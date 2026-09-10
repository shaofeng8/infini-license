import { CloudOutlined, InfoCircleOutlined } from '@ant-design/icons'
import { Alert } from 'antd'
import type { LicenseDetail } from '@/types/license'

/**
 * 用量页。
 *
 * 两种「没有数据」必须区分开，设计文档对此有明确要求：
 *
 * - **正式授权**：零上报是产品承诺，不是缺陷。这里给一张解释卡片而不是留白
 *   或空态插画 —— 留白会让运营去提「用量统计坏了」的工单，而正确答案是
 *   「我们承诺过不采集」。
 * - **试用授权**：本该有数据，但管理端查询接口还没实现（见执行计划 P2
 *   遗留项），所以说明是「功能未开放」而不是「暂无数据」。
 */
export function UsageTab({ license }: { license: LicenseDetail }) {
  if (license.type === 'formal') {
    return (
      <div
        className="lc-card-flat"
        style={{
          padding: '48px 32px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
          textAlign: 'center',
        }}
      >
        <CloudOutlined
          style={{ fontSize: 40, color: 'var(--lc-color-neutral)' }}
        />
        <div>
          <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>
            离线交付，本系统无用量数据
          </div>
          <div
            style={{
              fontSize: 13,
              lineHeight: '22px',
              color: 'var(--lc-color-text-secondary)',
              maxWidth: 460,
            }}
          >
            正式授权全程零上报，客户环境不会向我方发送任何请求 —— 这是对客户的
            产品承诺，不是统计故障。限额由客户端本地依据凭证内容判断，
            用量只存在于客户自己的环境里。
          </div>
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--lc-color-text-secondary)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <InfoCircleOutlined />
          需要用量数据时只能请客户在自己的后台导出
        </div>
      </div>
    )
  }

  return (
    <Alert
      type="info"
      showIcon
      message="试用用量查询尚未开放"
      description="试用实例的用量已经在上报并入库（lc_usage_daily / lc_usage_task），但管理端的查询接口还没实现，页面待后端补齐后接入。"
    />
  )
}
