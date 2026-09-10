import { randomUUID } from 'node:crypto'
import { cpus, hostname, platform } from 'node:os'

import { checkClock } from '../clock'
import { DEFAULT_TRIAL_DAYS, DEFAULT_TRIAL_WARN_DAYS } from '../constants'
import { parseLicenseEnvelope } from '../envelope'
import { evaluateLicense } from '../evaluate'
import { compareFingerprint, computeFingerprint } from '../fingerprint'
import { ClockWatermark, InvalidReason, LicensePayload, LicenseState } from '../types'
import { TrustedKey, verifyCredential } from '../verify'
import { KeyFile, loadKeyFile } from './keyfile'
import {
  MirrorState,
  fallbackMirrorPath,
  mirrorPath,
  readMirror,
  writeMirror,
} from './mirror'
import { LicenseEvent, LicenseStore, PersistedState, createInitialState } from './store'

export interface LicenseManagerOptions {
  store: LicenseStore
  /** 构建时内嵌的签名公钥清单 */
  trustedKeys: TrustedKey[]
  /** 镜像文件 MAC 的密钥，构建时注入，与签名公钥同等对待 */
  mirrorSecret: string
  /** 显式的 license.key 路径，通常取自 LICENSE_KEY_PATH */
  keyFilePath?: string | null
  baseDir?: string
  /**
   * 覆盖镜像文件位置。
   * 生产环境不要设置 —— 默认路径刻意选在数据目录之外，配置成数据目录里的
   * 路径会让镜像跟着数据库备份一起被还原，防重置就失效了。测试必须设置，
   * 否则会写到真实机器的 ProgramData。
   */
  mirrorFilePath?: string
  trialEnabled?: boolean
  trialDays?: number
  trialWarnDays?: number
  /** false 时只求值不阻断，用于灰度上线 */
  enforce?: boolean
  /** 热重载检查间隔（秒） */
  reloadCheckSec?: number
  /** 数据库侧指纹信号，例如库的创建时间 */
  dbSignal?: () => Promise<string | null>
  /** 便于测试注入 */
  now?: () => number
  hostSignal?: () => string
  logger?: (message: string, event: LicenseEvent) => void
}

const DEFAULT_RELOAD_CHECK_SEC = 60

/**
 * 客户端授权管理器：纯函数核心之外的所有副作用都收在这里。
 *
 * 职责边界很清楚 —— 它只做三件事：把状态从磁盘和数据库读进来、调用纯函数
 * 求值、把结果写回去。任何判定逻辑都不在这个文件里，出现在这里就说明放错了
 * 地方。这么划分是因为判定逻辑决定客户能否登录，必须留在可穷举测试的纯函数中。
 */
export class LicenseManager {
  private readonly options: Required<
    Pick<
      LicenseManagerOptions,
      'trialEnabled' | 'trialDays' | 'trialWarnDays' | 'enforce' | 'reloadCheckSec'
    >
  > &
    LicenseManagerOptions

  private state: LicenseState
  private persisted: PersistedState | null = null
  private lastCheckedAt = 0
  private refreshing: Promise<LicenseState> | null = null
  private resolvedMirrorPath: string | null = null
  /** file_missing 事件的进程内去重标记，见 reportMissingFile() */
  private missingFileReported = false
  /** 上一次读库是否失败。为 true 时手里的状态不权威，见 persist() */
  private storeReadFailed = false

  constructor(options: LicenseManagerOptions) {
    this.options = {
      trialEnabled: true,
      trialDays: DEFAULT_TRIAL_DAYS,
      trialWarnDays: DEFAULT_TRIAL_WARN_DAYS,
      enforce: true,
      reloadCheckSec: DEFAULT_RELOAD_CHECK_SEC,
      ...options,
    }

    this.state = {
      status: 'checking',
      loginBlocked: false,
      remainingDays: null,
      warning: false,
      customerName: null,
      licenseNo: null,
      licenseType: null,
      edition: null,
      expiresAt: null,
      features: null,
      limits: null,
      support: null,
      evaluatedAt: 0,
    }
  }

