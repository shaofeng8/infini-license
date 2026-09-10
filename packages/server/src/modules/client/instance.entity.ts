import { Column, Entity } from 'typeorm'
import { TimestampedEntity } from '@/common/entity/common.entity'

export type InstanceStatus = 'active' | 'converted' | 'expired'

@Entity('lc_instance')
export class InstanceEntity extends TimestampedEntity {
  @Column({ name: 'license_id', length: 24 })
  licenseId: string

  @Column({ name: 'customer_id', length: 24 })
  customerId: string

  /** 唯一索引。同一套部署重复注册会命中它，从而不重置试用期 */
  @Column({ length: 64, unique: true })
  fingerprint: string

  @Column({ name: 'install_id', length: 36 })
  installId: string

  /** 指纹变了但主机没变时用它识别疑似重装 */
  @Column({ name: 'host_signal_hash', length: 64, nullable: true })
  hostSignalHash: string | null

  @Column({ name: 'db_signal', length: 64, nullable: true })
  dbSignal: string | null

  /** 用于快速比对，不可逆 */
  @Column({ name: 'secret_hash', length: 64 })
  secretHash: string

  /**
   * secret 的密文备份。重复注册要返回同一个 secret，所以不能只存哈希 ——
   * 客户端可能在拿到 secret 后就崩溃了，没能持久化下来。
   */
  @Column({ name: 'secret_cipher', type: 'varbinary', length: 512 })
  secretCipher: Buffer

  @Column({ length: 16, default: 'active' })
  status: InstanceStatus

  /** 首次注册时间。**重复注册绝不更新这个字段**，这是防重置的核心 */
  @Column({ name: 'trial_started_at', type: 'datetime', precision: 3 })
  trialStartedAt: Date

  @Column({ name: 'suspected_reset', type: 'tinyint', width: 1, default: 0 })
  suspectedReset: boolean

  @Column({ name: 'reuse_count', default: 0 })
  reuseCount: number

  @Column({ name: 'drift_count', default: 0 })
  driftCount: number

  @Column({ name: 'product_version', length: 32, nullable: true })
  productVersion: string | null

  @Column({ name: 'host_name', length: 128, nullable: true })
  hostName: string | null

  @Column({ name: 'os_info', length: 64, nullable: true })
  osInfo: string | null

  @Column({ name: 'cpu_cores', nullable: true })
  cpuCores: number | null

  @Column({ name: 'deploy_kind', length: 32, nullable: true })
  deployKind: string | null

  @Column({ name: 'last_ip', length: 64, nullable: true })
  lastIp: string | null

  @Column({ name: 'last_heartbeat_at', type: 'datetime', precision: 3, nullable: true })
  lastHeartbeatAt: Date | null

  @Column({ name: 'last_usage_at', type: 'datetime', precision: 3, nullable: true })
  lastUsageAt: Date | null
}
