import { createHmac, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { dirname, join } from 'node:path'

import { stableStringify } from '../stable-json'

/**
 * 需要防重置的最小状态子集。
 *
 * 只镜像这几项：清库能绕过的就是它们，而其它字段（凭证内容、实例密钥）本来
 * 就在别处有权威副本，镜像了只是增加不一致的机会。
 */
export interface MirrorState {
  installId: string
  trialStartedAt: number | null
  maxSeenTs: number
  rollbackCount: number
}

export interface MirrorResult {
  state: MirrorState | null
  /** 文件存在但签名不对或结构不符 —— 有人动过 */
  tampered: boolean
}

/**
 * 数据库之外的第二份状态副本。
 *
 * 试用起点和时钟水位只存库的话，`DROP DATABASE` 就能无限续试用。多存一份到
 * 数据目录外的隐藏文件，两份取更严格的那个，重置成本就从「删库」变成「同时
 * 找到并删掉两处」。
 *
 * 这挡不住铁了心逆向的人，也不打算挡 —— 目标是让顺手重置变得不顺手。真正的
 * 约束仍然是合同。
 */
export function readMirror(secret: string, path = mirrorPath()): MirrorResult {
  try {
    if (!existsSync(path)) return { state: null, tampered: false }

    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw) as { data?: unknown; mac?: unknown }
    if (typeof parsed.mac !== 'string' || typeof parsed.data !== 'object' || !parsed.data) {
      return { state: null, tampered: true }
    }

    if (!macMatches(parsed.data, parsed.mac, secret)) {
      return { state: null, tampered: true }
    }

    const state = parsed.data as MirrorState
    if (typeof state.installId !== 'string' || typeof state.maxSeenTs !== 'number') {
      return { state: null, tampered: true }
    }

    return { state, tampered: false }
  } catch {
    // 读不出来（权限、损坏、非 JSON）当作被动过，让上层退到更严格的一侧
    return { state: null, tampered: true }
  }
}

export function writeMirror(state: MirrorState, secret: string, path = mirrorPath()): boolean {
  try {
    mkdirSync(dirname(path), { recursive: true })
    const data = { ...state }
    const payload = { data, mac: macOf(data, secret) }
    writeFileSync(path, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 })
    return true
  } catch {
    // 只读文件系统、容器未挂卷等场景写不进去。
    // 此时降级为「只有库这一份」，不能因为写不了镜像就拒绝服务。
    return false
  }
}

/** 放在数据目录之外，避免跟着数据库备份/恢复一起被还原 */
export function mirrorPath(): string {
  if (platform() === 'win32') {
    const base = process.env.ProgramData || process.env.LOCALAPPDATA || homedir()
    return join(base, '.infinisynapse', '.runtime-state')
  }
  // 容器里 /var/lib 往往不可写，homedir 更稳，两者都试由调用方决定
  const base = process.env.INFINI_STATE_DIR || '/var/lib/infinisynapse'
  return join(base, '.runtime-state')
}

export function fallbackMirrorPath(): string {
  return join(homedir(), '.infinisynapse', '.runtime-state')
}

function macOf(data: unknown, secret: string): string {
  return createHmac('sha256', `infini-license-mirror:${secret}`)
    .update(stableStringify(data))
    .digest('hex')
}

function macMatches(data: unknown, mac: string, secret: string): boolean {
  const expected = macOf(data, secret)
  if (expected.length !== mac.length) return false
  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(mac, 'utf8'))
}
