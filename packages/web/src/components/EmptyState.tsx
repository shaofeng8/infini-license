import { Button } from 'antd'
import type { ReactNode } from 'react'

interface EmptyStateProps {
  /** 一句引导，说清「为什么这里是空的」和「接下来该做什么」 */
  title: string
  description?: string
  actionText?: string
  onAction?: () => void
  /** 换一张插画，默认是文档箱线稿 */
  illustration?: ReactNode
}

/**
 * 空态插画。
 *
 * 简单 SVG 线稿而不是 antd 默认 `Empty`：默认那张灰色小盒子加「暂无数据」
 * 四个字，在「筛选没命中」和「这个功能还没被用过」两种情况下长得一模一样，
 * 而这两者该做的事完全不同。所以这里强制要求传一句具体的引导文案。
 */
export function EmptyState({
  title,
  description,
  actionText,
  onAction,
  illustration,
}: EmptyStateProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '64px 24px',
        gap: 16,
      }}
    >
      {illustration ?? <DefaultIllustration />}

      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>
          {title}
        </div>
        {description ? (
          <div
            style={{
              fontSize: 13,
              color: 'var(--lc-color-text-secondary)',
              maxWidth: 420,
            }}
          >
            {description}
          </div>
        ) : null}
      </div>

      {actionText && onAction ? (
        <Button type="primary" onClick={onAction}>
          {actionText}
        </Button>
      ) : null}
    </div>
  )
}

function DefaultIllustration() {
  return (
    <svg
      width="96"
      height="72"
      viewBox="0 0 96 72"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="14"
        y="22"
        width="68"
        height="42"
        rx="6"
        stroke="var(--lc-color-border)"
        strokeWidth="2"
      />
      <path
        d="M14 34h20l5 8h18l5-8h20"
        stroke="var(--lc-color-neutral)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M30 22V12a4 4 0 014-4h28a4 4 0 014 4v10"
        stroke="var(--lc-color-border)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="48" cy="50" r="3" fill="var(--lc-color-neutral)" />
    </svg>
  )
}
