import { buildLicenseEnvelope, parseLicenseEnvelope } from './license-envelope.util'

const JWS = `${'a'.repeat(80)}.${'b'.repeat(200)}.${'c'.repeat(86)}`

const fields = {
  customer: '某某集团',
  licenseNo: 'LIC-2026-0007',
  edition: '企业版',
  validUntil: '2027-09-09',
  issuedAt: '2026-09-09',
  fingerprint: 'a3f2c1d09e8b7654',
}

describe('license.key 信封', () => {
  it('打包后能原样解析回 JWS', () => {
    const envelope = buildLicenseEnvelope(JWS, fields)

    expect(parseLicenseEnvelope(envelope)).toBe(JWS)
  })

  it('头部字段可读，且正文按 64 字符折行', () => {
    const envelope = buildLicenseEnvelope(JWS, fields)

    expect(envelope).toContain('License-No:   LIC-2026-0007')
    expect(envelope).toContain('Customer:     某某集团')

    const bodyLines = envelope
      .split('\n')
      .filter(line => /^[A-Za-z0-9_.-]+$/.test(line) && line.length > 1)
    expect(bodyLines.every(line => line.length <= 64)).toBe(true)
  })

  it('CRLF 行尾同样能解析', () => {
    const envelope = buildLicenseEnvelope(JWS, fields).replace(/\n/g, '\r\n')

    expect(parseLicenseEnvelope(envelope)).toBe(JWS)
  })

  it('篡改头部不影响解析出的 JWS —— 头部本就不参与签名，程序也不读它', () => {
    const envelope = buildLicenseEnvelope(JWS, fields).replace('2027-09-09', '2099-01-01')

    expect(parseLicenseEnvelope(envelope)).toBe(JWS)
  })

  it('容错：直接粘贴裸 JWS 也能解析，方便运维排查', () => {
    expect(parseLicenseEnvelope(JWS)).toBe(JWS)
    expect(parseLicenseEnvelope(`  ${JWS}\n`)).toBe(JWS)
  })

  it('非法内容返回 null', () => {
    expect(parseLicenseEnvelope('')).toBeNull()
    expect(parseLicenseEnvelope('随便一段文本')).toBeNull()
    expect(parseLicenseEnvelope(buildLicenseEnvelope('not-a-jws', fields))).toBeNull()
  })
})
