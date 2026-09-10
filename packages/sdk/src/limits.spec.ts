import { blockedLimits, canCreateUser, checkLimits, isFeatureEnabled } from './limits'
import { LicenseLimits, LicenseState } from './types'

const limits: LicenseLimits = {
  maxUsers: 50,
  maxConcurrentTasks: 10,
  tokenQuota: { limit: 1000, period: 'total' },
  taskQuota: { limit: 100, period: 'monthly' },
  overLimitRatio: 1.1,
}

function verdictOf(kind: string, usage: Parameters<typeof checkLimits>[1]) {
  return checkLimits(limits, usage).find(v => v.kind === kind)!
}

describe('checkLimits', () => {
  it('限额为 null 时视为不限制，永不告警也永不拦截', () => {
    const verdicts = checkLimits({ maxUsers: null, tokenQuota: null }, { userCount: 999_999 })

    expect(verdicts.every(v => !v.reached && !v.blocked && !v.warning)).toBe(true)
  })

  it('limits 整体为 null 时返回空数组', () => {
    expect(checkLimits(null, { userCount: 100 })).toEqual([])
  })

  it('达到 80% 时告警但不拦截', () => {
    const v = verdictOf('tokenQuota', { tokensUsed: 800 })

    expect(v.warning).toBe(true)
    expect(v.reached).toBe(false)
    expect(v.blocked).toBe(false)
  })

  it('达到 100% 时 reached，但仍在软阈值内不拦截', () => {
    const v = verdictOf('tokenQuota', { tokensUsed: 1000 })

    expect(v.reached).toBe(true)
    expect(v.blocked).toBe(false)
  })

  it('超过软阈值（1.1 倍）才真正拦截', () => {
    expect(verdictOf('tokenQuota', { tokensUsed: 1099 }).blocked).toBe(false)
    expect(verdictOf('tokenQuota', { tokensUsed: 1100 }).blocked).toBe(true)
  })

  it('软阈值可由凭证配置调整', () => {
    const strict = checkLimits({ ...limits, overLimitRatio: 1 }, { tokensUsed: 1000 })

    expect(strict.find(v => v.kind === 'tokenQuota')!.blocked).toBe(true)
  })

  it('用量缺省视为 0', () => {
    const verdicts = checkLimits(limits, {})

    expect(verdicts.every(v => v.used === 0 && !v.blocked)).toBe(true)
  })

  it('配额 limit 为 0 或负数视为不限制', () => {
    const v = checkLimits({ tokenQuota: { limit: 0, period: 'total' } }, { tokensUsed: 10_000 })

    expect(v.find(x => x.kind === 'tokenQuota')!.limit).toBeNull()
  })

  it('blockedLimits 只返回需要拦截的维度', () => {
    const blocked = blockedLimits(limits, { tokensUsed: 5000, userCount: 1, tasksUsed: 1 })

    expect(blocked.map(v => v.kind)).toEqual(['tokenQuota'])
  })
})

describe('canCreateUser', () => {
  it('用户数卡硬限额，不用软阈值 —— 买 50 个人就不该建出第 51 个', () => {
    expect(canCreateUser(limits, 49)).toBe(true)
    expect(canCreateUser(limits, 50)).toBe(false)
    expect(canCreateUser(limits, 54)).toBe(false)
  })

  it('未限制用户数时永远允许', () => {
    expect(canCreateUser({ maxUsers: null }, 10_000)).toBe(true)
    expect(canCreateUser(null, 10_000)).toBe(true)
  })
})

describe('isFeatureEnabled', () => {
  const state = (features: string[] | null) => ({ features }) as LicenseState

  it('features 为 null 表示全功能开放', () => {
    expect(isFeatureEnabled(state(null), 'anything')).toBe(true)
  })

  it('白名单内放行，白名单外拒绝', () => {
    expect(isFeatureEnabled(state(['wiki', 'dashboard']), 'wiki')).toBe(true)
    expect(isFeatureEnabled(state(['wiki']), 'browserAutomation')).toBe(false)
  })

  it('没有状态时一律拒绝', () => {
    expect(isFeatureEnabled(null, 'wiki')).toBe(false)
  })
})
