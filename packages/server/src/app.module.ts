import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { ScheduleModule } from '@nestjs/schedule'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AllExceptionsFilter } from './common/filters/any-exception.filter'
import { TransformInterceptor } from './common/interceptors/transform.interceptor'
import configs, { dbRegToken, IDatabaseConfig } from './config'
import { AuditModule } from './modules/audit/audit.module'
import { AuthModule } from './modules/auth/auth.module'
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard'
import { RolesGuard } from './modules/auth/roles.guard'
import { BootstrapModule } from './modules/bootstrap/bootstrap.module'
import { ClientModule } from './modules/client/client.module'
import { CredentialModule } from './modules/credential/credential.module'
import { CryptoModule } from './modules/crypto/crypto.module'
import { CustomerModule } from './modules/customer/customer.module'
import { HealthController } from './modules/health/health.controller'
import { LicenseModule } from './modules/license/license.module'
import { SigningKeyModule } from './modules/signing-key/signing-key.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: Object.values(configs),
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => configService.get<IDatabaseConfig>(dbRegToken),
    }),
    ScheduleModule.forRoot(),
    // 试用客户端接口是公开的，必须限流；后台接口顺带受益
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),

    CryptoModule,
    AuditModule,
    AuthModule,
    SigningKeyModule,
    CredentialModule,
    CustomerModule,
    LicenseModule,
    ClientModule,
    BootstrapModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // 顺序有意义：先限流，再认证，最后鉴权
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
