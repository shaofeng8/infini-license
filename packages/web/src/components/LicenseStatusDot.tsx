import type { LicenseStatus, LicenseType } from '@/types/license'
import type { DotTone } from './StatusDot'
import { StatusDot } from './StatusDot'

interface LicenseStatusDotProps {
  status: LicenseStatus
  type: LicenseType
  /** null = 永久授权 */
  remainingDays?: number | null
  endAt?: string | null
  /** 到期前多少天算「即将到期」，取授权自己的 warnDays */
  warnDays?: number
}

/**
 * 授权状态的展示口径，集中在这里而不是散在各个列表列里。
 *
 * 后端的 `status` 只有 pending/active/expired/void 四个值，但界面要显示六种
 * 状态 —— 「即将到期」和「试用中」都是 `active`，得再结合 `type` 与剩余天数
 * 才能分出来。这个折算规则一旦在列表页和详情页各写一遍，改预警阈值时必然
 * 漏掉一处，于是同一份授权在两个页面显示不同状态。
 */
export function LicenseStatusDot({
  status,
  type,
  remainingDays,
  endAt,
  warnDays = 15,
}: LicenseStatusDotProps) {
  if (status === 'void') {
    return (
      <StatusDot tone="neutral" hollow>
        已作废
      </StatusDot>
    )
  }

  if (status === 'expired') {
    return <StatusDot tone="danger">已过期</StatusDot>
  }

  if (status === 'pending') {
    return (
      <StatusDot tone="neutral" hollow>
        已签发
      </StatusDot>
    )
  }

  // 以下都是 active
  const perpetual = !endAt
  const days = remainingDays ?? null

  if (type === 'trial') {
    return (
      <StatusDot
        tone="trial"
        suffix={days === null ? undefined : `剩 ${days} 天`}
      >
        试用中
      </StatusDot>
    )
  }

  if (perpetual) {
    return <StatusDot tone="success">永久有效</StatusDot>
  }

  if (days !== null && days <= warnDays) {
    return (
      <StatusDot tone="warning" suffix={`${days} 天`}>
        即将到期
      </StatusDot>
    )
  }

  return <StatusDot tone="success">生效中</StatusDot>
}

/** 凭证历史里区分「当前生效」与「已取代」 */
export function CredentialStatusDot({ isCurrent }: { isCurrent: boolean }) {
  const tone: DotTone = isCurrent ? 'success' : 'superseded'
  return <StatusDot tone={tone}>{isCurrent ? '当前生效' : '已取代'}</StatusDot>
}
