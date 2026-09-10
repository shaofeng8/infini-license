import { Controller, Get, Query } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { AdminRole } from '../auth/admin-user.entity'
import { MinRole } from '../auth/auth.decorator'
import { AuditService } from './audit.service'

@ApiTags('审计')
@Controller('audit')
@MinRole(AdminRole.OPS)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('list')
  @ApiOperation({ summary: '审计日志分页查询' })
  list(
    @Query('action') action?: string,
    @Query('actorId') actorId?: string,
    @Query('targetId') targetId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.auditService.query({
      action,
      actorId,
      targetId,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
    })
  }
}
