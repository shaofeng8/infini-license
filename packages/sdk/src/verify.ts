import { createPublicKey, verify as cryptoVerify } from 'crypto'
import { JWS_TYP } from './constants'
import { InvalidReason, LicensePayload } from './types'

export interface TrustedKey {
  kid: string
  /** SPKI PEM 格式的 Ed25519 公钥 */
  publicKey: string
}

export interface VerifyResult {
  valid: boolean
  payload?: LicensePayload
  kid?: string
  reason?: InvalidReason
}

/**
 * 校验凭证签名。
 *
 * 与服务端 JwsService 是两份独立实现，故意不复用 —— SDK 要随产品发给客户、
 * 要能被混淆、不能依赖服务端代码。改动签名格式时两边必须同步。
 */
export function verifyCredential(jws: string, trustedKeys: TrustedKey[]): VerifyResult {
  const segments = typeof jws === 'string' ? jws.split('.') : []
  if (segments.length !== 3) {
    return { valid: false, reason: 'malformed' }
  }

  const [headerSeg, payloadSeg, signatureSeg] = segments

  let header: { alg?: string; typ?: string; kid?: string }
  let payload: LicensePayload
  try {
    header = JSON.parse(fromBase64Url(headerSeg).toString('utf8'))
    payload = JSON.parse(fromBase64Url(payloadSeg).toString('utf8'))
  } catch {
    return { valid: false, reason: 'malformed' }
  }

  // alg 与 typ 都由我们自己认定，不能听凭证里写什么就用什么。
  // 否则把 alg 改成 none 就能绕过验签，这是最经典的 JWT 攻击。
  if (header.alg !== 'EdDSA' || header.typ !== JWS_TYP) {
    return { valid: false, reason: 'malformed' }
  }

  const key = trustedKeys.find(k => k.kid === header.kid)
  if (!key) {
    // 客户端内置的公钥列表随产品版本发布，离线客户装的是老版本。
    // 走到这里通常意味着我们用比客户端更新的密钥签了凭证。
    return { valid: false, kid: header.kid, reason: 'unknown_kid' }
  }

  try {
    const ok = cryptoVerify(
      null,
      Buffer.from(`${headerSeg}.${payloadSeg}`, 'ascii'),
      createPublicKey(key.publicKey),
      fromBase64Url(signatureSeg),
    )
    return ok
      ? { valid: true, payload, kid: key.kid }
      : { valid: false, payload, kid: key.kid, reason: 'signature' }
  } catch {
    return { valid: false, kid: key.kid, reason: 'signature' }
  }
}

/**
 * 不验签地读出 payload。
 *
 * 只用于诊断日志。任何展示给用户或参与判定的信息都必须走 verifyCredential，
 * 这个函数的返回值不可信。
 */
export function peekPayloadUnsafe(jws: string): LicensePayload | null {
  const payloadSeg = typeof jws === 'string' ? jws.split('.')[1] : undefined
  if (!payloadSeg) return null
  try {
    return JSON.parse(fromBase64Url(payloadSeg).toString('utf8'))
  } catch {
    return null
  }
}

function fromBase64Url(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  return Buffer.from(normalized + padding, 'base64')
}
