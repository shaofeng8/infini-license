import { createHash, createHmac, randomUUID } from 'node:crypto'

export interface SignedHeaders {
  'X-License-Instance': string
  'X-License-Timestamp': string
  'X-License-Nonce': string
  'X-License-Signature': string
}

export interface SignInput {
  method: string
  /** 请求路径，不含 query。必须与服务端看到的完全一致 */
  path: string
  /** 序列化后的请求体，空请求传空串 */
  rawBody: string
  instanceId: string
  instanceSecret: string
  /** Unix 毫秒 */
  now: number
  nonce?: string
}

/**
 * 拼签名串。纯函数，服务端有一份镜像实现，两边必须逐字节一致。
 *
 * 五个字段各有分工：method 与 path 防止签名被挪用到别的接口，timestamp 限定
 * 有效窗口，nonce 防重放，body 哈希防篡改。少任何一个都能构造出绕过。
 *
 * 用 `\n` 分隔而不是拼接，是为了避免 ('a','bc') 与 ('ab','c') 签出同一个串。
 */
export function buildSigningString(input: {
  method: string
  path: string
  timestampSec: number
  nonce: string
  rawBody: string
}): string {
  return [
    input.method.toUpperCase(),
    input.path,
    String(input.timestampSec),
    input.nonce,
    sha256Hex(input.rawBody),
  ].join('\n')
}

export function signRequest(input: SignInput): SignedHeaders {
  const timestampSec = Math.floor(input.now / 1000)
  const nonce = input.nonce ?? randomUUID()

  const signingString = buildSigningString({
    method: input.method,
    path: input.path,
    timestampSec,
    nonce,
    rawBody: input.rawBody,
  })

  return {
    'X-License-Instance': input.instanceId,
    'X-License-Timestamp': String(timestampSec),
    'X-License-Nonce': nonce,
    'X-License-Signature': createHmac('sha256', input.instanceSecret)
      .update(signingString, 'utf8')
      .digest('base64'),
  }
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}
