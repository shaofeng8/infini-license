import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { BusinessException } from '@/common/exceptions/biz.exception'
import { ErrorEnum } from '@/constants/error-code.constant'
import { AdminRole, ROLE_LEVEL } from './admin-user.entity'
import { AuthUser, PUBLIC_KEY, ROLES_KEY } from './auth.decorator'

/**
 * 按角色等级放行。`@MinRole(AdminRole.OPS)` 表示 ops 及以上可访问。
 *
 * 没标注 @MinRole 的接口默认只要登录即可 —— 后台的读操作占多数，
 * 逐个标注 viewer 是噪音。写操作必须显式标注，评审时缺注解会很显眼。
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const required = this.reflector.getAllAndOverride<AdminRole>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!required) return true

    const user = context.switchToHttp().getRequest().user as AuthUser
    if (!user || ROLE_LEVEL[user.role] === undefined) {
      throw new BusinessException(ErrorEnum.TOKEN_INVALID)
    }

    if (ROLE_LEVEL[user.role] < ROLE_LEVEL[required]) {
      throw new BusinessException(ErrorEnum.PERMISSION_DENIED)
    }
    return true
  }
}
