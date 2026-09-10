import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, EntityManager, Repository } from 'typeorm'
import { BusinessException } from '@/common/exceptions/biz.exception'
import { ErrorEnum } from '@/constants/error-code.constant'
import { PageResult } from '@/common/model/response.model'
import { ISecurityConfig, securityRegToken } from '@/config'
import { AuditService } from '../audit/audit.service'
import { AuthUser } from '../auth/auth.decorator'
import { CredentialService, IssuedCredential } from '../credential/credential.service'
import { CustomerService } from '../customer/customer.service'
import { IssueLicenseDto, QueryLicenseDto, RenewLicenseDto } from './license.dto'
import { LicenseEntity, LicenseLimitsPatch, LicenseStatus } from './license.entity'
import { SequenceService } from './sequence.service'

const DAY_MS = 86_400_000

@Injectable()
export class LicenseService {
  private readonly logger = new Logger(LicenseService.name)

  constructor(
    @InjectRepository(LicenseEntity)
    private readonly repo: Repository<LicenseEntity>,
    private readonly dataSource: DataSource,
    private readonly customerService: CustomerService,
    private readonly credentialService: CredentialService,
    private readonly sequenceService: SequenceService,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService,
  ) {}

  // -- 查询 -----------------------------------------------------------------

  async paginate(query: QueryLicenseDto): Promise<PageResult<any>> {
    const qb = this.repo
      .createQueryBuilder('l')
      .leftJoin('lc_customer', 'c', 'c._id = l.customer_id')
      .addSelect('c.name', 'customerName')
      .orderBy('l.created_at', 'DESC')

    if (query.keyword) {
      qb.andWhere('(l.license_no LIKE :kw OR c.name LIKE :kw)', { kw: `%${query.keyword}%` })
    }
    if (query.customerId) qb.andWhere('l.customer_id = :cid', { cid: query.customerId })
    if (query.type) qb.andWhere('l.type = :type', { type: query.type })
    if (query.status) qb.andWhere('l.status = :status', { status: query.status })
    if (query.expiringInDays) {
      qb.andWhere('l.end_at IS NOT NULL')
        .andWhere('l.end_at > NOW()')
        .andWhere('l.end_at <= DATE_ADD(NOW(), INTERVAL :days DAY)', { days: query.expiringInDays })
    }

    const total = await qb.getCount()

    // 这里必须用 offset/limit，不能用 skip/take。
    //
    // skip/take 会让 TypeORM 改走「先查一批 distinct 主键、再按主键取行」的
    // 两段式分页，那条路要为每个 select 项找 ColumnMetadata；而上面的
    // `addSelect('c.name', ...)` 挂在 leftJoin 的**表名**别名上（不是实体
    // 关联），压根没有元数据，于是抛 `undefined.databaseName`，整个接口 500。
    //
    // skip/take 存在的意义是防止 join 出来的重复行把一页吃掉，而这里
    // 一份授权只对应一个客户，不会有行放大，offset/limit 语义上完全等价。
    const { entities, raw } = await qb
      .offset(query.skip)
      .limit(query.pageSize)
      .getRawAndEntities()

    const items = entities.map((entity, index) => ({
      ...entity,
      customerName: raw[index]?.customerName ?? null,
      remainingDays: this.remainingDays(entity),
    }))

    return new PageResult(items, total, query.page, query.pageSize)
  }

  async findById(id: string, manager?: EntityManager): Promise<LicenseEntity> {
    const repo = manager ? manager.getRepository(LicenseEntity) : this.repo
    const license = await repo.findOne({ where: { _id: id } })
    if (!license) {
      throw new BusinessException(ErrorEnum.LICENSE_NOT_FOUND)
    }
    return license
  }

  async detail(id: string) {
    const license = await this.findById(id)
    const [customer, credentials] = await Promise.all([
      this.customerService.findById(license.customerId),
      this.credentialService.listByLicense(id),
    ])

    return {
      ...license,
      customerName: customer.name,
      remainingDays: this.remainingDays(license),
      credentials: credentials.map(c => ({
        id: c._id,
        jti: c.jti,
        kid: c.kid,
        issueReason: c.issueReason,
        issuedAt: c.issuedAt,
        validFrom: c.validFrom,
        validUntil: c.validUntil,
        checksum: c.checksum,
        downloadCount: c.downloadCount,
        lastDownloadAt: c.lastDownloadAt,
        isCurrent: c.supersededBy === null,
      })),
    }
  }

  // -- 签发 -----------------------------------------------------------------

