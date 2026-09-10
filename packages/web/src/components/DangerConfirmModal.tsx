import { ExclamationCircleFilled } from '@ant-design/icons'
import { Alert, Input, Modal, Typography } from 'antd'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

interface DangerConfirmModalProps {
  open: boolean
  title: string
  /** 说明这个操作会造成什么，越具体越好 */
  description: ReactNode
  /**
   * 要求用户逐字输入的确认串，通常是授权编号或 kid。
   *
   * 留空则退化为普通确认框（只有按钮）。续期、密钥退役这类不可回退的操作
   * 必须传 —— 打字的两秒钟是让人真正看清自己在操作哪一条的唯一机会，
   * 「确定/取消」按钮点起来太快了。
   */
  confirmText?: string
  confirmLabel?: string
  okText?: string
  loading?: boolean
  onOk: () => void | Promise<void>
  onCancel: () => void
  /** 额外的表单区域，如作废原因输入框 */
  extra?: ReactNode
}

export function DangerConfirmModal({
  open,
  title,
  description,
  confirmText,
  confirmLabel,
  okText = '确认执行',
  loading = false,
  onOk,
  onCancel,
  extra,
}: DangerConfirmModalProps) {
  const [typed, setTyped] = useState('')

  // 每次打开都清空，否则上一次输过的编号会残留，
  // 让「逐字确认」这道闸门形同虚设
  useEffect(() => {
    if (open) setTyped('')
  }, [open])

  const needsTyping = Boolean(confirmText)
  const matched = !needsTyping || typed.trim() === confirmText

  return (
    <Modal
      open={open}
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <ExclamationCircleFilled style={{ color: 'var(--lc-color-danger)' }} />
          {title}
        </span>
      }
      okText={okText}
      okButtonProps={{ danger: true, disabled: !matched }}
      cancelText="取消"
      confirmLoading={loading}
      onOk={onOk}
      onCancel={onCancel}
      destroyOnClose
      maskClosable={false}
      width={520}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          paddingTop: 8,
        }}
      >
        <Alert type="warning" showIcon message={description} />

        {extra}

        {needsTyping ? (
          <div>
            <div style={{ fontSize: 13, marginBottom: 8 }}>
              {confirmLabel ?? '请输入下方编号以确认：'}
              <Typography.Text code copyable={false} className="lc-num">
                {confirmText}
              </Typography.Text>
            </div>
            <Input
              value={typed}
              onChange={e => setTyped(e.target.value)}
              placeholder="逐字输入上方编号"
              status={typed && !matched ? 'error' : undefined}
              autoComplete="off"
            />
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