  /** 服务启动时调用一次。失败不抛异常，退化为 invalid 状态 */
  async init(): Promise<LicenseState> {
    return this.refresh(true)
  }

  /**
   * 取当前状态。同步返回缓存，超过检查间隔时在后台触发一次刷新。
   *
   * 登录接口每次都会调它，绝不能在这里做磁盘或数据库 IO —— 那会把授权检查
   * 变成登录路径上的一个同步阻塞点。
   */
  getState(): LicenseState {
    const now = this.now()
    if (now - this.lastCheckedAt >= this.options.reloadCheckSec * 1000) {
      void this.refresh(false).catch(() => undefined)
    }
    return this.state
  }

  /**
   * 重新加载并求值。
   *
   * 客户换了 license.key 之后不必重启服务：下一次检查窗口就会读到新文件。
   * 续期时客户方往往只有运维能碰服务器，「放个文件就生效」比「放完再重启」
   * 少一次沟通和一次停机窗口。
   */
  async refresh(force = false): Promise<LicenseState> {
    // 多个并发登录同时触发刷新时，只做一次
    if (this.refreshing && !force) return this.refreshing

    this.refreshing = this.doRefresh().finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }

  /** 试用注册成功后回填服务端下发的凭证与实例身份 */
  async saveTrialIdentity(input: {
    credentialJws: string
    instanceId: string
    instanceSecret: string
  }): Promise<LicenseState> {
    const persisted = await this.loadPersisted(this.now())
    await this.persist({
      ...persisted,
      trialCredentialJws: input.credentialJws,
      trialInstanceId: input.instanceId,
      trialInstanceSecret: input.instanceSecret,
    })
    return this.refresh(true)
  }

  /**
   * 重置时间水位，用于把因时钟异常被锁死的部署救回来。
   *
   * 只动水位与回拨计数，`installId`、试用起点、绑定指纹、凭证一概不碰 ——
   * 那些是防试用重置的东西，跟时钟误伤没关系，一并清掉等于给客户送一次
   * 免费试用。
   *
   * 水位重置为**当前时刻**而不是清零：清零会让机制之后一直处于「没有基准」
   * 的状态，而设为当前时刻既解掉了毒化的未来值，也让后续的回拨检测照常工作。
   *
   * 走 persist() 而不是让宿主直接改库，因为库与镜像调和时 `maxSeenTs` 取的是
   * 更大的那个 —— 只改库的话，重启时镜像会把毒化的值原样带回来。
   *
   * **这是一个能被滥用的口子，必须清楚它的定位。** 谁能调它，谁就能在回拨时钟
   * 之后解掉自己的封锁，也就等于绕过时钟防护。之所以可以接受：把时钟冻结住本
   * 来就能无限延长授权，而单调水位发现不了「不走」（见
   * docs/02-license-model.md §9），绕过的强度上限早已由那一条决定。用一个能被
   * 滥用的恢复通道，换掉「客户被锁死而我方在内网里毫无手段」这个真实事故面，
   * 是划算的。事件表里无条件留痕，滥用事后看得见。
   */
  async resetClockWatermark(): Promise<LicenseState> {
    const now = this.now()
    const persisted = await this.loadPersisted(now)

    await this.emit({
      kind: 'clock_reset',
      at: now,
      detail: {
        previousMaxSeenTs: persisted.maxSeenTs,
        previousRollbackCount: persisted.rollbackCount,
        previousJumpBaseTs: persisted.jumpBaseTs,
        resetTo: now,
      },
    })

    await this.persist({
      ...persisted,
      maxSeenTs: now,
      rollbackCount: 0,
      lastRollbackAt: null,
      jumpBaseTs: null,
    })

    return this.refresh(true)
  }

  /** 试用上报需要实例身份 */
  async getTrialIdentity(): Promise<{ instanceId: string; instanceSecret: string } | null> {
    const persisted = await this.loadPersisted(this.now())
    if (!persisted.trialInstanceId || !persisted.trialInstanceSecret) return null
    return {
      instanceId: persisted.trialInstanceId,
      instanceSecret: persisted.trialInstanceSecret,
    }
  }