  /**
   * 签发正式授权：建授权记录 + 签凭证，一个事务内完成。
   *
   * 分开做会留下「有授权记录但没凭证」的半成品，运维在后台看到一条授权
   * 却下载不到文件，只能靠人工排查。宁可整体失败重来。
   */
  async issue(dto: IssueLicenseDto, operator: AuthUser): Promise<IssuedCredential> {
    const startAt = new Date(dto.startAt)
    const endAt = dto.endAt ? new Date(dto.endAt) : null
    const term = this.assertTerm(startAt, endAt)

    const result = await this.dataSource.transaction(async trx => {
      const customer = await this.customerService.findActiveById(dto.customerId, trx)
      const licenseNo = await this.sequenceService.nextLicenseNo(trx)
      const repo = trx.getRepository(LicenseEntity)

      const license = await repo.save(
        repo.create({
          licenseNo,
          customerId: customer._id,
          type: 'formal',
          product: dto.product ?? 'infinisynapse',
          edition: dto.edition ?? 'enterprise',
          status: this.deriveStatus(startAt, endAt),
          startAt,
          endAt,
          warnDays: dto.warnDays ?? 15,
          maxUsers: dto.maxUsers ?? null,
          maxConcurrentTasks: dto.maxConcurrentTasks ?? null,
          tokenQuota: dto.tokenQuota ?? null,
          tokenQuotaPeriod: dto.tokenQuota ? (dto.tokenQuotaPeriod ?? 'total') : null,
          taskQuota: dto.taskQuota ?? null,
          taskQuotaPeriod: dto.taskQuota ? (dto.taskQuotaPeriod ?? 'total') : null,
          overLimitRatio: dto.overLimitRatio ?? 1.1,
          featuresJson: dto.features?.length ? dto.features : null,
          bindMode: dto.bindMode ?? 'tofu',
          maxInstances: 1,
          // 正式授权恒不上报，这是与试用的根本区别，不接受入参覆盖
          telemetryEnabled: false,
          convertedFromId: dto.convertedFromId ?? null,
          contractNo: dto.contractNo ?? null,
          remark: dto.remark ?? null,
          createdBy: operator.id,
        }),
      )

      const issued = await this.credentialService.issue({
        license,
        customer,
        reason: dto.convertedFromId ? 'convert' : 'issue',
        operatorId: operator.id,
        manager: trx,
      })

      if (dto.convertedFromId) {
        await this.markTrialConverted(dto.convertedFromId, trx)
      }

      return { issued, license, customerName: customer.name }
    })

    await this.auditService.record({
      actorId: operator.id,
      actorName: operator.username,
      action: 'license.issue',
      targetType: 'license',
      targetId: result.license._id,
      summary: `为 ${result.customerName} 签发 ${result.license.licenseNo}`,
      detail: {
        licenseNo: result.license.licenseNo,
        startAt: dto.startAt,
        endAt: dto.endAt ?? null,
        termDays: term.termDays,
        longTerm: term.longTerm,
        checksum: result.issued.credential.checksum,
      },
    })

    return result.issued
  }

  /**
   * 续期：在**原授权记录**上延长到期日并签发新凭证，授权编号不变。
   *
   * 不新建记录是为了让客户手里的授权编号保持稳定——报障时说得出的那个编号
   * 必须能在后台查到。历史通过 lc_credential 的凭证链保留，每份旧凭证的
   * payload 里都冻结了当时的有效期与限额。
   */
  async renew(id: string, dto: RenewLicenseDto, operator: AuthUser): Promise<IssuedCredential> {
    const newEndAt = new Date(dto.endAt)

    const result = await this.dataSource.transaction(async trx => {
      const license = await this.findById(id, trx)

      if (license.type !== 'formal') {
        throw new BusinessException(ErrorEnum.LICENSE_TYPE_MISMATCH, '试用授权请走转正流程')
      }
      if (license.status === 'void') {
        throw new BusinessException(ErrorEnum.LICENSE_VOIDED)
      }
      if (license.endAt && newEndAt.getTime() <= license.endAt.getTime()) {
        throw new BusinessException(ErrorEnum.LICENSE_TERM_INVALID, '新到期日必须晚于当前到期日')
      }
      // 续期时长从「现在」而不是「原生效日」起算：原授权可能已经过期很久，
      // 从原生效日算出来的天数会虚高，超长告警会被误触发。
      const term = this.assertTerm(new Date(), newEndAt)

      const customer = await this.customerService.findActiveById(license.customerId, trx)
      const repo = trx.getRepository(LicenseEntity)

      const patch: Partial<LicenseEntity> = {
        endAt: newEndAt,
        status: this.deriveStatus(license.startAt, newEndAt),
        warnDays: dto.warnDays ?? license.warnDays,
        renewedAt: new Date(),
        renewCount: license.renewCount + 1,
        contractNo: dto.contractNo ?? license.contractNo,
      }
      if (dto.features !== undefined) {
        patch.featuresJson = dto.features.length ? dto.features : null
      }
      if (dto.updateLimits) {
        Object.assign(patch, this.buildLimitsPatch(dto))
      }

      await repo.update({ _id: id }, patch)
      const updated = await this.findById(id, trx)

      const issued = await this.credentialService.issue({
        license: updated,
        customer,
        reason: 'renew',
        operatorId: operator.id,
        manager: trx,
      })

      return {
        issued,
        license: updated,
        customerName: customer.name,
        previousEnd: license.endAt,
        term,
      }
    })

    await this.auditService.record({
      actorId: operator.id,
      actorName: operator.username,
      action: 'license.renew',
      targetType: 'license',
      targetId: id,
      summary: `${result.license.licenseNo} 续期至 ${dto.endAt.slice(0, 10)}`,
      detail: {
        previousEnd: result.previousEnd,
        newEnd: dto.endAt,
        termDays: result.term.termDays,
        longTerm: result.term.longTerm,
        reason: dto.reason ?? null,
        checksum: result.issued.credential.checksum,
      },
    })

    return result.issued
  }

