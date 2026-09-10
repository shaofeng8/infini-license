import type {
  AdminUser,
  AdminUserListItem,
  ChangePasswordRequest,
  CreateAdminUserRequest,
  LoginRequest,
  LoginResponse,
} from '@/types/auth'
import alovaInstance from '@/utils/http'

export const authApi = {
  login: (data: LoginRequest) =>
    alovaInstance.Post<LoginResponse>('/auth/login', data, {
      meta: {
        // 登录页本来就没有 token，带上一个过期的反而会被守卫拦掉
        skipAuth: true,
        // 失败信息由登录表单以内联 Alert 呈现，不走全局 toast。
        // 「账号已锁定 15 分钟」这种提示必须留在视线内，toast 三秒就飘走了，
        // 用户还在重新输密码时它已经消失，只会以为是自己又打错了
        silent: true,
      },
    }),

  profile: () => alovaInstance.Get<AdminUser>('/auth/profile'),

  /** 注意是 PUT /auth/password，不是 POST /auth/changePassword */
  changePassword: (data: ChangePasswordRequest) =>
    alovaInstance.Put<null>('/auth/password', data),

  // -- 以下仅 owner 可用 ---------------------------------------------------

  listUsers: () => alovaInstance.Get<AdminUserListItem[]>('/auth/users'),

  createUser: (data: CreateAdminUserRequest) =>
    alovaInstance.Post<AdminUserListItem>('/auth/users', data),

  /** status: 1 启用 / 0 停用 */
  setUserStatus: (id: string, status: number) =>
    alovaInstance.Put<null>(`/auth/users/${id}/status`, { status }),

  resetUserPassword: (id: string, password: string) =>
    alovaInstance.Put<null>(`/auth/users/${id}/password`, { password }),
}
