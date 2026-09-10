import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { AdminRole } from '../auth/admin-user.entity'
import { AuthUser, CurrentUser, MinRole } from '../auth/auth.decorator'
import { CreateCustomerDto, QueryCustomerDto, UpdateCustomerDto } from './customer.dto'
import { CustomerService } from './customer.service'

@ApiTags('客户')
@Controller('customer')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Get('list')
  @ApiOperation({ summary: '客户分页列表' })
  list(@Query() query: QueryCustomerDto) {
    return this.customerService.paginate(query)
  }

  @Get(':id')
  @ApiOperation({ summary: '客户详情' })
  detail(@Param('id') id: string) {
    return this.customerService.findById(id)
  }

  @Post()
  @MinRole(AdminRole.SALES)
  @ApiOperation({ summary: '新建客户' })
  create(@Body() dto: CreateCustomerDto, @CurrentUser() user: AuthUser) {
    return this.customerService.create(dto, user)
  }

  @Put(':id')
  @MinRole(AdminRole.SALES)
  @ApiOperation({ summary: '编辑客户' })
  update(@Param('id') id: string, @Body() dto: UpdateCustomerDto, @CurrentUser() user: AuthUser) {
    return this.customerService.update(id, dto, user)
  }
}