  /**
   * 重新签发一份内容相同的凭证。
   *
   * 用在客户把 license.key 弄丢、或者机器指纹绑错需要重新 TOFU 的场景。
   * 有效期不变，只换 jti —— 老凭证在客户那边其实还能用，这里换新是为了
   * 让后台的「当前凭证」指向明确，避免一份授权对着两个流传在外的文件。
   */
  async reissue(id: string, operator: AuthUser, reason?: string): Promise<IssuedCredential> {
    const result = await this.dataSource.transaction(async trx => {
      const license = await this.findById(id, trx)
      if (license.status === 'void') {
        throw new BusinessException(ErrorEnum.LICENSE_VOIDED)
      }
      const customer = await this.customerService.findActiveById(license.customerId, trx)
      const issued = await this.credentialService.issue({
        license,
        customer,
        reason: 'reissue',
        operatorId: operator.id,
        manager: trx,
      })
      return { issued, license, customerName: customer.name }
    })

    await this.auditService.record({
      actorId: operator.id,
      actorName: operator.username,
      action: 'license.reissue',
      targetType: 'license',
      targetId: id,
      summary: `重新签发 ${result.license.licenseNo}`,
      detail: { reason: reason ?? null, checksum: result.issued.credential.checksum },
    })

    return result.issued
  }

  /**
   * 作废授权。
   *
   * 这**只是后台的账面状态**，对客户环境没有任何影响 —— 正式授权完全离线，
   * 我们没有下发吊销的通道。真要停掉客户的使用，只能靠合同和到期日。
   * 作废的实际用途是把误签、重复签的记录从有效列表里清出去。
   */
  async voidLicense(id: string, operator: AuthUser, reason: string): Promise<void> {
    const license = await this.findById(id)
    await this.repo.update({ _id: id }, { status: 'void' })

    await this.auditService.record({
      actorId: operator.id,
      actorName: operator.username,
      action: 'license.void',
      targetType: 'license',
      targetId: id,
      summary: `作废 ${license.licenseNo}`,
      detail: { reason, note: '仅后台状态，客户环境不受影响' },
    })
  }

  // -- 状态维护 -------------------------------------------------------------

  /** 每日刷新派生状态，仅用于列表筛选；业务判断一律直接比日期 */
  async refreshStatuses(): Promise<number> {
    const now = new Date()

    const toActive = await this.repo
      .createQueryBuilder()
      .update(LicenseEntity)
      .set({ status: 'active' })
      .where('status = :pending', { pending: 'pending' })
      .andWhere('start_at <= :now', { now })
      .andWhere('(end_at IS NULL OR end_at > :now)', { now })
      .execute()

    const toExpired = await this.repo
      .createQueryBuilder()
      .update(LicenseEntity)
      .set({ status: 'expired' })
      .where('status IN (:...live)', { live: ['pending', 'active'] })
      .andWhere('end_at IS NOT NULL')
      .andWhere('end_at <= :now', { now })
      .execute()

    const changed = (toActive.affected ?? 0) + (toExpired.affected ?? 0)
    if (changed > 0) {
      this.logger.log(`授权状态刷新完成，变更 ${changed} 条`)
    }
    return changed
  }

