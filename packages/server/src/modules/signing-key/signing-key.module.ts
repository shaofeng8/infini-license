import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { SigningKeyController } from './signing-key.controller'
import { SigningKeyEntity } from './signing-key.entity'
import { SigningKeyService } from './signing-key.service'

@Module({
  imports: [TypeOrmModule.forFeature([SigningKeyEntity])],
  controllers: [SigningKeyController],
  providers: [SigningKeyService],
  exports: [SigningKeyService],
})
export class SigningKeyModule {}
