import { DAY_MS } from './constants'
import { LicenseState } from './types'

export type NoticeLevel = 'none' | 'info' | 'warning' | 'urgent' | 'blocked'

export interface LicenseNotice {
  level: NoticeLevel
  /** 是否阻断登录。与 state.loginBlocked 一致，放这里方便 UI 只依赖一个对象 */
  blocking: boolean
  /**
   * i18n key。infiniSynapse 支持多语言，SDK 不产出成品文案，
   * 只给 key 与参数，由各端的语言包渲染。
   */
  titleKey: string
  messageKey: string
  params: Record<string, string | number>
  /** 用户能否关掉这个提醒 */
  dismissible: boolean
  /** 关掉后多久再次弹出（毫秒）。0 表示每次进入都弹 */
  snoozeMs: number
  /** 是否需要顶部常驻条 */
  banner: boolean
  /** 联系方式，来自凭证里冻结的 support 字段 */
  support: LicenseState['support']
}

const I18N_PREFIX = 'license.notice'

/** 到期前 3 天内的提醒不允许关闭 */
const UNDISMISSIBLE_DAYS = 3

/** 到期前 7 天内每天提醒一次 */
const DAILY_REMINDER_DAYS = 7

/**
 * 由授权状态生成 UI 提醒。纯函数。
 *
 * 分档而不是一律弹同一个框，是因为提醒疲劳是真实存在的：连续 15 天每次登录
 * 都弹同一个不可关闭的框，用户会训练出「无脑点掉」的肌肉记忆，等到真正
 * 只剩三天时那个框就已经失效了。所以远期提醒可以关且关得久，临期提醒
 * 才升级为不可关闭。
 */
export function buildNotice(state: LicenseState): LicenseNotice {
  const support = state.support ?? null
  const params: Record<string, string | number> = {
    customerName: state.customerName ?? '',
    licenseNo: state.licenseNo ?? '',
    remainingDays: state.remainingDays ?? 0,
    expiresAt: state.expiresAt ?? 0,
  }

  if (state.loginBlocked) {
    return {
      level: 'blocked',
      blocking: true,
      titleKey: `${I18N_PREFIX}.blocked.title`,
      messageKey: `${I18N_PREFIX}.blocked.${blockedVariant(state)}`,
      params,
      dismissible: false,
      snoozeMs: 0,
      banner: false,
      support,
    }
  }

  // 试用期即便没到预警窗口也常驻一条 banner。试用状态必须始终可见 ——
  // 客户以为自己在用正式版、到期突然被锁，是最糟的体验。
  const isTrial = state.licenseType === 'trial' || state.status.startsWith('trial')
  const remaining = state.remainingDays

  if (remaining === null) {
    return silent(isTrial, params, support, state)
  }

  if (remaining <= UNDISMISSIBLE_DAYS) {
    return {
      level: 'urgent',
      blocking: false,
      titleKey: `${I18N_PREFIX}.urgent.title`,
      messageKey: `${I18N_PREFIX}.urgent.${isTrial ? 'trial' : 'formal'}`,
      params,
      dismissible: false,
      snoozeMs: 0,
      banner: true,
      support,
    }
  }

  if (remaining <= DAILY_REMINDER_DAYS) {
    return {
      level: 'warning',
      blocking: false,
      titleKey: `${I18N_PREFIX}.warning.title`,
      messageKey: `${I18N_PREFIX}.warning.${isTrial ? 'trial' : 'formal'}`,
      params,
      dismissible: true,
      snoozeMs: DAY_MS,
      banner: true,
      support,
    }
  }

  if (state.warning) {
    return {
      level: 'info',
      blocking: false,
      titleKey: `${I18N_PREFIX}.info.title`,
      messageKey: `${I18N_PREFIX}.info.${isTrial ? 'trial' : 'formal'}`,
      params,
      dismissible: true,
      snoozeMs: 3 * DAY_MS,
      banner: true,
      support,
    }
  }

  return silent(isTrial, params, support, state)
}

/** 阻断页要展示的文案变体 */
function blockedVariant(state: LicenseState): string {
  switch (state.status) {
    case 'formal_expired':
      return 'formalExpired'
    case 'trial_expired':
      return 'trialExpired'
    case 'missing':
      return 'missing'
    default:
      // invalid 一律用同一句话，不向客户暴露是验签失败、指纹不符还是时钟异常。
      // 具体原因在 invalidReason 里，只进日志与事件表。
      return 'invalid'
  }
}

function silent(
  isTrial: boolean,
  params: Record<string, string | number>,
  support: LicenseState['support'],
  state: LicenseState,
): LicenseNotice {
  return {
    level: isTrial ? 'info' : 'none',
    blocking: false,
    titleKey: isTrial ? `${I18N_PREFIX}.trialBanner.title` : '',
    messageKey: isTrial ? `${I18N_PREFIX}.trialBanner.message` : '',
    params,
    dismissible: true,
    snoozeMs: 3 * DAY_MS,
    banner: isTrial,
    support: support ?? state.support ?? null,
  }
}
