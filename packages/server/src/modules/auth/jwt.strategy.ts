import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { ISecurityConfig, securityRegToken } from '@/config'
import { AdminRole } from './admin-user.entity'
import { AuthUser } from './auth.decorator'

export interface JwtPayload {
  sub: string
  username: string
  realName: string | null
  role: AdminRole
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    const { jwtSecret } = configService.get<ISecurityConfig>(securityRegToken)
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
    })
  }

  /**
   * 只做无状态还原，不查库。
   *
   * 后台是内部工具，账号停用后最多等一个 token 生命周期（默认 8 小时）失效，
   * 这点延迟换掉每次请求一条 SELECT 是划算的。真要立即踢人就直接改 JWT_SECRET。
   */
  validate(payload: JwtPayload): AuthUser {
    return {
      id: payload.sub,
      username: payload.username,
      realName: payload.realName,
      role: payload.role,
    }
  }
}
