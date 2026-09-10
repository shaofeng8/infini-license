import { CheckOutlined, CopyOutlined } from '@ant-design/icons'
import { Tooltip, message } from 'antd'
import { useState } from 'react'
import { copyText, truncateId } from '@/utils/format'

interface CopyableTextProps {
  value?: string | null
  /** 截断后保留的字符数，0 表示不截断 */
  keep?: number
  /** hover 时展示的完整值，默认就是 value 本身 */
  tooltip?: string
  mono?: boolean
}

/**
 * 可复制的长标识（jti、checksum、指纹、任务 id）。
 *
 * 一律截短显示 + 复制按钮：这些值有 24 到 64 位，整串铺在表格里会把其他列
 * 挤没，而运维需要它们的场景只有「粘到别处去查」，从来不需要肉眼读全。
 */
export function CopyableText({
  value,
  keep = 8,
  tooltip,
  mono = true,
}: CopyableTextProps) {
  const [copied, setCopied] = useState(false)

  if (!value) {
    return <span style={{ color: 'var(--lc-color-text-secondary)' }}>—</span>
  }

  const handleCopy = async () => {
    const ok = await copyText(value)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } else {
      message.error('复制失败，请手动选中复制')
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <Tooltip title={tooltip ?? value}>
        <span
          style={{
            fontFamily: mono ? 'ui-monospace, SFMono-Regular, monospace' : undefined,
            fontSize: 13,
          }}
        >
          {keep > 0 ? truncateId(value, keep) : value}
        </span>
      </Tooltip>
      <Tooltip title={copied ? '已复制' : '复制'}>
        {copied ? (
          <CheckOutlined style={{ color: 'var(--lc-color-success)', fontSize: 12 }} />
        ) : (
          <CopyOutlined
            onClick={handleCopy}
            style={{
              color: 'var(--lc-color-text-secondary)',
              fontSize: 12,
              cursor: 'pointer',
            }}
          />
        )}
      </Tooltip>
    </span>
  )
}
