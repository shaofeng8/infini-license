import { HttpException, HttpStatus } from '@nestjs/common'
import { ErrorEnum } from '@/constants/error-code.constant'
import { RESPONSE_SUCCESS_CODE } from '@/constants/response.constant'

/**
 * 业务异常。HTTP 状态恒为 200，错误码放在响应体里。
 *
 * 传入 `ErrorEnum` 时按 `code:message` 拆分；传入裸字符串时视为纯提示语，
 * 错误码取 200 —— 这是 infini-proxy 沿用下来的约定，前端拦截器依赖它。
 */
export class BusinessException extends HttpException {
  private readonly errorCode: number

  constructor(error: ErrorEnum | string, extraMessage?: string) {
    if (!error.includes(':')) {
      super(
        HttpException.createBody({ code: RESPONSE_SUCCESS_CODE, message: error }),
        HttpStatus.OK,
      )
      this.errorCode = RESPONSE_SUCCESS_CODE
      return
    }

    const separatorAt = error.indexOf(':')
    const code = error.slice(0, separatorAt)
    const baseMessage = error.slice(separatorAt + 1)
    const message = extraMessage ? `${baseMessage}：${extraMessage}` : baseMessage

    super(HttpException.createBody({ code, message }), HttpStatus.OK)
    this.errorCode = Number(code)
  }

  getErrorCode() {
    return this.errorCode
  }
}

export { BusinessException as BizException }
