import { InputNumber, Select, Switch } from 'antd'
import { UNLIMITED_TEXT } from '@/utils/format'
import type { QuotaPeriod } from '@/types/license'
import { QUOTA_PERIOD_LABEL } from '@/types/license'

interface LimitFieldProps {
  label: string
  hint?: string
  /** null / undefined = 不限制 */
  value: number | null
  onChange: (value: number | null) => void
  /** 带周期的限额（token、任务数）传这两个 */
  period?: QuotaPeriod | null
  onPeriodChange?: (period: QuotaPeriod) => void
  min?: number
  max?: number
  step?: number
  unit?: string
}

/**
 * 单项限额录入：Switch「启用限制」+ 数值输入。
 *
 * 关掉 Switch 时输入框禁用置灰而不是隐藏 —— 这直接对应后端「不配置即不限制」
 * 的语义（列上存 NULL）。如果做成「留空表示不限制」，运维没法区分「我故意
 * 不限」和「我忘了填」，而这两者签出去的凭证效果完全不同。
 */
export function LimitField({
  label,
  hint,
  value,
  onChange,
  period,
  onPeriodChange,
  min = 1,
  max,
  step,
  unit,
}: LimitFieldProps) {
  const enabled = value !== null && value !== undefined

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '12px 0',
        borderBottom: '1px solid var(--lc-color-border)',
      }}
    >
      <Switch
        checked={enabled}
        onChange={checked => onChange(checked ? (min ?? 1) : null)}
        style={{ marginTop: 4 }}
      />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, marginBottom: hint ? 2 : 8 }}>{label}</div>
        {hint ? (
          <div
            style={{
              fontSize: 12,
              color: 'var(--lc-color-text-secondary)',
              marginBottom: 8,
            }}
          >
            {hint}
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <InputNumber
            disabled={!enabled}
            value={value ?? undefined}
            onChange={next => onChange(next ?? null)}
            min={min}
            max={max}
            step={step}
            addonAfter={unit}
            style={{ width: 200 }}
            className="lc-num"
          />

          {onPeriodChange ? (
            <Select
              disabled={!enabled}
              value={period ?? 'total'}
              onChange={onPeriodChange}
              style={{ width: 100 }}
              options={Object.entries(QUOTA_PERIOD_LABEL).map(([v, l]) => ({
                value: v,
                label: l,
              }))}
            />
          ) : null}

          {enabled ? null : (
            <span
              style={{ fontSize: 13, color: 'var(--lc-color-text-secondary)' }}
            >
              {UNLIMITED_TEXT}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
