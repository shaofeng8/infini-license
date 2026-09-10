/**
 * 四种角色，与 server 的 `AdminRole` 逐字对应。
 *
 * 顺序有意义：后端 `RolesGuard` 是按等级比较（`ROLE_LEVEL[user] >= ROLE_LEVEL[required]`）
 * 而不是精确匹配，前端的菜单过滤与按钮禁用必须用同一套等级，否则会出现
 * 「界面上能点、后端 403」或者反过来「后端允许但界面藏了」。
 */
export type AdminRole = 'owner' | 'ops' | 'sales' | 'viewer'

export const ROLE_LEVEL: Record<AdminRole, number> = {
  viewer: 1,
  sales: 2,
  ops: 3,
  owner: 4,
}

export const ROLE_LABEL: Record<AdminRole, string> = {
  owner: '超级管理员',
  ops: '运维',
  sales: '销售',
  viewer: '只读',
}

export const ROLE_DESC: Record<AdminRole, string> = {
  owner: '全部权限，含签名密钥与账号管理',
  ops: '可签发、续期、补发凭证',
  sales: '可读写客户，不能签发',
  viewer: '只读',
}

export interface AdminUser {
  id: string
  username: string
  realName: string | null
  role: AdminRole
}

export interface LoginRequest {
  username: string
  password: string
}

/** 注意字段是 `accessToken` 而非 `token` */
export interface LoginResponse {
  accessToken: string
  /** **秒**，不是毫秒（server 的 `parseDuration` 返回秒）。存本地过期时间戳时要 ×1000 */
  expiresIn: number
  user: AdminUser
}

export interface ChangePasswordRequest {
  oldPassword: string
  newPassword: string
}

/**
 * 账号列表项。
 *
 * 主键是 `_id` 而不是 `id`：`GET /auth/users` 直接返回 TypeORM 实体，序列化后
 * 带的是列名 `_id`。只有 `POST /auth/login` 的 `user` 是手工映射过的 DTO，那里
 * 才叫 `id`。两个名字都得留着，别在其中一处「统一」掉。
 *
 * `status` 是 tinyint 数字（1 启用 / 0 停用），不是字符串枚举。
 */
export interface AdminUserListItem {
  _id: string
  username: string
  realName: string | null
  role: AdminRole
  status: number
  failedAttempts: number
  lockedUntil: string | null
  lastLoginAt: string | null
  lastLoginIp: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateAdminUserRequest {
  username: string
  password: string
  realName?: string
  role: AdminRole
}

/**
 * 后端 `assertPasswordStrength`：至少 12 位，且含大小写字母与数字。
 * 前端表单用同一条规则做即时校验，省掉一次往返才知道密码太弱。
 */
export const PASSWORD_RULE = {
  minLength: 12,
  pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{12,128}$/,
  hint: '至少 12 位，需同时包含大写字母、小写字母和数字',
} as const
