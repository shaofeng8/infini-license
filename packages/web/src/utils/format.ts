import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'

dayjs.locale('zh-cn')

/** 「不限制」的统一表达。设计文档要求：不用 `-`、`∞` 或空白 */
export const UNLIMITED_TEXT = '不限制'

export function formatDateTime(value?: string | Date | null): string {
  if (!value) return '—'
  const d = dayjs(value)
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm:ss') : '—'
}

export function formatDate(value?: string | Date | null): string {
  if (!value) return '—'
  const d = dayjs(value)
  return d.isValid() ? d.format('YYYY-MM-DD') : '—'
}

/**
 * 剩余 / 已过期的相对天数文案。
 *
 * 返回值同时带上语义色，因为「已过期 8 天」必须是红的 —— 这是运维每天扫列表
 * 时唯一需要立刻动手的信号，用中性色写出来会被漏掉。
 */
export interface RemainingText {
  text: string
  color: string
  expired: boolean
}

export function describeRemaining(
  endAt?: string | null,
  remainingDays?: number | null,
): RemainingText {
  if (!endAt) {
    return {
      text: '永久有效',
      color: 'var(--lc-color-text-secondary)',
      expired: false,
    }
  }

  // 优先用后端算好的天数：客户端时钟不可信，两边算出不同的剩余天数会让
  // 运维怀疑数据有问题。后端没给才本地兜底
  const days =
    remainingDays ?? dayjs(endAt).startOf('day').diff(dayjs().startOf('day'), 'day')

  if (days < 0) {
    return {
      text: `已过期 ${Math.abs(days)} 天`,
      color: 'var(--lc-color-danger)',
      expired: true,
    }
  }
  if (days === 0) {
    return { text: '今天到期', color: 'var(--lc-color-danger)', expired: false }
  }
  if (days <= 30) {
    return {
      text: `剩余 ${days} 天`,
      color: 'var(--lc-color-warning)',
      expired: false,
    }
  }
  return {
    text: `剩余 ${days} 天`,
    color: 'var(--lc-color-text-secondary)',
    expired: false,
  }
}

/**
 * 大数字加千分位。
 *
 * token 配额动辄上亿，`100000000` 和 `10000000` 肉眼分不出差一个零，
 * 而这个差别是「一亿」和「一千万」。
 */
export function formatNumber(value?: number | null): string {
  if (value === null || value === undefined) return UNLIMITED_TEXT
  return value.toLocaleString('zh-CN')
}

/**
 * 去掉小数末尾多余的零：`5000.0` → `5000`，`1.20` → `1.2`，`1.00` → `1`。
 *
 * 只在字符串里真有小数点时才动手。否则 `100` 会被当成尾随零削成 `1`。
 */
function trimTrailingZeros(text: string): string {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text
}

/**
 * token 这类超大数值的紧凑表达，用于列表和概览卡片。
 *
 * 会损失精度，所以**只能用在一眼扫量级的地方**。凡是要求「看清楚到底是
 * 多少」的场景（签发确认清单、续期改限额）一律用 `formatNumber`。
 * 展示紧凑值的地方请一并给出 `title={formatNumber(value)}`，
 * 让人能 hover 出精确值。
 */
export function formatCompactNumber(value?: number | null): string {
  if (value === null || value === undefined) return UNLIMITED_TEXT

  const yi = () => `${trimTrailingZeros((value / 100_000_000).toFixed(2))} 亿`

  if (value >= 100_000_000) return yi()

  if (value >= 10_000) {
    const wan = (value / 10_000).toFixed(1)
    // 按四舍五入后的结果分档，而不是按原值。99,999,999 直接算会得到
    // 「10000 万」—— 既该进位成亿，又跟 100,000,000 的「1 亿」显示成
    // 两个单位，摆在一列里看着像差了一个数量级
    return Number(wan) >= 10_000 ? yi() : `${trimTrailingZeros(wan)} 万`
  }

  return value.toLocaleString('zh-CN')
}

/**
 * 紧凑值对应的 hover 提示文案，`null`（不限制）时返回 undefined —— 
 * 「不限制」本身已经说清楚了，再挂个 tooltip 是干扰。
 *
 * 用原生 `title` 而不是 antd `Tooltip`：列表一屏 20 行、每行多个数字，
 * 挂几十个 Tooltip 组件不划算，而这里只需要「hover 能看到精确值」。
 */
export function exactNumberTitle(value?: number | null): string | undefined {
  if (value === null || value === undefined) return undefined
  return formatNumber(value)
}

/** 把长 id / 指纹截短显示，配合复制按钮使用 */
export function truncateId(value?: string | null, keep = 8): string {
  if (!value) return '—'
  return value.length <= keep ? value : `${value.slice(0, keep)}…`
}

/**
 * 复制到剪贴板。
 *
 * 带 `execCommand` 兜底：后台可能部署在没有 HTTPS 的内网地址上，
 * 那里 `navigator.clipboard` 整个不存在，直接用会抛 TypeError。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

/** 把文本另存为文件，用于 license.key 落盘 */
export function saveTextAsFile(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
