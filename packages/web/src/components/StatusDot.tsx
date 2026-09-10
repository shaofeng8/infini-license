import type { CSSProperties, ReactNode } from 'react'

export type DotTone =
  | 'success'
  | 'warning'
  | 'danger'
  | 'trial'
  | 'neutral'
  | 'superseded'
  | 'primary'

const TONE_COLOR: Record<DotTone, string> = {
  success: 'var(--lc-color-success)',
  warning: 'var(--lc-color-warning)',
  danger: 'var(--lc-color-danger)',
  trial: 'var(--lc-color-trial)',
  neutral: 'var(--lc-color-neutral)',
  superseded: 'var(--lc-color-superseded)',
  primary: 'var(--lc-color-primary)',
}

interface StatusDotProps {
  tone: DotTone
  children: ReactNode
  /** 空心圆点，用于「已签发未生效」这类尚未开始的状态 */
  hollow?: boolean
  /** 次要说明，灰色小字接在主文案后面，如「(15天)」 */
  suffix?: ReactNode
  style?: CSSProperties
}

/**
 * 状态展示的统一形态：圆点 + 文字。
 *
 * 设计文档明确不用彩色实心 Tag —— 授权列表一屏三十行，每行一个色块背景会
 * 变成视觉噪音，反而看不出哪个状态需要处理。圆点只占几个像素但颜色信息量
 * 一样足。
 */
export function StatusDot({
  tone,
  children,
  hollow = false,
  suffix,
  style,
}: StatusDotProps) {
  const color = TONE_COLOR[tone]

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          flex: '0 0 auto',
          background: hollow ? 'transparent' : color,
          border: hollow ? `1.5px solid ${color}` : 'none',
        }}
      />
      <span>{children}</span>
      {suffix ? (
        <span style={{ color: 'var(--lc-color-text-secondary)', fontSize: 12 }}>
          {suffix}
        </span>
      ) : null}
    </span>
  )
}
