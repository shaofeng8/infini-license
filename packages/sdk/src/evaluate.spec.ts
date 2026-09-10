import { DAY_MS } from './constants'
import { evaluateLicense } from './evaluate'
import { LicensePayload } from './types'

const NOW = Date.parse('2026-09-09T12:00:00Z')

function payload(overrides: Partial<LicensePayload> = {}): LicensePayload {
  return {
    ver: 2,
    typ: 'formal',
    jti: 'cred_x',
    iss: 'infini-license',
    lid: 'lid1',
    lno: 'LIC-2026-0007',
    cid: 'cid1',
    cname: '某某集团',
    prod: 'infinisynapse',
    edition: 'enterprise',
    iat: sec(NOW - 30 * DAY_MS),
    lic: { start: sec(NOW - 30 * DAY_MS), end: sec(NOW + 100 * DAY_MS) },
    warnDays: 15,
    bind: { mode: 'tofu', maxInstances: 1 },
    limits: { maxUsers: 50, overLimitRatio: 1.1 },
    features: ['wiki'],
    telemetry: { enabled: false },
    policy: { clockSkewTolSec: 3600 },
    support: { name: '客户成功', phone: '400-000-0000' },
    ...overrides,
  }
}

function sec(ms: number): number {
  return Math.floor(ms / 1000)
}

describe('evaluateLicense · 正式授权', () => {
  it('有效期内为 formal_active，不阻断', () => {
    const state = evaluateLicense({ now: NOW, payload: payload() })

    expect(state.status).toBe('formal_active')
    expect(state.loginBlocked).toBe(false)
    expect(state.warning).toBe(false)
    expect(state.remainingDays).toBe(100)
    expect(state.customerName).toBe('某某集团')
    expect(state.licenseNo).toBe('LIC-2026-0007')
  })

  it('进入预警窗口后为 formal_expiring，仍然不阻断', () => {
    const state = evaluateLicense({
      now: NOW,
      payload: payload({ lic: { start: sec(NOW - 300 * DAY_MS), end: sec(NOW + 10 * DAY_MS) } }),
    })

    expect(state.status).toBe('formal_expiring')
    expect(state.loginBlocked).toBe(false)
    expect(state.warning).toBe(true)
    expect(state.remainingDays).toBe(10)
  })

  it('预警窗口边界：正好等于 warnDays 时开始预警', () => {
    const atBoundary = evaluateLicense({
      now: NOW,
      payload: payload({ lic: { start: sec(NOW - 300 * DAY_MS), end: sec(NOW + 15 * DAY_MS) } }),
    })
    const justOutside = evaluateLicense({
      now: NOW,
      payload: payload({
        lic: { start: sec(NOW - 300 * DAY_MS), end: sec(NOW + 15 * DAY_MS + 1000) },
      }),
    })

    expect(atBoundary.status).toBe('formal_expiring')
    expect(justOutside.status).toBe('formal_active')
  })

  it('到期即阻断，没有宽限期', () => {
    const state = evaluateLicense({
      now: NOW,
      payload: payload({ lic: { start: sec(NOW - 300 * DAY_MS), end: sec(NOW) } }),
    })

    expect(state.status).toBe('formal_expired')
    expect(state.loginBlocked).toBe(true)
  })

  it('过期后仍能读出客户名、授权编号与联系方式，供阻断页展示', () => {
    const state = evaluateLicense({
      now: NOW,
      payload: payload({ lic: { start: sec(NOW - 400 * DAY_MS), end: sec(NOW - DAY_MS) } }),
    })

    expect(state.loginBlocked).toBe(true)
    expect(state.customerName).toBe('某某集团')
    expect(state.licenseNo).toBe('LIC-2026-0007')
    expect(state.support?.phone).toBe('400-000-0000')
  })

  it('永久授权（end 为 null）永远有效，剩余天数为 null', () => {
    const state = evaluateLicense({
      now: NOW,
      payload: payload({ lic: { start: sec(NOW - 1000 * DAY_MS), end: null } }),
    })

    expect(state.status).toBe('formal_active')
    expect(state.remainingDays).toBeNull()
    expect(state.expiresAt).toBeNull()
  })

  it('尚未到生效日判为 invalid', () => {
    const state = evaluateLicense({
      now: NOW,
      payload: payload({ lic: { start: sec(NOW + 10 * DAY_MS), end: sec(NOW + 200 * DAY_MS) } }),
    })

    expect(state.status).toBe('invalid')
    expect(state.invalidReason).toBe('not_yet_valid')
  })

  it('生效日的小幅提前落在时钟容忍窗口内，不误判', () => {
    const state = evaluateLicense({
      now: NOW,
      payload: payload({ lic: { start: sec(NOW + 1800_000), end: sec(NOW + 200 * DAY_MS) } }),
    })

    expect(state.status).toBe('formal_active')
  })

  it('签发方不符判为 invalid', () => {
    const state = evaluateLicense({ now: NOW, payload: payload({ iss: 'somebody-else' }) })

    expect(state.status).toBe('invalid')
    expect(state.invalidReason).toBe('issuer')
  })
})

