import { PlusOutlined } from '@ant-design/icons'
import { useRequest } from 'alova/client'
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useState } from 'react'
import { authApi } from '@/api'
import { DangerConfirmModal } from '@/components/DangerConfirmModal'
import { PageHeader } from '@/components/PageHeader'
import { AbsoluteDate } from '@/components/RelativeDate'
import { StatusDot } from '@/components/StatusDot'
import { TableSkeleton } from '@/components/TableSkeleton'
import { useCurrentUser } from '@/stores/userStore'
import type { AdminRole, AdminUserListItem } from '@/types/auth'
import { PASSWORD_RULE, ROLE_DESC, ROLE_LABEL } from '@/types/auth'
import { formatDateTime } from '@/utils/format'

export default function AdminUserPage() {
  const me = useCurrentUser()
  const [createOpen, setCreateOpen] = useState(false)
  const [resetTarget, setResetTarget] = useState<AdminUserListItem | null>(null)
  const [statusTarget, setStatusTarget] = useState<AdminUserListItem | null>(null)
  const [busy, setBusy] = useState(false)

  const { data, loading, send: reload } = useRequest(() => authApi.listUsers(), {
    initialData: [] as AdminUserListItem[],
    immediate: true,
  })

  const users = data ?? []

  const handleToggleStatus = async () => {
    if (!statusTarget) return
    const next = statusTarget.status === 1 ? 0 : 1
    setBusy(true)
    try {
      await authApi.setUserStatus(statusTarget._id, next).send()
      message.success(next === 1 ? '已启用' : '已停用')
      setStatusTarget(null)
      void reload()
    } finally {
      setBusy(false)
    }
  }

  const columns: ColumnsType<AdminUserListItem> = [
    {
      title: '用户名',
      dataIndex: 'username',
      width: 160,
      render: (value: string, row) => (
        <Space size={8}>
          <span style={{ fontWeight: 500 }}>{value}</span>
          {row._id === me?.id ? (
            <Tag bordered={false} color="blue">
              我
            </Tag>
          ) : null}
        </Space>
      ),
    },
    {
      title: '姓名',
      dataIndex: 'realName',
      width: 120,
      render: (value: string | null) => value || '—',
    },
    {
      title: '角色',
      dataIndex: 'role',
      width: 160,
      render: (role: AdminRole) => (
        <Tooltip title={ROLE_DESC[role]}>
          <span>{ROLE_LABEL[role]}</span>
        </Tooltip>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 140,
      render: (status: number, row) => {
        // 锁定是登录失败累积出来的临时状态，与「被管理员停用」不是一回事，
        // 混在一起显示会让人去误改账号状态，而实际上等 15 分钟就自动好了
        const locked =
          row.lockedUntil !== null && new Date(row.lockedUntil) > new Date()
        if (locked) {
          return (
            <Tooltip title={`锁定至 ${formatDateTime(row.lockedUntil)}`}>
              <StatusDot tone="warning">已锁定</StatusDot>
            </Tooltip>
          )
        }
        return status === 1 ? (
          <StatusDot tone="success">正常</StatusDot>
        ) : (
          <StatusDot tone="neutral" hollow>
            已停用
          </StatusDot>
        )
      },
    },
    {
      title: '最近登录',
      dataIndex: 'lastLoginAt',
      width: 190,
      render: (value: string | null, row) =>
        value ? (
          <div style={{ fontSize: 12 }}>
            <AbsoluteDate value={value} />
            {row.lastLoginIp ? (
              <div
                className="lc-num"
                style={{ color: 'var(--lc-color-text-secondary)' }}
              >
                {row.lastLoginIp}
              </div>
            ) : null}
          </div>
        ) : (
          <span style={{ color: 'var(--lc-color-text-secondary)' }}>从未登录</span>
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
      width: 170,
      fixed: 'right',
      render: (_, row) => {
        const isSelf = row._id === me?.id
        return (
          <Space size={4}>
            <Button
              type="link"
              size="small"
              onClick={() => setResetTarget(row)}
              disabled={isSelf}
            >
              重置密码
            </Button>
            <Tooltip title={isSelf ? '不能停用自己的账号' : ''}>
              <Button
                type="link"
                size="small"
                danger={row.status === 1}
                disabled={isSelf}
                onClick={() => setStatusTarget(row)}
              >
                {row.status === 1 ? '停用' : '启用'}
              </Button>
            </Tooltip>
          </Space>
        )
      },
    },
  ]

  return (
    <>
      <PageHeader
        title="管理员"
        description="四级角色按等级放行：超级管理员 > 运维 > 销售 > 只读。角色变更在对方下次请求时生效。"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateOpen(true)}
          >
            创建账号
          </Button>
        }
      />

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="角色权限对照"
        description={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(Object.keys(ROLE_LABEL) as AdminRole[]).map(role => (
              <div key={role} style={{ fontSize: 13 }}>
                <strong>{ROLE_LABEL[role]}</strong>
                <span style={{ color: 'var(--lc-color-text-secondary)' }}>
                  {' '}
                  — {ROLE_DESC[role]}
                </span>
              </div>
            ))}
          </div>
        }
      />

      <div className="lc-card-flat" style={{ padding: 16 }}>
        {loading && users.length === 0 ? (
          <TableSkeleton rows={4} />
        ) : (
          <Table<AdminUserListItem>
            rowKey="_id"
            size="middle"
            columns={columns}
            dataSource={users}
            pagination={false}
            scroll={{ x: 1100 }}
            rowClassName={row => (row.status === 0 ? 'lc-row-muted' : '')}
          />
        )}
      </div>

      <CreateUserModal
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false)
          void reload()
        }}
      />

      <ResetPasswordModal
        target={resetTarget}
        onCancel={() => setResetTarget(null)}
        onDone={() => setResetTarget(null)}
      />

      <DangerConfirmModal
        open={statusTarget !== null}
        title={statusTarget?.status === 1 ? '停用账号' : '启用账号'}
        okText="确认"
        loading={busy}
        onOk={handleToggleStatus}
        onCancel={() => setStatusTarget(null)}
        description={
          statusTarget?.status === 1 ? (
            <>
              停用后 <strong>{statusTarget?.username}</strong>{' '}
              无法再登录，但已签发出去的凭证与审计记录都会保留。
            </>
          ) : (
            <>
              启用后 <strong>{statusTarget?.username}</strong> 可以用原密码登录。
              如果不确定原密码是否还安全，建议一并重置。
            </>
          )
        }
      />
    </>
  )
}

