import { Injectable, Logger } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'

/** nonce 有效期，与时间戳容忍窗口一致 —— 超出窗口的请求已被时间戳检查拦掉 */
export const NONCE_TTL_SEC = 300

@Injectable()
export class NonceService {
  private readonly logger = new Logger(NonceService.name)

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * 记录一个 nonce，返回它是否是首次出现。
   *
   * 靠主键冲突判重放，而不是「先查再插」—— 后者在并发下有窗口期，同一个
   * nonce 的两个并发请求可能都查不到、都通过。插入冲突由数据库保证原子性。
   */
  async claim(instanceId: string, nonce: string): Promise<boolean> {
    const expiresAt = new Date(Date.now() + NONCE_TTL_SEC * 1000)

    try {
      await this.dataSource.query(
        'INSERT INTO lc_replay_nonce (instance_id, nonce, expires_at) VALUES (?, ?, ?)',
        [instanceId, nonce, expiresAt],
      )
      return true
    } catch (error) {
      if (isDuplicateKey(error)) return false

      // 数据库故障时放行而不是拒绝：防重放是纵深防御的一层，签名校验才是主
      // 防线。因为这张辅助表写不进去就把客户的上报全部拒掉，代价过大。
      this.logger.error(`nonce 写入失败，本次跳过防重放检查：${describe(error)}`)
      return true
    }
  }

  /** 清理过期记录。不清理会让表无限增长 */
  async purgeExpired(): Promise<number> {
    const result = await this.dataSource.query(
      'DELETE FROM lc_replay_nonce WHERE expires_at < NOW(3) LIMIT 10000',
    )
    return result?.affectedRows ?? 0
  }
}

function isDuplicateKey(error: unknown): boolean {
  return (error as { code?: string })?.code === 'ER_DUP_ENTRY'
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
