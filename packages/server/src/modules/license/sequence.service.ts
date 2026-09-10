import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { EntityManager, Repository } from 'typeorm'
import { SequenceEntity } from './sequence.entity'

@Injectable()
export class SequenceService {
  constructor(
    @InjectRepository(SequenceEntity)
    private readonly repo: Repository<SequenceEntity>,
  ) {}

  /**
   * 取下一个序号。
   *
   * 必须在事务里跑：`SELECT ... FOR UPDATE` 的行锁只在事务内有效，而 TypeORM
   * 的 EntityManager.query 每次可能从连接池里换一条连接。传进来 manager 时
   * 复用调用方的事务，否则自己开一个。
   */
  async next(name: string, manager?: EntityManager): Promise<number> {
    if (manager) {
      return this.allocate(name, manager)
    }
    return this.repo.manager.transaction(trx => this.allocate(name, trx))
  }

  /**
   * 用一条 UPDATE 完成「读取 + 自增」，靠 `LAST_INSERT_ID(expr)` 把新值带回来。
   *
   * 这里**不能**先 `INSERT IGNORE` 再 `SELECT ... FOR UPDATE`：命中重复键时
   * InnoDB 会为 INSERT IGNORE 加共享锁，两个并发事务各持一把共享锁、又都想
   * 升级成排他锁，必然死锁。真库并发冒烟就是这么炸的，单测用 mock 仓储跑不到。
   *
   * 现在的写法只取排他锁，并发只会排队等待，不会互相咬死。
   */
  private async allocate(name: string, trx: EntityManager): Promise<number> {
    const allocated = await this.increment(name, trx)
    if (allocated !== null) return allocated

    // 序列按年分桶，新年度第一次签发时这行还不存在。
    // 新行的插入只加记录锁，不存在共享锁升级的问题。
    try {
      await trx.query('INSERT INTO lc_sequence (name, next_value) VALUES (?, 2)', [name])
      return 1
    } catch (error) {
      if (!isDuplicateKey(error)) throw error

      // 跨年瞬间的并发：另一个事务刚建好这行，再自增一次即可
      const retried = await this.increment(name, trx)
      if (retried === null) throw error
      return retried
    }
  }

  private async increment(name: string, trx: EntityManager): Promise<number | null> {
    const result = await trx.query(
      'UPDATE lc_sequence SET next_value = LAST_INSERT_ID(next_value + 1) WHERE name = ?',
      [name],
    )
    if (!result || result.affectedRows === 0) return null

    // LAST_INSERT_ID 里存的是自增后的值，本次分配到的是它减一。
    // 连接由事务钉住，读到的必然是本事务刚写入的那个值。
    const [row] = await trx.query('SELECT LAST_INSERT_ID() AS v')
    return Number(row.v) - 1
  }

  /** 正式授权编号：LIC-2026-0007 */
  async nextLicenseNo(manager?: EntityManager): Promise<string> {
    const year = new Date().getUTCFullYear()
    const seq = await this.next(`LIC-${year}`, manager)
    return `LIC-${year}-${String(seq).padStart(4, '0')}`
  }

  /** 试用授权编号：TRL-2026-004213。位数留宽，试用注册量级远大于正式签发 */
  async nextTrialNo(manager?: EntityManager): Promise<string> {
    const year = new Date().getUTCFullYear()
    const seq = await this.next(`TRL-${year}`, manager)
    return `TRL-${year}-${String(seq).padStart(6, '0')}`
  }
}

function isDuplicateKey(error: unknown): boolean {
  return (error as { code?: string })?.code === 'ER_DUP_ENTRY'
}
