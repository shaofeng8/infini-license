import { Alert, Timeline } from 'antd'
import { CopyableText } from '@/components/CopyableText'
import type { LicenseDetail } from '@/types/license'
import { ISSUE_REASON_LABEL } from '@/types/license'
import { formatDateTime } from '@/utils/format'

const REASON_COLOR: Record<string, string> = {
  issue: 'var(--lc-color-primary)',
  renew: 'var(--lc-color-success)',
  reissue: 'var(--lc-color-warning)',
  convert: 'var(--lc-color-trial)',
  extend: 'var(--lc-color-trial)',
}

/**
 * 事件时间线。
 *
 * 由凭证签发历史倒推而来，而不是读一个专门的事件表 —— 后端设计里有
 * `GET /license/timeline/:id`，但未实现（见 04-api.md）。凭证历史已经覆盖了
 * 签发、续期、补发、转正、延期五类事件，唯一缺的是**下载**记录：它在审计
 * 日志里，按 `targetId` 关联，等审计查询能按 targetId 过滤后再并进来。
 */
export function TimelineTab({ license }: { license: LicenseDetail }) {
  // 详情接口返回的凭证是按签发时间正序，时间线要倒序（最近的在上面）
  const events = [...license.credentials].sort((a, b) =>
    b.issuedAt.localeCompare(a.issuedAt),
  )

  if (events.length === 0) {
    return <Alert type="info" showIcon message="还没有签发过凭证" />
  }

  return (
    <div className="lc-card-flat" style={{ padding: '24px 24px 0' }}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
        message="时间线目前只含凭证签发类事件；下载记录请到系统设置的审计日志里按授权编号查"
      />

      <Timeline
        items={events.map(item => ({
          color: REASON_COLOR[item.issueReason] ?? 'gray',
          children: (
            <div style={{ paddingBottom: 8 }}>
              <div style={{ fontWeight: 500 }}>
                {ISSUE_REASON_LABEL[item.issueReason] ?? item.issueReason}
                {item.isCurrent ? (
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 12,
                      fontWeight: 400,
                      color: 'var(--lc-color-success)',
                    }}
                  >
                    当前生效
                  </span>
                ) : null}
              </div>
              <div
                className="lc-num"
                style={{
                  fontSize: 12,
                  color: 'var(--lc-color-text-secondary)',
                  marginTop: 2,
                }}
              >
                {formatDateTime(item.issuedAt)}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--lc-color-text-secondary)',
                  marginTop: 4,
                  display: 'flex',
                  gap: 16,
                  flexWrap: 'wrap',
                }}
              >
                <span>
                  jti <CopyableText value={item.jti} keep={8} />
                </span>
                <span>
                  密钥 <CopyableText value={item.kid} keep={8} />
                </span>
                <span className="lc-num">下载 {item.downloadCount} 次</span>
              </div>
            </div>
          ),
        }))}
      />
    </div>
  )
}
