import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import { Request, Response } from 'express'
import { ErrorEnum } from '@/constants/error-code.constant'
import { BusinessException } from '../exceptions/biz.exception'

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name)

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const request = ctx.getRequest<Request>()
    const response = ctx.getResponse<Response>()

    if (response.headersSent) {
      return
    }

    const isBusiness = exception instanceof BusinessException
    const status = this.getStatus(exception)
    let message = this.getErrorMessage(exception)

    if (status === HttpStatus.INTERNAL_SERVER_ERROR && !isBusiness) {
      this.logger.error(
        `${request.method} ${decodeURI(request.url)} - ${message}`,
        (exception as Error)?.stack,
      )
      // 生产环境不把内部细节回给调用方
      if (process.env.NODE_ENV !== 'development') {
        message = ErrorEnum.SERVER_ERROR.split(':')[1]
      }
    } else {
      this.logger.warn(`(${status}) ${message} ${request.method} ${decodeURI(request.url)}`)
    }

    const apiErrorCode = isBusiness ? (exception as BusinessException).getErrorCode() : status
    const httpStatus = isBusiness ? HttpStatus.OK : status

    response.status(httpStatus)
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.json({ code: apiErrorCode, data: null, message })
  }

  private getStatus(exception: unknown): number {
    if (exception instanceof BusinessException) {
      return exception.getErrorCode()
    }
    if (exception instanceof HttpException) {
      return exception.getStatus()
    }

    // body-parser 之类的中间件抛的是 http-errors 而非 Nest 的 HttpException，
    // 它们自带正确的状态码（请求体过大是 413、JSON 语法错误是 400）。
    // 不认这个字段的话，全部会被当成 500，把「客户端请求有问题」误报成
    // 「服务器故障」，排查方向直接跑偏。
    const raw = (exception as { status?: unknown; statusCode?: unknown })?.status ??
      (exception as { statusCode?: unknown })?.statusCode
    if (typeof raw === 'number' && raw >= 400 && raw < 600) {
      return raw
    }

    return HttpStatus.INTERNAL_SERVER_ERROR
  }

  private getErrorMessage(exception: unknown): string {
    if (exception instanceof HttpException) {
      return exception.message
    }
    return (exception as any)?.message || String(exception)
  }
}
