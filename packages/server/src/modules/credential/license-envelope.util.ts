const BEGIN_MARK = '-----BEGIN INFINISYNAPSE LICENSE-----'
const END_MARK = '-----END INFINISYNAPSE LICENSE-----'
const WRAP_WIDTH = 64

export interface EnvelopeHeaderFields {
  customer: string
  licenseNo: string
  edition: string
  validUntil: string
  issuedAt: string
  fingerprint: string
}

/**
 * 把 JWS 包装成 PEM 风格的 license.key 文本。
 *
 * 头部那几行**不参与签名**，纯粹是给客户运维肉眼识别用的 —— 拿到文件能一眼
 * 看出是哪家客户、什么时候到期，不用跑工具解码。代价是这些行可以被随意篡改，
 * 所以解析侧绝对不能读它们，见 parseLicenseEnvelope。
 */
export function buildLicenseEnvelope(jws: string, fields: EnvelopeHeaderFields): string {
  const header = [
    `Customer:     ${fields.customer}`,
    `License-No:   ${fields.licenseNo}`,
    `Edition:      ${fields.edition}`,
    `Valid-Until:  ${fields.validUntil}`,
    `Issued-At:    ${fields.issuedAt}`,
    `Fingerprint:  ${fields.fingerprint}`,
  ].join('\n')

  const body = wrap(jws, WRAP_WIDTH).join('\n')

  return `${BEGIN_MARK}\n${header}\n\n${body}\n${END_MARK}\n`
}

/**
 * 从 license.key 文本中取出 JWS。
 *
 * 只认 BEGIN/END 之间最后一个空行之后的内容，头部字段一律丢弃。这是有意的：
 * 若程序信任头部的 `Valid-Until`，改一行文本就能骗过运维甚至骗过校验，
 * 所有展示信息都必须来自验签后的 payload。
 */
export function parseLicenseEnvelope(text: string): string | null {
  if (!text) return null

  const beginAt = text.indexOf(BEGIN_MARK)
  const endAt = text.indexOf(END_MARK)

  // 容错：没有信封时按裸 JWS 处理，方便运维直接粘贴凭证串排查
  const inner =
    beginAt >= 0 && endAt > beginAt ? text.slice(beginAt + BEGIN_MARK.length, endAt) : text

  const blankLineAt = inner.search(/\r?\n[ \t]*\r?\n/)
  const bodyPart = blankLineAt >= 0 ? inner.slice(blankLineAt) : inner
  const compact = bodyPart.replace(/\s+/g, '')

  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(compact) ? compact : null
}

function wrap(input: string, width: number): string[] {
  const lines: string[] = []
  for (let i = 0; i < input.length; i += width) {
    lines.push(input.slice(i, i + width))
  }
  return lines
}
