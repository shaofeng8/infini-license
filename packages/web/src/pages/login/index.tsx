import { LockOutlined, SafetyCertificateOutlined, UserOutlined } from '@ant-design/icons'
import { Alert, Button, Form, Input } from 'antd'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { authApi } from '@/api'
import { DEFAULT_ROUTE } from '@/router/menu'
import { useUserStore } from '@/stores/userStore'
import type { LoginRequest } from '@/types/auth'
import { palette } from '@/theme'

export default function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const setSession = useUserStore(state => state.setSession)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (values: LoginRequest) => {
    setLoading(true)
    setError('')
    try {
      // 登录接口在 api 层标了 silent，失败信息由下面的 Alert 呈现
      const result = await authApi.login(values).send()
      setSession(result)
      const redirect = searchParams.get('redirect')
      navigate(redirect || DEFAULT_ROUTE, { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : '登录失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: palette.pageBg,
        padding: 24,
      }}
    >
      <div
        className="lc-card-hover"
        style={{
          display: 'flex',
          width: '100%',
          maxWidth: 880,
          overflow: 'hidden',
          minHeight: 460,
        }}
      >
        <BrandPanel />

        <div
          style={{
            flex: '1 1 45%',
            padding: '48px 40px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          <h1 style={{ margin: 0, fontSize: 20, lineHeight: '28px', fontWeight: 600 }}>
            登录管理后台
          </h1>
          <p
            style={{
              margin: '8px 0 24px',
              fontSize: 13,
              color: palette.textSecondary,
            }}
          >
            仅限内部运营人员使用
          </p>

          {error ? (
            <Alert
              type="error"
              showIcon
              message={error}
              style={{ marginBottom: 16 }}
            />
          ) : null}

          <Form
            layout="vertical"
            requiredMark={false}
            onFinish={handleSubmit}
            autoComplete="off"
            size="large"
          >
            <Form.Item
              name="username"
              label="用户名"
              rules={[{ required: true, message: '请输入用户名' }]}
            >
              <Input prefix={<UserOutlined />} placeholder="用户名" autoFocus />
            </Form.Item>

            <Form.Item
              name="password"
              label="密码"
              rules={[{ required: true, message: '请输入密码' }]}
              // 连错 5 次锁 15 分钟，提前说清楚，免得有人反复试到被锁
              extra="连续 5 次输错将临时锁定账号 15 分钟"
            >
              <Input.Password prefix={<LockOutlined />} placeholder="密码" />
            </Form.Item>

            <Button
              type="primary"
              htmlType="submit"
              block
              loading={loading}
              style={{ marginTop: 8 }}
            >
              登录
            </Button>
          </Form>
        </div>
      </div>
    </div>
  )
}

/** 左侧品牌区：无注册、无第三方登录，这是内部系统 */
function BrandPanel() {
  return (
    <div
      style={{
        flex: '1 1 55%',
        background: `linear-gradient(140deg, ${palette.siderBg} 0%, #1B2A4E 100%)`,
        color: '#fff',
        padding: '48px 40px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <SafetyCertificateOutlined style={{ fontSize: 22, color: palette.primary }} />
        <span style={{ fontSize: 16, fontWeight: 600 }}>InfiniSynapse License</span>
      </div>

      <div>
        <div style={{ fontSize: 24, lineHeight: '34px', fontWeight: 600 }}>
          授权签发、管理
          <br />
          与试用追踪
        </div>
        <div
          style={{
            marginTop: 16,
            fontSize: 13,
            lineHeight: '22px',
            color: 'rgba(255,255,255,.65)',
          }}
        >
          正式客户的授权以离线凭证交付，签发后不可收回。
          <br />
          请确认客户与有效期无误后再下载 license.key。
        </div>
      </div>

      <svg width="120" height="80" viewBox="0 0 120 80" fill="none" aria-hidden="true">
        <rect
          x="1"
          y="1"
          width="78"
          height="58"
          rx="6"
          stroke="rgba(255,255,255,.25)"
          strokeWidth="1.5"
        />
        <path d="M12 18h48M12 30h56M12 42h34" stroke="rgba(255,255,255,.22)" strokeWidth="3" strokeLinecap="round" />
        <circle cx="92" cy="52" r="22" fill={palette.primary} fillOpacity=".16" />
        <path
          d="M92 40l9 4.5v7c0 5.6-3.7 10.8-9 12.5-5.3-1.7-9-6.9-9-12.5v-7L92 40z"
          stroke={palette.primary}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="M88 52.5l3 3 5-5.5" stroke={palette.primary} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}
