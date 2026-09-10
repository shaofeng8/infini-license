import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsEnum, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'
import { PaginationDto } from '@/common/dto/pagination.dto'
import { CustomerStage } from './customer.entity'

export class CreateCustomerDto {
  @ApiProperty({ description: '客户全称' })
  @IsString()
  @IsNotEmpty({ message: '请填写客户名称' })
  @MaxLength(255)
  name: string

  @ApiPropertyOptional({ description: '简称' })
  @IsString()
  @IsOptional()
  @MaxLength(64)
  shortName?: string

  @ApiPropertyOptional({ description: '阶段', enum: ['lead', 'trial', 'customer', 'churned'] })
  @IsEnum(['lead', 'trial', 'customer', 'churned'] as const)
  @IsOptional()
  stage?: CustomerStage

  @ApiPropertyOptional({ description: '联系人' })
  @IsString()
  @IsOptional()
  @MaxLength(64)
  contactName?: string

  @ApiPropertyOptional({ description: '联系电话' })
  @IsString()
  @IsOptional()
  @MaxLength(32)
  contactPhone?: string

  @ApiPropertyOptional({ description: '联系邮箱' })
  @IsString()
  @IsOptional()
  @MaxLength(128)
  contactEmail?: string

  @ApiPropertyOptional({ description: '行业' })
  @IsString()
  @IsOptional()
  @MaxLength(64)
  industry?: string

  @ApiPropertyOptional({ description: '地区' })
  @IsString()
  @IsOptional()
  @MaxLength(64)
  region?: string

  @ApiPropertyOptional({ description: '负责销售' })
  @IsString()
  @IsOptional()
  @MaxLength(64)
  salesOwner?: string

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string
}

export class UpdateCustomerDto extends CreateCustomerDto {
  @ApiPropertyOptional({ description: '状态：1 正常 0 停用' })
  @IsInt()
  @IsIn([0, 1])
  @IsOptional()
  status?: number
}

export class QueryCustomerDto extends PaginationDto {
  @ApiPropertyOptional({ description: '按名称/简称/联系人模糊搜索' })
  @IsString()
  @IsOptional()
  keyword?: string

  @ApiPropertyOptional({ description: '阶段' })
  @IsString()
  @IsOptional()
  stage?: CustomerStage

  @ApiPropertyOptional({ description: '来源：manual / trial_auto' })
  @IsString()
  @IsOptional()
  source?: string

  @ApiPropertyOptional({ description: '状态' })
  @IsOptional()
  status?: number
}
