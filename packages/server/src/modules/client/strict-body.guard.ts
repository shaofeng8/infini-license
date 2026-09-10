import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { BusinessException } from '@/common/exceptions/biz.exception'
import { ErrorEnum } from '@/constants/error-code.constant'

const STRICT_BODY_DTO = 'strict_body_dto'

/**
 * 声明这个路由的请求体只接受 DTO 里显式列出的字段。
 *
 * 用法：`@StrictBody(UsageDto)`
 */
export const StrictBody = (dto: new () => object) => SetMetadata(STRICT_BODY_DTO, dto)

/**
 * 未声明字段一律拒收。
 *
 * **为什么是 Guard 而不是 ValidationPipe：** 全局管道开了 `whitelist: true`，
 * 它会把未声明的字段静默剥掉。管道在 Guard 之后执行，所以路由级管道拿到的
 * 已经是被清洗过的对象，`forbidNonWhitelisted` 永远命不中 —— 这个坑真库
 * 冒烟才暴露出来，看代码完全像是生效的。
 *
 * Guard 在管道之前跑，拿到的是 body-parser 刚解析出的原始对象，因此能看见
 * 多余字段。
 *
 * 这道校验是「只收用了多少、不收用来做什么」这条隐私承诺的技术保证，客户
 * 可以据此审计我方实际接收的字段范围。它刻意不依赖任何全局配置：全局管道
 * 的选项被人为了别的需求调松时，这里不受影响。
 */
@Injectable()
export class StrictBodyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const dto = this.reflector.get<(new () => object) | undefined>(
      STRICT_BODY_DTO,
      context.getHandler(),
    )
    if (!dto) return true

    const body = context.switchToHttp().getRequest<{ body?: unknown }>().body ?? {}

    const errors = validateSync(plainToInstance(dto, body), {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    })

    if (errors.length > 0) {
      throw new BusinessException(ErrorEnum.PARAM_INVALID, firstMessage(errors))
    }
    return true
  }
}

/** 递归找出第一条具体原因。嵌套的 tasks[3].prompt 也要报得出来 */
function firstMessage(errors: ReturnType<typeof validateSync>): string | undefined {
  for (const error of errors) {
    const constraint = Object.values(error.constraints ?? {})[0]
    if (constraint) return constraint

    const nested = firstMessage(error.children ?? [])
    if (nested) return nested
  }
  return undefined
}
