import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common'
import { AdminRole } from './admin-user.entity'

export const PUBLIC_KEY = 'license:public_route'
export const ROLES_KEY = 'license:min_role'

/** 免登录接口。默认所有接口都要登录，这里显式开洞 */
export const Public = () => SetMetadata(PUBLIC_KEY, true)

/** 声明访问该接口所需的最低角色 */
export const MinRole = (role: AdminRole) => SetMetadata(ROLES_KEY, role)

export interface AuthUser {
  id: string
  username: string
  realName: string | null
  role: AdminRole
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().user as AuthUser
})
