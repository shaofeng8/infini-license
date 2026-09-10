import type { PageQuery } from './base'

export type CustomerSource = 'manual' | 'trial_auto'
export type CustomerStage = 'lead' | 'trial' | 'customer' | 'churned'

export interface Customer {
  _id: string
  name: string
  shortName: string | null
  source: CustomerSource
  stage: CustomerStage
  contactName: string | null
  contactPhone: string | null
  contactEmail: string | null
  industry: string | null
  region: string | null
  salesOwner: string | null
  remark: string | null
  /** 1 正常 / 0 停用 */
  status: number
  createdAt: string
  updatedAt: string
}

export interface CustomerPayload {
  name: string
  shortName?: string
  stage?: CustomerStage
  contactName?: string
  contactPhone?: string
  contactEmail?: string
  industry?: string
  region?: string
  salesOwner?: string
  remark?: string
  /** 仅编辑时可传 */
  status?: number
}

export interface CustomerQuery extends PageQuery {
  keyword?: string
  stage?: CustomerStage
  source?: CustomerSource
  status?: number
}

export const CUSTOMER_STAGE_LABEL: Record<CustomerStage, string> = {
  lead: '线索',
  trial: '试用中',
  customer: '已成交',
  churned: '已流失',
}

/**
 * 阶段配色。
 *
 * 「已成交」用成功绿、「试用中」用试用蓝，与授权列表里的类型色条同色系 ——
 * 运营在两个页面之间跳，同一个概念换个颜色就得重新建立映射。
 */
export const CUSTOMER_STAGE_COLOR: Record<CustomerStage, string> = {
  lead: 'var(--lc-color-neutral)',
  trial: 'var(--lc-color-trial)',
  customer: 'var(--lc-color-success)',
  churned: 'var(--lc-color-danger)',
}

export const CUSTOMER_SOURCE_LABEL: Record<CustomerSource, string> = {
  manual: '运营录入',
  trial_auto: '试用自动',
}
