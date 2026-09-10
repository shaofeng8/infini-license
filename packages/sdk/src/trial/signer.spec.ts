import { createHash, createHmac } from 'node:crypto'

import { buildSigningString, signRequest } from './signer'

const SECRET = 'instance-secret'
const NOW = 1_780_000_000_000

describe('请求签名', () => {
  const base = {
    method: 'POST',
    path: '/api/client/heartbeat',
    timestampSec: 1_780_000_000,
    nonce: 'a0b1c2d3-e4f5-4678-9abc-def012345678',
    rawBody: '{"localState":"trial_active"}',
  }

  it('签名串按固定顺序拼接，body 取哈希', () => {
    expect(buildSigningString(base)).toBe(
      [
        'POST',
        '/api/client/heartbeat',
        '1780000000',
        'a0b1c2d3-e4f5-4678-9abc-def012345678',
        createHash('sha256').update(base.rawBody, 'utf8').digest('hex'),
      ].join('\n'),
    )
  })

  it('method 统一大写，客户端传小写也能与服务端对上', () => {
    expect(buildSigningString({ ...base, method: 'post' })).toBe(buildSigningString(base))
  })

  it('五个字段任意一个变化都会改变签名串', () => {
    const original = buildSigningString(base)

    expect(buildSigningString({ ...base, method: 'PUT' })).not.toBe(original)
    expect(buildSigningString({ ...base, path: '/api/client/usage' })).not.toBe(original)
    expect(buildSigningString({ ...base, timestampSec: base.timestampSec + 1 })).not.toBe(original)
    expect(buildSigningString({ ...base, nonce: 'other' })).not.toBe(original)
    expect(buildSigningString({ ...base, rawBody: '{}' })).not.toBe(original)
  })

  it('字段边界不会被歧义拼接吞掉', () => {
    // 用 \n 分隔而非直接相接：否则 path 尾部与 timestamp 首部能互相借位，
    // 构造出两组不同输入签出同一个串
    const a = buildSigningString({ ...base, path: '/a', nonce: 'bc' })
    const b = buildSigningString({ ...base, path: '/ab', nonce: 'c' })
    expect(a).not.toBe(b)
  })

  it('产出的四个请求头齐全，签名是 base64 的 HMAC-SHA256', () => {
    const headers = signRequest({
      method: base.method,
      path: base.path,
      rawBody: base.rawBody,
      instanceId: 'inst-1',
      instanceSecret: SECRET,
      now: NOW,
      nonce: base.nonce,
    })

    expect(headers['X-License-Instance']).toBe('inst-1')
    expect(headers['X-License-Timestamp']).toBe('1780000000')
    expect(headers['X-License-Nonce']).toBe(base.nonce)
    expect(headers['X-License-Signature']).toBe(
      createHmac('sha256', SECRET).update(buildSigningString(base), 'utf8').digest('base64'),
    )
  })

  it('毫秒时间戳被截成秒', () => {
    const headers = signRequest({
      method: 'POST',
      path: '/x',
      rawBody: '',
      instanceId: 'i',
      instanceSecret: SECRET,
      now: 1_780_000_000_999,
    })
    expect(headers['X-License-Timestamp']).toBe('1780000000')
  })

  it('不传 nonce 时自动生成，且每次都不同', () => {
    const input = {
      method: 'POST',
      path: '/x',
      rawBody: '',
      instanceId: 'i',
      instanceSecret: SECRET,
      now: NOW,
    }
    const first = signRequest(input)
    const second = signRequest(input)

    expect(first['X-License-Nonce']).toMatch(/^[0-9a-f-]{36}$/)
    expect(first['X-License-Nonce']).not.toBe(second['X-License-Nonce'])
    // nonce 进了签名串，所以签名也必须跟着变
    expect(first['X-License-Signature']).not.toBe(second['X-License-Signature'])
  })

  it('换密钥签出不同签名', () => {
    const input = {
      method: 'POST',
      path: '/x',
      rawBody: '',
      instanceId: 'i',
      now: NOW,
      nonce: 'fixed',
    }
    expect(signRequest({ ...input, instanceSecret: 'a' })['X-License-Signature']).not.toBe(
      signRequest({ ...input, instanceSecret: 'b' })['X-License-Signature'],
    )
  })
})
