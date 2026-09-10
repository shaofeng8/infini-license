import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator'
import { PaginationDto } from '@/common/dto/pagination.dto'
import { LicenseStatus, LicenseType, QuotaPeriod } from './license.entity'

export class LicenseLimitsDto {
  @ApiPropertyOptional({ description: '最大用户数，留空不限制' })
  @IsInt()
  @Min(1)
  @IsOptional()
  maxUsers?: number

  @ApiPropertyOptional({ description: '最大并发任务数，留空不限制' })
  @IsInt()
  @Min(1)
  @IsOptional()
  maxConcurrentTasks?: number

  @ApiPropertyOptional({ description: 'Token 配额，留空不限制' })
  @IsInt()
  @Min(1)
  @IsOptional()
  tokenQuota?: number

  @ApiPropertyOptional({ description: 'Token 配额周期', enum: ['total', 'monthly'] })
  @IsIn(['total', 'monthly'])
  @IsOptional()
  tokenQuotaPeriod?: QuotaPeriod

  @ApiPropertyOptional({ description: '任务数配额，留空不限制' })
  @IsInt()
  @Min(1)
  @IsOptional()
  taskQuota?: number

  @ApiPropertyOptional({ description: '任务配额周期', enum: ['total', 'monthly'] })
  @IsIn(['total', 'monthly'])
  @IsOptional()
  taskQuotaPeriod?: QuotaPeriod

  @ApiPropertyOptional({ description: '超限软阈值倍数，默认 1.1', default: 1.1 })
  @IsNumber()
  @Min(1)
  @Max(3)
  @IsOptional()
  overLimitRatio?: number
}

export class IssueLicenseDto extends LicenseLimitsDto {
  @ApiProperty({ description: '客户 id' })
  @IsString()
  @IsNotEmpty({ message: '请选择客户' })
  customerId: string

  @ApiPropertyOptional({ description: '产品', default: 'infinisynapse' })
  @IsString()
  @IsOptional()
  @MaxLength(32)
  product?: string

  @ApiPropertyOptional({ description: '版本', default: 'enterprise' })
  @IsString()
  @IsOptional()
  @MaxLength(32)
  edition?: string

  @ApiProperty({ description: '生效日期，ISO 8601' })
  @IsDateString()
  startAt: string

  @ApiPropertyOptional({ description: '到期日期，留空表示永久授权' })
  @IsDateString()
  @IsOptional()
  endAt?: string

  @ApiPropertyOptional({ description: '到期前多少天开始弹窗预警', default: 15 })
  @IsInt()
  @Min(0)
  @Max(180)
  @IsOptional()
  warnDays?: number

  @ApiPropertyOptional({ description: '功能白名单，留空表示全功能' })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(64)
  @IsOptional()
  features?: string[]

  @ApiPropertyOptional({ description: '机器绑定模式', enum: ['tofu', 'none'], default: 'tofu' })
  @IsIn(['tofu', 'none'])
  @IsOptional()
  bindMode?: 'tofu' | 'none'

  @ApiPropertyOptional({ description: '合同号' })
  @IsString()
  @IsOptional()
  @MaxLength(64)
  contractNo?: string

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string

  @ApiPropertyOptional({ description: '由哪份试用授权转正而来' })
  @IsString()
  @IsOptional()
  convertedFromId?: string
}

export class RenewLicenseDto extends LicenseLimitsDto {
  @ApiProperty({ description: '新的到期日期，必须晚于当前到期日' })
  @IsDateString()
  endAt: string

  @ApiPropertyOptional({ description: '同时调整预警天数' })
  @IsInt()
  @Min(0)
  @Max(180)
  @IsOptional()
  warnDays?: number

  @ApiPropertyOptional({ description: '功能白名单，传入则覆盖原值' })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  features?: string[]

  @ApiPropertyOptional({ description: '是否同时覆盖限额。false 时忽略本 DTO 的限额字段' })
  @IsBoolean()
  @IsOptional()
  updateLimits?: boolean

  @ApiPropertyOptional({ description: '合同号' })
  @IsString()
  @IsOptional()
  @MaxLength(64)
  contractNo?: string

  @ApiPropertyOptional({ description: '续期原因，写入审计' })
  @IsString()
  @IsOptional()
  reason?: string
}

export class QueryLicenseDto extends PaginationDto {
  @ApiPropertyOptional({ description: '按授权编号/客户名模糊搜索' })
  @IsString()
  @IsOptional()
  keyword?: string

  @ApiPropertyOptional({ description: '客户 id' })
  @IsString()
  @IsOptional()
  customerId?: string

  @ApiPropertyOptional({ description: '类型', enum: ['formal', 'trial'] })
  @IsIn(['formal', 'trial'])
  @IsOptional()
  type?: LicenseType

  @ApiPropertyOptional({ description: '状态' })
  @IsIn(['pending', 'active', 'expired', 'void'])
  @IsOptional()
  status?: LicenseStatus

  @ApiPropertyOptional({ description: '只看 N 天内到期的' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  @IsOptional()
  expiringInDays?: number
}
