import { Column, Entity } from 'typeorm'
import { TimestampedEntity } from '@/common/entity/common.entity'

/**
 * 后台角色。四级足够覆盖内部使用，不引入 Casbin 那套动态权限 ——
 * 这个后台的使用者只有我们自己十来个人，规则写死在代码里更容易审计。
 */
export enum AdminRole {
  /** 全部权限，含密钥管理与账号管理 */
  OWNER = 'owner',
  /** 签发、续期、重发凭证 */
  OPS = 'ops',
  /** 客户与授权的读写，不能签发 */
  SALES = 'sales',
  /** 只读 */
  VIEWER = 'viewer',
}

/** 数值越大权限越高，用于 RolesGuard 的门槛比较 */
export const ROLE_LEVEL: Record<AdminRole, number> = {
  [AdminRole.VIEWER]: 1,
  [AdminRole.SALES]: 2,
  [AdminRole.OPS]: 3,
  [AdminRole.OWNER]: 4,
}

@Entity('lc_admin_user')
export class AdminUserEntity extends TimestampedEntity {
  @Column({ length: 64, unique: true })
  username: string

  @Column({ name: 'password_hash', length: 255, select: false })
  passwordHash: string

  @Column({ name: 'real_name', length: 64, nullable: true })
  realName: string | null

  @Column({ length: 16, default: AdminRole.VIEWER })
  role: AdminRole

  @Column({ type: 'tinyint', default: 1 })
  status: number

  @Column({ name: 'failed_attempts', default: 0 })
  failedAttempts: number

  @Column({ name: 'locked_until', type: 'datetime', precision: 3, nullable: true })
  lockedUntil: Date | null

  @Column({ name: 'last_login_at', type: 'datetime', precision: 3, nullable: true })
  lastLoginAt: Date | null

  @Column({ name: 'last_login_ip', length: 64, nullable: true })
  lastLoginIp: string | null
}
