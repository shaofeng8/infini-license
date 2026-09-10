import { Result } from 'antd'
import type { ReactElement } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { hasRole, useUserStore } from '@/stores/userStore'
import type { AdminRole } from '@/types/auth'

/**
 * 登录闸门。未登录或 token 已过期一律跳登录页，并把当前地址带上。
 *
 * 带 redirect 参数是为了让「链接分享」能用：同事把一条授权详情的链接发过来，
 * 点开先登录，登录完应该落在那条详情上，而不是回到首页让他重新去找。
 */
export function RequireAuth({ children }: { children: ReactElement }) {
  const location = useLocation()
  const isTokenValid = useUserStore(state => state.isTokenValid)

  if (!isTokenValid()) {
    const back = `${location.pathname}${location.search}`
    return <Navigate to={`/login?redirect=${encodeURIComponent(back)}`} replace />
  }

  return children
}

/**
 * 角色闸门。渲染 403 而不是跳转。
 *
 * 跳走会让人以为链接坏了；明确说「你的角色看不到这个」，他才知道该去找谁
 * 要权限。菜单里同时也会把入口藏掉，这里是兜底 —— 有人把链接直接发给了
 * viewer，或者收藏夹里存着降权前的地址。
 */
export function RequireRole({
  min,
  children,
}: {
  min: AdminRole
  children: ReactElement
}) {
  const user = useUserStore(state => state.user)

  if (!hasRole(user, min)) {
    return (
      <Result
        status="403"
        title="无权访问"
        subTitle="当前角色没有访问该功能的权限，如需使用请联系超级管理员调整角色。"
      />
    )
  }

  return children
}

/** 已登录时访问 /login 直接送回后台，省掉一次手动跳 */
export function RedirectIfAuthed({ children }: { children: ReactElement }) {
  const isTokenValid = useUserStore(state => state.isTokenValid)
  return isTokenValid() ? <Navigate to="/license" replace /> : children
}
