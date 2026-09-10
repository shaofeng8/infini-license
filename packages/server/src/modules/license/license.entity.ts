import { Column, Entity } from 'typeorm'
import {
  bigintNumberTransformer,
  decimalNumberTransformer,
  TimestampedEntity,
} from '@/common/entity/common.entity'

export type LicenseType = 'formal' | 'trial'
export type LicenseStatus = 'pending' | 'active' | 'expired' | 'void'
export type QuotaPeriod = 'total' | 'monthly'
export type BindMode = 'tofu' | 'none'

/** 限额入参的公共形状，签发与续期共用 */
export interface LicenseLimitsPatch {
  maxUsers?: number | null
  maxConcurrentTasks?: number | null
  tokenQuota?: number | null
  tokenQuotaPeriod?: QuotaPeriod
  taskQuota?: number | null
  taskQuotaPeriod?: QuotaPeriod
  overLimitRatio?: number
}

@Entity('lc_license')
export class LicenseEntity extends TimestampedEntity {
  @Column({ name: 'license_no', length: 32, unique: true })
  licenseNo: string

  @Column({ name: 'customer_id', length: 24 })
  customerId: string

  @Column({ length: 16, default: 'formal' })
  type: LicenseType

  @Column({ length: 32, default: 'infinisynapse' })
  product: string

  @Column({ length: 32, default: 'enterprise' })
  edition: string

  /**
   * 由 start_at / end_at 派生并缓存，仅供列表筛选与索引使用。
   * 正式客户零上报，我方无从得知授权在客户环境里是否真的在跑，
   * 因此这里没有「已激活」这种状态。任何判断都应直接比日期。
   */
  @Column({ length: 16, default: 'pending' })
  status: LicenseStatus

  @Column({ name: 'start_at', type: 'datetime', precision: 3 })
  startAt: Date

  /** NULL = 永久授权 */
  @Column({ name: 'end_at', type: 'datetime', precision: 3, nullable: true })
  endAt: Date | null

  @Column({ name: 'warn_days', default: 15 })
  warnDays: number

  // -- 限额：NULL 一律表示不限制 -------------------------------------------

  @Column({ name: 'max_users', nullable: true })
  maxUsers: number | null

  @Column({ name: 'max_concurrent_tasks', nullable: true })
  maxConcurrentTasks: number | null

  @Column({
    name: 'token_quota',
    type: 'bigint',
    nullable: true,
    transformer: bigintNumberTransformer,
  })
  tokenQuota: number | null

  @Column({ name: 'token_quota_period', length: 16, nullable: true })
  tokenQuotaPeriod: QuotaPeriod | null

  @Column({ name: 'task_quota', type: 'bigint', nullable: true, transformer: bigintNumberTransformer })
  taskQuota: number | null

  @Column({ name: 'task_quota_period', length: 16, nullable: true })
  taskQuotaPeriod: QuotaPeriod | null

  /** 用量超限的软阈值倍数，超过这个比例才真正拦截写操作 */
  @Column({
    name: 'over_limit_ratio',
    type: 'decimal',
    precision: 4,
    scale: 2,
    default: 1.1,
    transformer: decimalNumberTransformer,
  })
  overLimitRatio: number

  /** NULL = 全功能 */
  @Column({ name: 'features_json', type: 'json', nullable: true })
  featuresJson: string[] | null

  // -- 绑定与上报 -----------------------------------------------------------

  @Column({ name: 'bind_mode', length: 16, default: 'tofu' })
  bindMode: BindMode

  /** 仅试用模式能实际执行；正式模式零上报，无从统计实例数 */
  @Column({ name: 'max_instances', default: 1 })
  maxInstances: number

  /** formal 恒为 false，trial 恒为 true */
  @Column({ name: 'telemetry_enabled', type: 'tinyint', width: 1, default: 0 })
  telemetryEnabled: boolean

  // -- 生命周期关联 ---------------------------------------------------------

  @Column({ name: 'renewed_at', type: 'datetime', precision: 3, nullable: true })
  renewedAt: Date | null

  @Column({ name: 'renew_count', default: 0 })
  renewCount: number

  /** 仅换合同主体/产品线时使用；普通续期在原记录上延期，不新建 */
  @Column({ name: 'renewed_from_id', length: 24, nullable: true })
  renewedFromId: string | null

  @Column({ name: 'converted_from_id', length: 24, nullable: true })
  convertedFromId: string | null

  @Column({ name: 'contract_no', length: 64, nullable: true })
  contractNo: string | null

  @Column({ type: 'text', nullable: true })
  remark: string | null

  @Column({ name: 'created_by', length: 24, nullable: true })
  createdBy: string | null
}
