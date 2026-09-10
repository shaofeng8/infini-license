import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Button, Input, Select, Space, Table, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { customerApi } from '@/api'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { AbsoluteDate } from '@/components/RelativeDate'
import { StatusDot } from '@/components/StatusDot'
import { TableSkeleton } from '@/components/TableSkeleton'
import { useListQuery } from '@/hooks/useListQuery'
import { useQueryState } from '@/hooks/useQueryState'
import { canEditCustomer, useCurrentUser } from '@/stores/userStore'
import { emptyPage } from '@/types/base'
import type { Customer, CustomerQuery, CustomerStage } from '@/types/customer'
import {
  CUSTOMER_SOURCE_LABEL,
  CUSTOMER_STAGE_LABEL,
} from '@/types/customer'
import { CustomerFormModal } from './CustomerFormModal'

const STAGE_TONE: Record<CustomerStage, 'neutral' | 'trial' | 'success' | 'danger'> =
  {
    lead: 'neutral',
    trial: 'trial',
    customer: 'success',
    churned: 'danger',
  }

const DEFAULTS = {
  page: 1,
  pageSize: 20,
  keyword: '',
  stage: '',
  source: '',
}

export default function CustomerListPage() {
  const navigate = useNavigate()
  const user = useCurrentUser()
  const editable = canEditCustomer(user)
  const { state, setState, setFilter } = useQueryState(DEFAULTS)
  const [keywordDraft, setKeywordDraft] = useState(state.keyword)
  const [editing, setEditing] = useState<Customer | null | undefined>(undefined)

  const query = useMemo<CustomerQuery>(() => {
    const next: CustomerQuery = { page: state.page, pageSize: state.pageSize }
    if (state.keyword) next.keyword = state.keyword
    if (state.stage) next.stage = state.stage as CustomerStage
    if (state.source) next.source = state.source as Customer['source']
    return next
  }, [state])

  const { data, loading, refresh } = useListQuery(
    JSON.stringify(query),
    () => customerApi.list(query).send(),
    emptyPage<Customer>(DEFAULTS.pageSize),
  )

  const items = data?.items ?? []
  const filtering = Boolean(state.keyword || state.stage || state.source)

  const columns: ColumnsType<Customer> = [
    {
      title: '客户名称',
      dataIndex: 'name',
      width: 260,
      render: (_, row) => (
        <>
          <div style={{ fontWeight: 500 }}>{row.name}</div>
          {row.shortName ? (
            <div style={{ fontSize: 12, color: 'var(--lc-color-text-secondary)' }}>
              {row.shortName}
            </div>
          ) : null}
        </>
      ),
    },
    {
      title: '阶段',
      dataIndex: 'stage',
      width: 110,
      render: (stage: CustomerStage) => (
        <StatusDot tone={STAGE_TONE[stage]}>
          {CUSTOMER_STAGE_LABEL[stage]}
        </StatusDot>
      ),
    },
    {
      title: '来源',
      dataIndex: 'source',
      width: 100,
      render: (source: Customer['source']) => (
        <span
          style={{
            fontSize: 12,
            color:
              source === 'trial_auto'
                ? 'var(--lc-color-trial)'
                : 'var(--lc-color-text-secondary)',
          }}
        >
          {CUSTOMER_SOURCE_LABEL[source]}
        </span>
      ),
    },
    { title: '行业', dataIndex: 'industry', width: 110, render: v => v || '—' },
    { title: '地区', dataIndex: 'region', width: 100, render: v => v || '—' },
    {
      title: '负责销售',
      dataIndex: 'salesOwner',
      width: 100,
      render: v => v || '—',
    },
    {
      title: '联系人',
      key: 'contact',
      width: 180,
      render: (_, row) =>
        row.contactName || row.contactPhone ? (
          <div style={{ fontSize: 12 }}>
            <div>{row.contactName || '—'}</div>
            <div
              className="lc-num"
              style={{ color: 'var(--lc-color-text-secondary)' }}
            >
              {row.contactPhone || row.contactEmail || ''}
            </div>
          </div>
        ) : (
          '—'
        ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 160,
      render: (value: string) => <AbsoluteDate value={value} />,
    },
    {
      title: '操作',
      key: 'action',
      width: 130,
      fixed: 'right',
      render: (_, row) => (
        <Space size={4}>
          <Button
            type="link"
            size="small"
            onClick={() => navigate(`/customer/${row._id}`)}
          >
            详情
          </Button>
          <Button
            type="link"
            size="small"
            disabled={!editable}
            onClick={() => setEditing(row)}
          >
            编辑
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="客户管理"
        description="试用注册会自动创建客户（来源标记为「试用自动」），可能与运营录入的记录重名。"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={refresh}>
              刷新
            </Button>
            <Tooltip title={editable ? '' : '需要销售及以上角色'}>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                disabled={!editable}
                onClick={() => setEditing(null)}
              >
                新建客户
              </Button>
            </Tooltip>
          </Space>
        }
      />

      <div className="lc-card-flat" style={{ padding: 16 }}>
        <Space wrap style={{ marginBottom: 16 }}>
          <Input.Search
            allowClear
            placeholder="按名称、简称或联系人搜索"
            value={keywordDraft}
            onChange={e => setKeywordDraft(e.target.value)}
            onSearch={value => setFilter({ keyword: value })}
            style={{ width: 280 }}
          />
          <Select
            allowClear
            placeholder="阶段"
            style={{ width: 130 }}
            value={state.stage || undefined}
            onChange={value => setFilter({ stage: value ?? '' })}
            options={Object.entries(CUSTOMER_STAGE_LABEL).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <Select
            allowClear
            placeholder="来源"
            style={{ width: 130 }}
            value={state.source || undefined}
            onChange={value => setFilter({ source: value ?? '' })}
            options={Object.entries(CUSTOMER_SOURCE_LABEL).map(([value, label]) => ({
              value,
              label,
            }))}
          />
        </Space>

        {loading && items.length === 0 ? (
          <TableSkeleton />
        ) : (
          <Table<Customer>
            rowKey="_id"
            size="middle"
            columns={columns}
            dataSource={items}
            loading={loading && items.length > 0}
            scroll={{ x: 1250 }}
            rowClassName={row => (row.status === 0 ? 'lc-row-muted' : '')}
            locale={{
              emptyText: (
                <EmptyState
                  title={filtering ? '没有符合条件的客户' : '还没有任何客户'}
                  description={
                    filtering
                      ? '换个关键词或放宽筛选条件再试。'
                      : '签发授权前需要先建立客户记录。试用注册也会自动创建。'
                  }
                  actionText={!filtering && editable ? '新建客户' : undefined}
                  onAction={
                    !filtering && editable ? () => setEditing(null) : undefined
                  }
                />
              ),
            }}
            pagination={{
              current: state.page,
              pageSize: state.pageSize,
              total: data?.total ?? 0,
              showSizeChanger: true,
              showTotal: total => `共 ${total} 条`,
              onChange: (page, pageSize) => setState({ page, pageSize }),
            }}
          />
        )}
      </div>

      <CustomerFormModal
        open={editing !== undefined}
        customer={editing ?? null}
        onCancel={() => setEditing(undefined)}
        onSaved={() => {
          setEditing(undefined)
          refresh()
        }}
      />
    </>
  )
}
