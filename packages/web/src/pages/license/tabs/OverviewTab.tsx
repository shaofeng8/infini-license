import { Descriptions, Tag } from 'antd'
import { CopyableText } from '@/components/CopyableText'
import { QuotaBar } from '@/components/QuotaBar'
import { RelativeDate } from '@/components/RelativeDate'
import type { LicenseDetail } from '@/types/license'
import { QUOTA_PERIOD_LABEL } from '@/types/license'
import {
  UNLIMITED_TEXT,
  exactNumberTitle,
  formatCompactNumber,
  formatDate,
} from '@/utils/format'

/** 正式客户零上报时限额卡上的说明，避免留白让人以为数据没加载出来 */
const NO_USAGE_HINT = '离线交付，本系统无用量数据'

export function OverviewTab({ license }: { license: LicenseDetail }) {
  const trial = license.type === 'trial'
  const usageHint = trial ? undefined : NO_USAGE_HINT

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
        }}
      >
        <QuotaCard
          title="最大用户数"
          limit={license.maxUsers}
          hint={usageHint}
          suffix="人"
        />
        <QuotaCard
          title="最大并发任务"
          limit={license.maxConcurrentTasks}
          hint={usageHint}
          suffix="个"
        />
        <QuotaCard
          title={`Token 配额${
            license.tokenQuotaPeriod
              ? `（${QUOTA_PERIOD_LABEL[license.tokenQuotaPeriod]}）`
              : ''
          }`}
          limit={license.tokenQuota}
          hint={usageHint}
        />
        <QuotaCard
          title={`任务数配额${
            license.taskQuotaPeriod
              ? `（${QUOTA_PERIOD_LABEL[license.taskQuotaPeriod]}）`
              : ''
          }`}
          limit={license.taskQuota}
          hint={usageHint}
          suffix="个"
        />
      </div>

      <Descriptions
        title="授权信息"
        column={2}
        size="small"
        bordered
        className="lc-card-flat"
      >
        <Descriptions.Item label="授权编号">
          <CopyableText value={license.licenseNo} keep={0} />
        </Descriptions.Item>
        <Descriptions.Item label="客户">
          {license.customerName ?? '—'}
        </Descriptions.Item>
        <Descriptions.Item label="产品">{license.product}</Descriptions.Item>
        <Descriptions.Item label="版本">{license.edition}</Descriptions.Item>
        <Descriptions.Item label="生效日期">
          {formatDate(license.startAt)}
        </Descriptions.Item>
        <Descriptions.Item label="到期日期">
          <RelativeDate
            value={license.endAt}
            remainingDays={license.remainingDays}
            emptyText="永久有效"
          />
        </Descriptions.Item>
        <Descriptions.Item label="预警天数">
          <span className="lc-num">{license.warnDays} 天</span>
        </Descriptions.Item>
        <Descriptions.Item label="超限软阈值">
          <span className="lc-num">{license.overLimitRatio}×</span>
        </Descriptions.Item>
        <Descriptions.Item label="功能范围">
          {license.featuresJson === null ? (
            <span style={{ color: 'var(--lc-color-text-secondary)' }}>
              全功能（{UNLIMITED_TEXT}）
            </span>
          ) : (
            <span>
              {license.featuresJson.map(f => (
                <Tag key={f} bordered={false}>
                  {f}
                </Tag>
              ))}
            </span>
          )}
        </Descriptions.Item>
        <Descriptions.Item label="机器绑定">{license.bindMode}</Descriptions.Item>
        <Descriptions.Item label="用量上报">
          {license.telemetryEnabled ? (
            <span style={{ color: 'var(--lc-color-trial)' }}>开启（试用）</span>
          ) : (
            <span style={{ color: 'var(--lc-color-text-secondary)' }}>
              关闭（正式客户零上报）
            </span>
          )}
        </Descriptions.Item>
        <Descriptions.Item label="续期次数">
          <span className="lc-num">{license.renewCount} 次</span>
        </Descriptions.Item>
        <Descriptions.Item label="最近续期">
          {license.renewedAt ? formatDate(license.renewedAt) : '—'}
        </Descriptions.Item>
        <Descriptions.Item label="合同号">
          {license.contractNo || '—'}
        </Descriptions.Item>
        <Descriptions.Item label="创建时间">
          {formatDate(license.createdAt)}
        </Descriptions.Item>
        <Descriptions.Item label="备注" span={2}>
          {license.remark || '—'}
        </Descriptions.Item>
      </Descriptions>
    </div>
  )
}

function QuotaCard({
  title,
  limit,
  hint,
  suffix,
}: {
  title: string
  limit: number | null
  hint?: string
  suffix?: string
}) {
  return (
    <div className="lc-card-flat" style={{ padding: 16 }}>
      <div
        style={{
          fontSize: 12,
          color: 'var(--lc-color-text-secondary)',
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      <div
        className="lc-num"
        style={{ fontSize: 24, fontWeight: 600, marginBottom: 12 }}
        title={exactNumberTitle(limit)}
      >
        {limit === null ? (
          <span style={{ fontSize: 18, color: 'var(--lc-color-text-secondary)' }}>
            {UNLIMITED_TEXT}
          </span>
        ) : (
          <>
            {formatCompactNumber(limit)}
            {suffix ? (
              <span style={{ fontSize: 14, fontWeight: 400 }}> {suffix}</span>
            ) : null}
          </>
        )}
      </div>
      <QuotaBar limit={limit} unavailableHint={hint} />
    </div>
  )
}
