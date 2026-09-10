export const DAY_MS = 86_400_000

export const JWS_TYP = 'INFI-LIC'

export const LICENSE_ISSUER = 'infini-license'

/** 时钟回拨容忍窗口：小于这个幅度视为 NTP 正常校时 */
export const DEFAULT_CLOCK_SKEW_TOL_SEC = 3600

/** 单次回拨超过这个幅度直接判死，不给累计的机会 */
export const HARD_ROLLBACK_DAYS = 7

/** 累计回拨次数达到这个值判死 */
export const MAX_ROLLBACK_COUNT = 3

/** 回拨计数的衰减周期：这么久没再回拨就清零 */
export const ROLLBACK_DECAY_MS = DAY_MS

/**
 * 前跳超过这个天数时，水位完全不推进。
 *
 * 往前调时钟对攻击者没有好处（授权只会提前到期），但意外前跳后果严重：
 * 主板电池耗尽让系统时间跳到 2099 年，若把水位跟着推上去，等时间恢复正常后
 * 每次校验都会被判成巨幅回拨，客户从此锁死且无法自愈。
 */
export const MAX_WATERMARK_ADVANCE_DAYS = 30

export const DEFAULT_TRIAL_DAYS = 30

export const DEFAULT_TRIAL_WARN_DAYS = 7

export const DEFAULT_FORMAL_WARN_DAYS = 15

export const DEFAULT_OVER_LIMIT_RATIO = 1.1
