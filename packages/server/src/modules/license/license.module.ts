import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { CredentialModule } from '../credential/credential.module'
import { CustomerModule } from '../customer/customer.module'
import { LicenseController } from './license.controller'
import { LicenseEntity } from './license.entity'
import { LicenseService } from './license.service'
import { LicenseTask } from './license.task'
import { SequenceEntity } from './sequence.entity'
import { SequenceService } from './sequence.service'

@Module({
  imports: [
    TypeOrmModule.forFeature([LicenseEntity, SequenceEntity]),
    CustomerModule,
    CredentialModule,
  ],
  controllers: [LicenseController],
  providers: [LicenseService, SequenceService, LicenseTask],
  exports: [LicenseService, SequenceService],
})
export class LicenseModule {}
