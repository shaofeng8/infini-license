import { ApiProperty } from '@nestjs/swagger'
import { RESPONSE_SUCCESS_CODE, RESPONSE_SUCCESS_MESSAGE } from '@/constants/response.constant'

export class ResOp<T = any> {
  @ApiProperty({
    description: '接口业务数据，具体结构以各接口的响应 DTO 为准',
    nullable: true,
    type: 'object',
    additionalProperties: true,
  })
  data: T

  @ApiProperty({ description: 'HTTP/业务状态码', example: 200 })
  code: number

  @ApiProperty({ description: '响应消息', example: '请求成功' })
  message: string

  constructor(code: number, data: T, message = RESPONSE_SUCCESS_MESSAGE) {
    this.code = code
    this.data = data
    this.message = message
  }

  static success<T>(data?: T, message?: string) {
    return new ResOp(RESPONSE_SUCCESS_CODE, data ?? null, message)
  }

  static error(code: number, message: string) {
    return new ResOp(code, null, message)
  }
}

export class PageResult<T> {
  @ApiProperty({ description: '当前页数据', isArray: true })
  items: T[]

  @ApiProperty({ description: '总条数' })
  total: number

  @ApiProperty({ description: '当前页码，从 1 开始' })
  page: number

  @ApiProperty({ description: '每页条数' })
  pageSize: number

  constructor(items: T[], total: number, page: number, pageSize: number) {
    this.items = items
    this.total = total
    this.page = page
    this.pageSize = pageSize
  }
}
