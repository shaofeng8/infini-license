import { Alert, Form, Input, Modal, Select } from 'antd'
import { useEffect, useState } from 'react'
import { licenseApi } from '@/api'
import type { IssueResult, LicenseDetail } from '@/types/license'

/** 补发原因。选项本身不进后端，只是拼进 reason 文本里，方便审计里读得懂 */
const REASONS = [
  { value: '客户丢失 license.key 文件', label: '客户丢失文件' },
  { value: '机器指纹绑定错误，需换机部署', label: '换机 / 指纹绑错' },
  { value: '文件在传输中损坏，校验和不匹配', label: '文件损坏' },
  { value: '内部测试', label: '内部测试' },
]

export function ReissueModal({
  open,
  license,
  onCancel,
  onReissued,
}: {
  open: boolean
  license: LicenseDetail
  onCancel: () => void
  onReissued: (result: IssueResult) => void
}) {
  const [form] = Form.useForm<{ preset: string; note?: string }>()
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) form.resetFields()
  }, [open, form])

  const handleSubmit = async () => {
    const values = await form.validateFields()
    const reason = values.note
      ? `${values.preset}（${values.note}）`
      : values.preset

    setSubmitting(true)
    try {
      const result = await licenseApi.reissue(license._id, reason).send()
      onReissued(result)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title="补发凭证"
      okText="确认补发"
      cancelText="取消"
      confirmLoading={submitting}
      onOk={handleSubmit}
      onCancel={onCancel}
      destroyOnClose
      maskClosable={false}
      width={520}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="补发的凭证内容与原件完全一致，有效期不变"
        description="它只解决「文件丢了 / 装错机器」，不能用来延长有效期 —— 需要延期请用「续期」。补发后原凭证仍可下载但会标记为已取代。"
      />

      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item
          name="preset"
          label="补发原因"
          rules={[{ required: true, message: '请选择补发原因' }]}
        >
          <Select placeholder="请选择" options={REASONS} />
        </Form.Item>

        <Form.Item name="note" label="补充说明">
          <Input.TextArea
            rows={2}
            maxLength={160}
            showCount
            placeholder="选填，如工单号或客户对接人"
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
