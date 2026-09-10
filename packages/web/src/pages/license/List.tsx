import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Button, Input, Segmented, Select, Space, Table, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { licenseApi } from '@/api'
import { CopyableText } from '@/components/CopyableText'
import { EmptyState } from '@/components/EmptyState'
import { LicenseStatusDot } from '@/components/LicenseStatusDot'
import { LicenseTypeBadge } from '@/components/LicenseTypeBadge'
import { typeStripeStyle } from '@/components/licenseTypeStyle'
import { PageHeader } from '@/components/PageHeader'
import { RelativeDate } from '@/components/RelativeDate'
import { TableSkeleton } from '@/components/TableSkeleton'
import { useListQuery } from '@/hooks/useListQuery'
import { useQueryState } from '@/hooks/useQueryState'
import { canIssue, useCurrentUser } from '@/stores/userStore'
import { emptyPage } from '@/types/base'
import type { LicenseListItem, LicenseQuery } from '@/types/license'
import { LICENSE_STATUS_LABEL } from '@/types/license'
import {
  UNLIMITED_TEXT,
  exactNumberTitle,
  formatCompactNumber,
  formatNumber,
} from '@/utils/format'
import { IssueDrawer } from './IssueDrawer'

/** 快捷筛选，对应设计文档 P4 列表的四个入口 */
const QUICK_FILTERS = [
  { label: '全部', value: 'all' },
  { label: '30 天内到期', value: 'expiring' },
  { label: '已过期', value: 'expired' },
  { label: '试用中', value: 'trial' },
  { label: '永久授权', value: 'perpetual' },
]

const DEFAULTS = {
  page: 1,
  pageSize: 20,
  keyword: '',
  quick: 'all',
  status: '',
}

type ListState = typeof DEFAULTS

