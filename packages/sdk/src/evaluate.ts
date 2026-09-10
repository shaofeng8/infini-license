import {
  DAY_MS,
  DEFAULT_CLOCK_SKEW_TOL_SEC,
  DEFAULT_FORMAL_WARN_DAYS,
  DEFAULT_TRIAL_DAYS,
  DEFAULT_TRIAL_WARN_DAYS,
  LICENSE_ISSUER,
} from './constants'
import { checkClock } from './clock'
import { EvaluateInput, InvalidReason, LicensePayload, LicenseState } from './types'

/** 需要阻断登录的状态。UI 一律读 state.loginBlocked，不要自己重复这份清单 */
const BLOCKING_STATUSES = new Set([
  'missing',
  'invalid',
  'trial_expired',
  'formal_expired',
])

/**
 * 求出当前授权状态。**整个客户端的判定核心，纯函数。**
 *
 * 刻意不在函数内部读系统时间、读文件、查数据库：所有输入由调用方准备好传进来。
 * 代价是调用方要多写十几行装配代码，收益是这套判定逻辑可以被穷举测试 ——
 * 它决定客户能不能登录，一个分支写错就是全员被锁在门外，没有比可测性更值钱的东西。
 */
export function evaluateLicense(input: EvaluateInput): LicenseState {
  const {
    now,
    payload,
    trialStartedAt = null,
    trialDays = DEFAULT_TRIAL_DAYS,
    trialWarnDays = DEFAULT_TRIAL_WARN_DAYS,
    clock = null,
    trialEnabled = true,
    enforce = true,
  } = input

  const skewTolSec = payload?.policy?.clockSkewTolSec ?? DEFAULT_CLOCK_SKEW_TOL_SEC

  // 时钟检测放在最前面：时钟不可信时，后面所有基于时间的判断都没有意义
  if (clock) {
    const clockResult = checkClock(now, clock, { skewTolSec })
    if (clockResult.rejected) {
      return finalize(invalidState(now, payload, 'clock_rollback'), enforce)
    }
  }

  if (!payload) {
    return finalize(
      evaluateWithoutCredential({
        now,
        invalidReason: input.invalidReason,
        trialEnabled,
        trialStartedAt,
        trialDays,
        trialWarnDays,
      }),
      enforce,
    )
  }

  // 签发方不对，说明这份凭证不是给本产品的
  if (payload.iss !== LICENSE_ISSUER) {
    return finalize(invalidState(now, payload, 'issuer'), enforce)
  }

  // 这里曾经有一条「TOFU 指纹不符就判 invalid」。已经去掉，原因见下。
  //
  // 那道校验挡不住它声称要挡的东西。指纹是 sha256(installId)，而 installId
  // 属于「这套部署」，换掉 license.key 文件并不会改变它 —— 也就是说绑定的
  // 两端始终是同一个值，比对永远相等。P8 复制防护演练实测：把凭证复制到全新
  // 部署（TOFU 首次绑定）放行，复制到已完成绑定的另一套部署也放行，连
  // fingerprint_mismatch 都不会记。凭证里的 lid/lno/jti 一个都没参与绑定。
  //
  // 反过来，它唯一真会触发的路径是「镜像里的 installId 与库里的绑定值不符」，
  // 而那的现实成因是基础设施变更（同一台主机跑过别的实例、隐藏文件被带到别处），
  // 不是盗用。于是这条校验的净效果是：零防护 + 一个会把客户全员锁死的误伤面。
  //
  // 指纹仍然计算、仍然绑定、不符时仍然记 fingerprint_mismatch 事件，供诊断与
  // 服务端侧观测使用 —— 只是不再据此阻断。离线且免激活的交付方式本身就决定了
  // 客户端无法防复制，这一点见 docs/05-client-integration.md。

  const startMs = payload.lic.start * 1000
  if (now < startMs - skewTolSec * 1000) {
    // 凭证还没到生效日。可能是提前交付，也可能是本地时钟被调早了
    return finalize(invalidState(now, payload, 'not_yet_valid'), enforce)
  }

  const endMs = resolveEndMs(payload, trialStartedAt, trialDays)
  const isTrial = payload.typ === 'trial'
  const warnDays = payload.warnDays ?? (isTrial ? trialWarnDays : DEFAULT_FORMAL_WARN_DAYS)

  if (endMs === null) {
    return finalize(
      baseState(now, payload, isTrial ? 'trial_active' : 'formal_active', null, false),
      enforce,
    )
  }

  const remainingDays = Math.ceil((endMs - now) / DAY_MS)

  if (now >= endMs) {
    return finalize(
      baseState(now, payload, isTrial ? 'trial_expired' : 'formal_expired', remainingDays, false),
      enforce,
    )
  }

  if (remainingDays <= warnDays) {
    return finalize(
      baseState(now, payload, isTrial ? 'trial_expiring' : 'formal_expiring', remainingDays, true),
      enforce,
    )
  }

  return finalize(
    baseState(now, payload, isTrial ? 'trial_active' : 'formal_active', remainingDays, false),
    enforce,
  )
}

