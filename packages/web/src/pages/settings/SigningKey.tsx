import { PlusOutlined } from '@ant-design/icons'
import { useRequest } from 'alova/client'
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Space,
  Switch,
  Table,
  Tooltip,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useState } from 'react'
import { signingKeyApi } from '@/api'
import { CopyableText } from '@/components/CopyableText'
import { DangerConfirmModal } from '@/components/DangerConfirmModal'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { AbsoluteDate } from '@/components/RelativeDate'
import { StatusDot } from '@/components/StatusDot'
import { TableSkeleton } from '@/components/TableSkeleton'
import type { SigningKey, SigningKeyStatus } from '@/types/system'
import { SIGNING_KEY_STATUS_LABEL } from '@/types/system'

const STATUS_TONE: Record<SigningKeyStatus, 'success' | 'warning' | 'neutral'> = {
  active: 'success',
  retiring: 'warning',
  retired: 'neutral',
}

export default function SigningKeyPage() {
  const [createOpen, setCreateOpen] = useState(false)
  const [retireTarget, setRetireTarget] = useState<SigningKey | null>(null)
  const [activateTarget, setActivateTarget] = useState<SigningKey | null>(null)
  const [busy, setBusy] = useState(false)

  const { data, loading, send: reload } = useRequest(() => signingKeyApi.list(), {
    initialData: [] as SigningKey[],
    immediate: true,
  })

  const keys = data ?? []
  const activeCount = keys.filter(k => k.status === 'active').length

  const handleRetire = async () => {
    if (!retireTarget) return
    setBusy(true)
    try {
      await signingKeyApi.retire(retireTarget.kid).send()
      message.success(`已停用 ${retireTarget.kid}`)
      setRetireTarget(null)
      void reload()
    } finally {
      setBusy(false)
    }
  }

  const handleActivate = async () => {
    if (!activateTarget) return
    setBusy(true)
    try {
      await signingKeyApi.activate(activateTarget.kid).send()
      message.success(`${activateTarget.kid} 已切为当前签发密钥`)
      setActivateTarget(null)
      void reload()
    } finally {
      setBusy(false)
    }
  }

  const columns: ColumnsType<SigningKey> = [
    {
      title: 'kid',
      dataIndex: 'kid',
      width: 200,
      render: (kid: string) => <CopyableText value={kid} keep={0} />,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      render: (status: SigningKeyStatus) => (
        <StatusDot tone={STATUS_TONE[status]} hollow={status === 'retired'}>
          {SIGNING_KEY_STATUS_LABEL[status]}
        </StatusDot>
      ),
    },
    { title: '算法', dataIndex: 'algorithm', width: 90 },
    {
      title: '客户端起始版本',
      dataIndex: 'clientSince',
      width: 160,
      render: (value: string | null) =>
        value ? (
          <span className="lc-num">{value}</span>
        ) : (
          <Tooltip title="没有记录起始版本，无法判断老客户端是否内置了这把公钥，用它签发有验签失败的风险">
            <span style={{ color: 'var(--lc-color-warning)' }}>未记录 ⚠</span>
          </Tooltip>
        ),
    },
    {
      title: '启用时间',
      dataIndex: 'activatedAt',
      width: 160,
      render: (value: string) => <AbsoluteDate value={value} />,
    },
    {
      title: '停用时间',
      dataIndex: 'retiredAt',
      width: 160,
      render: (value: string | null) =>
        value ? <AbsoluteDate value={value} /> : '—',
    },
    { title: '备注', dataIndex: 'remark', render: v => v || '—' },
    {
      title: '操作',
      key: 'action',
      width: 150,
      fixed: 'right',
      render: (_, row) => (
        <Space size={4}>
          {row.status !== 'active' && row.status !== 'retired' ? (
            <Button
              type="link"
              size="small"
              onClick={() => setActivateTarget(row)}
            >
              设为当前
            </Button>
          ) : null}
          {row.status !== 'retired' ? (
            <Tooltip
              title={
                activeCount <= 1 && row.status === 'active'
                  ? '这是最后一把可用密钥，停用后将无法签发'
                  : ''
              }
            >
              <Button
                type="link"
                size="small"
                danger
                disabled={activeCount <= 1 && row.status === 'active'}
                onClick={() => setRetireTarget(row)}
              >
                停用
              </Button>
            </Tooltip>
          ) : null}
        </Space>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="签名密钥"
        description="Ed25519 密钥对，私钥用 LICENSE_MASTER_KEY 加密后存库。停用只影响将来的签发，不构成对已发凭证的吊销。"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateOpen(true)}
          >
            生成新密钥
          </Button>
        }
      />

      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message="换密钥前先确认客户端版本"
        description="离线客户端只认自己内置的公钥。用一把比客户现装版本更新的 kid 去签发，凭证在客户环境里会直接验签失败，而失败现场在对方内网里，我们看不到 —— 表现为客户报「装了新文件还是说授权无效」。"
      />

      <div className="lc-card-flat" style={{ padding: 16 }}>
        {loading && keys.length === 0 ? (
          <TableSkeleton rows={4} />
        ) : (
          <Table<SigningKey>
            rowKey="kid"
            size="middle"
            columns={columns}
            dataSource={keys}
            pagination={false}
            scroll={{ x: 1100 }}
            rowClassName={row => (row.status === 'retired' ? 'lc-row-muted' : '')}
            locale={{
              emptyText: (
                <EmptyState
                  title="还没有签名密钥"
                  description="没有可用密钥无法签发任何授权，请先生成一把。"
                  actionText="生成新密钥"
                  onAction={() => setCreateOpen(true)}
                />
              ),
            }}
          />
        )}
      </div>

      <CreateKeyModal
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false)
          void reload()
        }}
      />

      <DangerConfirmModal
        open={retireTarget !== null}
        title="停用签名密钥"
        okText="确认停用"
        loading={busy}
        confirmText={retireTarget?.kid}
        confirmLabel="请输入下方 kid 以确认："
        onOk={handleRetire}
        onCancel={() => setRetireTarget(null)}
        description={
          <>
            停用后这把密钥<strong>不能再用于签发</strong>
            ，但已经签出去的凭证仍然有效 —— 客户端验签只看凭证里的 kid
            对应的公钥，不查我方的启停状态。这不是吊销手段。
          </>
        }
      />

      <Modal
        open={activateTarget !== null}
        title="切换当前签发密钥"
        okText="确认切换"
        cancelText="取消"
        confirmLoading={busy}
        onOk={handleActivate}
        onCancel={() => setActivateTarget(null)}
      >
        <Alert
          type="warning"
          showIcon
          message={`之后签发的凭证都会用 ${activateTarget?.kid ?? ''} 签名`}
          description={
            activateTarget?.clientSince
              ? `这把密钥从客户端 ${activateTarget.clientSince} 起内置。比该版本更老的客户环境无法验签，签发前请确认客户已升级。`
              : '这把密钥没有记录客户端起始版本，无法判断兼容性。建议先补上 clientSince 再切换。'
          }
        />
      </Modal>
    </>
  )
}

