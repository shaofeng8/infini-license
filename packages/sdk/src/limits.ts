import { DEFAULT_OVER_LIMIT_RATIO } from './constants'
import { LicenseLimits, LicenseState, QuotaSpec } from './types'

export type LimitKind = 'maxUsers' | 'maxConcurrentTasks' | 'tokenQuota' | 'taskQuota'

export interface LimitVerdict {
  kind: LimitKind
  /** 限额值；null 表示不限制 */
  limit: number | null
  used: number
  /** 已用比例；不限制时为 0 */
  ratio: number
  /** 是否已达到限额 */
  reached: boolean
  /** 是否超过软阈值，需要真正拦截 */
  blocked: boolean
  /** 是否进入提醒区间（80%） */
  warning: boolean
}

export interface UsageSnapshot {
  userCount?: number
  concurrentTasks?: number
  /** 当前统计周期内的 token 消耗 */
  tokensUsed?: number
  /** 当前统计周期内的任务数 */
  tasksUsed?: number
}

const WARN_RATIO = 0.8

/**
 * 判定各限额维度的状态。纯函数。
 *
 * 用量超限不硬性拦断，而是留一个软阈值（默认 1.1 倍）。原因是用量统计天然
 * 有滞后和口径差异 —— 一次长任务的 token 要等结束才结算，代理层和应用层的
 * 计数也不会完全一致。卡在恰好 100% 会让客户在正常使用中被莫名打断，
 * 而客户环境里我们没有远程放行的手段。
 */
export function checkLimits(limits: LicenseLimits | null, usage: UsageSnapshot): LimitVerdict[] {
  if (!limits) return []

  const ratio = limits.overLimitRatio ?? DEFAULT_OVER_LIMIT_RATIO

  return [
    verdict('maxUsers', limits.maxUsers ?? null, usage.userCount ?? 0, ratio),
    verdict(
      'maxConcurrentTasks',
      limits.maxConcurrentTasks ?? null,
      usage.concurrentTasks ?? 0,
      ratio,
    ),
    verdict('tokenQuota', quotaLimit(limits.tokenQuota), usage.tokensUsed ?? 0, ratio),
    verdict('taskQuota', quotaLimit(limits.taskQuota), usage.tasksUsed ?? 0, ratio),
  ]
}

/** 只取需要拦截的维度 */
export function blockedLimits(limits: LicenseLimits | null, usage: UsageSnapshot): LimitVerdict[] {
  return checkLimits(limits, usage).filter(v => v.blocked)
}

/**
 * 能否再创建一个用户。
 *
 * 用户数与 token 用量不同：它是可控的、离散的、没有统计滞后的，所以这里
 * **卡在硬限额上而不用软阈值**。买了 50 个人的授权就不该建出第 51 个。
 */
export function canCreateUser(limits: LicenseLimits | null, currentUserCount: number): boolean {
  const max = limits?.maxUsers ?? null
  if (max === null) return true
  return currentUserCount < max
}

/** 功能是否在授权范围内。features 为 null 表示全功能开放 */
export function isFeatureEnabled(state: LicenseState | null, feature: string): boolean {
  if (!state) return false
  if (state.features === null) return true
  return state.features.includes(feature)
}

function quotaLimit(quota: QuotaSpec | null | undefined): number | null {
  if (!quota || quota.limit <= 0) return null
  return quota.limit
}

function verdict(
  kind: LimitKind,
  limit: number | null,
  used: number,
  overLimitRatio: number,
): LimitVerdict {
  if (limit === null) {
    return { kind, limit: null, used, ratio: 0, reached: false, blocked: false, warning: false }
  }

  const ratio = used / limit
  return {
    kind,
    limit,
    used,
    ratio,
    reached: used >= limit,
    blocked: used >= limit * overLimitRatio,
    warning: ratio >= WARN_RATIO,
  }
}