// -- 无凭证分支 --------------------------------------------------------------

function evaluateWithoutCredential(args: {
  now: number
  invalidReason?: InvalidReason
  trialEnabled: boolean
  trialStartedAt: number | null
  trialDays: number
  trialWarnDays: number
}): LicenseState {
  const { now, invalidReason, trialEnabled, trialStartedAt, trialDays, trialWarnDays } = args

  // 文件存在但读不懂，跟「没有文件」是两件事：前者说明有人放错了或文件损坏，
  // 不该悄悄降级成试用，否则客户会以为授权生效了而实际在跑试用。
  if (invalidReason) {
    return invalidState(now, null, invalidReason)
  }

  if (!trialEnabled || trialStartedAt === null) {
    return baseState(now, null, 'missing', null, false)
  }

  const endMs = trialStartedAt + trialDays * DAY_MS
  const remainingDays = Math.ceil((endMs - now) / DAY_MS)

  if (now >= endMs) {
    return { ...baseState(now, null, 'trial_expired', remainingDays, false), expiresAt: endMs }
  }
  if (remainingDays <= trialWarnDays) {
    return { ...baseState(now, null, 'trial_expiring', remainingDays, true), expiresAt: endMs }
  }
  return { ...baseState(now, null, 'trial_active', remainingDays, false), expiresAt: endMs }
}

// -- 到期时刻的确定 ----------------------------------------------------------

/**
 * 试用期取「凭证到期日」与「本地记录的试用起点 + 试用天数」中**更早**的那个。
 *
 * 这是试用防重置的关键一步。清库重装能拿到一份崭新的试用凭证，但本地隐藏
 * 文件里的起始时间还在，两者取早就让重置失效。反过来若本地起点被删掉，
 * 凭证的到期日仍然兜底。
 *
 * 正式凭证不参与这个逻辑：客户付了钱，本地残留的试用痕迹不能缩短他的有效期。
 */
function resolveEndMs(
  payload: LicensePayload,
  trialStartedAt: number | null,
  trialDays: number,
): number | null {
  const credentialEnd = payload.lic.end === null ? null : payload.lic.end * 1000

  if (payload.typ !== 'trial' || trialStartedAt === null) {
    return credentialEnd
  }

  const localEnd = trialStartedAt + trialDays * DAY_MS
  if (credentialEnd === null) {
    return localEnd
  }
  return Math.min(credentialEnd, localEnd)
}

// -- 状态构造 ----------------------------------------------------------------

function baseState(
  now: number,
  payload: LicensePayload | null,
  status: LicenseState['status'],
  remainingDays: number | null,
  warning: boolean,
): LicenseState {
  return {
    status,
    loginBlocked: BLOCKING_STATUSES.has(status),
    remainingDays,
    warning,
    customerName: payload?.cname ?? null,
    licenseNo: payload?.lno ?? null,
    licenseType: payload?.typ ?? null,
    edition: payload?.edition ?? null,
    expiresAt: payload?.lic.end === null || payload === null ? null : payload.lic.end * 1000,
    features: payload?.features ?? null,
    limits: payload?.limits ?? null,
    support: payload?.support ?? null,
    evaluatedAt: now,
  }
}

/**
 * invalid 状态仍然带上 payload 里的客户名与授权编号。
 *
 * 凭证没有 exp，即使判定为无效也解得出这些信息，阻断页上就能显示
 * 「授权编号 LIC-2026-0007，请联系管理员」而不是干巴巴一句「校验失败」。
 * 支持人员据此能立刻定位是哪份授权出了问题。
 */
function invalidState(
  now: number,
  payload: LicensePayload | null,
  reason: InvalidReason,
): LicenseState {
  return { ...baseState(now, payload, 'invalid', null, false), invalidReason: reason }
}

/**
 * 灰度开关：enforce 为 false 时状态照常求值，但不真的锁人。
 *
 * 新的阻断逻辑首次铺到存量客户时，误判的代价是全员登不进来。先发一个
 * 只弹提醒的版本跑一段时间，确认没有误伤再打开阻断。
 */
function finalize(state: LicenseState, enforce: boolean): LicenseState {
  if (enforce) return state
  return { ...state, loginBlocked: false }
}
