import { UNLIMITED_TEXT, exactNumberTitle, formatCompactNumber } from '@/utils/format'

interface QuotaBarProps {
  label?: string
  /** null = 不限制 */
  limit: number | null
  /** 已用量。管理端目前拿不到正式客户的用量，传 undefined 即可 */
  used?: number
  /** 用量不可得时的说明，如「离线交付，无用量数据」 */
  unavailableHint?: string
  width?: number | string
}

/** 阈值口径：<70% 主色 / 70–90% 橙 / >90% 红 */
function toneOf(ratio: number): string {
  if (ratio > 0.9) return 'var(--lc-color-danger)'
  if (ratio >= 0.7) return 'var(--lc-color-warning)'
  return 'var(--lc-color-primary)'
}

/**
 * 配额水位条。
 *
 * 三种状态要分清，设计文档对此有明确要求：
 *
 * 1. **不限制**（`limit === null`）→ 灰色虚线条 + 「不限制」。**不显示 0% 或
 *    100%** —— 0% 会被读成「一点没用」，100% 会被读成「用满了」，而真实语义
 *    是「这一项压根没有上限」，两种误读的处置动作完全相反。
 * 2. **有上限但拿不到用量**（正式客户零上报）→ 灰色虚线条 + 说明文字。同样
 *    不能显示 0%，那会让运营以为客户买了没用。
 * 3. **有上限且有用量** → 实心条 + 百分比。
 */
export function QuotaBar({
  label,
  limit,
  used,
  unavailableHint,
  width = '100%',
}: QuotaBarProps) {
  const unlimited = limit === null || limit === undefined
  const unknownUsage = !unlimited && (used === null || used === undefined)
  const dashed = unlimited || unknownUsage

  const ratio = dashed ? 0 : Math.min(used! / limit!, 1)
  const percent = dashed ? 0 : Math.round((used! / limit!) * 100)

  return (
    <div style={{ width }}>
      {label ? (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 12,
            color: 'var(--lc-color-text-secondary)',
            marginBottom: 4,
          }}
        >
          <span>{label}</span>
          <span className="lc-num" title={exactNumberTitle(limit)}>
            {unlimited ? UNLIMITED_TEXT : formatCompactNumber(limit)}
          </span>
        </div>
      ) : null}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div
          style={{
            flex: 1,
            height: 6,
            borderRadius: 999,
            background: dashed ? 'transparent' : 'var(--lc-color-border)',
            border: dashed ? '1px dashed var(--lc-color-neutral)' : 'none',
            overflow: 'hidden',
          }}
        >
          {dashed ? null : (
            <div
              style={{
                width: `${ratio * 100}%`,
                height: '100%',
                borderRadius: 999,
                background: toneOf(ratio),
                transition: 'width .2s ease',
              }}
            />
          )}
        </div>

        <span
          className="lc-num"
          style={{
            fontSize: 12,
            minWidth: 40,
            textAlign: 'right',
            color: dashed
              ? 'var(--lc-color-text-secondary)'
              : toneOf(ratio),
          }}
        >
          {unlimited
            ? UNLIMITED_TEXT
            : unknownUsage
              ? '—'
              : `${percent}%`}
        </span>
      </div>

      {unknownUsage && unavailableHint ? (
        <div
          style={{
            fontSize: 12,
            color: 'var(--lc-color-text-secondary)',
            marginTop: 4,
          }}
        >
          {unavailableHint}
        </div>
      ) : null}
    </div>
  )
}
