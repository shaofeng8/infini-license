import { stableStringify } from './stable-json'

describe('stableStringify', () => {
  it('键序与插入顺序无关 —— 签名的前提', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
    expect(stableStringify({ a: 2, b: 1 })).toBe(stableStringify({ b: 1, a: 2 }))
  })

  it('递归排序嵌套对象', () => {
    expect(stableStringify({ z: { d: 1, c: 2 }, a: 3 })).toBe('{"a":3,"z":{"c":2,"d":1}}')
  })

  it('保留数组顺序 —— 数组的顺序是语义的一部分', () => {
    expect(stableStringify([3, 1, 2])).toBe('[3,1,2]')
  })

  it('丢弃 undefined 值的键，与 JSON.stringify 一致', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}')
  })

  it('保留显式的 null', () => {
    expect(stableStringify({ a: null })).toBe('{"a":null}')
  })

  it('处理标量与顶层 null', () => {
    expect(stableStringify(1)).toBe('1')
    expect(stableStringify('x')).toBe('"x"')
    expect(stableStringify(true)).toBe('true')
    expect(stableStringify(null)).toBe('null')
    expect(stableStringify(undefined)).toBe('null')
  })

  it('转义键名中的特殊字符', () => {
    expect(stableStringify({ 'a"b': 1 })).toBe('{"a\\"b":1}')
  })

  it('输出可被 JSON.parse 还原', () => {
    const value = { z: [1, { b: 2, a: null }], y: 'text' }
    expect(JSON.parse(stableStringify(value))).toEqual(value)
  })
})
