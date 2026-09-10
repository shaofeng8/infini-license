import { generateKeyPairSync, sign as cryptoSign } from 'crypto'
import { peekPayloadUnsafe, TrustedKey, verifyCredential } from './verify'
import { parseLicenseEnvelope } from './envelope'

function makeKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  }
}

function toBase64Url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const samplePayload = {
  ver: 2,
  typ: 'formal',
  iss: 'infini-license',
  lno: 'LIC-2026-0007',
  cname: '某某集团',
}

function makeJws(
  privateKeyPem: string,
  header: Record<string, unknown> = { alg: 'EdDSA', typ: 'INFI-LIC', kid: 'lk_2026a' },
  payload: Record<string, unknown> = samplePayload,
): string {
  const signingInput = `${toBase64Url(JSON.stringify(header))}.${toBase64Url(JSON.stringify(payload))}`
  const signature = cryptoSign(null, Buffer.from(signingInput, 'ascii'), privateKeyPem as never)
  return `${signingInput}.${toBase64Url(signature)}`
}

describe('verifyCredential', () => {
  it('kid 匹配且签名正确时通过', () => {
    const { publicKeyPem, privateKeyPem } = makeKeyPair()
    const keys: TrustedKey[] = [{ kid: 'lk_2026a', publicKey: publicKeyPem }]

    const result = verifyCredential(makeJws(privateKeyPem), keys)

    expect(result.valid).toBe(true)
    expect(result.kid).toBe('lk_2026a')
    expect(result.payload?.lno).toBe('LIC-2026-0007')
  })

  it('从多把内置公钥里按 kid 挑对的那把', () => {
    const older = makeKeyPair()
    const newer = makeKeyPair()
    const keys: TrustedKey[] = [
      { kid: 'lk_2025a', publicKey: older.publicKeyPem },
      { kid: 'lk_2026a', publicKey: newer.publicKeyPem },
    ]

    expect(verifyCredential(makeJws(newer.privateKeyPem), keys).valid).toBe(true)
  })

  it('kid 不在内置列表里时报 unknown_kid，不是签名错误', () => {
    const signer = makeKeyPair()
    const keys: TrustedKey[] = [{ kid: 'lk_2025a', publicKey: signer.publicKeyPem }]

    const result = verifyCredential(makeJws(signer.privateKeyPem), keys)

    expect(result.valid).toBe(false)
    expect(result.reason).toBe('unknown_kid')
    expect(result.kid).toBe('lk_2026a')
  })

  it('换一把公钥验签失败', () => {
    const signer = makeKeyPair()
    const stranger = makeKeyPair()
    const keys: TrustedKey[] = [{ kid: 'lk_2026a', publicKey: stranger.publicKeyPem }]

    expect(verifyCredential(makeJws(signer.privateKeyPem), keys).reason).toBe('signature')
  })

  it('篡改 payload 后验签失败', () => {
    const { publicKeyPem, privateKeyPem } = makeKeyPair()
    const keys: TrustedKey[] = [{ kid: 'lk_2026a', publicKey: publicKeyPem }]

    const [header, , signature] = makeJws(privateKeyPem).split('.')
    const forged = toBase64Url(JSON.stringify({ ...samplePayload, cname: '别人家' }))

    expect(verifyCredential(`${header}.${forged}.${signature}`, keys).reason).toBe('signature')
  })

  it('拒绝 alg 为 none 的伪造凭证', () => {
    const { publicKeyPem, privateKeyPem } = makeKeyPair()
    const keys: TrustedKey[] = [{ kid: 'lk_2026a', publicKey: publicKeyPem }]

    const jws = makeJws(privateKeyPem, { alg: 'none', typ: 'INFI-LIC', kid: 'lk_2026a' })

    expect(verifyCredential(jws, keys).reason).toBe('malformed')
  })

  it('拒绝 typ 不符的凭证（防止拿别处的 JWT 冒充）', () => {
    const { publicKeyPem, privateKeyPem } = makeKeyPair()
    const keys: TrustedKey[] = [{ kid: 'lk_2026a', publicKey: publicKeyPem }]

    const jws = makeJws(privateKeyPem, { alg: 'EdDSA', typ: 'JWT', kid: 'lk_2026a' })

    expect(verifyCredential(jws, keys).reason).toBe('malformed')
  })

  it('格式非法的输入返回失败而不抛异常', () => {
    const { publicKeyPem } = makeKeyPair()
    const keys: TrustedKey[] = [{ kid: 'lk_2026a', publicKey: publicKeyPem }]

    expect(verifyCredential('', keys).reason).toBe('malformed')
    expect(verifyCredential('a.b', keys).reason).toBe('malformed')
    expect(verifyCredential('a.b.c', keys).reason).toBe('malformed')
    expect(verifyCredential(null as never, keys).reason).toBe('malformed')
  })

  it('内置公钥列表为空时不通过', () => {
    const { privateKeyPem } = makeKeyPair()

    expect(verifyCredential(makeJws(privateKeyPem), []).reason).toBe('unknown_kid')
  })

  it('peekPayloadUnsafe 能不验签读出内容，仅供诊断', () => {
    const { privateKeyPem } = makeKeyPair()

    expect(peekPayloadUnsafe(makeJws(privateKeyPem))?.lno).toBe('LIC-2026-0007')
    expect(peekPayloadUnsafe('garbage')).toBeNull()
    expect(peekPayloadUnsafe('')).toBeNull()
  })
})

describe('信封 + 验签联动', () => {
  it('从 license.key 文本一路解析到验签通过', () => {
    const { publicKeyPem, privateKeyPem } = makeKeyPair()
    const jws = makeJws(privateKeyPem)

    const envelope = [
      '-----BEGIN INFINISYNAPSE LICENSE-----',
      'Customer:     某某集团',
      'Valid-Until:  2027-09-09',
      '',
      jws.slice(0, 64),
      jws.slice(64),
      '-----END INFINISYNAPSE LICENSE-----',
      '',
    ].join('\r\n')

    const parsed = parseLicenseEnvelope(envelope)
    expect(parsed).toBe(jws)

    const result = verifyCredential(parsed!, [{ kid: 'lk_2026a', publicKey: publicKeyPem }])
    expect(result.valid).toBe(true)
  })

  it('篡改信封头部不影响验签结果 —— 头部本就不参与签名', () => {
    const { publicKeyPem, privateKeyPem } = makeKeyPair()
    const jws = makeJws(privateKeyPem)

    const envelope = `-----BEGIN INFINISYNAPSE LICENSE-----\nValid-Until:  2099-01-01\n\n${jws}\n-----END INFINISYNAPSE LICENSE-----\n`

    const result = verifyCredential(parseLicenseEnvelope(envelope)!, [
      { kid: 'lk_2026a', publicKey: publicKeyPem },
    ])

    expect(result.valid).toBe(true)
    // 展示信息只能来自 payload，而 payload 里没有被篡改的那个日期
    expect(result.payload?.cname).toBe('某某集团')
  })
})
