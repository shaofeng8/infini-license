import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'

import { checksumOf, loadKeyFile, resolveCandidates } from './keyfile'

describe('license.key 定位与读取', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'infini-keyfile-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('读取工作目录下的 license.key', () => {
    writeFileSync(join(dir, 'license.key'), 'content')

    const file = loadKeyFile({ baseDir: dir })
    expect(file?.path).toBe(join(dir, 'license.key'))
    expect(file?.content).toBe('content')
    expect(file?.checksum).toBe(checksumOf('content'))
  })

  it('找不到文件返回 null —— 这是试用模式的入口，不是错误', () => {
    expect(loadKeyFile({ baseDir: dir })).toBeNull()
  })

  it('按候选顺序优先取工作目录，其次 config 目录', () => {
    mkdirSync(join(dir, 'config'))
    writeFileSync(join(dir, 'config', 'license.key'), 'from-config')
    expect(loadKeyFile({ baseDir: dir })?.content).toBe('from-config')

    writeFileSync(join(dir, 'license.key'), 'from-root')
    expect(loadKeyFile({ baseDir: dir })?.content).toBe('from-root')
  })

  it('显式指定路径时只认这一个，不回退到默认候选', () => {
    writeFileSync(join(dir, 'license.key'), 'default-location')

    const file = loadKeyFile({ baseDir: dir, explicitPath: join(dir, 'nowhere.key') })
    expect(file).toBeNull()
  })

  it('显式路径支持相对写法，按 baseDir 解析', () => {
    mkdirSync(join(dir, 'deploy'))
    writeFileSync(join(dir, 'deploy', 'prod.key'), 'explicit')

    expect(loadKeyFile({ baseDir: dir, explicitPath: 'deploy/prod.key' })?.content).toBe('explicit')
  })

  it('空白的显式路径视作未配置', () => {
    writeFileSync(join(dir, 'license.key'), 'fallback')
    expect(loadKeyFile({ baseDir: dir, explicitPath: '   ' })?.content).toBe('fallback')
  })

  it('路径指向目录时跳过', () => {
    mkdirSync(join(dir, 'license.key'))
    expect(loadKeyFile({ baseDir: dir })).toBeNull()
  })

  it('文件过大时跳过，避免误指向大文件读爆内存', () => {
    writeFileSync(join(dir, 'license.key'), 'x'.repeat(70 * 1024))
    expect(loadKeyFile({ baseDir: dir })).toBeNull()
  })

  it('内容变化时 checksum 随之变化，热重载据此判断', () => {
    writeFileSync(join(dir, 'license.key'), 'v1')
    const first = loadKeyFile({ baseDir: dir })!

    writeFileSync(join(dir, 'license.key'), 'v2')
    const second = loadKeyFile({ baseDir: dir })!

    expect(second.checksum).not.toBe(first.checksum)
  })

  it('候选路径一律是绝对路径，不受进程工作目录影响', () => {
    const candidates = resolveCandidates({ baseDir: dir })

    expect(candidates.length).toBeGreaterThan(1)
    for (const candidate of candidates) {
      expect(isAbsolute(candidate)).toBe(true)
    }
    expect(candidates[0]).toBe(join(dir, 'license.key'))
  })
})