  async expiringSoon(days = 30) {
    return this.repo
      .createQueryBuilder('l')
      .leftJoin('lc_customer', 'c', 'c._id = l.customer_id')
      .addSelect('c.name', 'customerName')
      .where('l.type = :type', { type: 'formal' })
      .andWhere('l.status != :void', { void: 'void' })
      .andWhere('l.end_at IS NOT NULL')
      .andWhere('l.end_at > NOW()')
      .andWhere('l.end_at <= DATE_ADD(NOW(), INTERVAL :days DAY)', { days })
      .orderBy('l.end_at', 'ASC')
      .getRawAndEntities()
      .then(({ entities, raw }) =>
        entities.map((entity, index) => ({
          ...entity,
          customerName: raw[index]?.customerName ?? null,
          remainingDays: this.remainingDays(entity),
        })),
      )
  }

  // -- 内部工具 -------------------------------------------------------------

  private async markTrialConverted(trialLicenseId: string, trx: EntityManager): Promise<void> {
    const trial = await trx.getRepository(LicenseEntity).findOne({ where: { _id: trialLicenseId } })
    if (!trial) {
      throw new BusinessException(ErrorEnum.LICENSE_NOT_FOUND, '待转正的试用授权不存在')
    }
    if (trial.type !== 'trial') {
      throw new BusinessException(ErrorEnum.LICENSE_TYPE_MISMATCH, '来源授权不是试用类型')
    }
    await trx.getRepository(LicenseEntity).update({ _id: trialLicenseId }, { status: 'void' })
  }

  private buildLimitsPatch(dto: LicenseLimitsPatch): Partial<LicenseEntity> {
    return {
      maxUsers: dto.maxUsers ?? null,
      maxConcurrentTasks: dto.maxConcurrentTasks ?? null,
      tokenQuota: dto.tokenQuota ?? null,
      tokenQuotaPeriod: dto.tokenQuota ? (dto.tokenQuotaPeriod ?? 'total') : null,
      taskQuota: dto.taskQuota ?? null,
      taskQuotaPeriod: dto.taskQuota ? (dto.taskQuotaPeriod ?? 'total') : null,
      overLimitRatio: dto.overLimitRatio ?? 1.1,
    }
  }

  /**
   * 校验有效期区间，并返回是否属于超长签发。
   *
   * 默认不设有效期上限（`LICENSE_MAX_TERM_DAYS=0`），由签发人自行判断 ——
   * 商务上确实存在多年期合同。但因为没有远程吊销通道，一份签出去五年的凭证
   * 在这五年里我们完全无从干预，所以超过 longTermWarnDays 的签发会记日志并在
   * 审计详情里打标，事后能查得到是谁在什么时候签的。
   */
  private assertTerm(startAt: Date, endAt: Date | null): { longTerm: boolean; termDays: number | null } {
    if (Number.isNaN(startAt.getTime())) {
      throw new BusinessException(ErrorEnum.LICENSE_TERM_INVALID, '生效日期无法解析')
    }

    const { maxTermDays, longTermWarnDays } = this.configService.get<ISecurityConfig>(securityRegToken)

    if (!endAt) {
      this.logger.warn('正在签发永久授权，无到期日可依赖，风险由签发人承担')
      return { longTerm: true, termDays: null }
    }
    if (Number.isNaN(endAt.getTime())) {
      throw new BusinessException(ErrorEnum.LICENSE_TERM_INVALID, '到期日期无法解析')
    }
    if (endAt.getTime() <= startAt.getTime()) {
      throw new BusinessException(ErrorEnum.LICENSE_TERM_INVALID, '到期日必须晚于生效日')
    }

    const termDays = Math.ceil((endAt.getTime() - startAt.getTime()) / DAY_MS)

    if (maxTermDays > 0 && termDays > maxTermDays) {
      throw new BusinessException(
        ErrorEnum.LICENSE_TERM_TOO_LONG,
        `本次为 ${termDays} 天，上限 ${maxTermDays} 天`,
      )
    }

    const longTerm = termDays > longTermWarnDays
    if (longTerm) {
      this.logger.warn(`正在签发超长期授权：${termDays} 天，期间无法远程干预`)
    }
    return { longTerm, termDays }
  }

  private deriveStatus(startAt: Date, endAt: Date | null): LicenseStatus {
    const now = Date.now()
    if (endAt && endAt.getTime() <= now) return 'expired'
    if (startAt.getTime() > now) return 'pending'
    return 'active'
  }

  private remainingDays(license: LicenseEntity): number | null {
    if (!license.endAt) return null
    return Math.ceil((license.endAt.getTime() - Date.now()) / DAY_MS)
  }
}
