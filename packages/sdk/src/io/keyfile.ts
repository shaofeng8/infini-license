import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

export interface KeyFile {
  path: string
  content: string
  /** 内容 SHA-256 前 16 位，用于判断文件是否变化 */
  checksum: string
  mtimeMs: number
}

export interface KeyFileLookup {
  /** 显式指定的路径，通常来自 LICENSE_KEY_PATH */
  explicitPath?: string | null
  /** 解析相对路径的基准目录，默认当前工作目录 */
  baseDir?: string
}

/** 未显式配置时的搜索顺序。放宽到上两级是因为服务常从 packages/server 启动 */
const DEFAULT_CANDIDATES = [
  'license.key',
  'config/license.key',
  '../license.key',
  '../../license.key',
  '/etc/infinisynapse/license.key',
]

/**
 * 找出并读取 license.key。
 *
 * 找不到不是错误 —— 那是试用模式的入口条件，返回 null 交由上层判定。
 * 显式配置了路径却读不到才值得警告，所以这种情况会把候选路径原样带回去。
 */
export function loadKeyFile(lookup: KeyFileLookup = {}): KeyFile | null {
  for (const path of resolveCandidates(lookup)) {
    const file = tryRead(path)
    if (file) return file
  }
  return null
}

export function resolveCandidates(lookup: KeyFileLookup = {}): string[] {
  const baseDir = lookup.baseDir ?? process.cwd()
  const explicit = lookup.explicitPath?.trim()

  // 显式配置就只认这一个路径：静默回退到别处会让「我明明换了文件」变成悬案
  if (explicit) {
    return [isAbsolute(explicit) ? explicit : resolve(baseDir, explicit)]
  }

  return DEFAULT_CANDIDATES.map(candidate =>
    isAbsolute(candidate) ? candidate : resolve(baseDir, candidate),
  )
}

function tryRead(path: string): KeyFile | null {
  try {
    if (!existsSync(path)) return null

    const stat = statSync(path)
    if (!stat.isFile()) return null
    // 正常凭证不过几 KB。设个上限，免得误指向大文件时把内存读爆
    if (stat.size > 64 * 1024) return null

    const content = readFileSync(path, 'utf8')
    return { path, content, checksum: checksumOf(content), mtimeMs: stat.mtimeMs }
  } catch {
    // 权限不足、读取中被替换等等一律当作没找到，由上层按 missing 处理
    return null
  }
}

export function checksumOf(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16)
}
