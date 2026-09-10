import { Alert, Form, Input, Modal, Select } from 'antd'
import { useEffect } from 'react'
import { DOWNLOAD_PURPOSES } from '@/types/license'
import type { CredentialHistoryItem, DownloadPurpose } from '@/types/license'
import { formatDateTime } from '@/utils/format'

export interface DownloadConfirmValues {
  purpose: DownloadPurpose
  note?: string
}

/**
 * 凭证下载确认流。
 *
 * 设计文档把下载列为全系统最敏感的操作，要求下载前必须选「下载用途」。
 * 用途不是走过场：license.key 流出后无法收回，事后唯一能回答「这份凭证
 * 当初为什么被取出来」的就是这条记录 + 后端的 `credential.download` 审计。
 *
 * **已知缺口**：后端 `GET /license/credential/:id/download` 目前不接收
 * 任何请求体，用途只能记在前端这一侧的提示里，无法真正写进审计的 detail。
 * 已在 07-execution-plan.md 记录，等后端补一个可选的 `purpose` 查询参数。
 */
export function DownloadConfirmModal({
  open,
  credential,
  licenseNo,
  loading,
  onOk,
  onCancel,
}: {
  open: boolean
  credential: CredentialHistoryItem | null
  licenseNo: string
  loading: boolean
  onOk: (values: DownloadConfirmValues) => void
  onCancel: () => void
}) {
  const [form] = Form.useForm<DownloadConfirmValues>()

  useEffect(() => {
    if (open) form.resetFields()
  }, [open, form])

  return (
    <Modal
      open={open}
      title="下载 license.key"
      okText="确认下载"
      cancelText="取消"
      confirmLoading={loading}
      onOk={() => form.validateFields().then(onOk)}
      onCancel={onCancel}
      destroyOnClose
      maskClosable={false}
      width={520}
    >
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message="这次下载会记入审计日志"
        description={
          credential
            ? `授权 ${licenseNo}，此前已下载 ${credential.downloadCount} 次${
                credential.lastDownloadAt
                  ? `，最近一次 ${formatDateTime(credential.lastDownloadAt)}`
                  : ''
              }。`
            : undefined
        }
      />

      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item
          name="purpose"
          label="下载用途"
          rules={[{ required: true, message: '请选择下载用途' }]}
        >
          <Select
            placeholder="请选择"
            options={DOWNLOAD_PURPOSES.map(item => ({
              value: item.value,
              label: item.label,
            }))}
          />
        </Form.Item>

        <Form.Item name="note" label="补充说明">
          <Input.TextArea
            rows={2}
            maxLength={200}
            showCount
            placeholder="选填，如客户对接人或工单号"
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
