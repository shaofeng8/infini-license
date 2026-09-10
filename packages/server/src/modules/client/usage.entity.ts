import { Column, Entity } from 'typeorm'
import { bigintNumberTransformer, DocumentEntity } from '@/common/entity/common.entity'

@Entity('lc_heartbeat')
export class HeartbeatEntity extends DocumentEntity {
  @Column({ name: 'instance_id', length: 24 })
  instanceId: string

  @Column({ name: 'license_id', length: 24 })
  licenseId: string

  @Column({
    name: 'received_at',
    type: 'datetime',
    precision: 3,
    default: () => 'CURRENT_TIMESTAMP(3)',
  })
  receivedAt: Date

  @Column({ name: 'client_time', type: 'datetime', precision: 3, nullable: true })
  clientTime: Date | null

  /** 客户端时钟与服务端的偏差。持续偏大是「客户在调时钟」的早期信号 */
  @Column({ name: 'clock_skew_sec', nullable: true })
  clockSkewSec: number | null

  @Column({ name: 'product_version', length: 32, nullable: true })
  productVersion: string | null

  @Column({ name: 'local_state', length: 24, nullable: true })
  localState: string | null

  @Column({ name: 'local_user_count', nullable: true })
  localUserCount: number | null

  @Column({ name: 'local_counters', type: 'json', nullable: true })
  localCounters: Record<string, unknown> | null

  @Column({ length: 64, nullable: true })
  ip: string | null
}

@Entity('lc_usage_batch')
export class UsageBatchEntity extends DocumentEntity {
  /** 客户端生成，与 instance_id 组成唯一索引，是幂等的判据 */
  @Column({ name: 'batch_id', length: 36 })
  batchId: string

  @Column({ name: 'instance_id', length: 24 })
  instanceId: string

  @Column({ name: 'license_id', length: 24 })
  licenseId: string

  @Column({ length: 16 })
  source: 'app' | 'proxy'

  @Column({ name: 'window_start', type: 'datetime', precision: 3 })
  windowStart: Date

  @Column({ name: 'window_end', type: 'datetime', precision: 3 })
  windowEnd: Date

  @Column({ name: 'task_count', default: 0 })
  taskCount: number

  @Column({ name: 'input_tokens', type: 'bigint', default: 0, transformer: bigintNumberTransformer })
  inputTokens: number

  @Column({
    name: 'output_tokens',
    type: 'bigint',
    default: 0,
    transformer: bigintNumberTransformer,
  })
  outputTokens: number

  @Column({
    name: 'cache_read_tokens',
    type: 'bigint',
    default: 0,
    transformer: bigintNumberTransformer,
  })
  cacheReadTokens: number

  @Column({ name: 'client_sent_at', type: 'datetime', precision: 3, nullable: true })
  clientSentAt: Date | null

  @Column({
    name: 'received_at',
    type: 'datetime',
    precision: 3,
    default: () => 'CURRENT_TIMESTAMP(3)',
  })
  receivedAt: Date

  @Column({ length: 64, nullable: true })
  anomaly: string | null
}

@Entity('lc_usage_task')
export class UsageTaskEntity extends DocumentEntity {
  @Column({ name: 'license_id', length: 24 })
  licenseId: string

  @Column({ name: 'instance_id', length: 24 })
  instanceId: string

  @Column({ name: 'task_id', length: 255 })
  taskId: string

  @Column({ name: 'parent_task_id', length: 255, nullable: true })
  parentTaskId: string | null

  /** 客户侧加盐哈希出来的假名，我方无法反推真实用户 */
  @Column({ name: 'user_ref', length: 64 })
  userRef: string

  @Column({ length: 16, default: 'app' })
  source: string

  @Column({ length: 24, nullable: true })
  status: string | null

  @Column({ name: 'started_at', type: 'datetime', precision: 3, nullable: true })
  startedAt: Date | null

  @Column({ name: 'finished_at', type: 'datetime', precision: 3, nullable: true })
  finishedAt: Date | null

  @Column({ name: 'duration_ms', nullable: true })
  durationMs: number | null

