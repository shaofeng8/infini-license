import { Spin } from 'antd'

/** 路由级懒加载占位。页面内的加载状态用 TableSkeleton / Skeleton，不要用这个 */
export default function Loading() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 240,
        width: '100%',
      }}
    >
      <Spin />
    </div>
  )
}
