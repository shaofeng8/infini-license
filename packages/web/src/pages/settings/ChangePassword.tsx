import { Alert, Button, Form, Input, message } from 'antd'
import { useState } from 'react'
import { authApi } from '@/api'
import { PageHeader } from '@/components/PageHeader'
import { useUserStore } from '@/stores/userStore'
import { PASSWORD_RULE } from '@/types/auth'

interface FormValues {
  oldPassword: string
  newPassword: string
  confirmPassword: string
}

export default function ChangePasswordPage() {
  const [form] = Form.useForm<FormValues>()
  const [submitting, setSubmitting] = useState(false)
  const clearSession = useUserStore(state => state.clearSession)

  const handleSubmit = async (values: FormValues) => {
    setSubmitting(true)
    try {
      await authApi
        .changePassword({
          oldPassword: values.oldPassword,
          newPassword: values.newPassword,
        })
        .send()
      message.success('密码已修改，请用新密码重新登录')
      // 改完密码强制重新登录：老 token 在服务端仍然有效（JWT 无状态），
      // 但让用户立刻用新密码走一遍，能当场确认新密码是他记住的那个
      clearSession(true)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <PageHeader title="修改密码" />

      <div className="lc-card-flat" style={{ padding: 24, maxWidth: 480 }}>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 24 }}
          message="修改成功后需要重新登录"
        />

        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={handleSubmit}
        >
          <Form.Item
            name="oldPassword"
            label="当前密码"
            rules={[{ required: true, message: '请输入当前密码' }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>

          <Form.Item
            name="newPassword"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { pattern: PASSWORD_RULE.pattern, message: PASSWORD_RULE.hint },
            ]}
            extra={PASSWORD_RULE.hint}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>

          <Form.Item
            name="confirmPassword"
            label="确认新密码"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: '请再次输入新密码' },
              ({ getFieldValue }) => ({
                validator: (_, value) =>
                  !value || value === getFieldValue('newPassword')
                    ? Promise.resolve()
                    : Promise.reject(new Error('两次输入的密码不一致')),
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>

          <Button type="primary" htmlType="submit" loading={submitting}>
            确认修改
          </Button>
        </Form>
      </div>
    </>
  )
}
