import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsHexadecimal,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator'

/**
 * 试用客户端上报的 DTO。
 *
 * 这些类配合 `forbidNonWhitelisted: true` 使用（见 client.controller.ts）：
 * **任何未在此声明的字段都会让整个请求被拒绝。** 这是「只上报用了多少、
 * 不上报用来做什么」这条隐私承诺的技术保证 —— 不是可以为了兼容性放宽的
 * 普通校验。客户端将来要多传字段，必须先在这里显式声明并评估隐私影响。
 */

class InstanceInfoDto {
  @IsOptional()
  @IsString()
  @Length(1, 32)
  productVersion?: string

  @IsOptional()
  @IsString()
  @Length(1, 128)
  hostName?: string

  @IsOptional()
  @IsString()
  @Length(1, 64)
  os?: string

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4096)
  cpuCores?: number

  @IsOptional()
  @IsIn(['docker', 'k8s', 'bare'])
  deployKind?: string
}

export class TrialRegisterDto {
  @IsHexadecimal()
  @Length(64, 64)
  fingerprint: string

  @IsUUID()
  installId: string

  @IsOptional()
  @IsHexadecimal()
  @Length(64, 64)
  hostSignalHash?: string | null

  @IsOptional()
  @IsHexadecimal()
  @Length(64, 64)
  dbSignal?: string | null

  @ValidateNested()
  @Type(() => InstanceInfoDto)
  instance: InstanceInfoDto
}

class CountersDto {
  @IsOptional()
  @IsString()
  @Length(1, 16)
  periodKey?: string

  @IsOptional()
  @IsInt()
  @Min(0)
  taskCount?: number

  @IsOptional()
  @IsInt()
  @Min(0)
  totalTokens?: number
}

export class HeartbeatDto {
  @IsOptional()
  @IsString()
  @Length(1, 32)
  productVersion?: string

  @IsOptional()
  @IsString()
  @Length(1, 24)
  localState?: string

  @IsOptional()
  @IsInt()
  @Min(0)
  localUserCount?: number

  @IsOptional()
  @IsDateString()
  clientTime?: string

  @IsOptional()
  @ValidateNested()
  @Type(() => CountersDto)
  counters?: CountersDto

  @IsOptional()
  @IsString()
  @Length(1, 64)
  credentialJti?: string

  @IsOptional()
  @IsInt()
  @Min(0)
  outboxPending?: number
}

export class UsageTaskDto {
  @IsString()
  @Length(1, 255)
  taskId: string

  @IsOptional()
  @IsString()
  @Length(1, 255)
  parentTaskId?: string | null

  /** 假名标识。客户侧加盐哈希，我方无法反推真实用户 */
  @IsHexadecimal()
  @Length(64, 64)
  userRef: string

  @IsOptional()
  @IsIn(['completed', 'failed', 'cancelled', 'running'])
  status?: string

  @IsOptional()
  @IsDateString()
  startedAt?: string

  @IsOptional()
  @IsDateString()
  finishedAt?: string

  @IsOptional()
  @IsInt()
  @Min(0)
  durationMs?: number

  @IsInt()
  @Min(0)
  inputTokens: number

  @IsInt()
  @Min(0)
  outputTokens: number

  @IsOptional()
  @IsInt()
  @Min(0)
  cacheReadTokens?: number

  @IsOptional()
  @IsInt()
  @Min(0)
  cacheWriteTokens?: number

  @IsOptional()
  @IsInt()
  @Min(0)
  llmCallCount?: number
}

class UsageAggregateDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  activeUserCount?: number
}

export class UsageDto {
  @IsUUID()
  batchId: string

  @IsIn(['app', 'proxy'])
  source: 'app' | 'proxy'

  @IsDateString()
  windowStart: string

  @IsDateString()
  windowEnd: string

  /**
   * 单批上限 1000 条。客户端积压时应拆批而非加大单批 ——
   * 没有上限的话，一个跑了半年的实例首次联网就能发来几十万条。
   */
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => UsageTaskDto)
  tasks: UsageTaskDto[]

  @IsOptional()
  @ValidateNested()
  @Type(() => UsageAggregateDto)
  aggregate?: UsageAggregateDto
}
