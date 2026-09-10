import { InvalidReason, LicenseStatus } from '../types'

/**
 * 需要跨重启保留的本地状态。
 *
 * 全部由宿主项目落到自己的表里（infini-proxy 的 `license_state`），SDK 不碰
 * 数据库 —— 两个宿主一个用 TypeORM 一个也用 TypeORM，但实体、连接、迁移方式
 * 各不相同，在 SDK 里塞一层通用持久层只会同时迁就两边而两边都不舒服。
 */
export interface PersistedState {
  /** 首次启动生成的 UUID，指纹的主要成分 */
  installId: string
  /** TOFU 绑定的指纹。null 表示尚未绑定 */
  boundFingerprint: string | null
  /** 试用起始时刻，Unix 毫秒 */
  trialStartedAt: number | null
  /** 时钟水位 */
  maxSeenTs: number
  rollbackCount: number
  lastRollbackAt: number | null
  /**
   * 最近一次可疑前跳之前的水位，Unix 毫秒；没有待撤销的前跳时为 null。
   *
   * 少了它，一次意外前跳（BIOS 电池、NTP 配错、快照恢复）会把水位毒化，
   * 运维修正时钟的那一刻客户全员被锁死。见 clock.ts 的 §前跳与撤销。
   */
  jumpBaseTs: number | null
  /** 试用凭证。正式模式恒为 null，凭证在文件里 */
  trialCredentialJws: string | null
  /** 试用实例身份，用于上报签名 */
  trialInstanceId: string | null
  trialInstanceSecret: string | null
  /** 上次成功加载的凭证文件指纹，用于判断文件是否变化 */
  lastKeyFileChecksum: string | null
  /**
   * 上次从 license.key 里成功验签的凭证原文。
   *
   * 存它只为一件事：文件不在了的时候还能按原到期日继续服务。运维误删、挂载
   * 卷没挂上、compose 改错路径都会让文件凭空消失，而这类事故与「授权到期」
   * 毫无关系，不该让客户全员登不进来。
   *
   * 这不会放宽任何授权：缓存的是同一份 Ed25519 签名凭证，到期日、绑定模式、
   * 额度都还在里面，验签照跑。少了文件只是少了一个载体，不是多了一份权利。
   */
  lastCredentialJws: string | null
}

export type LicenseEventKind =
  | 'loaded'
  | 'reloaded'
  | 'file_missing'
  | 'verify_failed'
  | 'fingerprint_bound'
  | 'fingerprint_mismatch'
  | 'clock_rollback'
  | 'clock_advance_clamped'
  | 'clock_corrected'
  | 'clock_reset'
  | 'mirror_tampered'
  | 'status_changed'
  | 'trial_registered'
  | 'trial_register_failed'

export interface LicenseEvent {
  kind: LicenseEventKind
  at: number
  status?: LicenseStatus
  reason?: InvalidReason
  detail?: Record<string, unknown>
}

/**
 * 宿主项目需要实现的持久化契约。
 *
 * `readState` 返回 null 表示首次运行，Manager 会生成 installId 并调用 writeState。
 */
export interface LicenseStore {
  readState(): Promise<PersistedState | null>
  writeState(state: PersistedState): Promise<void>
  recordEvent(event: LicenseEvent): Promise<void>
}

export function createInitialState(installId: string, now: number): PersistedState {
  return {
    installId,
    boundFingerprint: null,
    trialStartedAt: null,
    maxSeenTs: now,
    rollbackCount: 0,
    lastRollbackAt: null,
    jumpBaseTs: null,
    trialCredentialJws: null,
    trialInstanceId: null,
    trialInstanceSecret: null,
    lastKeyFileChecksum: null,
    lastCredentialJws: null,
  }
}
