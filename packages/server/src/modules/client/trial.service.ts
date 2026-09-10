import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, EntityManager, Repository } from 'typeorm'
import { BusinessException } from '@/common/exceptions/biz.exception'
import { ITrialConfig, trialRegToken } from '@/config'
import { ErrorEnum } from '@/constants/error-code.constant'
import { CredentialService } from '../credential/credential.service'
import { CryptoService } from '../crypto/crypto.service'
import { CustomerEntity } from '../customer/customer.entity'
import { LicenseEntity } from '../license/license.entity'
import { SequenceService } from '../license/sequence.service'
import { HeartbeatDto, TrialRegisterDto } from './client.dto'
import { HeartbeatEntity } from './usage.entity'
import { InstanceEntity } from './instance.entity'

export interface RegisterResult {
  instanceId: string
  instanceSecret: string
  credential: string
  licenseNo: string
  trialStartedAt: string
  serverTime: string
}

export interface HeartbeatResult {
  serverTime: string
  credential: string | null
  policy: { heartbeatSec: number; usageSec: number }
}

const DAY_MS = 86_400_000

@Injectable()
export class TrialService {
  private readonly logger = new Logger(TrialService.name)

  constructor(
    @InjectRepository(InstanceEntity)
    private readonly instanceRepo: Repository<InstanceEntity>,
    @InjectRepository(HeartbeatEntity)
    private readonly heartbeatRepo: Repository<HeartbeatEntity>,
    private readonly dataSource: DataSource,
    private readonly crypto: CryptoService,
    private readonly credentialService: CredentialService,
    private readonly sequenceService: SequenceService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 试用注册。
   *
   * 三条分支的核心目标只有一个：**试用起始时间只认最早那次。** 客户重装、
   * 清库、换指纹都不能把 30 天重新开始。分支一靠指纹唯一索引，分支二靠主机
   * 与数据库信号做模糊识别，分支三才是真正的新客户。
   */
  async register(dto: TrialRegisterDto, ip: string | null): Promise<RegisterResult> {
    const trial = this.configService.get<ITrialConfig>(trialRegToken)
    if (!trial.enabled) {
      throw new BusinessException(ErrorEnum.TRIAL_DISABLED)
    }

    const existing = await this.instanceRepo.findOne({ where: { fingerprint: dto.fingerprint } })
    if (existing) {
      return this.reuse(existing, dto, ip)
    }

    return this.dataSource.transaction(async manager => {
      // 事务内再查一次：并发首次注册时两个请求都会走到这里，
      // 唯一索引会让后来者插入失败，这里提前用行锁把它们排队
      const raced = await manager.findOne(InstanceEntity, {
        where: { fingerprint: dto.fingerprint },
        lock: { mode: 'pessimistic_write' },
      })
      if (raced) return this.reuse(raced, dto, ip, manager)

      const inherited = await this.findInheritedStart(dto, manager)
      const trialStartedAt = inherited?.trialStartedAt ?? new Date()

      if (inherited) {
        this.logger.warn(
          `指纹 ${short(dto.fingerprint)} 疑似重装（沿用 ${inherited.reason} 的起始时间 ` +
            `${trialStartedAt.toISOString()}）`,
        )
      }

      const { customer, license } = await this.provision(dto, trialStartedAt, trial, manager)

      const secret = this.crypto.randomToken(32)
      const instance = manager.create(InstanceEntity, {
        licenseId: license._id,
        customerId: customer._id,
        fingerprint: dto.fingerprint,
        installId: dto.installId,
        hostSignalHash: dto.hostSignalHash ?? null,
        dbSignal: dto.dbSignal ?? null,
        secretHash: this.crypto.sha256Hex(secret),
        secretCipher: this.crypto.encrypt(secret),
        status: 'active',
        trialStartedAt,
        suspectedReset: Boolean(inherited),
        productVersion: dto.instance.productVersion ?? null,
        hostName: dto.instance.hostName ?? null,
        osInfo: dto.instance.os ?? null,
        cpuCores: dto.instance.cpuCores ?? null,
        deployKind: dto.instance.deployKind ?? null,
        lastIp: ip,
      })
      await manager.save(InstanceEntity, instance)

      const issued = await this.credentialService.issue({
        license,
        customer,
        reason: 'trial_register',
        instanceId: instance._id,
        telemetryEndpoint: trial.telemetryEndpoint,
        manager,
      })

      return {
        instanceId: instance._id,
        instanceSecret: secret,
        credential: issued.jws,
        licenseNo: license.licenseNo,
        trialStartedAt: trialStartedAt.toISOString(),
        serverTime: new Date().toISOString(),
      }
    })
  }

  /**
   * 指纹命中已有实例：返回原有身份与原起始时间，不重置试用期。
   *
   * 会走到这里的正常场景是客户端拿到 secret 后没能持久化（进程崩溃、磁盘
   * 满）而重试注册。因此必须返回同一个 secret —— 这也是要在库里存密文备份
   * 而非只存哈希的原因。
   */
  private async reuse(
    instance: InstanceEntity,
    dto: TrialRegisterDto,
    ip: string | null,
    manager?: EntityManager,
  ): Promise<RegisterResult> {
    const repo = manager?.getRepository(InstanceEntity) ?? this.instanceRepo

    await repo.increment({ _id: instance._id }, 'reuseCount', 1)
    await repo.update(
      { _id: instance._id },
      {
        lastIp: ip,
        productVersion: dto.instance.productVersion ?? instance.productVersion,
        hostName: dto.instance.hostName ?? instance.hostName,
      },
    )

    const license = await (manager ?? this.dataSource.manager).findOne(LicenseEntity, {
      where: { _id: instance.licenseId },
    })
    const credential = await this.credentialService.findCurrentByLicense(instance.licenseId)

    if (!license || !credential) {
      // 实例存在但授权或凭证不见了，属于数据不一致，不该静默发一份新的试用
      throw new BusinessException(ErrorEnum.LICENSE_NOT_FOUND)
    }

    return {
      instanceId: instance._id,
      instanceSecret: this.crypto.decryptToString(instance.secretCipher),
      credential: credential.jws,
      licenseNo: license.licenseNo,
      trialStartedAt: instance.trialStartedAt.toISOString(),
      serverTime: new Date().toISOString(),
    }
  }

  /**
   * 指纹没命中，但主机或数据库信号命中过 —— 疑似重装。
   *
   * 取所有命中实例中**最早**的起始时间。客户反复重装刷试用期时，每次都会
   * 落到这条分支上并沿用最初那个时间，重装次数再多也无效。
   */
  private async findInheritedStart(
    dto: TrialRegisterDto,
    manager: EntityManager,
  ): Promise<{ trialStartedAt: Date; reason: string } | null> {
    const candidates: { field: string; value: string | null | undefined }[] = [
      { field: 'installId', value: dto.installId },
      { field: 'hostSignalHash', value: dto.hostSignalHash },
      { field: 'dbSignal', value: dto.dbSignal },
    ]

    let earliest: { trialStartedAt: Date; reason: string } | null = null

    for (const { field, value } of candidates) {
      if (!value) continue

      const hit = await manager.findOne(InstanceEntity, {
        where: { [field]: value },
        order: { trialStartedAt: 'ASC' },
      })
      if (!hit) continue

      if (!earliest || hit.trialStartedAt < earliest.trialStartedAt) {
        earliest = { trialStartedAt: hit.trialStartedAt, reason: field }
      }
    }

    return earliest
  }

  /** 全新试用客户：自动建客户与授权，不需要运营介入 */
  private async provision(
    dto: TrialRegisterDto,
    trialStartedAt: Date,
    trial: ITrialConfig,
    manager: EntityManager,
  ): Promise<{ customer: CustomerEntity; license: LicenseEntity }> {
    const label = dto.instance.hostName?.trim() || short(dto.fingerprint)

    const customer = manager.create(CustomerEntity, {
      name: `试用客户 (${label})`,
      shortName: label.slice(0, 32),
      stage: 'trial',
      source: 'trial_auto',
      status: 1,
    })
    await manager.save(CustomerEntity, customer)

    const license = manager.create(LicenseEntity, {
      licenseNo: await this.sequenceService.nextTrialNo(manager),
      customerId: customer._id,
      type: 'trial',
      status: 'active',
      startAt: trialStartedAt,
      // 到期日按继承来的起始时间算，重装刷不出新的 30 天
      endAt: new Date(trialStartedAt.getTime() + trial.days * DAY_MS),
      warnDays: trial.warnDays,
      maxUsers: trial.maxUsers,
      maxConcurrentTasks: trial.maxConcurrentTasks,
      tokenQuota: trial.tokenQuota,
      tokenQuotaPeriod: trial.tokenQuota ? 'total' : null,
      taskQuota: trial.taskQuota,
      taskQuotaPeriod: trial.taskQuota ? 'total' : null,
      overLimitRatio: trial.overLimitRatio,
      bindMode: 'tofu',
      maxInstances: 1,
      telemetryEnabled: true,
    })
    await manager.save(LicenseEntity, license)

    return { customer, license }
  }

  // -- 心跳 -----------------------------------------------------------------

  /**
   * 记录心跳，并在运营延长过试用期时把新凭证带回去。
   *
   * 心跳本身不做任何限额判定 —— 客户端已经拿凭证在本地判过了。这里只收集
   * 信息，因为客户随时可能断网，任何依赖心跳才能生效的策略都不可靠。
   */
  async heartbeat(
    instance: InstanceEntity,
    dto: HeartbeatDto,
    ip: string | null,
  ): Promise<HeartbeatResult> {
    const trial = this.configService.get<ITrialConfig>(trialRegToken)
    const now = new Date()

    const clientTime = dto.clientTime ? new Date(dto.clientTime) : null
    const clockSkewSec = clientTime
      ? Math.round((clientTime.getTime() - now.getTime()) / 1000)
      : null

    const heartbeat = new HeartbeatEntity()
    Object.assign(heartbeat, {
      instanceId: instance._id,
      licenseId: instance.licenseId,
      receivedAt: now,
      clientTime,
      clockSkewSec,
      productVersion: dto.productVersion ?? null,
      localState: dto.localState ?? null,
      localUserCount: dto.localUserCount ?? null,
      localCounters: dto.counters ? { ...dto.counters } : null,
      ip,
    })
    await this.heartbeatRepo.save(heartbeat)

    await this.instanceRepo.update(
      { _id: instance._id },
      {
        lastHeartbeatAt: now,
        lastIp: ip,
        productVersion: dto.productVersion ?? instance.productVersion,
      },
    )

    // 偏差超过容忍窗口就计数。单次偏差可能是 NTP 未同步，持续偏移才可疑
    if (clockSkewSec !== null && Math.abs(clockSkewSec) > trial.clockSkewWarnSec) {
      await this.instanceRepo.increment({ _id: instance._id }, 'driftCount', 1)
      this.logger.warn(`实例 ${instance._id} 时钟偏差 ${clockSkewSec}s`)
    }

    return {
      serverTime: now.toISOString(),
      credential: await this.resolveUpdatedCredential(instance, dto),
      policy: { heartbeatSec: trial.heartbeatSec, usageSec: trial.usageSec },
    }
  }

  /**
   * 只在客户端手里的凭证已经不是最新一份时才下发。
   *
   * 用 jti 比对而非到期日：运营可能调整的不止到期日，还有限额与功能开关，
   * 任何一项变了都会重新签发，jti 是唯一能覆盖所有情况的判据。
   */
  private async resolveUpdatedCredential(
    instance: InstanceEntity,
    dto: HeartbeatDto,
  ): Promise<string | null> {
    const current = await this.credentialService.findCurrentByLicense(instance.licenseId)
    if (!current) return null
    if (dto.credentialJti && dto.credentialJti === current.jti) return null

    // 客户端没报 jti 时不主动下发，避免每次心跳都白传一份凭证
    if (!dto.credentialJti) return null

    this.logger.log(`实例 ${instance._id} 凭证已更新，随心跳下发 ${current.jti}`)
    return current.jws
  }
}

function short(value: string): string {
  return value.slice(0, 12)
}
