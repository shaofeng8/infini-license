import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { SigningKeyModule } from '../signing-key/signing-key.module'
import { CredentialEntity } from './credential.entity'
import { CredentialService } from './credential.service'

@Module({
  imports: [TypeOrmModule.forFeature([CredentialEntity]), SigningKeyModule],
  providers: [CredentialService],
  exports: [CredentialService],
})
export class CredentialModule {}
