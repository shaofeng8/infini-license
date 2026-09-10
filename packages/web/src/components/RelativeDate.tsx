import { describeRemaining, formatDate, formatDateTime } from '@/utils/format'

interface RelativeDateProps {
  value?: string | null
  /** 后端算好的剩余天数，优先于本地计算 */
  remainingDays?: number | null
  /** 主行加后缀，如「到期」 */
  suffix?: string
  /** 主行显示到秒 */
  withTime?: boolean
  /** 永久授权时主行显示的文案 */
  emptyText?: string
}

/**
 * 日期展示：主显绝对日期，次显相对时间。
 *
 * 两个都要有。只给绝对日期，运维得自己数「2027-09-09 还有多久」；只给相对
 * 时间，又没法和合同上的日期对账。排序一律按绝对时间（在列的 sorter 里做），
 * 不按这里显示的文案。
 */
export function RelativeDate({
  value,
  remainingDays,
  suffix,
  withTime = false,
  emptyText = '永久',
}: RelativeDateProps) {
  if (!value) {
    return (
      <span style={{ color: 'var(--lc-color-text-secondary)' }}>{emptyText}</span>
    )
  }

  const main = withTime ? formatDateTime(value) : formatDate(value)
  const remaining = describeRemaining(value, remainingDays)

  return (
    <div style={{ lineHeight: 1.4 }}>
      <div className="lc-num">
        {main}
        {suffix ? (
          <span style={{ color: 'var(--lc-color-text-secondary)' }}>
            {' '}
            {suffix}
          </span>
        ) : null}
      </div>
      <div className="lc-num" style={{ fontSize: 12, color: remaining.color }}>
        {remaining.text}
      </div>
    </div>
  )
}

/** 只显示绝对时间的场景（审计日志、签发时间），不带相对天数 */
export function AbsoluteDate({
  value,
  withTime = true,
}: {
  value?: string | null
  withTime?: boolean
}) {
  return (
    <span className="lc-num">
      {withTime ? formatDateTime(value) : formatDate(value)}
    </span>
  )
}
