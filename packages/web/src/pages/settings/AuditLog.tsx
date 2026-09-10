import { ReloadOutlined } from '@ant-design/icons'
import { Button, Input, Select, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useMemo, useState } from 'react'
import { auditApi } from '@/api'
import { CopyableText } from '@/components/CopyableText'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { AbsoluteDate } from '@/components/RelativeDate'
import { TableSkeleton } from '@/components/TableSkeleton'
import { useListQuery } from '@/hooks/useListQuery'
import { useQueryState } from '@/hooks/useQueryState'
import { emptyPage } from '@/types/base'
import type { AuditLog, AuditQuery } from '@/types/system'
import { AUDIT_ACTION_LABEL, AUDIT_HIGHLIGHT_ACTIONS } from '@/types/system'

const DEFAULTS = {
  page: 1,
  pageSize: 20,
  action: '',
  targetId: '',
}

export default function AuditLogPage() {
  const { state, setState, setFilter } = useQueryState(DEFAULTS)
  const [targetDraft, setTargetDraft] = useState(state.targetId)

  const query = useMemo<AuditQuery>(() => {
    const next: AuditQuery = { page: state.page, pageSize: state.pageSize }
    if (state.action) next.action = state.action
    if (state.targetId) next.targetId = state.targetId
    return next
  }, [state])

  const { data, loading, refresh } = useListQuery(
    JSON.stringify(query),
    () => auditApi.list(query).send(),
    emptyPage<AuditLog>(DEFAULTS.pageSize),
  )

  const items = data?.items ?? []
  const filtering = Boolean(state.action || state.targetId)

  const columns: ColumnsType<AuditLog> = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (value: string) => <AbsoluteDate value={value} />,
    },
    {
      title: '操作',
      dataIndex: 'action',
      width: 130,
      render: (action: string) => {
        const label = AUDIT_ACTION_LABEL[action] ?? action
        return AUDIT_HIGHLIGHT_ACTIONS.has(action) ? (
          <Tag color="red" bordered={false}>
            {label}
          </Tag>
        ) : (
          <span>{label}</span>
        )
      },
    },
    {
      title: '操作人',
      dataIndex: 'actorName',
      width: 120,
      render: (value: string | null) => value || '系统',
    },
    {
      title: '摘要',
      dataIndex: 'summary',
      render: (value: string | null) => value || '—',
    },
    {
      title: '目标',
      key: 'target',
      width: 200,
      render: (_, row) =>
        row.targetId ? (
          <div style={{ fontSize: 12 }}>
            <div style={{ color: 'var(--lc-color-text-secondary)' }}>
              {row.targetType ?? '—'}
            </div>
            <CopyableText value={row.targetId} keep={12} />
          </div>
        ) : (
          '—'
        ),
    },
    {
      title: 'IP',
      dataIndex: 'ip',
      width: 130,
      render: (value: string | null) => (
        <span className="lc-num" style={{ fontSize: 12 }}>
          {value || '—'}
        </span>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="审计日志"
        description="凭证下载与账号锁定以红色标记 —— 前者是最敏感的操作，后者往往是暴力破解的信号而非同事忘了密码。"
        extra={
          <Button icon={<ReloadOutlined />} loading={loading} onClick={refresh}>
            刷新
          </Button>
        }
      />

      <div className="lc-card-flat" style={{ padding: 16 }}>
        <Space wrap style={{ marginBottom: 16 }}>
          <Select
            allowClear
            showSearch
            placeholder="操作类型"
            style={{ width: 200 }}
            value={state.action || undefined}
            onChange={value => setFilter({ action: value ?? '' })}
            optionFilterProp="label"
            options={Object.entries(AUDIT_ACTION_LABEL).map(([value, label]) => ({
              value,
              label: `${label}（${value}）`,
            }))}
          />

          <Input.Search
            allowClear
            placeholder="按目标 id 精确查询"
            value={targetDraft}
            onChange={e => setTargetDraft(e.target.value)}
            onSearch={value => setFilter({ targetId: value })}
            style={{ width: 280 }}
          />
        </Space>

        {loading && items.length === 0 ? (
          <TableSkeleton />
        ) : (
          <Table<AuditLog>
            rowKey="_id"
            size="middle"
            columns={columns}
            dataSource={items}
            loading={loading && items.length > 0}
            scroll={{ x: 1080 }}
            expandable={{
              // detailJson 里存的是变更前后值，平时折叠起来，
              // 真要追查时展开看，不然摘要列会被 JSON 挤爆
              rowExpandable: row => row.detailJson !== null,
              expandedRowRender: row => (
                <Typography.Paragraph
                  style={{
                    margin: 0,
                    fontSize: 12,
                    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {JSON.stringify(row.detailJson, null, 2)}
                </Typography.Paragraph>
              ),
            }}
            locale={{
              emptyText: (
                <EmptyState
                  title={filtering ? '没有匹配的审计记录' : '还没有任何审计记录'}
                  description={
                    filtering
                      ? '换个操作类型，或确认目标 id 是否完整。这里的目标查询是精确匹配，不支持模糊。'
                      : '登录、签发、下载凭证等操作都会自动留痕。'
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
    </>
  )
}
