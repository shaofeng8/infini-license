import { createHash, randomBytes } from 'crypto'
import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { EntityManager, Repository } from 'typeorm'
import { BusinessException } from '@/common/exceptions/biz.exception'
import { ErrorEnum } from '@/constants/error-code.constant'
import { JwsService } from '../crypto/jws.service'
import { CustomerEntity } from '../customer/customer.entity'
import { LicenseEntity } from '../license/license.entity'
import { SigningKeyService } from '../signing-key/signing-key.service'
import { CredentialEntity, IssueReason } from './credential.entity'
import {
  LICENSE_ISSUER,
  LICENSE_PAYLOAD_VERSION,
  LicenseLimits,
  LicensePayload,
  QuotaSpec,
} from './credential.types'
import { buildLicenseEnvelope, EnvelopeHeaderFields } from './license-envelope.util'

export interface IssueCredentialOptions {
  license: LicenseEntity
  customer: CustomerEntity
  reason: IssueReason
  /** 仅试用凭证需要：绑定的实例 id 与上报端点 */
  instanceId?: string
  telemetryEndpoint?: string
  operatorId?: string
  manager?: EntityManager
}

export interface IssuedCredential {
  credential: CredentialEntity
  jws: string
  envelope: string
  fileName: string
}

@Injectable()
export class CredentialService {
  private readonly logger = new Logger(CredentialService.name)

  constructor(
    @InjectRepository(CredentialEntity)
    private readonly repo: Repository<CredentialEntity>,
    private readonly signingKeyService: SigningKeyService,
    private readonly jwsService: JwsService,
  ) {}

  /**
   * 签发一份凭证：构造 payload → 签名 → 落库 → 生成 license.key 文本。
   *
   * 签完立刻用公钥验一遍。多花不到一毫秒，换来的是「绝不会把一份验不过的
   * 凭证发给客户」—— 客户拿到坏文件后我们没有任何远程修复手段，只能重走
   * 一遍交付流程，这个代价远高于一次验签。
   */
  async issue(options: IssueCredentialOptions): Promise<IssuedCredential> {
    const { license, customer, reason, instanceId, telemetryEndpoint, operatorId } = options

    const signingKey = await this.signingKeyService.getActiveKey()
    const privateKeyPem = await this.signingKeyService.getPrivateKeyPem(signingKey.kid)

    const issuedAt = new Date()
    const jti = `cred_${randomBytes(12).toString('hex')}`
    const payload = this.buildPayload({
      license,
      customer,
      jti,
      issuedAt,
      instanceId,
      telemetryEndpoint,
    })

    const jws = this.jwsService.sign(payload, signingKey.kid, privateKeyPem)

    const selfCheck = this.jwsService.verify(jws, signingKey.publicKey)
    if (!selfCheck.valid) {
      this.logger.error(`凭证签发后自检失败：${selfCheck.reason}，kid=${signingKey.kid}`)
      throw new BusinessException(ErrorEnum.SERVER_ERROR, '凭证自检未通过，已中止签发')
    }

    const checksum = createHash('sha256').update(jws).digest('hex').slice(0, 16)

    const entity = this.repo.create({
      jti,
      licenseId: license._id,
      instanceId: instanceId ?? null,
      kid: signingKey.kid,
      credType: license.type,
      issueReason: reason,
      issuedAt,
      validFrom: license.startAt,
      validUntil: license.endAt,
      payloadJson: payload,
      jws,
      checksum,
      createdBy: operatorId ?? null,
    })

    const repo = options.manager ? options.manager.getRepository(CredentialEntity) : this.repo
    const saved = await repo.save(entity)

    // 同一份授权的老凭证标记为已被取代，便于后台只展示当前有效的那一份
    await repo
      .createQueryBuilder()
      .update(CredentialEntity)
      .set({ supersededBy: saved._id })
      .where('license_id = :licenseId', { licenseId: license._id })
      .andWhere('_id != :selfId', { selfId: saved._id })
      .andWhere('superseded_by IS NULL')
      .execute()

    return {
      credential: saved,
      jws,
      envelope: buildLicenseEnvelope(jws, this.buildEnvelopeFields(payload, checksum)),
      fileName: 'license.key',
    }
  }