/**
 * 指纹**不参与判定**，这里锁死这条约定。
 *
 * 曾经 `fingerprintMatch: false` 会判 invalid。P8 复制防护演练证明那道校验
 * 挡不住复制（指纹是 sha256(installId)，绑定的两端始终是同一套部署自己），
 * 净效果只剩一个会把客户全员锁死的误伤面，于是拿掉了。指纹仍在 manager 里
 * 计算并记事件，见 io/manager.spec.ts 的「指纹只记事件、不阻断」。
 */
describe('evaluateLicense · 指纹不再参与判定', () => {
  it('bind.mode 为 tofu 也照常放行 —— 求值根本不看指纹', () => {
    const state = evaluateLicense({ now: NOW, payload: payload({ bind: { mode: 'tofu' } }) })

    expect(state.status).toBe('formal_active')
    expect(state.loginBlocked).toBe(false)
  })

  it('bindMode 为 none 时同样放行', () => {
    const state = evaluateLicense({ now: NOW, payload: payload({ bind: { mode: 'none' } }) })

    expect(state.status).toBe('formal_active')
  })
})

describe('evaluateLicense · 时钟硬化', () => {
  it('大幅回拨判为 invalid', () => {
    const state = evaluateLicense({
      now: NOW,
      payload: payload(),
      clock: { maxSeenTs: NOW + 30 * DAY_MS, rollbackCount: 0 },
    })

    expect(state.status).toBe('invalid')
    expect(state.invalidReason).toBe('clock_rollback')
  })

  it('小幅回拨（NTP 校时量级）不影响判定', () => {
    const state = evaluateLicense({
      now: NOW,
      payload: payload(),
      clock: { maxSeenTs: NOW + 600_000, rollbackCount: 0 },
    })

    expect(state.status).toBe('formal_active')
  })

  it('时钟异常优先于到期判定 —— 时钟不可信时基于时间的结论都没意义', () => {
    const state = evaluateLicense({
      now: NOW,
      payload: payload({ lic: { start: sec(NOW - 400 * DAY_MS), end: sec(NOW - DAY_MS) } }),
      clock: { maxSeenTs: NOW + 30 * DAY_MS, rollbackCount: 0 },
    })

    expect(state.invalidReason).toBe('clock_rollback')
  })
})

describe('evaluateLicense · 试用模式', () => {
  const trialPayload = (endOffsetDays: number) =>
    payload({
      typ: 'trial',
      lno: 'TRL-2026-000042',
      warnDays: 7,
      telemetry: { enabled: true, endpoint: 'https://x/api', instanceId: 'i1' },
      lic: { start: sec(NOW - (30 - endOffsetDays) * DAY_MS), end: sec(NOW + endOffsetDays * DAY_MS) },
    })

  it('试用期内为 trial_active', () => {
    const state = evaluateLicense({ now: NOW, payload: trialPayload(20) })

    expect(state.status).toBe('trial_active')
    expect(state.loginBlocked).toBe(false)
    expect(state.licenseType).toBe('trial')
  })

  it('试用到期即阻断', () => {
    const state = evaluateLicense({ now: NOW, payload: trialPayload(0) })

    expect(state.status).toBe('trial_expired')
    expect(state.loginBlocked).toBe(true)
  })

  it('本地记录的试用起点更早时，以它为准 —— 清库重装拿新凭证也无法重置', () => {
    const state = evaluateLicense({
      now: NOW,
      // 凭证说还剩 29 天（刚注册），但本地隐藏文件记着 40 天前就开始试用了
      payload: trialPayload(29),
      trialStartedAt: NOW - 40 * DAY_MS,
      trialDays: 30,
    })

    expect(state.status).toBe('trial_expired')
    expect(state.loginBlocked).toBe(true)
  })

  it('本地起点被删掉时，凭证到期日兜底', () => {
    const state = evaluateLicense({
      now: NOW,
      payload: trialPayload(0),
      trialStartedAt: null,
    })

    expect(state.status).toBe('trial_expired')
  })

  it('正式凭证不受本地试用痕迹影响 —— 客户付了钱不能被残留数据缩短有效期', () => {
    const state = evaluateLicense({
      now: NOW,
      payload: payload({ lic: { start: sec(NOW - DAY_MS), end: sec(NOW + 300 * DAY_MS) } }),
      trialStartedAt: NOW - 90 * DAY_MS,
      trialDays: 30,
    })

    expect(state.status).toBe('formal_active')
    expect(state.remainingDays).toBe(300)
  })
})

