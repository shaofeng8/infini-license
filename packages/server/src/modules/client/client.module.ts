import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { CredentialModule } from '../credential/credential.module'
import { CryptoModule } from '../crypto/crypto.module'
import { CustomerEntity } from '../customer/customer.entity'
import { LicenseModule } from '../license/license.module'
import { LicenseEntity } from '../license/license.entity'
import { ClientController } from './client.controller'
import { ClientTask } from './client.task'
import { HmacAuthGuard } from './hmac-auth.guard'
import { HmacService } from './hmac.service'
import { InstanceEntity } from './instance.entity'
import { NonceService } from './nonce.service'
import { RateLimitService } from './rate-limit.service'
import { StrictBodyGuard } from './strict-body.guard'
import { TrialService } from './trial.service'
import { UsageService } from './usage.service'
import {
  HeartbeatEntity,
  UsageBatchEntity,
  UsageDailyEntity,
  UsageTaskEntity,
  UserRefEntity,
} from './usage.entity'

@Module({
  imports: [
    TypeOrmModule.forFeature([
      InstanceEntity,
      HeartbeatEntity,
      UsageBatchEntity,
      UsageTaskEntity,
      UsageDailyEntity,
      UserRefEntity,
      LicenseEntity,
      CustomerEntity,
    ]),
    CryptoModule,
    CredentialModule,
    LicenseModule,
  ],
  controllers: [ClientController],
  providers: [
    HmacService,
    NonceService,
    RateLimitService,
    HmacAuthGuard,
    StrictBodyGuard,
    TrialService,
    UsageService,
    ClientTask,
  ],
  exports: [TrialService, UsageService],
})
export class ClientModule {}
