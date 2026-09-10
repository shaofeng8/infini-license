/**
 * 客户端类型定义。
 *
 * LicensePayload 必须与服务端 packages/server/src/modules/credential/credential.types.ts
 * 保持一致。两份定义故意不共享：SDK 要以源码形式内嵌进 infini-proxy 与
 * infiniSynapse，不能依赖服务端代码。改动时两边同步。
 */

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

export interface LicensePayload {
  ver: number
  typ: 'formal' | 'trial'
  jti: string
  iss: string
  lid: string
  lno: string
  cid: string
  cname: string
  prod: string
  edition: string
  /** 签发时刻，Unix 秒 */
  iat: number
  /** Unix 秒；end 为 null 表示永久授权 */
  lic: { start: number; end: number | null }
  warnDays: number
  bind: { mode: 'tofu' | 'none'; maxInstances?: number }
  limits: LicenseLimits
  /** null = 全功能开放 */
  features: string[] | null
  telemetry: {
    enabled: boolean
    endpoint?: string
    instanceId?: string
    heartbeatSec?: number
    usageSec?: number
  }
  policy: { clockSkewTolSec?: number; reloadCheckSec?: number }
  support?: { name?: string; phone?: string; email?: string }
}

/** 授权状态。阻断与否完全由它决定 */
export type LicenseStatus =
  /** bootstrap 未完成。正常情况下外部观察不到 */
  | 'checking'
  /** 无凭证且试用不可用 */
  | 'missing'
  | 'trial_active'
  | 'trial_expiring'
  | 'trial_expired'
  | 'formal_active'
  | 'formal_expiring'
  | 'formal_expired'
  /** 验签失败或时钟异常 */
  | 'invalid'

/** 判定为 invalid 的具体原因，只写日志与事件，不对客户暴露 */
export type InvalidReason =
  | 'signature'
  | 'unknown_kid'
  | 'malformed'
  /**
   * 已不再产生。指纹不符现在只记 `fingerprint_mismatch` 事件、不阻断，原因见
   * evaluate.ts。保留这个取值是因为客户环境里还跑着旧版本客户端，它们导出的
   * 诊断信息与 `license_event` 历史行仍然带着它。
   */
  | 'fingerprint'
  | 'clock_rollback'
  | 'not_yet_valid'
  | 'issuer'

export interface LicenseState {
  status: LicenseStatus
  /** 是否阻断登录。UI 只该看这一个字段，不要自己按 status 推断 */
  loginBlocked: boolean
  /** 剩余天数；null 表示永久或不适用 */
  remainingDays: number | null
  /** 是否进入预警窗口 */
  warning: boolean
  invalidReason?: InvalidReason
  /** 展示用信息，一律来自验签后的 payload */
  customerName: string | null
  licenseNo: string | null
  licenseType: 'formal' | 'trial' | null
  edition: string | null
  /** Unix 毫秒 */
  expiresAt: number | null
  features: string[] | null
  limits: LicenseLimits | null
  support: LicensePayload['support'] | null
  /** 本次求值时刻，Unix 毫秒 */
  evaluatedAt: number
}

export interface ClockWatermark {
  /** 见过的最大时间戳，Unix 毫秒 */
  maxSeenTs: number
  /** 累计判定为回拨的次数 */
  rollbackCount: number
  /** 最近一次回拨的时刻，用于衰减 */
  lastRollbackAt?: number
  /**
   * 最近一次「可疑幅度的前跳」发生之前的水位，Unix 毫秒。
   *
   * 它是一张退票：时钟被修正回来时，回拨若落在这个值之上，就说明这是在撤销
   * 那次前跳而不是在篡改时间，据此放行并把水位一并降回去。详见 clock.ts。
   */
  jumpBaseTs?: number
}

export interface EvaluateInput {
  /** 当前时间，Unix 毫秒。由调用方传入而非函数内部取，保证可测 */
  now: number
  /** 验签通过的 payload；未通过或无凭证时为 null */
  payload: LicensePayload | null
  /** 凭证存在但验签/解析失败时的原因 */
  invalidReason?: InvalidReason
  /** 试用起始时刻，Unix 毫秒。无凭证时靠它判定试用期 */
  trialStartedAt?: number | null
  /** 试用天数 */
  trialDays?: number
  /** 试用预警天数 */
  trialWarnDays?: number
  /** 时钟水位。传入才做回拨检测 */
  clock?: ClockWatermark | null
  /** 是否允许试用。false 时无凭证直接进 missing */
  trialEnabled?: boolean
  /**
   * 是否真正执行阻断。false 时状态照常求值但 loginBlocked 恒为 false，
   * 用于灰度上线期间只弹提醒不锁人。
   */
  enforce?: boolean
}