  async getInstallId(): Promise<string> {
    return (await this.loadPersisted(this.now())).installId
  }

  /**
   * 本地状态此刻是否可信。
   *
   * 读库失败时 manager 手里只有一份临时拼出来的状态，且此时写不回盘（见
   * persist()）。宿主必须拿它挡住有外部副作用的动作 —— 尤其是试用注册：
   * 注册会在我方服务端生成一个新实例，而结果落不了盘，下一次心跳又会再
   * 注册一次，最后我方后台看到同一个客户冒出一串实例。
   */
  isStateAuthoritative(): boolean {
    return !this.storeReadFailed
  }

  // -- 内部流程 --------------------------------------------------------------

  private async doRefresh(): Promise<LicenseState> {
    const now = this.now()
    this.lastCheckedAt = now

    let persisted = await this.loadPersisted(now)
    const previousStatus = this.state.status

    const keyFile = loadKeyFile({
      explicitPath: this.options.keyFilePath,
      baseDir: this.options.baseDir,
    })

    const { jws, payload, invalidReason } = this.readCredential(keyFile, persisted)

    if (keyFile) {
      this.missingFileReported = false

      if (persisted.lastKeyFileChecksum !== keyFile.checksum) {
        await this.emit({
          kind: persisted.lastKeyFileChecksum === null ? 'loaded' : 'reloaded',
          at: now,
          detail: { path: keyFile.path, checksum: keyFile.checksum },
        })
        persisted = { ...persisted, lastKeyFileChecksum: keyFile.checksum }
      }

      // 只缓存验签通过的那一份。验不过的不存 —— 否则一次「把错文件放进去」
      // 会变成一份永久生效的坏缓存，之后连换回正确文件都救不回来。
      if (jws && !invalidReason && persisted.lastCredentialJws !== jws) {
        persisted = { ...persisted, lastCredentialJws: jws }
      }
    }

    if (invalidReason) {
      await this.emit({ kind: 'verify_failed', at: now, reason: invalidReason })
    } else if (!keyFile) {
      await this.reportMissingFile(persisted, now)
    }

    const fingerprintMatch = await this.resolveFingerprint(persisted, payload, now)
    if (fingerprintMatch.bound) {
      persisted = { ...persisted, boundFingerprint: fingerprintMatch.fingerprint }
    }

    const previousWatermark: ClockWatermark = {
      maxSeenTs: persisted.maxSeenTs,
      rollbackCount: persisted.rollbackCount,
      lastRollbackAt: persisted.lastRollbackAt ?? undefined,
      jumpBaseTs: persisted.jumpBaseTs ?? undefined,
    }
    const clockResult = checkClock(now, previousWatermark, {
      skewTolSec: payload?.policy?.clockSkewTolSec,
    })

    if (clockResult.rolledBack) {
      await this.emit({
        kind: 'clock_rollback',
        at: now,
        detail: { rollbackMs: clockResult.rollbackMs, count: clockResult.watermark.rollbackCount },
      })
    }
    if (clockResult.advanceClamped) {
      await this.emit({ kind: 'clock_advance_clamped', at: now, detail: { now } })
    }
    if (clockResult.clockCorrected) {
      // 运维排障时最想知道的就是这条：水位主动降下来过，且降之前发生过什么
      await this.emit({
        kind: 'clock_corrected',
        at: now,
        detail: { from: persisted.maxSeenTs, to: now, jumpBaseTs: persisted.jumpBaseTs },
      })
    }

    persisted = {
      ...persisted,
      maxSeenTs: clockResult.watermark.maxSeenTs,
      rollbackCount: clockResult.watermark.rollbackCount,
      lastRollbackAt: clockResult.watermark.lastRollbackAt ?? null,
      jumpBaseTs: clockResult.watermark.jumpBaseTs ?? null,
    }

    persisted = this.resolveTrialStart(persisted, keyFile, payload, now)

    this.state = evaluateLicense({
      now,
      payload,
      invalidReason,
      trialStartedAt: persisted.trialStartedAt,
      trialDays: this.options.trialDays,
      trialWarnDays: this.options.trialWarnDays,
      // 指纹结果刻意不传：它只用于记事件，不参与判定，见 resolveFingerprint()
      // 传入刷新前的水位：evaluateLicense 内部会自行做一次同样的检测
      clock: previousWatermark,
      trialEnabled: this.options.trialEnabled,
      enforce: this.options.enforce,
    })

    await this.persist(persisted)

    if (this.state.status !== previousStatus && previousStatus !== 'checking') {
      await this.emit({
        kind: 'status_changed',
        at: now,
        status: this.state.status,
        reason: this.state.invalidReason,
        detail: { from: previousStatus },
      })
    }

    return this.state
  }

