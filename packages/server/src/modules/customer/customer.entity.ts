import { Column, Entity } from 'typeorm'
import { TimestampedEntity } from '@/common/entity/common.entity'

export type CustomerSource = 'manual' | 'trial_auto'
export type CustomerStage = 'lead' | 'trial' | 'customer' | 'churned'

@Entity('lc_customer')
export class CustomerEntity extends TimestampedEntity {
  @Column({ length: 255 })
  name: string

  @Column({ name: 'short_name', length: 64, nullable: true })
  shortName: string | null

  /**
   * 客户名不设唯一索引：试用注册会自动建客户，同一家公司多个部门各自试用时
   * 会撞名，硬约束只会让注册失败。重名由后台的合并操作人工收拾。
   */
  @Column({ length: 16, default: 'manual' })
  source: CustomerSource

  @Column({ length: 16, default: 'lead' })
  stage: CustomerStage

  @Column({ name: 'contact_name', length: 64, nullable: true })
  contactName: string | null

  @Column({ name: 'contact_phone', length: 32, nullable: true })
  contactPhone: string | null

  @Column({ name: 'contact_email', length: 128, nullable: true })
  contactEmail: string | null

  @Column({ length: 64, nullable: true })
  industry: string | null

  @Column({ length: 64, nullable: true })
  region: string | null

  @Column({ name: 'sales_owner', length: 64, nullable: true })
  salesOwner: string | null

  @Column({ type: 'text', nullable: true })
  remark: string | null

  @Column({ type: 'tinyint', default: 1 })
  status: number
}
