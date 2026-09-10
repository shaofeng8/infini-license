import { Skeleton } from 'antd'

/**
 * 表格骨架屏。
 *
 * 设计文档明确禁止整页 Spin 遮罩：列表页的筛选栏在加载期间应该还能操作，
 * 而遮罩会把它一起盖住 —— 运营改个筛选条件得先等上一次请求回来。
 */
export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div style={{ padding: '8px 0' }}>
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          style={{
            display: 'flex',
            gap: 24,
            padding: '14px 16px',
            borderBottom: '1px solid var(--lc-color-border)',
          }}
        >
          <Skeleton.Input active size="small" style={{ width: 160 }} />
          <Skeleton.Input active size="small" style={{ width: 120 }} />
          <Skeleton.Input active size="small" style={{ width: 90 }} />
          <Skeleton.Input active size="small" style={{ flex: 1 }} />
        </div>
      ))}
    </div>
  )
}
