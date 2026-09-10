import { Injectable, Logger } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'

export type WindowKind = 'hour' | 'day'

export interface RateLimitRule {
  /** 限流对象，例如 `ip:1.2.3.4` 或 `fp:3d9f...` */
  subject: string
  kind: WindowKind
  limit: number
}

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name)

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * 固定窗口计数，返回是否允许本次请求。
   *
   * 计数与读取分成两条语句，因此并发下读到的值可能偏大。这里刻意接受
   * 这个误差：限流器偏严一点无害，而为了精确去开事务钉住连接，会给每个
   * 请求加一次事务开销 —— 为一个近似就够用的计数器付这个代价不值得。
   */
  async consume(rule: RateLimitRule): Promise<boolean> {
    const bucket = `${rule.subject}:${windowKey(rule.kind, new Date())}`
    const expiresAt = new Date(Date.now() + windowSeconds(rule.kind) * 1000)

    try {
      await this.dataSource.query(
        `INSERT INTO lc_rate_limit (bucket, hits, expires_at) VALUES (?, 1, ?)
         ON DUPLICATE KEY UPDATE hits = hits + 1`,
        [bucket, expiresAt],
      )

      const [row] = await this.dataSource.query(
        'SELECT hits FROM lc_rate_limit WHERE bucket = ?',
        [bucket],
      )
      return Number(row?.hits ?? 0) <= rule.limit
    } catch (error) {
      // 与 nonce 同理：计数表故障时放行，不能让辅助设施决定客户能否上报
      this.logger.error(`限流计数失败，本次放行：${describe(error)}`)
      return true
    }
  }

  async purgeExpired(): Promise<number> {
    const result = await this.dataSource.query(
      'DELETE FROM lc_rate_limit WHERE expires_at < NOW(3) LIMIT 10000',
    )
    return result?.affectedRows ?? 0
  }
}

/** 窗口键用 UTC，避免服务端时区变更导致窗口错位 */
function windowKey(kind: WindowKind, at: Date): string {
  const iso = at.toISOString()
  const date = iso.slice(0, 10).replace(/-/g, '')
  return kind === 'hour' ? `h${date}${iso.slice(11, 13)}` : `d${date}`
}

function windowSeconds(kind: WindowKind): number {
  return kind === 'hour' ? 3600 : 86400
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
