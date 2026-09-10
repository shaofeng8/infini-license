/**
 * 键序稳定的 JSON 序列化。
 *
 * 签名和校验必须序列化出完全相同的字节。`JSON.stringify` 的键序取决于对象
 * 属性的插入顺序，同一份数据经过一轮解析再重建就可能换序，签名随之对不上。
 * 递归按键名排序即可消除这个不确定性。
 *
 * 试用上报的 HMAC 与本地镜像的 MAC 都依赖它。
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null'
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }

  const entries = Object.entries(value as Record<string, unknown>)
    // undefined 在 JSON 里没有对应表示，JSON.stringify 也会丢掉这些键，保持一致
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)

  return `{${entries.join(',')}}`
}