function CreateKeyModal({
  open,
  onCancel,
  onCreated,
}: {
  open: boolean
  onCancel: () => void
  onCreated: () => void
}) {
  const [form] = Form.useForm<{
    clientSince?: string
    remark?: string
    activate: boolean
  }>()
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    const values = await form.validateFields()
    setSubmitting(true)
    try {
      const result = await signingKeyApi.create(values).send()
      message.success(`已生成 ${result.kid}`)
      onCreated()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title="生成新签名密钥"
      okText="生成"
      cancelText="取消"
      confirmLoading={submitting}
      onOk={handleSubmit}
      onCancel={onCancel}
      destroyOnClose
      afterOpenChange={opened => {
        if (opened) form.setFieldsValue({ activate: false })
      }}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="生成后需要把公钥打包进客户端 SDK 才能真正启用"
        description="默认「只生成不启用」：先发一版内置了新公钥的客户端，等客户升级完再回来切换，否则新签的凭证在老客户端上会验签失败。"
      />

      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item
          name="clientSince"
          label="客户端起始版本"
          extra="从哪个客户端版本起内置了这把公钥，如 1.8.0。留空会导致后续无法做兼容性判断。"
        >
          <Input placeholder="如 1.8.0" maxLength={32} />
        </Form.Item>

        <Form.Item name="remark" label="备注">
          <Input maxLength={255} placeholder="选填，如轮换原因" />
        </Form.Item>

        <Form.Item
          name="activate"
          label="立即设为当前签发密钥"
          valuePropName="checked"
          extra="打开后新签发的凭证立刻改用这把密钥签名。离线客户拿不到内置新公钥的版本，请务必确认客户端已经铺开。"
        >
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  )
}