  /**
   * 决定用哪份凭证。
   *
   * license.key 存在就一律用它，即使它验不过也不回退到别处 —— 客户放了文件
   * 说明意图是走正式授权，静默降级成试用会让「授权没生效」这件事以「功能
   * 受限」的形式延迟暴露，排查成本极高。
   *
   * 文件不在时才看缓存，且**缓存里的正式凭证优先于库里的试用凭证**。试用
   * 转正的客户两份都有，取错了会拿一个两年前的试用起点去求值，当场把人
   * 全锁在门外。
   *
   * 缓存凭证和文件凭证走完全相同的验签，不因为「来自本地」就少查一步。
   */
  private readCredential(
    keyFile: KeyFile | null,
    persisted: PersistedState,
  ): {
    jws: string | null
    payload: LicensePayload | null
    invalidReason?: InvalidReason
  } {
    const jws = keyFile
      ? parseLicenseEnvelope(keyFile.content)
      : persisted.lastCredentialJws ?? persisted.trialCredentialJws

    if (!jws) {
      // 有文件却解不出 JWS：文件损坏或放错了内容，算 malformed 而非 missing
      return keyFile
        ? { jws: null, payload: null, invalidReason: 'malformed' }
        : { jws: null, payload: null }
    }

    const result = verifyCredential(jws, this.options.trustedKeys)
    if (!result.valid) {
      return { jws, payload: null, invalidReason: result.reason ?? 'signature' }
    }
    return { jws, payload: result.payload ?? null }
  }

  /**
   * 文件不在时记一条事件。
   *
   * 这两种情况的运维含义完全相反，必须在事件里分得开：曾经加载过说明文件是
   * 丢的（事故，得有人去看），从来没有过说明这台就是试用（正常）。
   *
   * 用内存标记去重。热重载每 60 秒跑一次，不去重的话一台丢了文件的部署会
   * 每分钟刷一条，两千条的保留窗口一天半就被自己刷满，真正该被看见的那条
   * 反而先被裁掉。标记只活在进程内，重启会再记一条 —— 那正好是想要的。
   */
  private async reportMissingFile(persisted: PersistedState, now: number): Promise<void> {
    if (this.missingFileReported) return
    this.missingFileReported = true

    if (persisted.lastKeyFileChecksum !== null) {
      await this.emit({
        kind: 'file_missing',
        at: now,
        detail: {
          servedFromCache: persisted.lastCredentialJws !== null,
          lastChecksum: persisted.lastKeyFileChecksum,
        },
      })
      return
    }

    if (!persisted.trialCredentialJws) {
      await this.emit({ kind: 'file_missing', at: now })
    }
  }

