import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, EntityManager, Repository } from 'typeorm'
import { createObjectId } from '@/common/entity/common.entity'
import { UsageDto, UsageTaskDto } from './client.dto'
import { InstanceEntity } from './instance.entity'

export interface UsageResult {
  accepted: boolean
  batchId: string
  duplicated: boolean
}

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name)

  constructor(
    @InjectRepository(InstanceEntity)
    private readonly instanceRepo: Repository<InstanceEntity>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * 接收一批用量。
   *
   * 幂等靠 `lc_usage_batch` 的 `(instance_id, batch_id)` 唯一索引：客户端
   * 网络超时后会重传同一个 batchId，重复到达时直接返回而不累加。这不是可选
   * 的优化 —— 客户环境网络不稳是常态，没有幂等，用量数据一定会被重复计入。
   */
  async ingest(instance: InstanceEntity, dto: UsageDto): Promise<UsageResult> {
    const totals = sumTasks(dto.tasks)

    return this.dataSource.transaction(async manager => {
      const fresh = await this.claimBatch(instance, dto, totals, manager)
      if (!fresh) {
        return { accepted: true, batchId: dto.batchId, duplicated: true }
      }

      const affectedDates = new Set<string>()

      for (const task of dto.tasks) {
        const statDate = resolveStatDate(task, dto.windowEnd)
        affectedDates.add(statDate)
        await this.upsertTask(instance, task, dto.source, statDate, manager)
        await this.upsertUserRef(instance, task, manager)
      }

      // 日聚合从明细重算而非累加。累加会在重传、乱序、批次跨天时算错，
      // 而重算的成本是一次按索引的聚合查询 —— 这个交换非常划算。
      for (const statDate of affectedDates) {
        await this.recomputeDaily(instance, statDate, manager)
      }

      await manager.update(
        InstanceEntity,
        { _id: instance._id },
        { lastUsageAt: new Date() },
      )

      return { accepted: true, batchId: dto.batchId, duplicated: false }
    })
  }

  /** 返回 false 表示这批已经收过 */
  private async claimBatch(
    instance: InstanceEntity,
    dto: UsageDto,
    totals: TaskTotals,
    manager: EntityManager,
  ): Promise<boolean> {
    const result = await manager.query(
      `INSERT IGNORE INTO lc_usage_batch
         (_id, batch_id, instance_id, license_id, source, window_start, window_end,
          task_count, input_tokens, output_tokens, cache_read_tokens, client_sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))`,
      [
        createObjectId(),
        dto.batchId,
        instance._id,
        instance.licenseId,
        dto.source,
        new Date(dto.windowStart),
        new Date(dto.windowEnd),
        dto.tasks.length,
        totals.inputTokens,
        totals.outputTokens,
        totals.cacheReadTokens,
      ],
    )

    // 这里用 INSERT IGNORE 是安全的：本事务后续不再对这一行取排他锁，
    // 不存在共享锁升级，因此没有 sequence.service 里那种死锁风险。
    return (result?.affectedRows ?? 0) > 0
  }

  /**
   * 明细按 `(instance_id, task_id)` upsert。
   *
   * token 用累加而非覆盖：一个长任务会跨多个上报窗口，每个窗口只带来增量。
   * 但 `status` 与 `finished_at` 用覆盖，它们描述的是任务的最终状态。
   */
  private async upsertTask(
    instance: InstanceEntity,
    task: UsageTaskDto,
    source: string,
    statDate: string,
    manager: EntityManager,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO lc_usage_task
         (_id, license_id, instance_id, task_id, parent_task_id, user_ref, source, status,
          started_at, finished_at, duration_ms, input_tokens, output_tokens,
          cache_read_tokens, cache_write_tokens, llm_call_count, stat_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         status             = VALUES(status),
         finished_at        = VALUES(finished_at),
         duration_ms        = VALUES(duration_ms),
         input_tokens       = input_tokens       + VALUES(input_tokens),
         output_tokens      = output_tokens      + VALUES(output_tokens),
         cache_read_tokens  = cache_read_tokens  + VALUES(cache_read_tokens),
         cache_write_tokens = cache_write_tokens + VALUES(cache_write_tokens),
         llm_call_count     = llm_call_count     + VALUES(llm_call_count)`,
      [
        createObjectId(),
        instance.licenseId,
        instance._id,
        task.taskId,
        task.parentTaskId ?? null,
        task.userRef,
        source,
        task.status ?? null,
        task.startedAt ? new Date(task.startedAt) : null,
        task.finishedAt ? new Date(task.finishedAt) : null,
        task.durationMs ?? null,
        task.inputTokens,
        task.outputTokens,
        task.cacheReadTokens ?? 0,
        task.cacheWriteTokens ?? 0,
        task.llmCallCount ?? 0,
        statDate,
      ],
    )
  }

  private async upsertUserRef(
    instance: InstanceEntity,
    task: UsageTaskDto,
    manager: EntityManager,
  ): Promise<void> {
    const tokens =
      task.inputTokens + task.outputTokens + (task.cacheReadTokens ?? 0)

    await manager.query(
      `INSERT INTO lc_user_ref
         (_id, license_id, instance_id, user_ref, first_seen_at, last_seen_at, task_count, total_tokens)
       VALUES (?, ?, ?, ?, NOW(3), NOW(3), 1, ?)
       ON DUPLICATE KEY UPDATE
         last_seen_at = NOW(3),
         total_tokens = total_tokens + VALUES(total_tokens)`,
      [createObjectId(), instance.licenseId, instance._id, task.userRef, tokens],
    )
  }

  /**
   * 从明细重算某一天的聚合。
   *
   * `active_user_count` 取当天出现过的 user_ref 去重数，`new_user_count` 取
   * 首次出现就在当天的那部分 —— 用 `lc_user_ref.first_seen_at` 判断而不是
   * 「当天最早」，否则历史用户在新的一天出现也会被算成新增。
   */
  private async recomputeDaily(
    instance: InstanceEntity,
    statDate: string,
    manager: EntityManager,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO lc_usage_daily
         (_id, license_id, instance_id, stat_date, task_count, task_success_count,
          task_failed_count, active_user_count, new_user_count, input_tokens,
          output_tokens, cache_read_tokens, total_tokens, llm_call_count)
       SELECT ?, ?, ?, ?,
              COUNT(*),
              SUM(status = 'completed'),
              SUM(status = 'failed'),
              COUNT(DISTINCT user_ref),
              (SELECT COUNT(*) FROM lc_user_ref r
                WHERE r.instance_id = ? AND DATE(r.first_seen_at) = ?),
              SUM(input_tokens),
              SUM(output_tokens),
              SUM(cache_read_tokens),
              SUM(input_tokens + output_tokens + cache_read_tokens),
              SUM(llm_call_count)
         FROM lc_usage_task
        WHERE instance_id = ? AND stat_date = ?
       ON DUPLICATE KEY UPDATE
         task_count         = VALUES(task_count),
         task_success_count = VALUES(task_success_count),
         task_failed_count  = VALUES(task_failed_count),
         active_user_count  = VALUES(active_user_count),
         new_user_count     = VALUES(new_user_count),
         input_tokens       = VALUES(input_tokens),
         output_tokens      = VALUES(output_tokens),
         cache_read_tokens  = VALUES(cache_read_tokens),
         total_tokens       = VALUES(total_tokens),
         llm_call_count     = VALUES(llm_call_count)`,
      [
        createObjectId(),
        instance.licenseId,
        instance._id,
        statDate,
        instance._id,
        statDate,
        instance._id,
        statDate,
      ],
    )
  }
}

interface TaskTotals {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
}

function sumTasks(tasks: UsageTaskDto[]): TaskTotals {
  return tasks.reduce<TaskTotals>(
    (total, task) => ({
      inputTokens: total.inputTokens + task.inputTokens,
      outputTokens: total.outputTokens + task.outputTokens,
      cacheReadTokens: total.cacheReadTokens + (task.cacheReadTokens ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
  )
}

/**
 * 归入哪一天。
 *
 * 优先用任务开始时间，缺失时退到上报窗口末尾。用 UTC 切分 —— 客户遍布不同
 * 时区，按服务端本地时区切会让同一批数据在服务端迁移后归到不同的日期。
 */
function resolveStatDate(task: UsageTaskDto, windowEnd: string): string {
  const anchor = task.startedAt ?? task.finishedAt ?? windowEnd
  return new Date(anchor).toISOString().slice(0, 10)
}
