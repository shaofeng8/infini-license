import { CheckCircleFilled, DownloadOutlined } from '@ant-design/icons'
import { Alert, Button, Descriptions, Modal, Typography } from 'antd'
import { CopyableText } from '@/components/CopyableText'
import type { IssueResult } from '@/types/license'
import { formatDate, saveTextAsFile } from '@/utils/format'

/**
 * 签发 / 续期 / 补发成功后的交付弹窗。
 *
 * 这里的下载用的是接口返回体里已经带着的 `envelope`，**不再调下载接口**：
 * 一次签发在后端只应留一条 `license.issue` 审计，如果这里再走一次
 * `credential/:id/download`，每次签发都会顺带产生一条下载记录，
 * 事后追查「这份凭证被下载过几次」时会永远多出一次，分不清是运维真的下过
 * 还是签发时的自动动作。
 */
export function CredentialDeliveryModal({
  result,
  onClose,
}: {
  result: IssueResult | null
  onClose: () => void
}) {
  if (!result) return null

  const handleDownload = () => {
    saveTextAsFile(result.envelope, 'license.key')
  }

  return (
    <Modal
      open
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <CheckCircleFilled style={{ color: 'var(--lc-color-success)' }} />
          签发成功
        </span>
      }
      onCancel={onClose}
      width={640}
      maskClosable={false}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: 'var(--lc-color-text-secondary)' }}>
            关闭后仍可在授权详情的「凭证」页重新下载
          </span>
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <Button onClick={onClose}>关闭</Button>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={handleDownload}
            >
              下载 license.key
            </Button>
          </span>
        </div>
      }
    >
      <Alert
        type="success"
        showIcon
        style={{ marginBottom: 16 }}
        message="请把 license.key 交付给客户运维，放置在部署目录下"
        description="交付前建议核对下方校验和，确认文件在传输过程中没有损坏。"
      />

      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label="授权编号">
          <CopyableText value={result.licenseNo} keep={0} />
        </Descriptions.Item>
        <Descriptions.Item label="生效">
          {formatDate(result.validFrom)}
        </Descriptions.Item>
        <Descriptions.Item label="到期">
          {result.validUntil ? (
            formatDate(result.validUntil)
          ) : (
            <span style={{ color: 'var(--lc-color-warning)' }}>永久</span>
          )}
        </Descriptions.Item>
        <Descriptions.Item label="签名密钥">
          <CopyableText value={result.kid} keep={0} />
        </Descriptions.Item>
        <Descriptions.Item label="校验和">
          <CopyableText value={result.checksum} keep={16} />
        </Descriptions.Item>
      </Descriptions>

      <Typography.Paragraph style={{ marginTop: 16, marginBottom: 4 }}>
        <span style={{ fontSize: 13, color: 'var(--lc-color-text-secondary)' }}>
          文件内容预览
        </span>
      </Typography.Paragraph>
      <pre
        style={{
          margin: 0,
          maxHeight: 180,
          overflow: 'auto',
          padding: 12,
          fontSize: 12,
          lineHeight: 1.6,
          background: 'var(--lc-color-page-bg)',
          border: '1px solid var(--lc-color-border)',
          borderRadius: 8,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {result.envelope}
      </pre>
    </Modal>
  )
}