  /**
   * 计算并（首次）绑定机器指纹。
   *
   * **结果不参与判定，只用于记录与诊断。** 指纹是 sha256(installId)，绑定的
   * 两端始终是同一套部署自己，比对永远相等，防不住凭证被复制（见 evaluate.ts
   * 里那段说明）。留着它是因为 `fingerprint_bound` / `fingerprint_mismatch`
   * 两条事件仍有价值：客户报障时能看出这套部署是不是换过身份，试用上报也靠
   * hostSignalHash 的漂移在服务端侧观测异常。
   */
  private async resolveFingerprint(
    persisted: PersistedState,
    payload: LicensePayload | null,
    now: number,
  ): Promise<{ match: boolean | null; fingerprint: string; bound: boolean }> {
    const dbSignal = await this.safeDbSignal()
    const { fingerprint } = computeFingerprint({
      installId: persisted.installId,
      hostSignal: this.hostSignal(),
      dbSignal: dbSignal ?? undefined,
    })

    if (payload?.bind?.mode !== 'tofu') {
      return { match: null, fingerprint, bound: false }
    }

    const match = compareFingerprint(fingerprint, persisted.boundFingerprint)

    if (match === null) {
      // TOFU 首次绑定
      await this.emit({ kind: 'fingerprint_bound', at: now, detail: { fingerprint } })
      return { match: null, fingerprint, bound: true }
    }
    if (!match) {
      await this.emit({
        kind: 'fingerprint_mismatch',
        at: now,
        detail: { expected: persisted.boundFingerprint, actual: fingerprint },
      })
    }
    return { match, fingerprint, bound: false }
  }

  /**
   * 确定试用起点。
   *
   * 只在「没有 license.key 且拿不到正式凭证」时起算，且一旦写下就不再改动。
   * 正式凭证在场时绝不落这个值，否则客户从试用转正后若哪天文件读取失败，
   * 会立刻落回一个早已过期的试用期，直接被锁在门外。
   */
  private resolveTrialStart(
    persisted: PersistedState,
    keyFile: KeyFile | null,
    payload: LicensePayload | null,
    now: number,
  ): PersistedState {
    if (!this.options.trialEnabled) return persisted
    if (persisted.trialStartedAt !== null) return persisted
    if (keyFile || payload?.typ === 'formal') return persisted

    return { ...persisted, trialStartedAt: now }
  }

  // -- 状态读写 --------------------------------------------------------------

  /**
   * 从数据库和隐藏文件各读一份，逐字段取更严格的那个。
   *
   * 「更严格」的含义：试用起点取更早（到期更快），时钟水位与回拨次数取更大
   * （更容易判定异常）。清掉任意一份都不会让约束变松，两份都得处理掉才行。
   */
  private async loadPersisted(now: number): Promise<PersistedState> {
    if (this.persisted) return this.persisted

    const read = await this.safeReadStore()
    const mirror = this.readMirrorState()

    let base = read.state ?? createInitialState(mirror.state?.installId ?? randomUUID(), now)

    if (mirror.state) {
      base = {
        ...base,
        // 镜像里的 installId 优先：库被重建时它是唯一还认得这套部署的线索
        installId: mirror.state.installId,
        trialStartedAt: earlier(base.trialStartedAt, mirror.state.trialStartedAt),
        maxSeenTs: Math.max(base.maxSeenTs, mirror.state.maxSeenTs),
        rollbackCount: Math.max(base.rollbackCount, mirror.state.rollbackCount),
      }
    } else if (mirror.tampered) {
      // 文件在但 MAC 不对或结构不符。判定不受影响（此时只剩数据库一份，而那
      // 一份并不因此变松），但必须留痕：镜像是刻意藏起来的，正常运维不会碰到
      // 它，动过它就说明有人在找防重置的边界，这是报障时最值得先看的一条。
      await this.emit({ kind: 'mirror_tampered', at: now })
    }

    // 读库失败时不缓存这一份，下一轮 refresh 会重新读；读通了才认它权威。
    this.storeReadFailed = !read.ok
    if (read.ok) this.persisted = base

    return base
  }

  private async persist(next: PersistedState): Promise<void> {
    if (this.storeReadFailed) {
      // 手里这份是「库读不到时临时拼出来的」：installId 是新生成的、试用起点
      // 是当前时刻、指纹和试用实例身份都是空的。把它写回去会把真实记录整条
      // 盖掉——试用期从头起算、指纹解绑、实例身份丢失，于是客户端会拿着一个
      // 新身份再向我方注册一次。一次读超时不该有这种后果。
      //
      // 镜像也一样不写。它是库之外唯一的权威副本，用临时状态盖掉它等于把最后
      // 一条能认出这套部署的线索也删了。
      return
    }

    this.persisted = next

    await this.options.store.writeState(next).catch(() => undefined)

    const mirror: MirrorState = {
      installId: next.installId,
      trialStartedAt: next.trialStartedAt,
      maxSeenTs: next.maxSeenTs,
      rollbackCount: next.rollbackCount,
    }

    // 首选系统级目录，写不进去（容器未挂卷、权限不足）就退到 home
    for (const path of this.mirrorCandidates()) {
      if (writeMirror(mirror, this.options.mirrorSecret, path)) {
        this.resolvedMirrorPath = path
        return
      }
    }
    // 两处都写不了就只剩数据库一份。此时不能拒绝服务，防重置强度降低而已。
  }

