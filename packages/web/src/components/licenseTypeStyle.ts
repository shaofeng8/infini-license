import type { LicenseType } from '@/types/license'

export const TYPE_COLOR: Record<LicenseType, string> = {
  formal: 'var(--lc-color-primary)',
  trial: 'var(--lc-color-trial)',
}

export const TYPE_BG: Record<LicenseType, string> = {
  formal: 'var(--lc-color-primary-bg)',
  trial: '#E0F2FE',
}

/**
 * 行首 3px 色条，与 `LicenseTypeBadge` 一起构成类型的双重标识。
 *
 * 用在表格第一列的 `render` 里，靠 `position: relative` 的单元格定位。
 */
export function typeStripeStyle(type: LicenseType) {
  return {
    position: 'absolute' as const,
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    background: TYPE_COLOR[type],
  }
}
