import type { LicenseType } from '@/types/license'
import { LICENSE_TYPE_LABEL } from '@/types/license'
import { TYPE_BG, TYPE_COLOR } from './licenseTypeStyle'

/**
 * 类型徽标。
 *
 * 正式与试用是这套后台最重要的一组区分：把试用当正式看会导致运营去追一个
 * 根本没付钱的「客户」，反过来会漏掉真实客户的续期。所以设计文档要求在所有
 * 列表里**双重标识** —— 徽标 + 行首色条（见 `typeStripeStyle`），不能只靠
 * 文字，因为「正式」「试用」两个词在密集表格里扫读时形状太接近。
 */
export function LicenseTypeBadge({ type }: { type: LicenseType }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 8px',
        borderRadius: 4,
        fontSize: 12,
        lineHeight: '18px',
        fontWeight: 500,
        color: TYPE_COLOR[type],
        background: TYPE_BG[type],
      }}
    >
      {LICENSE_TYPE_LABEL[type]}
    </span>
  )
}