export default function LicenseListPage() {
  const navigate = useNavigate()
  const user = useCurrentUser()
  const { state, setState, setFilter } = useQueryState(DEFAULTS)
  const [keywordDraft, setKeywordDraft] = useState(state.keyword)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const editable = canIssue(user)

  // 筛选与分页都在 URL 里，条件变化直接由 useListQuery 驱动重新请求
  const query = useMemo(() => toQuery(state), [state])
  const { data, loading, refresh } = useListQuery(
    JSON.stringify(query),
    () => licenseApi.list(query).send(),
    emptyPage<LicenseListItem>(DEFAULTS.pageSize),
  )

  const items = data?.items ?? []
  const rows = state.quick === 'perpetual' ? items.filter(i => !i.endAt) : items
  const filtering = Boolean(state.keyword || state.status) || state.quick !== 'all'

  const columns: ColumnsType<LicenseListItem> = [
    {
      title: '客户 / 授权编号',
      dataIndex: 'licenseNo',
      width: 280,
      // 行首 3px 色条靠这个单元格定位，构成类型的第二重标识
      onCell: () => ({ style: { position: 'relative' } }),
      render: (_, row) => (
        <>
          <span style={typeStripeStyle(row.type)} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 500 }}>{row.customerName ?? '—'}</span>
            <LicenseTypeBadge type={row.type} />
          </div>
          <div style={{ marginTop: 2 }}>
            <CopyableText value={row.licenseNo} keep={0} />
          </div>
        </>
      ),
    },
    {
      title: '版本',
      dataIndex: 'edition',
      width: 110,
      render: (value: string) => value || '—',
    },
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
      sorter: (a, b) => {
        // 永久授权（endAt = null）排最后：它永远不需要处理，
        // 而这一列排序的目的就是「先看最快到期的」
        if (!a.endAt) return 1
        if (!b.endAt) return -1
        return a.endAt.localeCompare(b.endAt)
      },
      render: (_, row) => (
        <RelativeDate
          value={row.endAt}
          remainingDays={row.remainingDays}
          suffix="到期"
        />
      ),
    },
    {
      title: '限额摘要',
      key: 'limits',
      width: 230,
      render: (_, row) => <LimitSummary license={row} />,
    },
    {
      title: '凭证',
      dataIndex: 'renewCount',
      width: 90,
      render: (value: number) => (
        <span className="lc-num" style={{ color: 'var(--lc-color-text-secondary)' }}>
          续期 {value} 次
        </span>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      fixed: 'right',
      render: (_, row) => (
        <Button
          type="link"
          size="small"
          onClick={() => navigate(`/license/${row._id}`)}
        >
          详情
        </Button>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="授权管理"
        description="正式授权以离线凭证交付，签发后无法收回。续期在原授权上延期，编号不变。"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={refresh} loading={loading}>
              刷新
            </Button>
            <Tooltip title={editable ? '' : '需要运维及以上角色'}>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                disabled={!editable}
                onClick={() => setDrawerOpen(true)}
              >
                签发授权
              </Button>
            </Tooltip>
          </Space>
        }
      />

      <div className="lc-card-flat" style={{ padding: 16 }}>
        <Space wrap style={{ marginBottom: 16 }}>
          <Segmented
            options={QUICK_FILTERS}
            value={state.quick}
            onChange={value => setFilter({ quick: String(value) })}
          />

          <Input.Search
            allowClear
            placeholder="按授权编号或客户名搜索"
            value={keywordDraft}
            onChange={e => setKeywordDraft(e.target.value)}
            onSearch={value => setFilter({ keyword: value })}
            style={{ width: 260 }}
          />

          <Select
            allowClear
            placeholder="状态"
            style={{ width: 130 }}
            value={state.status || undefined}
            onChange={value => setFilter({ status: value ?? '' })}
            options={Object.entries(LICENSE_STATUS_LABEL).map(([value, label]) => ({
              value,
              label,
            }))}
          />
        </Space>

        {loading && items.length === 0 ? (
          <TableSkeleton />
        ) : (
          <Table<LicenseListItem>
            rowKey="_id"
            size="middle"
            columns={columns}
            dataSource={rows}
            loading={loading && items.length > 0}
            scroll={{ x: 1180 }}
            locale={{
              emptyText: (
                <EmptyState
                  title={filtering ? '没有符合条件的授权' : '还没有签发过任何授权'}
                  description={
                    filtering
                      ? '换个关键词或放宽筛选条件再试。'
                      : '签发前需要先有客户记录，可以从客户管理里新建。'
                  }
                  actionText={!filtering && editable ? '签发授权' : undefined}
                  onAction={
                    !filtering && editable ? () => setDrawerOpen(true) : undefined
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

      <IssueDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onIssued={() => {
          setDrawerOpen(false)
          refresh()
        }}
      />
    </>
  )
}

function toQuery(state: ListState): LicenseQuery {
  const query: LicenseQuery = { page: state.page, pageSize: state.pageSize }
  if (state.keyword) query.keyword = state.keyword
  if (state.status) query.status = state.status as LicenseQuery['status']

  // 「30 天内到期」用后端的 expiringInDays，它走 end_at 索引。
  // 「永久授权」后端没有对应参数，只能取回来再过滤（见下方 rows），
  // 副作用是分页总数仍是过滤前的数，等后端补 perpetual 参数再收拾
  if (state.quick === 'expiring') query.expiringInDays = 30
  if (state.quick === 'expired') query.status = 'expired'
  if (state.quick === 'trial') query.type = 'trial'

  return query
}

function LimitSummary({ license }: { license: LicenseListItem }) {
  const users =
    license.maxUsers === null
      ? `用户 ${UNLIMITED_TEXT}`
      : `${formatNumber(license.maxUsers)} 用户`

  return (
    <span
      className="lc-num"
      style={{ fontSize: 12, color: 'var(--lc-color-text-secondary)' }}
    >
      {users} ·{' '}
      {/* token 是紧凑值，会丢精度，挂 title 让人 hover 出准确数字 */}
      <span title={exactNumberTitle(license.tokenQuota)}>
        {license.tokenQuota === null
          ? `Token ${UNLIMITED_TEXT}`
          : `${formatCompactNumber(license.tokenQuota)} Token`}
      </span>
      {license.type === 'formal' ? (
        <Tooltip title="正式客户零上报，本系统没有用量数据，只能显示上限">
          <span style={{ marginLeft: 6, cursor: 'help' }}>ⓘ</span>
        </Tooltip>
      ) : null}
    </span>
  )
}
