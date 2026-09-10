import { generateKeyPairSync } from 'crypto'
import { JwsService } from './jws.service'
import { stableStringify, toBase64Url } from './base64url.util'

describe('JwsService', () => {
  const service = new JwsService()

  const makeKeyPair = () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    return {
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    }
  }

  const samplePayload = {
    ver: 2,
    typ: 'formal',
    lno: 'LIC-2026-0007',
    cname: '某某集团',
    lic: { start: 1757376000, end: 1788912000 },
  }

  it('签发的凭证能用对应公钥验签通过，且 payload 原样还原', () => {
    const { publicKeyPem, privateKeyPem } = makeKeyPair()

    const jws = service.sign(samplePayload, 'lk_2026a', privateKeyPem)
    const result = service.verify(jws, publicKeyPem)

    expect(result.valid).toBe(true)
    expect(result.header).toEqual({ alg: 'EdDSA', typ: 'INFI-LIC', kid: 'lk_2026a' })
    expect(result.payload).toEqual(samplePayload)
  })

  it('换成另一把公钥必须验签失败', () => {
    const signer = makeKeyPair()
    const stranger = makeKeyPair()

    const jws = service.sign(samplePayload, 'lk_2026a', signer.privateKeyPem)
    const result = service.verify(jws, stranger.publicKeyPem)

    expect(result.valid).toBe(false)
    expect(result.reason).toBe('bad_signature')
  })

  it('篡改 payload 后验签失败', () => {
    const { publicKeyPem, privateKeyPem } = makeKeyPair()
    const jws = service.sign(samplePayload, 'lk_2026a', privateKeyPem)

    const [header, , signature] = jws.split('.')
    const tampered = toBase64Url(
      stableStringify({ ...samplePayload, lic: { start: 1757376000, end: 9999999999 } }),
    )

    const result = service.verify(`${header}.${tampered}.${signature}`, publicKeyPem)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('bad_signature')
  })

  it('拒绝把 alg 改成非 EdDSA 的凭证', () => {
    const { publicKeyPem, privateKeyPem } = makeKeyPair()
    const jws = service.sign(samplePayload, 'lk_2026a', privateKeyPem)
    const [, payload, signature] = jws.split('.')

    const forgedHeader = toBase64Url(
      stableStringify({ alg: 'none', typ: 'INFI-LIC', kid: 'lk_2026a' }),
    )

    const result = service.verify(`${forgedHeader}.${payload}.${signature}`, publicKeyPem)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('unsupported_alg')
  })

  it('格式不合法的输入不抛异常，只返回失败', () => {
    const { publicKeyPem } = makeKeyPair()

    expect(service.verify('', publicKeyPem).reason).toBe('malformed')
    expect(service.verify('a.b', publicKeyPem).reason).toBe('malformed')
    expect(service.verify('a.b.c', publicKeyPem).reason).toBe('unparsable')
  })

  it('peekHeader 能在不验签的情况下读出 kid，用于挑选公钥', () => {
    const { privateKeyPem } = makeKeyPair()
    const jws = service.sign(samplePayload, 'lk_2026b', privateKeyPem)

    expect(service.peekHeader(jws)?.kid).toBe('lk_2026b')
  })

  it('payload 的 key 顺序不影响签名结果', () => {
    const { privateKeyPem } = makeKeyPair()

    const a = service.sign({ x: 1, y: 2 }, 'lk_2026a', privateKeyPem)
    const b = service.sign({ y: 2, x: 1 }, 'lk_2026a', privateKeyPem)

    expect(a).toBe(b)
  })
})
