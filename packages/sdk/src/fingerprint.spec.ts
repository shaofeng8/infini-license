import { compareFingerprint, computeFingerprint } from './fingerprint'

describe('computeFingerprint', () => {
  it('相同信号产出相同指纹', () => {
    const signals = { installId: 'uuid-1', hostSignal: 'host-a', dbSignal: 'db-1' }

    expect(computeFingerprint(signals).fingerprint).toBe(computeFingerprint(signals).fingerprint)
  })

  it('installId 变化则指纹变化 —— 复制 license.key 到新部署会被识破', () => {
    const a = computeFingerprint({ installId: 'uuid-1', hostSignal: 'h', dbSignal: 'd' })
    const b = computeFingerprint({ installId: 'uuid-2', hostSignal: 'h', dbSignal: 'd' })

    expect(a.fingerprint).not.toBe(b.fingerprint)
  })

  /**
   * 这条是回归测试，防的是一次真实事故：曾经把 hostSignal 哈希进指纹，导致
   * 客户重建一次容器（hostname 默认就是容器短 ID，每次重建都变）就指纹不符，
   * 全员被判 invalid 锁在门外，而客户内网里没有远程解锁手段。
   *
   * 主机与数据库信号只做漂移观测，任何时候都不许影响指纹。
   */
  it('主机与数据库信号变化不影响指纹 —— 重建容器、宿主机扩容不能锁死客户', () => {
    const before = computeFingerprint({
      installId: 'uuid-1',
      hostSignal: '815da51211cf|linux|8',
      dbSignal: 'db-created-2026-01-01',
    })
    const after = computeFingerprint({
      installId: 'uuid-1',
      hostSignal: '6a3ac32b0520|linux|32',
      dbSignal: 'db-created-2026-06-01',
    })

    expect(after.fingerprint).toBe(before.fingerprint)
    expect(compareFingerprint(after.fingerprint, before.fingerprint)).toBe(true)
  })

  it('信号全缺省时仍能算出指纹', () => {
    const result = computeFingerprint({ installId: 'uuid-1' })

    expect(result.fingerprint).toHaveLength(64)
    expect(result.hostSignalHash).toBeNull()
    expect(result.dbSignalHash).toBeNull()
  })

  it('主机与数据库信号各自出哈希，供服务端识别疑似重装', () => {
    const a = computeFingerprint({
      installId: 'uuid-1',
      hostSignal: 'same-host',
      dbSignal: 'same-db',
    })
    const b = computeFingerprint({
      installId: 'uuid-2',
      hostSignal: 'same-host',
      dbSignal: 'same-db',
    })

    expect(a.fingerprint).not.toBe(b.fingerprint)
    expect(a.hostSignalHash).toBe(b.hostSignalHash)
    expect(a.dbSignalHash).toBe(b.dbSignalHash)
    expect(a.hostSignalHash).not.toBe(a.dbSignalHash)
  })
})

describe('compareFingerprint', () => {
  it('尚未绑定时返回 null，调用方应写入并放行（TOFU）', () => {
    expect(compareFingerprint('abc', null)).toBeNull()
    expect(compareFingerprint('abc', undefined)).toBeNull()
    expect(compareFingerprint('abc', '')).toBeNull()
  })

  it('相符返回 true，不符返回 false', () => {
    expect(compareFingerprint('abc', 'abc')).toBe(true)
    expect(compareFingerprint('abc', 'xyz')).toBe(false)
  })
})
