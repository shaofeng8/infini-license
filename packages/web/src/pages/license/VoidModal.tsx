import { Input } from 'antd'
import { useEffect, useState } from 'react'
import { licenseApi } from '@/api'
import { DangerConfirmModal } from '@/components/DangerConfirmModal'
import type { LicenseDetail } from '@/types/license'

export function VoidModal({
  open,
  license,
  onCancel,
  onVoided,
}: {
  open: boolean
  license: LicenseDetail
  onCancel: () => void
  onVoided: () => void
}) {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) setReason('')
  }, [open])

  const handleOk = async () => {
    setSubmitting(true)
    try {
      await licenseApi.void(license._id, reason).send()
      onVoided()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <DangerConfirmModal
      open={open}
      title="作废授权"
      okText="确认作废"
      loading={submitting}
      onOk={handleOk}
      onCancel={onCancel}
      confirmText={license.licenseNo}
      description={
        <>
          作废<strong>只改变后台状态，不影响客户环境</strong>
          —— 已交付的 license.key 仍然有效，客户会继续正常使用直到凭证自然到期。
          我方没有远程吊销能力，需要立即停用只能联系客户删除授权文件。
        </>
      }
      extra={
        <div>
          <div style={{ fontSize: 13, marginBottom: 8 }}>作废原因</div>
          <Input.TextArea
            rows={2}
            maxLength={200}
            showCount
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="写入审计日志，如「合同终止」「重复签发」"
          />
        </div>
      }
    />
  )
}
