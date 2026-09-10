import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { AdminRole, AdminUser, LoginResponse } from '@/types/auth'
import { ROLE_LEVEL } from '@/types/auth'

const STORAGE_KEY = 'lc-user-store'

function redirectToLogin() {
  if (window.location.pathname === '/login') return
  const back = `${window.location.pathname}${window.location.search}${window.location.hash}`
  window.location.replace(`/login?redirect=${encodeURIComponent(back)}`)
}

interface UserState {
  user: AdminUser | null
  token: string | null
  /** 本地过期时间戳（毫秒） */
  expiresAt: number | null

  isTokenValid: () => boolean
  setSession: (result: LoginResponse) => void
  setUser: (user: AdminUser) => void
  clearSession: (redirect?: boolean) => void
}

export const useUserStore = create<UserState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      expiresAt: null,

      isTokenValid: () => {
        const { token, expiresAt } = get()
        if (!token) return false
        // 没有过期时间就当它有效，让后端的 401 去裁决。本地时钟不可信，
        // 客户机器时间跑偏时不应该把一个好 token 判死
        if (!expiresAt) return true
        return Date.now() < expiresAt
      },

      setSession: (result) => {
        // expiresIn 是**秒**（server 的 parseDuration 返回秒），要 ×1000。
        // 直接当毫秒用会算出一个几乎立刻就过期的时间戳，表现为「登录成功后
        // 一刷新就被踢回登录页」，而且看起来像是 token 没存上
        const expiresAt = result.expiresIn
          ? Date.now() + result.expiresIn * 1000
          : null
        set({ user: result.user, token: result.accessToken, expiresAt })
      },

      setUser: (user) => set({ user }),

      clearSession: (redirect = false) => {
        set({ user: null, token: null, expiresAt: null })
        localStorage.removeItem(STORAGE_KEY)
        if (redirect) redirectToLogin()
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: state => ({
        user: state.user,
        token: state.token,
        expiresAt: state.expiresAt,
      }),
      onRehydrateStorage: () => (state) => {
        // 刷新页面时就地清掉已过期的会话，避免带着死 token 发一轮请求
        // 再被 401 弹一次「登录已过期」——用户什么都没做就看到报错很困惑
        if (state?.token && !state.isTokenValid()) {
          state.token = null
          state.user = null
          state.expiresAt = null
        }
      },
    },
  ),
)

/**
 * 角色等级比较，与后端 `RolesGuard` 同一口径（`>=` 而非精确匹配）。
 *
 * 两边必须一致，否则会出现「界面上按钮能点、后端回 403」，或者反过来
 * 「后端允许但界面把入口藏了」。后者更糟，因为没人会去报这个 bug。
 */
export function hasRole(
  user: AdminUser | null | undefined,
  min: AdminRole,
): boolean {
  return roleAtLeast(user?.role, min)
}

/** 只有角色字符串时用这个（如菜单过滤），避免为了调 hasRole 去拼一个假 user */
export function roleAtLeast(
  role: AdminRole | undefined | null,
  min: AdminRole,
): boolean {
  if (!role || ROLE_LEVEL[role] === undefined) return false
  return ROLE_LEVEL[role] >= ROLE_LEVEL[min]
}

export function isOwner(user: AdminUser | null | undefined): boolean {
  return hasRole(user, 'owner')
}

/** 能否签发 / 续期 / 补发 / 下载凭证 */
export function canIssue(user: AdminUser | null | undefined): boolean {
  return hasRole(user, 'ops')
}

/** 能否读写客户 */
export function canEditCustomer(user: AdminUser | null | undefined): boolean {
  return hasRole(user, 'sales')
}

export const useCurrentUser = () => useUserStore(state => state.user)
