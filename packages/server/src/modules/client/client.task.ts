import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import { NonceService } from './nonce.service'
import { RateLimitService } from './rate-limit.service'

/** 心跳日志保留天数。只用于排查客户报障，不需要长期留存 */
const HEARTBEAT_RETENTION_DAYS = 90

@Injectable()
export class ClientTask {
  private readonly logger = new Logger(ClientTask.name)

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly nonce: NonceService,
    private readonly rateLimit: RateLimitService,
  ) {}

  /**
   * 清理防重放与限流的过期记录。
   *
   * 这两张表写入频繁、只在很短的窗口内有用，不清理会无限增长。清理跑得比
   * 窗口长度密一些即可，没必要精确。
   */
  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'client-ephemeral-purge' })
  async purgeEphemeral(): Promise<void> {
    try {
      const [nonces, buckets] = await Promise.all([
        this.nonce.purgeExpired(),
        this.rateLimit.purgeExpired(),
      ])
      if (nonces + buckets > 0) {
        this.logger.debug(`清理过期记录：nonce ${nonces} 条，限流桶 ${buckets} 条`)
      }
    } catch (error) {
      this.logger.error(`清理过期记录失败：${describe(error)}`)
    }
  }

  /** 清理心跳日志。用 LIMIT 分批，避免一次删太多锁表 */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'heartbeat-purge' })
  async purgeHeartbeats(): Promise<void> {
    try {
      let total = 0
      for (let batch = 0; batch < 50; batch += 1) {
        const result = await this.dataSource.query(
          'DELETE FROM lc_heartbeat WHERE received_at < DATE_SUB(NOW(3), INTERVAL ? DAY) LIMIT 5000',
          [HEARTBEAT_RETENTION_DAYS],
        )
        const deleted = result?.affectedRows ?? 0
        total += deleted
        if (deleted === 0) break
      }
      if (total > 0) {
        this.logger.log(`清理心跳日志 ${total} 条`)
      }
    } catch (error) {
      this.logger.error(`清理心跳日志失败：${describe(error)}`)
    }
  }

  /**
   * 标记失联与到期的试用实例。
   *
   * 试用客户断网是常态，失联不代表出问题，所以只更新状态供运营参考，
   * 不做任何自动处置。
   */
  @Cron(CronExpression.EVERY_HOUR, { name: 'instance-status-refresh' })
  async refreshInstanceStatus(): Promise<void> {
    try {
      const result = await this.dataSource.query(
        `UPDATE lc_instance i
            JOIN lc_license l ON l._id = i.license_id
           SET i.status = 'expired'
         WHERE i.status = 'active'
           AND l.end_at IS NOT NULL
           AND l.end_at < NOW(3)`,
      )
      const affected = result?.affectedRows ?? 0
      if (affected > 0) {
        this.logger.log(`${affected} 个试用实例已到期`)
      }
    } catch (error) {
      this.logger.error(`刷新实例状态失败：${describe(error)}`)
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
