import { parseLicenseEnvelope } from './envelope'

const JWS = `${'a'.repeat(80)}.${'b'.repeat(200)}.${'c'.repeat(86)}`

function envelope(body: string, header = 'Customer:     某某集团'): string {
  return `-----BEGIN INFINISYNAPSE LICENSE-----\n${header}\n\n${body}\n-----END INFINISYNAPSE LICENSE-----\n`
}

describe('parseLicenseEnvelope', () => {
  it('标准信封解析出 JWS', () => {
    expect(parseLicenseEnvelope(envelope(JWS))).toBe(JWS)
  })

  it('正文折行后仍能拼回', () => {
    const wrapped = JWS.match(/.{1,64}/g)!.join('\n')

    expect(parseLicenseEnvelope(envelope(wrapped))).toBe(JWS)
  })

  it('CRLF 与混合行尾都兼容', () => {
    expect(parseLicenseEnvelope(envelope(JWS).replace(/\n/g, '\r\n'))).toBe(JWS)
  })

  it('空行含空格或制表符时也能定位正文起点', () => {
    const text = `-----BEGIN INFINISYNAPSE LICENSE-----\nCustomer:     X\n \t \n${JWS}\n-----END INFINISYNAPSE LICENSE-----\n`

    expect(parseLicenseEnvelope(text)).toBe(JWS)
  })

  it('缺少 BEGIN/END 标记时按裸 JWS 处理', () => {
    expect(parseLicenseEnvelope(JWS)).toBe(JWS)
    expect(parseLicenseEnvelope(`\n  ${JWS}  \n`)).toBe(JWS)
  })

  it('END 标记缺失（复制时漏掉最后一行）仍能解析出来', () => {
    const truncated = `-----BEGIN INFINISYNAPSE LICENSE-----\nCustomer: X\n\n${JWS}\n`

    // 客户运维手工复制粘贴时漏掉尾行是常见事故。空行之后的内容照样能定位，
    // 没必要为了格式严谨把人挡在门外 —— 真正的把关是验签。
    expect(parseLicenseEnvelope(truncated)).toBe(JWS)
  })

  it('信封内没有空行时把整段当正文', () => {
    const noBlank = `-----BEGIN INFINISYNAPSE LICENSE-----\n${JWS}\n-----END INFINISYNAPSE LICENSE-----\n`

    expect(parseLicenseEnvelope(noBlank)).toBe(JWS)
  })

  it('空输入与非法内容返回 null', () => {
    expect(parseLicenseEnvelope('')).toBeNull()
    expect(parseLicenseEnvelope(null as never)).toBeNull()
    expect(parseLicenseEnvelope('随便一段中文')).toBeNull()
    expect(parseLicenseEnvelope(envelope('only.two'))).toBeNull()
    expect(parseLicenseEnvelope(envelope('a.b.c.d'))).toBeNull()
  })

  it('正文含 base64url 之外的字符时拒绝', () => {
    expect(parseLicenseEnvelope(envelope('aa+bb.cc.dd'))).toBeNull()
    expect(parseLicenseEnvelope(envelope('aa/bb.cc.dd'))).toBeNull()
  })
})
