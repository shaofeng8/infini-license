import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AdminUserEntity } from '../auth/admin-user.entity'
import { SigningKeyModule } from '../signing-key/signing-key.module'
import { BootstrapService } from './bootstrap.service'

@Module({
  imports: [TypeOrmModule.forFeature([AdminUserEntity]), SigningKeyModule],
  providers: [BootstrapService],
})
export class BootstrapModule {}
