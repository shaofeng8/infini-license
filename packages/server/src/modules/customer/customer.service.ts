import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { EntityManager, Repository } from 'typeorm'
import { BusinessException } from '@/common/exceptions/biz.exception'
import { ErrorEnum } from '@/constants/error-code.constant'
import { PageResult } from '@/common/model/response.model'
import { AuditService } from '../audit/audit.service'
import { AuthUser } from '../auth/auth.decorator'
import { CustomerEntity } from './customer.entity'
import { CreateCustomerDto, QueryCustomerDto, UpdateCustomerDto } from './customer.dto'

@Injectable()
export class CustomerService {
  constructor(
    @InjectRepository(CustomerEntity)
    private readonly repo: Repository<CustomerEntity>,
    private readonly auditService: AuditService,
  ) {}

  async paginate(query: QueryCustomerDto): Promise<PageResult<CustomerEntity>> {
    const qb = this.repo.createQueryBuilder('c').orderBy('c.created_at', 'DESC')

    if (query.keyword) {
      qb.andWhere(
        '(c.name LIKE :kw OR c.short_name LIKE :kw OR c.contact_name LIKE :kw)',
        { kw: `%${query.keyword}%` },
      )
    }
    if (query.stage) qb.andWhere('c.stage = :stage', { stage: query.stage })
    if (query.source) qb.andWhere('c.source = :source', { source: query.source })
    if (query.status !== undefined) qb.andWhere('c.status = :status', { status: query.status })

    const [items, total] = await qb
      .skip(query.skip)
      .take(query.pageSize)
      .getManyAndCount()

    return new PageResult(items, total, query.page, query.pageSize)
  }

  async findById(id: string, manager?: EntityManager): Promise<CustomerEntity> {
    const repo = manager ? manager.getRepository(CustomerEntity) : this.repo
    const customer = await repo.findOne({ where: { _id: id } })
    if (!customer) {
      throw new BusinessException(ErrorEnum.CUSTOMER_NOT_FOUND)
    }
    return customer
  }

  /** 签发前用：顺带检查客户是否被停用 */
  async findActiveById(id: string, manager?: EntityManager): Promise<CustomerEntity> {
    const customer = await this.findById(id, manager)
    if (customer.status !== 1) {
      throw new BusinessException(ErrorEnum.CUSTOMER_DISABLED)
    }
    return customer
  }

  async create(dto: CreateCustomerDto, operator: AuthUser): Promise<CustomerEntity> {
    const saved = await this.repo.save(
      this.repo.create({
        ...dto,
        source: 'manual',
        stage: dto.stage ?? 'lead',
        status: 1,
      }),
    )

    await this.auditService.record({
      actorId: operator.id,
      actorName: operator.username,
      action: 'customer.create',
      targetType: 'customer',
      targetId: saved._id,
      summary: `创建客户 ${saved.name}`,
    })

    return saved
  }

  async update(id: string, dto: UpdateCustomerDto, operator: AuthUser): Promise<CustomerEntity> {
    const before = await this.findById(id)
    await this.repo.update({ _id: id }, dto)

    await this.auditService.record({
      actorId: operator.id,
      actorName: operator.username,
      action: 'customer.update',
      targetType: 'customer',
      targetId: id,
      summary: `更新客户 ${before.name}`,
      detail: { changes: dto },
    })

    return this.findById(id)
  }

  /**
   * 试用注册时自动建档。
   *
   * 这里不做去重：同一家公司不同部门各自试用、同一台机器重装后重新注册，
   * 都会产生新记录。硬去重只会让注册失败，而注册失败会让客户直接用不了产品。
   * 重名由后台的人工合并处理。
   */
  async createForTrial(name: string, manager: EntityManager): Promise<CustomerEntity> {
    const repo = manager.getRepository(CustomerEntity)
    return repo.save(
      repo.create({
        name,
        source: 'trial_auto',
        stage: 'trial',
        status: 1,
      }),
    )
  }
}
