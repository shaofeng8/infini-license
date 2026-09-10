import { PlusOutlined } from '@ant-design/icons'
import { useRequest } from 'alova/client'
import { Alert, Button, Descriptions, Result, Space, Table, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { customerApi, licenseApi } from '@/api'
import { EmptyState } from '@/components/EmptyState'
import { LicenseStatusDot } from '@/components/LicenseStatusDot'
import { LicenseTypeBadge } from '@/components/LicenseTypeBadge'
import Loading from '@/components/Loading'
import { PageHeader } from '@/components/PageHeader'
import { RelativeDate } from '@/components/RelativeDate'
import { StatusDot } from '@/components/StatusDot'
import { canEditCustomer, canIssue, useCurrentUser } from '@/stores/userStore'
import {
  CUSTOMER_SOURCE_LABEL,
  CUSTOMER_STAGE_LABEL,
} from '@/types/customer'
import type { LicenseListItem } from '@/types/license'
import { formatDateTime } from '@/utils/format'
import { IssueDrawer } from '../license/IssueDrawer'
import { CustomerFormModal } from './CustomerFormModal'

export default function CustomerDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const user = useCurrentUser()
  const [editOpen, setEditOpen] = useState(false)
  const [issueOpen, setIssueOpen] = useState(false)

  const { data: customer, loading, send: reload } = useRequest(
    () => customerApi.detail(id),
    { immediate: true },
  )

  // 名下授权：后端 `/license/list` 支持按 customerId 过滤，直接借用
  const { data: licensePage, send: reloadLicenses } = useRequest(
    () => licenseApi.list({ customerId: id, page: 1, pageSize: 100 }),
    { immediate: true },
  )

  if (loading && !customer) return <Loading />

  if (!customer) {
    return <Result status="404" title="客户不存在" subTitle="链接里的编号可能有误。" />
  }

  const licenses = licensePage?.items ?? []
  const formal = licenses.filter(item => item.type === 'formal')
  const trial = licenses.filter(item => item.type === 'trial')

  return (
    <>
      <PageHeader
        backTo="/customer"
        title={customer.name}
        description={customer.shortName ?? undefined}
        tags={
          <Space size={8}>
            <StatusDot
              tone={
                customer.stage === 'customer'
                  ? 'success'
                  : customer.stage === 'trial'
                    ? 'trial'
                    : customer.stage === 'churned'
                      ? 'danger'
                      : 'neutral'
              }
            >
              {CUSTOMER_STAGE_LABEL[customer.stage]}
            </StatusDot>
            {customer.status === 0 ? (
              <StatusDot tone="danger" hollow>
                已停用
              </StatusDot>
            ) : null}
          </Space>
        }
        extra={
          <Space>
            <Tooltip title={canEditCustomer(user) ? '' : '需要销售及以上角色'}>
              <Button
                disabled={!canEditCustomer(user)}
                onClick={() => setEditOpen(true)}
              >
                编辑
              </Button>
            </Tooltip>
            <Tooltip
              title={
                customer.status === 0
                  ? '客户已停用，无法签发新授权'
                  : canIssue(user)
                    ? ''
                    : '需要运维及以上角色'
              }
            >
              <Button
                type="primary"
                icon={<PlusOutlined />}
                disabled={!canIssue(user) || customer.status === 0}
                onClick={() => setIssueOpen(true)}
              >
                签发授权
              </Button>
            </Tooltip>
          </Space>
        }
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <Descriptions title="基本信息" column={3} size="small" bordered>
          <Descriptions.Item label="来源">
            {CUSTOMER_SOURCE_LABEL[customer.source]}
          </Descriptions.Item>
          <Descriptions.Item label="行业">
            {customer.industry || '—'}
          </Descriptions.Item>
          <Descriptions.Item label="地区">
            {customer.region || '—'}
          </Descriptions.Item>
          <Descriptions.Item label="负责销售">
            {customer.salesOwner || '—'}
          </Descriptions.Item>
          <Descriptions.Item label="联系人">
            {customer.contactName || '—'}
          </Descriptions.Item>
          <Descriptions.Item label="联系电话">
            <span className="lc-num">{customer.contactPhone || '—'}</span>
          </Descriptions.Item>
          <Descriptions.Item label="联系邮箱" span={2}>
            {customer.contactEmail || '—'}
          </Descriptions.Item>
          <Descriptions.Item label="创建时间">
            {formatDateTime(customer.createdAt)}
          </Descriptions.Item>
          <Descriptions.Item label="备注" span={3}>
            {customer.remark || '—'}
          </Descriptions.Item>
        </Descriptions>

        <LicenseGroup
          title={`正式授权（${formal.length}）`}
          rows={formal}
          onOpen={licenseId => navigate(`/license/${licenseId}`)}
          emptyText="该客户还没有正式授权"
        />

        <LicenseGroup
          title={`试用授权（${trial.length}）`}
          rows={trial}
          onOpen={licenseId => navigate(`/license/${licenseId}`)}
          emptyText="该客户没有试用记录"
        />

        <Alert
          type="info"
          showIcon
          message="试用期用量趋势与客户合并功能尚未开放"
          description="用量趋势需要管理端的用量查询接口，客户合并需要 /api/customer/merge —— 两者后端都还没实现（见执行计划）。重名客户目前只能手工核对。"
        />
      </div>

      <CustomerFormModal
        open={editOpen}
        customer={customer}
        onCancel={() => setEditOpen(false)}
        onSaved={() => {
          setEditOpen(false)
          void reload()
        }}
      />

      <IssueDrawer
        open={issueOpen}
        presetCustomerId={customer._id}
        onClose={() => setIssueOpen(false)}
        onIssued={() => {
          setIssueOpen(false)
          void reloadLicenses()
        }}
      />
    </>
  )
}

function LicenseGroup({
  title,
  rows,
  onOpen,
  emptyText,
}: {
  title: string
  rows: LicenseListItem[]
  onOpen: (id: string) => void
  emptyText: string
}) {
  const columns: ColumnsType<LicenseListItem> = [
    {
      title: '授权编号',
      dataIndex: 'licenseNo',
      width: 200,
      render: (value: string, row) => (
        <Space size={8}>
          <a onClick={() => onOpen(row._id)}>{value}</a>
          <LicenseTypeBadge type={row.type} />
        </Space>
      ),
    },
    { title: '版本', dataIndex: 'edition', width: 110 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 150,
      render: (_, row) => (
        <LicenseStatusDot
          status={row.status}
          type={row.type}
          remainingDays={row.remainingDays}
          endAt={row.endAt}
          warnDays={row.warnDays}
        />
      ),
    },
    {
      title: '有效期',
      dataIndex: 'endAt',
      width: 170,
      render: (_, row) => (
        <RelativeDate
          value={row.endAt}
          remainingDays={row.remainingDays}
          suffix="到期"
        />
      ),
    },
  ]

  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 12 }}>
        {title}
      </div>
      <Table<LicenseListItem>
        rowKey="_id"
        size="small"
        columns={columns}
        dataSource={rows}
        pagination={false}
        locale={{ emptyText: <EmptyState title={emptyText} /> }}
      />
    </div>
  )
}
