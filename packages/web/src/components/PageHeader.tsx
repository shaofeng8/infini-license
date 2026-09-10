import { ArrowLeftOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

interface PageHeaderProps {
  title: ReactNode
  /** 标题下方一行说明，讲清这个页面是干什么的 */
  description?: ReactNode
  /** 右侧操作区 */
  extra?: ReactNode
  /** 传入则显示返回按钮 */
  backTo?: string
  /** 标题右侧的徽标区（类型、状态） */
  tags?: ReactNode
}

/** 页面头部：标题 20/28 semibold，与内容区共用 24px 左右留白 */
export function PageHeader({
  title,
  description,
  extra,
  backTo,
  tags,
}: PageHeaderProps) {
  const navigate = useNavigate()

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
        marginBottom: 24,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {backTo ? (
            <Button
              type="text"
              size="small"
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate(backTo)}
              style={{ marginLeft: -8 }}
            >
              返回
            </Button>
          ) : null}
          <h1
            style={{
              margin: 0,
              fontSize: 20,
              lineHeight: '28px',
              fontWeight: 600,
            }}
          >
            {title}
          </h1>
          {tags}
        </div>

        {description ? (
          <div
            style={{
              marginTop: 8,
              fontSize: 13,
              lineHeight: '20px',
              color: 'var(--lc-color-text-secondary)',
            }}
          >
            {description}
          </div>
        ) : null}
      </div>

      {extra ? (
        <div style={{ display: 'flex', gap: 8, flex: '0 0 auto' }}>{extra}</div>
      ) : null}
    </div>
  )
}
