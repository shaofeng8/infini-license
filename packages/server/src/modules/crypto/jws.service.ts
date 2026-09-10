import { createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify } from 'crypto'
import { Injectable } from '@nestjs/common'
import { fromBase64Url, stableStringify, toBase64Url } from './base64url.util'

export const JWS_TYP = 'INFI-LIC'

export interface JwsHeader {
  alg: 'EdDSA'
  typ: typeof JWS_TYP
  kid: string
}

export interface JwsVerifyResult<T = Record<string, any>> {
  valid: boolean
  header?: JwsHeader
  payload?: T
  reason?: string
}

/**
 * Ed25519 JWS Compact 签名与验签。
 *
 * 选 Ed25519 而不是 RSA：签名只有 64 字节，公钥 32 字节，凭证文件能压到
 * 一屏之内，客户运维复制粘贴不容易出错；而且没有 padding/摘要算法这类
 * 可被降级攻击的可配置项。
 *
 * 注意：这里的验签只用于服务端自检与签发后的往返校验。客户端 SDK 有一份
 * 独立实现（packages/sdk），故意不复用本文件 —— SDK 要随产品发给客户、
 * 要过混淆、不能依赖服务端代码。两边改动时需同步。
 */
@Injectable()
export class JwsService {
  sign(payload: Record<string, any>, kid: string, privateKeyPem: string): string {
    const header: JwsHeader = { alg: 'EdDSA', typ: JWS_TYP, kid }
    const signingInput = `${toBase64Url(stableStringify(header))}.${toBase64Url(stableStringify(payload))}`
    const key = createPrivateKey(privateKeyPem)
    const signature = cryptoSign(null, Buffer.from(signingInput, 'ascii'), key)
    return `${signingInput}.${toBase64Url(signature)}`
  }

  /** 只验签名，不判断有效期、指纹等业务规则 */
  verify<T = Record<string, any>>(jws: string, publicKeyPem: string): JwsVerifyResult<T> {
    const segments = jws?.split('.')
    if (segments?.length !== 3) {
      return { valid: false, reason: 'malformed' }
    }

    const [headerSeg, payloadSeg, signatureSeg] = segments

    let header: JwsHeader
    let payload: T
    try {
      header = JSON.parse(fromBase64Url(headerSeg).toString('utf8'))
      payload = JSON.parse(fromBase64Url(payloadSeg).toString('utf8'))
    } catch {
      return { valid: false, reason: 'unparsable' }
    }

    // alg 必须由我们自己认定，不能听凭证里写什么就用什么，否则等于给
    // "alg: none" 这类经典 JWT 攻击开门
    if (header?.alg !== 'EdDSA') {
      return { valid: false, header, payload, reason: 'unsupported_alg' }
    }

    try {
      const ok = cryptoVerify(
        null,
        Buffer.from(`${headerSeg}.${payloadSeg}`, 'ascii'),
        createPublicKey(publicKeyPem),
        fromBase64Url(signatureSeg),
      )
      return ok
        ? { valid: true, header, payload }
        : { valid: false, header, payload, reason: 'bad_signature' }
    } catch {
      return { valid: false, header, payload, reason: 'verify_error' }
    }
  }

  /** 不验签地读出 header，用于在众多公钥里挑出对应的 kid */
  peekHeader(jws: string): JwsHeader | null {
    const headerSeg = jws?.split('.')[0]
    if (!headerSeg) return null
    try {
      return JSON.parse(fromBase64Url(headerSeg).toString('utf8'))
    } catch {
      return null
    }
  }
}
