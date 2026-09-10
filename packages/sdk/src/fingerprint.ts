import { createHash } from 'crypto'

export interface FingerprintSignals {
  /**
   * 安装标识。首次启动生成的 UUID，落在数据库与隐藏文件里。
   * 这是指纹的**唯一**成分 —— 它跟着「这套部署」而不是「这台机器」。
   */
  installId: string
  /** 主机侧信号：hostname + 平台 + CPU 核数等的组合。只做漂移观测，不参与绑定 */
  hostSignal?: string
  /** 数据库侧信号：库的创建时间或某个初始行的 id。只做漂移观测，不参与绑定 */
  dbSignal?: string
}

export interface FingerprintResult {
  /** TOFU 比对用。只由 installId 决定 */
  fingerprint: string
  /** 主机信号的哈希，上报给服务端用于识别「疑似重装」 */
  hostSignalHash: string | null
  /** 数据库信号的哈希，用途同上 */
  dbSignalHash: string | null
}

/**
 * 计算机器指纹。
 *
 * **指纹只由 installId 决定，主机与数据库信号一律不参与绑定。**
 *
 * 这一点是踩过坑之后收紧的。曾经把 hostSignal 一起哈希进指纹，看起来更严格，
 * 实际上是把「客户重建了一次容器」变成「客户全员被锁在门外」：容器的 hostname
 * 默认就是容器短 ID，`docker compose down && up` 一次就换一个值；os.cpus()
 * 在容器里读的是宿主机核数，宿主机扩容也会变。这类基础设施变更在私有化部署
 * 里是家常便饭，而指纹不符会被判成 invalid，客户内网里我们没有任何远程解锁
 * 手段 —— 误判一次就是一次上门事故。
 *
 * **这个指纹不提供任何复制防护，别指望它。** 这里曾经写着「把 license.key
 * 复制到另一套部署 → installId 不同 → 指纹不符，拦得住」，P8 复制防护演练把
 * 它证伪了：
 *
 * - 复制到全新部署 → 对方 boundFingerprint 为空 → TOFU 首次绑定 → 放行
 * - 复制到已完成绑定的另一套部署 → 对方 installId 没变 → 指纹照样相等 → 放行，
 *   连 fingerprint_mismatch 都不会记
 *
 * 根因是绑定的两端本来就是同一个东西：指纹由 installId 算出，而 boundFingerprint
 * 就是首次使用正式凭证时写下的这同一个值。installId 属于「这套部署」，换掉
 * license.key 文件不会改变它，所以比对永远相等。凭证里的 lid/lno/jti 一个都没
 * 参与绑定 —— 它记录的是「我第一次见到的自己」，与凭证身份无关。
 *
 * 而这不是实现疏漏，是交付方式的必然：正式模式完全离线，且承诺「放进文件即
 * 生效、无任何激活动作」。客户端首次启动时既不知道该绑谁，也没法问我们。要真
 * 能防复制，就得在签发前先拿到客户的 installId 并写死进凭证，那等于把免激活
 * 这条承诺换掉。**复制防护目前靠合同约束，技术上只做服务端侧观测。**
 *
 * 那这个指纹还留着做什么：`fingerprint_bound` / `fingerprint_mismatch` 两条事件
 * 在客户报障时能看出这套部署是不是换过身份；`hostSignalHash` 的漂移让我们在
 * 试用上报里观测到「疑似重装」。**都只记录，不阻断** —— 指纹不符唯一的现实成因
 * 是基础设施变更而非盗用，据此锁人是净亏（见 evaluate.ts）。
 *
 * 仍然成立的是另一半：重建容器、换宿主机、恢复备份到新硬件 → installId 不变
 * → 一切正常。这正是当初把 hostSignal 踢出指纹要保住的东西。
 */
export function computeFingerprint(signals: FingerprintSignals): FingerprintResult {
  return {
    fingerprint: sha256Hex(signals.installId),
    hostSignalHash: signals.hostSignal ? sha256Hex(signals.hostSignal) : null,
    dbSignalHash: signals.dbSignal ? sha256Hex(signals.dbSignal) : null,
  }
}

/**
 * TOFU 比对结果。
 *
 * 返回 null 表示「尚未绑定」，调用方应当把当前指纹写入并放行 —— 这就是
 * Trust On First Use：第一次见到谁就认谁。正式凭证签发时客户环境还不存在，
 * 我们无从预知指纹，只能这么做。
 */
export function compareFingerprint(
  current: string,
  bound: string | null | undefined,
): boolean | null {
  if (!bound) return null
  return current === bound
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}