describe('evaluateLicense · 无凭证', () => {
  it('无凭证且试用期内为 trial_active', () => {
    const state = evaluateLicense({
      now: NOW,
      payload: null,
      trialStartedAt: NOW - 5 * DAY_MS,
      trialDays: 30,
    })

    expect(state.status).toBe('trial_active')
    expect(state.remainingDays).toBe(25)
    expect(state.expiresAt).toBe(NOW - 5 * DAY_MS + 30 * DAY_MS)
  })

  it('无凭证且试用期满即阻断', () => {
    const state = evaluateLicense({
      now: NOW,
      payload: null,
      trialStartedAt: NOW - 31 * DAY_MS,
      trialDays: 30,
    })

    expect(state.status).toBe('trial_expired')
    expect(state.loginBlocked).toBe(true)
  })

  it('无凭证且临近试用到期时进入预警', () => {
    const state = evaluateLicense({
      now: NOW,
      payload: null,
      trialStartedAt: NOW - 25 * DAY_MS,
      trialDays: 30,
      trialWarnDays: 7,
    })

    expect(state.status).toBe('trial_expiring')
    expect(state.warning).toBe(true)
  })

  it('试用被关闭时无凭证直接进 missing 并阻断', () => {
    const state = evaluateLicense({ now: NOW, payload: null, trialEnabled: false })

    expect(state.status).toBe('missing')
    expect(state.loginBlocked).toBe(true)
  })

  it('试用起点既读不到库也读不到隐藏文件时进 missing', () => {
    const state = evaluateLicense({ now: NOW, payload: null, trialStartedAt: null })

    expect(state.status).toBe('missing')
    expect(state.loginBlocked).toBe(true)
  })

  it('文件存在但读不懂时判 invalid，绝不悄悄降级成试用', () => {
    const state = evaluateLicense({
      now: NOW,
      payload: null,
      invalidReason: 'signature',
      trialStartedAt: NOW - DAY_MS,
    })

    expect(state.status).toBe('invalid')
    expect(state.invalidReason).toBe('signature')
    expect(state.loginBlocked).toBe(true)
  })

  it('kid 未知（我方用了比客户端更新的密钥）判 invalid 而非试用', () => {
    const state = evaluateLicense({ now: NOW, payload: null, invalidReason: 'unknown_kid' })

    expect(state.status).toBe('invalid')
    expect(state.invalidReason).toBe('unknown_kid')
  })
})

describe('evaluateLicense · enforce 灰度开关', () => {
  it('enforce 为 false 时状态照常求值，但不锁人', () => {
    const state = evaluateLicense({
      now: NOW,
      payload: payload({ lic: { start: sec(NOW - 400 * DAY_MS), end: sec(NOW - DAY_MS) } }),
      enforce: false,
    })

    expect(state.status).toBe('formal_expired')
    expect(state.loginBlocked).toBe(false)
  })

  it('enforce 为 false 时 invalid 也不锁人', () => {
    const state = evaluateLicense({
      now: NOW,
      payload: null,
      invalidReason: 'signature',
      enforce: false,
    })

    expect(state.status).toBe('invalid')
    expect(state.loginBlocked).toBe(false)
  })
})