  @Column({ name: 'input_tokens', type: 'bigint', default: 0, transformer: bigintNumberTransformer })
  inputTokens: number

  @Column({
    name: 'output_tokens',
    type: 'bigint',
    default: 0,
    transformer: bigintNumberTransformer,
  })
  outputTokens: number

  @Column({
    name: 'cache_read_tokens',
    type: 'bigint',
    default: 0,
    transformer: bigintNumberTransformer,
  })
  cacheReadTokens: number

  @Column({
    name: 'cache_write_tokens',
    type: 'bigint',
    default: 0,
    transformer: bigintNumberTransformer,
  })
  cacheWriteTokens: number

  @Column({ name: 'llm_call_count', default: 0 })
  llmCallCount: number

  @Column({ name: 'stat_date', type: 'date' })
  statDate: string

  @Column({
    name: 'first_seen_at',
    type: 'datetime',
    precision: 3,
    default: () => 'CURRENT_TIMESTAMP(3)',
  })
  firstSeenAt: Date

  @Column({
    name: 'last_seen_at',
    type: 'datetime',
    precision: 3,
    default: () => 'CURRENT_TIMESTAMP(3)',
  })
  lastSeenAt: Date
}

@Entity('lc_usage_daily')
export class UsageDailyEntity extends DocumentEntity {
  @Column({ name: 'license_id', length: 24 })
  licenseId: string

  @Column({ name: 'instance_id', length: 24 })
  instanceId: string

  @Column({ name: 'stat_date', type: 'date' })
  statDate: string

  @Column({ name: 'task_count', default: 0 })
  taskCount: number

  @Column({ name: 'task_success_count', default: 0 })
  taskSuccessCount: number

  @Column({ name: 'task_failed_count', default: 0 })
  taskFailedCount: number

  @Column({ name: 'active_user_count', default: 0 })
  activeUserCount: number

  @Column({ name: 'new_user_count', default: 0 })
  newUserCount: number

  @Column({ name: 'input_tokens', type: 'bigint', default: 0, transformer: bigintNumberTransformer })
  inputTokens: number

  @Column({
    name: 'output_tokens',
    type: 'bigint',
    default: 0,
    transformer: bigintNumberTransformer,
  })
  outputTokens: number

  @Column({
    name: 'cache_read_tokens',
    type: 'bigint',
    default: 0,
    transformer: bigintNumberTransformer,
  })
  cacheReadTokens: number

  @Column({ name: 'total_tokens', type: 'bigint', default: 0, transformer: bigintNumberTransformer })
  totalTokens: number

  @Column({
    name: 'llm_call_count',
    type: 'bigint',
    default: 0,
    transformer: bigintNumberTransformer,
  })
  llmCallCount: number

  @Column({
    name: 'proxy_input_tokens',
    type: 'bigint',
    default: 0,
    transformer: bigintNumberTransformer,
  })
  proxyInputTokens: number

  @Column({
    name: 'proxy_output_tokens',
    type: 'bigint',
    default: 0,
    transformer: bigintNumberTransformer,
  })
  proxyOutputTokens: number

  @Column({
    name: 'updated_at',
    type: 'datetime',
    precision: 3,
    default: () => 'CURRENT_TIMESTAMP(3)',
  })
  updatedAt: Date
}

@Entity('lc_user_ref')
export class UserRefEntity extends DocumentEntity {
  @Column({ name: 'license_id', length: 24 })
  licenseId: string

  @Column({ name: 'instance_id', length: 24 })
  instanceId: string

  @Column({ name: 'user_ref', length: 64 })
  userRef: string

  @Column({ name: 'first_seen_at', type: 'datetime', precision: 3 })
  firstSeenAt: Date

  @Column({ name: 'last_seen_at', type: 'datetime', precision: 3 })
  lastSeenAt: Date

  @Column({ name: 'task_count', type: 'bigint', default: 0, transformer: bigintNumberTransformer })
  taskCount: number

  @Column({ name: 'total_tokens', type: 'bigint', default: 0, transformer: bigintNumberTransformer })
  totalTokens: number
}
