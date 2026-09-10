import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { PageResult } from '@/common/model/response.model'
import { AuditLogEntity } from './audit-log.entity'

export interface AuditRecord {
  actorId?: string | null
  actorName?: string | null
  action: string
  targetType?: string
  targetId?: string
  summary?: string
  detail?: Record<string, any>
  ip?: string
}

export interface AuditQuery {
  action?: string
  actorId?: string
  targetId?: string
  page?: number
  pageSize?: number
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name)

  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly repo: Repository<AuditLogEntity>,
  ) {}

  /**
   * 写审计。故意吞掉异常：审计失败不能反过来让业务操作失败，
   * 否则一次日志表写满就会让整个签发流程停摆。
   */
  async record(entry: AuditRecord): Promise<void> {
    try {
      await this.repo.save(
        this.repo.create({
          actorId: entry.actorId ?? null,
          actorName: entry.actorName ?? null,
          action: entry.action,
          targetType: entry.targetType ?? null,
          targetId: entry.targetId ?? null,
          summary: entry.summary ?? null,
          detailJson: entry.detail ?? null,
          ip: entry.ip ?? null,
          createdAt: new Date(),
        }),
      )
    } catch (error) {
      this.logger.error(`审计写入失败 action=${entry.action}`, (error as Error)?.stack)
    }
  }

  async query(params: AuditQuery): Promise<PageResult<AuditLogEntity>> {
    const page = params.page ?? 1
    const pageSize = params.pageSize ?? 20

    const qb = this.repo.createQueryBuilder('a').orderBy('a.created_at', 'DESC')
    if (params.action) qb.andWhere('a.action = :action', { action: params.action })
    if (params.actorId) qb.andWhere('a.actor_id = :actorId', { actorId: params.actorId })
    if (params.targetId) qb.andWhere('a.target_id = :targetId', { targetId: params.targetId })

    const [items, total] = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount()

    return new PageResult(items, total, page, pageSize)
  }
}
