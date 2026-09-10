import type { PageQuery } from './base'

export type LicenseType = 'formal' | 'trial'
export type LicenseStatus = 'pending' | 'active' | 'expired' | 'void'
export type QuotaPeriod = 'total' | 'monthly'
export type BindMode = 'tofu' | 'none'

/** 凭证签发原因，与 server 的 `credential.entity.ts` 对齐 */
export type IssueReason = 'issue' | 'renew' | 'reissue' | 'convert' | 'extend'

/**
 * 授权实体。
 *
 * 所有限额字段的 `null` 一律表示**不限制**，不是 0、不是缺省。这是贯穿整个
 * 系统的语义，界面上必须显示成「不限制」而不是 `-` 或空白 —— 运维看到空白
 * 会去猜是「没配」还是「没读到」。
 */
export interface License {
  _id: string
  licenseNo: string
  customerId: string
  type: LicenseType
  product: string
  edition: string
  status: LicenseStatus
  startAt: string
  /** null = 永久授权 */
  endAt: string | null
  warnDays: number

  maxUsers: number | null
  maxConcurrentTasks: number | null
  tokenQuota: number | null
  tokenQuotaPeriod: QuotaPeriod | null
  taskQuota: number | null
  taskQuotaPeriod: QuotaPeriod | null
  overLimitRatio: number

  /** null = 全功能 */
  featuresJson: string[] | null

  bindMode: BindMode
  maxInstances: number
  telemetryEnabled: boolean

  renewedAt: string | null
  renewCount: number
  renewedFromId: string | null
  convertedFromId: string | null
  contractNo: string | null
  remark: string | null
  createdBy: string | null

  createdAt: string
  updatedAt: string
}

/** 列表与 expiring 接口在实体上额外拼的两个派生字段 */
export interface LicenseListItem extends License {
  customerName: string | null
  /** 永久授权为 null */
  remainingDays: number | null
}

export interface CredentialHistoryItem {
  id: string
  jti: string
  kid: string
  issueReason: IssueReason
  issuedAt: string
  validFrom: string
  validUntil: string | null
  checksum: string
  downloadCount: number
  lastDownloadAt: string | null
  /** `supersededBy === null`，即当前生效的那一份 */
  isCurrent: boolean
}

export interface LicenseDetail extends LicenseListItem {
  credentials: CredentialHistoryItem[]
}

/** 签发 / 续期成功后的返回体，`envelope` 就是 license.key 的完整文本 */
export interface IssueResult {
  licenseId: string
  credentialId: string
  licenseNo: string
  kid: string
  checksum: string
  validFrom: string
  validUntil: string | null
  envelope: string
}

export interface LicenseLimitsPayload {
  maxUsers?: number
  maxConcurrentTasks?: number
  tokenQuota?: number
  tokenQuotaPeriod?: QuotaPeriod
  taskQuota?: number
  taskQuotaPeriod?: QuotaPeriod
  overLimitRatio?: number
}

export interface IssueLicensePayload extends LicenseLimitsPayload {
  customerId: string
  product?: string
  edition?: string
  startAt: string
  /** 留空 = 永久授权 */
  endAt?: string
  warnDays?: number
  features?: string[]
  bindMode?: BindMode
  contractNo?: string
  remark?: string
  convertedFromId?: string
}

export interface RenewLicensePayload extends LicenseLimitsPayload {
  endAt: string
  warnDays?: number
  features?: string[]
  /** false 时后端忽略本次传的限额字段，保留原值 */
  updateLimits?: boolean
  contractNo?: string
  reason?: string
}

export interface LicenseQuery extends PageQuery {
  keyword?: string
  customerId?: string
  type?: LicenseType
  status?: LicenseStatus
  expiringInDays?: number
}

// -- 展示口径 ---------------------------------------------------------------

export const LICENSE_TYPE_LABEL: Record<LicenseType, string> = {
  formal: '正式',
  trial: '试用',
}

export const LICENSE_STATUS_LABEL: Record<LicenseStatus, string> = {
  pending: '已签发',
  active: '生效中',
  expired: '已过期',
  void: '已作废',
}

export const ISSUE_REASON_LABEL: Record<IssueReason, string> = {
  issue: '首次签发',
  renew: '续期',
  reissue: '补发',
  convert: '试用转正',
  extend: '试用延期',
}

export const QUOTA_PERIOD_LABEL: Record<QuotaPeriod, string> = {
  total: '累计',
  monthly: '每月',
}

/**
 * 凭证下载用途。
 *
 * 设计文档要求下载前必须选用途并写入审计 —— 这是全系统最敏感的操作，
 * 事后追查「这份 license.key 当初为什么被下载」只能靠这里的记录。
 */
export const DOWNLOAD_PURPOSES = [
  { value: 'delivery', label: '首次交付' },
  { value: 'renewal', label: '续期交付' },
  { value: 'lost', label: '客户丢失补发' },
  { value: 'internal', label: '内部测试' },
] as const

export type DownloadPurpose = (typeof DOWNLOAD_PURPOSES)[number]['value']
