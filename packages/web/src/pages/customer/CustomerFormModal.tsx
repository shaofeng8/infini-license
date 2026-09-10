import { Alert, Form, Input, Modal, Select, Switch, message } from 'antd'
import { useEffect, useState } from 'react'
import { customerApi } from '@/api'
import type { Customer, CustomerPayload, CustomerStage } from '@/types/customer'
import { CUSTOMER_STAGE_LABEL } from '@/types/customer'

interface FormValues extends Omit<CustomerPayload, 'status'> {
  enabled: boolean
}

export function CustomerFormModal({
  open,
  customer,
  onCancel,
  onSaved,
}: {
  open: boolean
  /** null = 新建 */
  customer: Customer | null
  onCancel: () => void
  onSaved: () => void
}) {
  const [form] = Form.useForm<FormValues>()
  const [submitting, setSubmitting] = useState(false)
  const editing = customer !== null

  useEffect(() => {
    if (!open) return
    form.resetFields()
    if (customer) {
      form.setFieldsValue({
        name: customer.name,
        shortName: customer.shortName ?? undefined,
        stage: customer.stage,
        contactName: customer.contactName ?? undefined,
        contactPhone: customer.contactPhone ?? undefined,
        contactEmail: customer.contactEmail ?? undefined,
        industry: customer.industry ?? undefined,
        region: customer.region ?? undefined,
        salesOwner: customer.salesOwner ?? undefined,
        remark: customer.remark ?? undefined,
        enabled: customer.status === 1,
      })
    } else {
      form.setFieldsValue({ stage: 'lead', enabled: true })
    }
  }, [open, customer, form])

  const handleSubmit = async () => {
    const { enabled, ...values } = await form.validateFields()
    const payload: CustomerPayload = { ...values }
    // status 只有编辑接口收（UpdateCustomerDto），新建时传了会被全局管道剥掉
    if (editing) payload.status = enabled ? 1 : 0

    setSubmitting(true)
    try {
      if (editing) {
        await customerApi.update(customer._id, payload).send()
        message.success('已保存')
      } else {
        await customerApi.create(payload).send()
        message.success('已创建')
      }
      onSaved()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title={editing ? '编辑客户' : '新建客户'}
      okText="保存"
      cancelText="取消"
      confirmLoading={submitting}
      onOk={handleSubmit}
      onCancel={onCancel}
      destroyOnClose
      width={560}
    >
      {customer?.source === 'trial_auto' ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="这条记录由试用注册自动创建"
          description="客户名取自客户端上报的信息，通常需要补全为公司全称。同一家公司多个部门各自试用会产生多条记录。"
        />
      ) : null}

      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item
          name="name"
          label="客户全称"
          rules={[{ required: true, message: '请填写客户名称' }]}
        >
          <Input maxLength={255} placeholder="与合同一致的公司全称" />
        </Form.Item>

        <Form.Item name="shortName" label="简称">
          <Input maxLength={64} placeholder="选填，列表里显示在全称下方" />
        </Form.Item>

        <Form.Item name="stage" label="阶段">
          <Select
            options={Object.entries(CUSTOMER_STAGE_LABEL).map(([value, label]) => ({
              value: value as CustomerStage,
              label,
            }))}
          />
        </Form.Item>

        <div style={{ display: 'flex', gap: 12 }}>
          <Form.Item name="industry" label="行业" style={{ flex: 1 }}>
            <Input maxLength={64} />
          </Form.Item>
          <Form.Item name="region" label="地区" style={{ flex: 1 }}>
            <Input maxLength={64} />
          </Form.Item>
          <Form.Item name="salesOwner" label="负责销售" style={{ flex: 1 }}>
            <Input maxLength={64} />
          </Form.Item>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <Form.Item name="contactName" label="联系人" style={{ flex: 1 }}>
            <Input maxLength={64} />
          </Form.Item>
          <Form.Item name="contactPhone" label="联系电话" style={{ flex: 1 }}>
            <Input maxLength={32} />
          </Form.Item>
        </div>

        <Form.Item
          name="contactEmail"
          label="联系邮箱"
          rules={[{ type: 'email', message: '邮箱格式不正确' }]}
        >
          <Input maxLength={128} />
        </Form.Item>

        <Form.Item name="remark" label="备注">
          <Input.TextArea rows={2} maxLength={500} showCount />
        </Form.Item>

        {editing ? (
          <Form.Item
            name="enabled"
            label="启用状态"
            valuePropName="checked"
            extra="停用后无法为该客户签发新授权，已签发的不受影响"
          >
            <Switch />
          </Form.Item>
        ) : null}
      </Form>
    </Modal>
  )
}
