import { Global, Module } from '@nestjs/common'
import { CryptoService } from './crypto.service'
import { JwsService } from './jws.service'

@Global()
@Module({
  providers: [CryptoService, JwsService],
  exports: [CryptoService, JwsService],
})
export class CryptoModule {}