  private readMirrorState() {
    // 逐个候选位置找一份能用的。找不到时也要把「文件在但校验不过」这个信号带
    // 回去 —— 原先这里在兜底分支硬写 tampered: false，于是 readMirror() 辛苦
    // 判出来的篡改标志结构上永远到不了调用方（P8 篡改演练发现）。
    let tampered = false
    for (const path of this.mirrorCandidates()) {
      const result = readMirror(this.options.mirrorSecret, path)
      if (result.state) {
        this.resolvedMirrorPath = path
        return result
      }
      tampered = tampered || result.tampered
    }
    return { state: null, tampered }
  }

  private mirrorCandidates(): string[] {
    if (this.options.mirrorFilePath) return [this.options.mirrorFilePath]
    if (this.resolvedMirrorPath) return [this.resolvedMirrorPath]
    return [mirrorPath(), fallbackMirrorPath()]
  }

  /**
   * 读库，并且**把「读到空」和「读失败」分开**。
   *
   * 两者以前都返回 null，于是一次读超时就被当成「首次运行」。调用方靠这个
   * 区别决定该不该回写，混在一起会让故障变成数据损坏。
   */
  private async safeReadStore(): Promise<{ ok: boolean; state: PersistedState | null }> {
    try {
      return { ok: true, state: await this.options.store.readState() }
    } catch {
      return { ok: false, state: null }
    }
  }

  private async safeDbSignal(): Promise<string | null> {
    if (!this.options.dbSignal) return null
    try {
      return await this.options.dbSignal()
    } catch {
      return null
    }
  }

  private async emit(event: LicenseEvent): Promise<void> {
    this.options.logger?.(describe(event), event)
    await this.options.store.recordEvent(event).catch(() => undefined)
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  private hostSignal(): string {
    if (this.options.hostSignal) return this.options.hostSignal()
    return [hostname(), platform(), String(cpus().length)].join('|')
  }
}

function earlier(a: number | null, b: number | null): number | null {
  if (a === null) return b
  if (b === null) return a
  return Math.min(a, b)
}

function describe(event: LicenseEvent): string {
  switch (event.kind) {
    case 'loaded':
      return '已加载授权文件'
    case 'reloaded':
      return '检测到授权文件变更，已重新加载'
    case 'file_missing':
      if (event.detail?.servedFromCache) {
        return 'license.key 不见了，正在用上次加载的凭证继续服务，请尽快确认文件是否被误删或挂载卷是否丢失'
      }
      if (event.detail?.lastChecksum) {
        return 'license.key 不见了，且本地没有可用的凭证缓存'
      }
      return '未找到 license.key，进入试用判定'
    case 'verify_failed':
      return `授权凭证校验失败：${event.reason}`
    case 'fingerprint_bound':
      return '已完成机器指纹首次绑定'
    case 'fingerprint_mismatch':
      return '机器指纹与绑定值不符'
    case 'clock_rollback':
      return '检测到系统时钟回拨'
    case 'clock_advance_clamped':
      return '系统时钟前跳过大，已暂停推进时间水位'
    case 'clock_corrected':
      return '系统时钟已修正回此前的前跳之前，时间水位随之降回'
    case 'clock_reset':
      return '时间水位被人工重置（时钟异常恢复操作）'
    case 'mirror_tampered':
      return '本地状态镜像文件校验不通过，可能被改动过'
    case 'status_changed':
      return `授权状态变更为 ${event.status}`
    case 'trial_registered':
      return '试用实例注册成功'
    case 'trial_register_failed':
      return '试用实例注册失败'
  }
}
