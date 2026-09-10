import { Alert, DatePicker, Form, Input, Modal, Select, Switch } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useEffect, useState } from 'react'
import { licenseApi } from '@/api'
import { LimitField } from '@/components/LimitField'
import type {
  IssueResult,
  LicenseDetail,
  QuotaPeriod,
  RenewLicensePayload,
} from '@/types/license'
import { formatDate } from '@/utils/format'

interface RenewFormValues {
  endAt: Dayjs
  warnDays: number
  contractNo?: string
  reason?: string
}

export function RenewModal({
  open,
  license,
  onCancel,
  onRenewed,
}: {
  open: boolean
  license: LicenseDetail
  onCancel: () => void
  onRenewed: (result: IssueResult) => void
}) {
  const [form] = Form.useForm<RenewFormValues>()
  const [submitting, setSubmitting] = useState(false)
  const [updateLimits, setUpdateLimits] = useState(false)
  const [confirmNo, setConfirmNo] = useState('')

  const [limits, setLimits] = useState({
    maxUsers: license.maxUsers,
    maxConcurrentTasks: license.maxConcurrentTasks,
    tokenQuota: license.tokenQuota,
    tokenQuotaPeriod: (license.tokenQuotaPeriod ?? 'total') as QuotaPeriod,
    taskQuota: license.taskQuota,
    taskQuotaPeriod: (license.taskQuotaPeriod ?? 'total') as QuotaPeriod,
  })

  useEffect(() => {
    if (!open) return
    form.resetFields()
    form.setFieldsValue({
      // 默认续一年，从原到期日往后接而不是从今天算 —— 客户合同通常是
      // 连续的，从今天算会白送客户几天，或者在逾期续期时凭空少几天
      endAt: dayjs(license.endAt ?? undefined).add(1, 'year'),
      warnDays: license.warnDays,
      contractNo: license.contractNo ?? undefined,
    })
    setUpdateLimits(false)
    setConfirmNo('')
    setLimits({
      maxUsers: license.maxUsers,
      maxConcurrentTasks: license.maxConcurrentTasks,
      tokenQuota: license.tokenQuota,
      tokenQuotaPeriod: (license.tokenQuotaPeriod ?? 'total') as QuotaPeriod,
      taskQuota: license.taskQuota,
      taskQuotaPeriod: (license.taskQuotaPeriod ?? 'total') as QuotaPeriod,
    })
  }, [open, form, license])

  const handleSubmit = async () => {
    const values = await form.validateFields()
    const payload: RenewLicensePayload = {
      endAt: values.endAt.endOf('day').toISOString(),
      warnDays: values.warnDays,
      updateLimits,
    }
    if (values.contractNo) payload.contractNo = values.contractNo
    if (values.reason) payload.reason = values.reason

    if (updateLimits) {
      // 后端 `updateLimits: true` 时会把没传的项当成「不限制」写 NULL，
      // 所以这里必须把四项全部显式带上，哪怕没改
      if (limits.maxUsers !== null) payload.maxUsers = limits.maxUsers
      if (limits.maxConcurrentTasks !== null) {
        payload.maxConcurrentTasks = limits.maxConcurrentTasks
      }
      if (limits.tokenQuota !== null) {
        payload.tokenQuota = limits.tokenQuota
        payload.tokenQuotaPeriod = limits.tokenQuotaPeriod
      }
      if (limits.taskQuota !== null) {
        payload.taskQuota = limits.taskQuota
        payload.taskQuotaPeriod = limits.taskQuotaPeriod
      }
    }

    setSubmitting(true)
    try {
      const result = await licenseApi.renew(license._id, payload).send()
      onRenewed(result)
    } finally {
      setSubmitting(false)
    }
  }

  const matched = confirmNo.trim() === license.licenseNo

  return (
    <Modal
      open={open}
      title="续期"
      okText="确认续期并签发新凭证"
      cancelText="取消"
      okButtonProps={{ disabled: !matched }}
      confirmLoading={submitting}
      onOk={handleSubmit}
      onCancel={onCancel}
      destroyOnClose
      maskClosable={false}
      width={600}
    >
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message="续期会签发一份新凭证，需要重新交付给客户"
        description={`授权编号保持 ${license.licenseNo} 不变，原凭证被标记为已取代。客户不换文件的话，到期后仍会被判过期。`}
      />

      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item label="当前到期日">
          <Input
            disabled
            value={license.endAt ? formatDate(license.endAt) : '永久授权'}
          />
        </Form.Item>

        <Form.Item
          name="endAt"
          label="新的到期日"
          rules={[
            { required: true, message: '请选择新的到期日' },
            {
              validator: (_, value: Dayjs) => {
                if (!value || !license.endAt) return Promise.resolve()
                return value.isAfter(dayjs(license.endAt))
                  ? Promise.resolve()
                  : Promise.reject(new Error('新到期日必须晚于当前到期日'))
              },
            },
          ]}
        >
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item name="warnDays" label="到期预警天数">
          <Select
            options={[7, 15, 30, 60].map(d => ({ value: d, label: `${d} 天` }))}
          />
        </Form.Item>

        <Form.Item name="contractNo" label="合同号">
          <Input maxLength={64} placeholder="选填" />
        </Form.Item>

        <Form.Item label="同时调整限额">
          <Switch checked={updateLimits} onChange={setUpdateLimits} />
          <span
            style={{
              marginLeft: 8,
              fontSize: 12,
              color: 'var(--lc-color-text-secondary)',
            }}
          >
            关闭时保留原限额不变
          </span>
        </Form.Item>

        {updateLimits ? (
          <div
            style={{
              padding: '0 12px',
              marginBottom: 16,
              background: 'var(--lc-color-page-bg)',
              borderRadius: 8,
            }}
          >
            <LimitField
              label="最大用户数"
              value={limits.maxUsers}
              onChange={v => setLimits(s => ({ ...s, maxUsers: v }))}
              unit="人"
            />
            <LimitField
              label="最大并发任务数"
              value={limits.maxConcurrentTasks}
              onChange={v => setLimits(s => ({ ...s, maxConcurrentTasks: v }))}
              unit="个"
            />
            <LimitField
              label="Token 配额"
              value={limits.tokenQuota}
              onChange={v => setLimits(s => ({ ...s, tokenQuota: v }))}
              period={limits.tokenQuotaPeriod}
              onPeriodChange={p => setLimits(s => ({ ...s, tokenQuotaPeriod: p }))}
              step={1_000_000}
            />
            <LimitField
              label="任务数配额"
              value={limits.taskQuota}
              onChange={v => setLimits(s => ({ ...s, taskQuota: v }))}
              period={limits.taskQuotaPeriod}
              onPeriodChange={p => setLimits(s => ({ ...s, taskQuotaPeriod: p }))}
              unit="个"
            />
          </div>
        ) : null}

        <Form.Item name="reason" label="续期原因">
          <Input.TextArea
            rows={2}
            maxLength={200}
            showCount
            placeholder="选填，写入审计日志"
          />
        </Form.Item>

        <Form.Item label="输入授权编号以确认" required>
          <Input
            value={confirmNo}
            onChange={e => setConfirmNo(e.target.value)}
            placeholder={license.licenseNo}
            status={confirmNo && !matched ? 'error' : undefined}
            autoComplete="off"
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
