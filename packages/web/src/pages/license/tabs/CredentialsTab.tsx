import { DownloadOutlined, RedoOutlined } from '@ant-design/icons'
import { Alert, Button, Space, Table, Tooltip, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useState } from 'react'
import { licenseApi } from '@/api'
import { CopyableText } from '@/components/CopyableText'
import { CredentialStatusDot } from '@/components/LicenseStatusDot'
import { AbsoluteDate } from '@/components/RelativeDate'
import type {
  CredentialHistoryItem,
  IssueResult,
  LicenseDetail,
} from '@/types/license'
import { ISSUE_REASON_LABEL } from '@/types/license'
import { formatDateTime, saveTextAsFile } from '@/utils/format'
import { DownloadConfirmModal } from '../DownloadConfirmModal'
import { ReissueModal } from '../ReissueModal'

export function CredentialsTab({
  license,
  editable,
  onReissued,
}: {
  license: LicenseDetail
  editable: boolean
  onReissued: (result: IssueResult) => void
}) {
  const [target, setTarget] = useState<CredentialHistoryItem | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [reissueOpen, setReissueOpen] = useState(false)

  const handleDownload = async () => {
    if (!target) return
    setDownloading(true)
    try {
      const envelope = await licenseApi.downloadCredential(target.id).send()
      saveTextAsFile(envelope, 'license.key')
      setTarget(null)
      message.success('已下载，请交付给客户运维')
    } finally {
      setDownloading(false)
    }
  }

  const columns: ColumnsType<CredentialHistoryItem> = [
    {
      title: '状态',
      dataIndex: 'isCurrent',
      width: 110,
      render: (isCurrent: boolean) => (
        <CredentialStatusDot isCurrent={isCurrent} />
      ),
    },
    {
      title: '签发原因',
      dataIndex: 'issueReason',
      width: 100,
      render: (reason: CredentialHistoryItem['issueReason']) =>
        ISSUE_REASON_LABEL[reason] ?? reason,
    },
    {
      title: 'jti',
      dataIndex: 'jti',
      width: 130,
      render: (jti: string) => <CopyableText value={jti} keep={10} />,
    },
    {
      title: '签名密钥',
      dataIndex: 'kid',
      width: 130,
      render: (kid: string) => <CopyableText value={kid} keep={10} />,
    },
    {
      title: '签发时间',
      dataIndex: 'issuedAt',
      width: 160,
      render: (value: string) => <AbsoluteDate value={value} />,
    },
    {
      title: '有效期',
      key: 'validity',
      width: 190,
      render: (_, row) => (
        <span className="lc-num" style={{ fontSize: 12 }}>
          {formatDateTime(row.validFrom).slice(0, 10)} →{' '}
          {row.validUntil ? formatDateTime(row.validUntil).slice(0, 10) : '永久'}
        </span>
      ),
    },
    {
      title: '下载',
      key: 'download',
      width: 170,
      render: (_, row) => (
        <div style={{ fontSize: 12 }}>
          <div className="lc-num">已下载 {row.downloadCount} 次</div>
          {row.lastDownloadAt ? (
            <div
              className="lc-num"
              style={{ color: 'var(--lc-color-text-secondary)' }}
            >
              最近 {formatDateTime(row.lastDownloadAt)}
            </div>
          ) : (
            <div style={{ color: 'var(--lc-color-text-secondary)' }}>
              尚未下载
            </div>
          )}
        </div>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      fixed: 'right',
      render: (_, row) => (
        <Tooltip title={editable ? '' : '需要运维及以上角色'}>
          <Button
            type="link"
            size="small"
            icon={<DownloadOutlined />}
            disabled={!editable}
            onClick={() => setTarget(row)}
          >
            下载
          </Button>
        </Tooltip>
      ),
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Alert
        type="info"
        showIcon
        message="每一次下载都会记入审计日志"
        description="历史凭证仍可下载，但客户环境里只有最新一份生效 —— 续期后旧凭证的到期日没有变，装错会让客户立刻被判过期。"
      />

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Space>
          <Tooltip
            title={
              editable
                ? '客户丢了文件、或指纹绑错机器时用'
                : '需要运维及以上角色'
            }
          >
            <Button
              icon={<RedoOutlined />}
              disabled={!editable || license.status === 'void'}
              onClick={() => setReissueOpen(true)}
            >
              补发凭证
            </Button>
          </Tooltip>
        </Space>
      </div>

      <Table<CredentialHistoryItem>
        rowKey="id"
        size="middle"
        columns={columns}
        dataSource={license.credentials}
        pagination={false}
        scroll={{ x: 1080 }}
        // 已取代的凭证整行降低对比度，避免误下载
        rowClassName={row => (row.isCurrent ? '' : 'lc-row-muted')}
      />

      <DownloadConfirmModal
        open={target !== null}
        credential={target}
        licenseNo={license.licenseNo}
        loading={downloading}
        onOk={handleDownload}
        onCancel={() => setTarget(null)}
      />

      <ReissueModal
        open={reissueOpen}
        license={license}
        onCancel={() => setReissueOpen(false)}
        onReissued={result => {
          setReissueOpen(false)
          onReissued(result)
        }}
      />
    </div>
  )
}
