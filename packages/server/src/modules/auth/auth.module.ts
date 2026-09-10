import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import { TypeOrmModule } from '@nestjs/typeorm'
import { SignOptions } from 'jsonwebtoken'
import { ISecurityConfig, securityRegToken } from '@/config'
import { AdminUserEntity } from './admin-user.entity'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { JwtStrategy } from './jwt.strategy'

@Module({
  imports: [
    TypeOrmModule.forFeature([AdminUserEntity]),
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const { jwtSecret, jwtExpiresIn } = configService.get<ISecurityConfig>(securityRegToken)
        return {
          secret: jwtSecret,
          // jsonwebtoken 的类型把 expiresIn 收窄成字面量联合，配置来自
          // 环境变量只能是 string，这里断言掉；格式错误会在签发时抛出
          signOptions: { expiresIn: jwtExpiresIn as SignOptions['expiresIn'] },
        }
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
