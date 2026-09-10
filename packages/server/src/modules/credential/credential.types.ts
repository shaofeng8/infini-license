/**
 * 凭证 payload。这份结构一旦发给客户就再也改不动了 —— 离线客户端不会升级，
 * 所有新增字段都必须可选，所有语义变更都必须靠 `ver` 分叉处理。
 *
 * 设计文档：docs/02-license-model.md §2
 */

export const LICENSE_PAYLOAD_VERSION = 2

export const LICENSE_ISSUER = 'infini-license'

export interface QuotaSpec {
  limit: number
  period: 'total' | 'monthly'
}

export interface LicenseLimits {
  maxUsers?: number | null
  maxConcurrentTasks?: number | null
  tokenQuota?: QuotaSpec | null
  taskQuota?: QuotaSpec | null
  overLimitRatio?: number
}

export interface LicenseTerm {
  /** Unix 秒 */
  start: number
  /** Unix 秒；null = 永久授权 */
  end: number | null
}

export interface LicenseBinding {
  mode: 'tofu' | 'none'
  maxInstances?: number
}

export interface LicenseTelemetry {
  enabled: boolean
  /** 仅 trial 携带 */
  endpoint?: string
  instanceId?: string
  heartbeatSec?: number
  usageSec?: number
}

export interface LicensePolicy {
  clockSkewTolSec?: number
  reloadCheckSec?: number
}

export interface LicenseSupportInfo {
  name?: string
  phone?: string
  email?: string
}

export interface LicensePayload {
  ver: number
  typ: 'formal' | 'trial'
  jti: string
  iss: string
  /** 授权记录 id */
  lid: string
  /** 授权编号，续期不变 */
  lno: string
  /** 客户 id 与名称。过期阻断页要显示客户名，所以必须冻结在凭证里 */
  cid: string
  cname: string
  prod: string
  edition: string
  /** 签发时刻，Unix 秒 */
  iat: number
  lic: LicenseTerm
  warnDays: number
  bind: LicenseBinding
  limits: LicenseLimits
  /** null = 全功能开放 */
  features: string[] | null
  telemetry: LicenseTelemetry
  policy: LicensePolicy
  support?: LicenseSupportInfo

  /**
   * 故意没有 `exp`。
   *
   * JWS 签名永久有效，授权有效性完全交给 `lic.end` 判断。若给 JWS 设了 exp，
   * 凭证过期后客户端连 payload 都解不出来，阻断页只能显示一句「凭证无效」，
   * 客户和我们的支持人员都无从下手；现在过期后依然能读出客户名、授权编号、
   * 到期日和联系方式，屏幕上就有了可执行的下一步。
   */
}
