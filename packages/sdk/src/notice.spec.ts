import { buildNotice } from './notice'
import { DAY_MS } from './constants'
import { LicenseState } from './types'

function state(overrides: Partial<LicenseState> = {}): LicenseState {
  return {
    status: 'formal_active',
    loginBlocked: false,
    remainingDays: 100,
    warning: false,
    customerName: '某某集团',
    licenseNo: 'LIC-2026-0007',
    licenseType: 'formal',
    edition: 'enterprise',
    expiresAt: Date.now() + 100 * DAY_MS,
    features: null,
    limits: null,
    support: { name: '客户成功', phone: '400-000-0000' },
    evaluatedAt: Date.now(),
    ...overrides,
  }
}

describe('buildNotice · 阻断态', () => {
  it('过期阻断时不可关闭，文案区分正式与试用', () => {
    const formal = buildNotice(state({ status: 'formal_expired', loginBlocked: true }))
    const trial = buildNotice(
      state({ status: 'trial_expired', loginBlocked: true, licenseType: 'trial' }),
    )

    expect(formal.level).toBe('blocked')
    expect(formal.dismissible).toBe(false)
    expect(formal.messageKey).toContain('formalExpired')
    expect(trial.messageKey).toContain('trialExpired')
  })

  it('阻断页仍带客户名、授权编号与联系方式，让支持人员能定位', () => {
    const notice = buildNotice(state({ status: 'formal_expired', loginBlocked: true }))

    expect(notice.params.customerName).toBe('某某集团')
    expect(notice.params.licenseNo).toBe('LIC-2026-0007')
    expect(notice.support?.phone).toBe('400-000-0000')
  })

  it('invalid 的各种原因对外都用同一句文案，不暴露具体原因', () => {
    const signature = buildNotice(
      state({ status: 'invalid', loginBlocked: true, invalidReason: 'signature' }),
    )
    const clock = buildNotice(
      state({ status: 'invalid', loginBlocked: true, invalidReason: 'clock_rollback' }),
    )
    const fingerprint = buildNotice(
      state({ status: 'invalid', loginBlocked: true, invalidReason: 'fingerprint' }),
    )

    expect(signature.messageKey).toBe(clock.messageKey)
    expect(clock.messageKey).toBe(fingerprint.messageKey)
    expect(signature.messageKey).toContain('invalid')
  })

  it('missing 有独立文案，指向配置授权文件', () => {
    const notice = buildNotice(state({ status: 'missing', loginBlocked: true }))

    expect(notice.messageKey).toContain('missing')
  })
})

describe('buildNotice · 分档提醒', () => {
  it('远期预警可关闭且关得久，避免提醒疲劳', () => {
    const notice = buildNotice(
      state({ status: 'formal_expiring', remainingDays: 14, warning: true }),
    )

    expect(notice.level).toBe('info')
    expect(notice.dismissible).toBe(true)
    expect(notice.snoozeMs).toBe(3 * DAY_MS)
  })

  it('7 天内每天提醒一次', () => {
    const notice = buildNotice(
      state({ status: 'formal_expiring', remainingDays: 6, warning: true }),
    )

    expect(notice.level).toBe('warning')
    expect(notice.dismissible).toBe(true)
    expect(notice.snoozeMs).toBe(DAY_MS)
  })

  it('3 天内升级为不可关闭 —— 这时候必须让人看见', () => {
    const notice = buildNotice(
      state({ status: 'formal_expiring', remainingDays: 3, warning: true }),
    )

    expect(notice.level).toBe('urgent')
    expect(notice.dismissible).toBe(false)
    expect(notice.snoozeMs).toBe(0)
  })

  it('分档边界连续，没有落空的天数', () => {
    const levels = [1, 2, 3, 4, 7, 8, 14, 15, 16].map(
      d => buildNotice(state({ status: 'formal_expiring', remainingDays: d, warning: d <= 15 })).level,
    )

    expect(levels).toEqual([
      'urgent',
      'urgent',
      'urgent',
      'warning',
      'warning',
      'info',
      'info',
      'info',
      'none',
    ])
  })
})

describe('buildNotice · 试用常驻提示', () => {
  it('试用期即便远未到期也常驻 banner —— 客户必须始终知道自己在试用', () => {
    const notice = buildNotice(
      state({ status: 'trial_active', licenseType: 'trial', remainingDays: 25, warning: false }),
    )

    expect(notice.banner).toBe(true)
    expect(notice.level).toBe('info')
    expect(notice.messageKey).toContain('trialBanner')
  })

  it('正式授权在有效期内完全静默，不打扰用户', () => {
    const notice = buildNotice(state())

    expect(notice.level).toBe('none')
    expect(notice.banner).toBe(false)
  })

  it('永久授权（剩余天数 null）不产生任何提醒', () => {
    const notice = buildNotice(state({ remainingDays: null, expiresAt: null }))

    expect(notice.level).toBe('none')
    expect(notice.blocking).toBe(false)
  })

  it('试用的永久情形仍显示 banner', () => {
    const notice = buildNotice(
      state({ status: 'trial_active', licenseType: 'trial', remainingDays: null }),
    )

    expect(notice.banner).toBe(true)
  })
})
