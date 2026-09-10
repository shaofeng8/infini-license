import { ConfigType, registerAs } from '@nestjs/config'

export const securityRegToken = 'security'

export const SecurityConfig = registerAs(securityRegToken, () => ({
  /** 加密 lc_signing_key.private_key_cipher 与 lc_instance.secret_cipher，base64 的 32 字节 */
  masterKey: process.env.LICENSE_MASTER_KEY ?? '',
  jwtSecret: process.env.JWT_SECRET ?? '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  /**
   * 单次签发的最长有效期（天）。0 或负数 = 不限制，由签发人自行判断。
   * 无远程吊销通道，签得越长越失控，但超长期签发确有商务场景，
   * 因此这里默认不拦，只在超过 longTermWarnDays 时记警告与审计标记。
   */
  maxTermDays: Number(process.env.LICENSE_MAX_TERM_DAYS ?? 0),
  /** 超过这个天数的签发会留下告警痕迹，方便事后审计 */
  longTermWarnDays: Number(process.env.LICENSE_LONG_TERM_WARN_DAYS ?? 760),
  /** 登录失败锁定 */
  maxFailedAttempts: Number(process.env.LOGIN_MAX_FAILED_ATTEMPTS ?? 5),
  lockMinutes: Number(process.env.LOGIN_LOCK_MINUTES ?? 15),
  bootstrapAdminUsername: process.env.BOOTSTRAP_ADMIN_USERNAME ?? 'admin',
  bootstrapAdminPassword: process.env.BOOTSTRAP_ADMIN_PASSWORD ?? '',
}))

export type ISecurityConfig = ConfigType<typeof SecurityConfig>