function CreateUserModal({
  open,
  onCancel,
  onCreated,
}: {
  open: boolean
  onCancel: () => void
  onCreated: () => void
}) {
  const [form] = Form.useForm<{
    username: string
    password: string
    realName?: string
    role: AdminRole
  }>()
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    const values = await form.validateFields()
    setSubmitting(true)
    try {
      await authApi.createUser(values).send()
      message.success('账号已创建，请把初始密码交给本人并提醒尽快修改')
      onCreated()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title="创建管理员账号"
      okText="创建"
      cancelText="取消"
      confirmLoading={submitting}
      onOk={handleSubmit}
      onCancel={onCancel}
      destroyOnClose
      afterOpenChange={opened => {
        if (opened) form.setFieldsValue({ role: 'viewer' })
      }}
    >
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item
          name="username"
          label="用户名"
          rules={[{ required: true, message: '请填写用户名' }]}
        >
          <Input maxLength={64} autoComplete="off" />
        </Form.Item>

        <Form.Item name="realName" label="姓名">
          <Input maxLength={64} placeholder="选填，审计日志里显示得更清楚" />
        </Form.Item>

        <Form.Item
          name="password"
          label="初始密码"
          rules={[
            { required: true, message: '请填写初始密码' },
            { pattern: PASSWORD_RULE.pattern, message: PASSWORD_RULE.hint },
          ]}
          extra={PASSWORD_RULE.hint}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>

        <Form.Item
          name="role"
          label="角色"
          rules={[{ required: true, message: '请选择角色' }]}
        >
          <Select
            options={(Object.keys(ROLE_LABEL) as AdminRole[]).map(role => ({
              value: role,
              label: `${ROLE_LABEL[role]} — ${ROLE_DESC[role]}`,
            }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

function ResetPasswordModal({
  target,
  onCancel,
  onDone,
}: {
  target: AdminUserListItem | null
  onCancel: () => void
  onDone: () => void
}) {
  const [form] = Form.useForm<{ password: string }>()
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!target) return
    const values = await form.validateFields()
    setSubmitting(true)
    try {
      await authApi.resetUserPassword(target._id, values.password).send()
      message.success('密码已重置')
      onDone()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={target !== null}
      title={`重置 ${target?.username ?? ''} 的密码`}
      okText="确认重置"
      cancelText="取消"
      confirmLoading={submitting}
      onOk={handleSubmit}
      onCancel={onCancel}
      destroyOnClose
    >
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message="重置会记入审计日志"
        description="重置后对方的旧密码立即失效，请通过可靠渠道把新密码交给本人。"
      />
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item
          name="password"
          label="新密码"
          rules={[
            { required: true, message: '请填写新密码' },
            { pattern: PASSWORD_RULE.pattern, message: PASSWORD_RULE.hint },
          ]}
          extra={PASSWORD_RULE.hint}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
