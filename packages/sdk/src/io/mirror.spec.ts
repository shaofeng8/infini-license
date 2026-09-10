import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MirrorState, readMirror, writeMirror } from './mirror'

const SECRET = 'build-time-secret'

describe('镜像文件', () => {
  let dir: string
  let path: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'infini-mirror-'))
    path = join(dir, 'nested', '.runtime-state')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const state: MirrorState = {
    installId: 'install-1',
    trialStartedAt: 1_700_000_000_000,
    maxSeenTs: 1_700_000_500_000,
    rollbackCount: 2,
  }

  it('写入后能原样读回，并自动建目录', () => {
    expect(writeMirror(state, SECRET, path)).toBe(true)
    expect(readMirror(SECRET, path)).toEqual({ state, tampered: false })
  })

  it('文件不存在时返回 null 且不算被篡改', () => {
    expect(readMirror(SECRET, path)).toEqual({ state: null, tampered: false })
  })

  it('改动内容后 MAC 校验失败，判定为被篡改', () => {
    writeMirror(state, SECRET, path)

    const payload = JSON.parse(readFileSync(path, 'utf8'))
    payload.data.trialStartedAt = Date.now()
    writeFileSync(path, JSON.stringify(payload))

    expect(readMirror(SECRET, path)).toEqual({ state: null, tampered: true })
  })

  it('换密钥读不出来 —— 换构建产物伪造不了镜像', () => {
    writeMirror(state, SECRET, path)
    expect(readMirror('another-secret', path).tampered).toBe(true)
  })

  it('内容不是 JSON 时判定为被篡改而非崩溃', () => {
    writeMirror(state, SECRET, path)
    writeFileSync(path, 'not json at all')
    expect(readMirror(SECRET, path)).toEqual({ state: null, tampered: true })
  })

  it('缺少 mac 字段时判定为被篡改', () => {
    writeMirror(state, SECRET, path)
    writeFileSync(path, JSON.stringify({ data: state }))
    expect(readMirror(SECRET, path).tampered).toBe(true)
  })

  it('MAC 正确但结构不完整时判定为被篡改', () => {
    // 手工构造一个 MAC 自洽但缺字段的文件：光校验 MAC 不足以信任内容
    writeMirror({ ...state, installId: undefined as unknown as string }, SECRET, path)
    expect(readMirror(SECRET, path).tampered).toBe(true)
  })

  it('目录不可写时返回 false 而非抛异常', () => {
    // 把文件路径指向一个已存在的普通文件之下，mkdir 必然失败
    const blocker = join(dir, 'blocker')
    writeFileSync(blocker, 'x')
    expect(writeMirror(state, SECRET, join(blocker, 'sub', 'state'))).toBe(false)
  })

  it('trialStartedAt 为 null 也能正确往返', () => {
    const fresh: MirrorState = { ...state, trialStartedAt: null }
    writeMirror(fresh, SECRET, path)
    expect(readMirror(SECRET, path).state).toEqual(fresh)
  })
})
