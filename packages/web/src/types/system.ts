import type { PageQuery } from './base'

// -- 签名密钥 ---------------------------------------------------------------

export type SigningKeyStatus = 'active' | 'retiring' | 'retired'

export interface SigningKey {
  _id: string
  kid: string
  algorithm: string
  publicKey: string
  status: SigningKeyStatus
  /**
   * 从哪个客户端版本起内置了这把公钥。
   *
   * 离线客户端拿不到新公钥，用比它更新的 kid 签出来的凭证在它那里必然验签
   * 失败，而且失败现场是在客户内网里，我们看不到。签发页要拿这个字段做警告。
   */
  clientSince: string | null
  remark: string | null
  activatedAt: string
  retiredAt: string | null
  createdAt: string
}

export interface CreateSigningKeyPayload {
  clientSince?: string
  remark?: string
  /**
   * 默认 **false**：只生成、不接管签发。
   *
   * 传 true 会让新签发的凭证立刻改用这把密钥，而客户端内置的公钥清单是
   * 随版本发出去的 —— 离线客户没有新公钥，所有新发和续期的凭证在他们
   * 那里都会验不过。正确顺序是：生成 → 公钥进客户端版本 → 铺到客户 →
   * 再回来 activate。
   */
  activate?: boolean
}

export interface CreateSigningKeyResult {
  kid: string
  publicKey: string
  status: SigningKeyStatus
}

export const SIGNING_KEY_STATUS_LABEL: Record<SigningKeyStatus, string> = {
  active: '当前签发',
  retiring: '停用中',
  retired: '已停用',
}

export const SIGNING_KEY_STATUS_COLOR: Record<SigningKeyStatus, string> = {
  active: 'var(--lc-color-success)',
  retiring: 'var(--lc-color-warning)',
  retired: 'var(--lc-color-neutral)',
}

// -- 审计日志 ---------------------------------------------------------------

export interface AuditLog {
  _id: string
  actorId: string | null
  actorName: string | null
  action: string
  targetType: string | null
  targetId: string | null
  summary: string | null
  detailJson: Record<string, unknown> | null
  ip: string | null
  createdAt: string
}

export interface AuditQuery extends PageQuery {
  action?: string
  actorId?: string
  targetId?: string
}

/** 与 server 里实际出现的 `action` 取值一一对应，共 16 种 */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  'admin.login': '登录',
  'admin.locked': '账号锁定',
  'admin.create_user': '创建账号',
  'admin.set_status': '启停账号',
  'admin.change_password': '修改密码',
  'admin.reset_password': '重置密码',
  'customer.create': '新建客户',
  'customer.update': '编辑客户',
  'license.issue': '签发授权',
  'license.renew': '续期',
  'license.reissue': '补发凭证',
  'license.void': '作废授权',
  'credential.download': '下载凭证',
  'signing_key.create': '生成密钥',
  'signing_key.activate': '启用密钥',
  'signing_key.retire': '停用密钥',
}

/**
 * 需要在审计列表里高亮的动作。
 *
 * `credential.download` 是设计文档点名要求高亮的：license.key 一旦流出就无法
 * 收回，这行记录是事后追责唯一的锚点。`admin.locked` 一并高亮，因为它往往是
 * 暴力破解的信号而不是同事忘了密码。
 */
export const AUDIT_HIGHLIGHT_ACTIONS = new Set([
  'credential.download',
  'admin.locked',
])
