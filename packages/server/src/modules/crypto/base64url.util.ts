export function toBase64Url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  return Buffer.from(normalized + padding, 'base64')
}

/**
 * 稳定序列化：对象 key 按字典序排列。
 *
 * 签名前必须走这一步。JS 对象的 key 顺序取决于插入顺序，同一份 payload
 * 经过不同代码路径构造出来的 JSON 字符串可能不同，直接 JSON.stringify
 * 会导致签出来的字节流不稳定，进而在重签、比对 checksum 时出现莫名差异。
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys)
  }
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        const child = (value as Record<string, unknown>)[key]
        if (child !== undefined) {
          acc[key] = sortKeys(child)
        }
        return acc
      }, {})
  }
  return value
}
