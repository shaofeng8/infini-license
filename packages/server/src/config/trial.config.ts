import { ConfigType, registerAs } from '@nestjs/config'

export const trialRegToken = 'trial'

/**
 * 试用默认参数。客户端注册试用时套用这套值签发 trial 凭证。
 * 限额为 0 或负数一律视为「不限制」，写进凭证时会转成 null。
 */
export const TrialConfig = registerAs(trialRegToken, () => ({
  enabled: process.env.TRIAL_REGISTER_ENABLED !== 'false',
  days: Number(process.env.TRIAL_DAYS ?? 30),
  warnDays: Number(process.env.TRIAL_WARN_DAYS ?? 7),
  maxUsers: normalizeLimit(process.env.TRIAL_MAX_USERS, 10),
  tokenQuota: normalizeLimit(process.env.TRIAL_TOKEN_QUOTA, 50_000_000),
  taskQuota: normalizeLimit(process.env.TRIAL_TASK_QUOTA, 2000),
  maxConcurrentTasks: normalizeLimit(process.env.TRIAL_MAX_CONCURRENT_TASKS, 2),
  /** 用量超限的软阈值。试用给的余量比正式客户小，超了就该来谈签约 */
  overLimitRatio: Number(process.env.TRIAL_OVER_LIMIT_RATIO ?? 1.05),
  /** 客户端 HMAC 请求允许的时间戳偏差 */
  requestSkewSec: Number(process.env.TRIAL_REQUEST_SKEW_SEC ?? 300),

  /**
   * 写进试用凭证的上报地址。
   *
   * 必须是客户环境能解析的公网地址，且**签发后就固定在凭证里无法更改** ——
   * 客户装完就断网的话，我们没有任何通道去纠正它。换域名要靠重新签发。
   */
  telemetryEndpoint: process.env.TRIAL_TELEMETRY_ENDPOINT ?? 'https://license.infinisynapse.cn',
  /** 随心跳下发给客户端的上报节奏 */
  heartbeatSec: Number(process.env.TRIAL_HEARTBEAT_SEC ?? 3600),
  usageSec: Number(process.env.TRIAL_USAGE_SEC ?? 900),
  /** 心跳里客户端时钟偏差超过这个值就计入 drift_count */
  clockSkewWarnSec: Number(process.env.TRIAL_CLOCK_SKEW_WARN_SEC ?? 300),

  /** 注册限流：同 IP 每小时、同指纹每天 */
  registerPerIpHourly: Number(process.env.TRIAL_REGISTER_PER_IP_HOURLY ?? 10),
  registerPerFingerprintDaily: Number(process.env.TRIAL_REGISTER_PER_FP_DAILY ?? 24),
}))

function normalizeLimit(raw: string | undefined, fallback: number | null): number | null {
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (Number.isNaN(value) || value <= 0) return null
  return value
}

export type ITrialConfig = ConfigType<typeof TrialConfig>