  /** 重新下载已签发的凭证原文，不重新签名 */
  async download(credentialId: string): Promise<IssuedCredential> {
    const credential = await this.repo.findOne({ where: { _id: credentialId } })
    if (!credential) {
      throw new BusinessException(ErrorEnum.CREDENTIAL_NOT_FOUND)
    }

    await this.repo.update(
      { _id: credentialId },
      { downloadCount: () => 'download_count + 1', lastDownloadAt: new Date() },
    )

    return {
      credential,
      jws: credential.jws,
      envelope: buildLicenseEnvelope(
        credential.jws,
        this.buildEnvelopeFields(credential.payloadJson, credential.checksum),
      ),
      fileName: 'license.key',
    }
  }

  async findCurrentByLicense(licenseId: string): Promise<CredentialEntity | null> {
    return this.repo.findOne({
      where: { licenseId, supersededBy: null },
      order: { issuedAt: 'DESC' },
    })
  }

  async listByLicense(licenseId: string): Promise<CredentialEntity[]> {
    return this.repo.find({ where: { licenseId }, order: { issuedAt: 'DESC' } })
  }

  // -- payload 构造 ---------------------------------------------------------

  private buildPayload(args: {
    license: LicenseEntity
    customer: CustomerEntity
    jti: string
    issuedAt: Date
    instanceId?: string
    telemetryEndpoint?: string
  }): LicensePayload {
    const { license, customer, jti, issuedAt, instanceId, telemetryEndpoint } = args
    const isTrial = license.type === 'trial'

    return {
      ver: LICENSE_PAYLOAD_VERSION,
      typ: license.type,
      jti,
      iss: LICENSE_ISSUER,
      lid: license._id,
      lno: license.licenseNo,
      cid: customer._id,
      cname: customer.name,
      prod: license.product,
      edition: license.edition,
      iat: toUnix(issuedAt),
      lic: {
        start: toUnix(license.startAt),
        end: license.endAt ? toUnix(license.endAt) : null,
      },
      warnDays: license.warnDays,
      bind: {
        mode: license.bindMode,
        maxInstances: license.maxInstances,
      },
      limits: this.buildLimits(license),
      features: license.featuresJson ?? null,
      telemetry: isTrial
        ? {
            enabled: true,
            endpoint: telemetryEndpoint,
            instanceId,
            heartbeatSec: 3600,
            usageSec: 900,
          }
        : { enabled: false },
      policy: {
        clockSkewTolSec: 3600,
        reloadCheckSec: 60,
      },
      support: {
        name: process.env.SUPPORT_NAME || 'InfiniSynapse 客户成功',
        phone: process.env.SUPPORT_PHONE || undefined,
        email: process.env.SUPPORT_EMAIL || undefined,
      },
    }
  }

  private buildLimits(license: LicenseEntity): LicenseLimits {
    return {
      maxUsers: license.maxUsers ?? null,
      maxConcurrentTasks: license.maxConcurrentTasks ?? null,
      tokenQuota: toQuota(license.tokenQuota, license.tokenQuotaPeriod),
      taskQuota: toQuota(license.taskQuota, license.taskQuotaPeriod),
      overLimitRatio: license.overLimitRatio ?? 1.1,
    }
  }

  private buildEnvelopeFields(payload: LicensePayload, checksum: string): EnvelopeHeaderFields {
    return {
      customer: payload.cname,
      licenseNo: payload.lno,
      edition: payload.edition,
      validUntil: payload.lic.end ? formatDate(payload.lic.end) : '永久',
      issuedAt: formatDate(payload.iat),
      fingerprint: checksum,
    }
  }
}

function toQuota(limit: number | null, period: string | null): QuotaSpec | null {
  if (limit === null || limit === undefined || limit <= 0) return null
  return { limit, period: period === 'monthly' ? 'monthly' : 'total' }
}

function toUnix(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10)
}
