const BEGIN_MARK = '-----BEGIN INFINISYNAPSE LICENSE-----'
const END_MARK = '-----END INFINISYNAPSE LICENSE-----'

/**
 * 从 license.key 文本中取出 JWS。
 *
 * 只取 BEGIN/END 之间第一个空行之后的内容，`Customer:` / `Valid-Until:` 那些
 * 头部字段一律丢弃。这些行不参与签名，改一行文本就能伪造，所以程序绝对
 * 不能读它们 —— UI 上展示的一切信息都必须来自验签后的 payload。
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
