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

/** 到期前这么多天开始每天弹一次，可关闭 */
const DAILY_REMINDER_DAYS = 7

/**
 * 由授权状态生成 UI 提醒。纯函数。
 *
 * 只保留三档：预警窗口外完全静默、剩余 ≤7 天每天弹一次（可关）、到期阻断登录。
 * 分档全在这里，两个前端只负责渲染。
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

  const isTrial = state.licenseType === 'trial' || state.status.startsWith('trial')
  const remaining = state.remainingDays

  if (remaining !== null && remaining <= DAILY_REMINDER_DAYS) {
    return {
      level: 'warning',
      blocking: false,
      titleKey: `${I18N_PREFIX}.warning.title`,
      messageKey: `${I18N_PREFIX}.warning.${isTrial ? 'trial' : 'formal'}`,
      params,
      dismissible: true,
      snoozeMs: DAY_MS,
      banner: false,
      support,
    }
  }

  return silent(params, support)
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
  params: Record<string, string | number>,
  support: LicenseState['support'],
): LicenseNotice {
  return {
    level: 'none',
    blocking: false,
    titleKey: '',
    messageKey: '',
    params,
    dismissible: true,
    snoozeMs: 0,
    banner: false,
    support,
  }
}
