import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Request } from 'express'
import { Repository } from 'typeorm'
import { BusinessException } from '@/common/exceptions/biz.exception'
import { ErrorEnum } from '@/constants/error-code.constant'
import { CryptoService } from '../crypto/crypto.service'
import { HmacService } from './hmac.service'
import { InstanceEntity } from './instance.entity'
import { NonceService } from './nonce.service'

/** 挂在 request 上供 controller 取用 */
export interface ClientRequest extends Request {
  licenseInstance?: InstanceEntity
  rawBody?: Buffer
}

@Injectable()
export class HmacAuthGuard implements CanActivate {
  private readonly logger = new Logger(HmacAuthGuard.name)

  constructor(
    @InjectRepository(InstanceEntity)
    private readonly instanceRepo: Repository<InstanceEntity>,
    private readonly hmac: HmacService,
    private readonly nonce: NonceService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * 校验顺序刻意如此：先做便宜且不触库的检查，再做需要 IO 的。
   *
   * 时间戳与请求头格式几乎零成本，能挡掉绝大部分无效流量；实例查询要一次
   * 索引查找；nonce 要一次写入。把签名比对放在 nonce 之前，是为了避免
   * 未签名的垃圾请求把 nonce 表撑大。
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ClientRequest>()

    const instanceId = header(request, 'x-license-instance')
    const timestamp = header(request, 'x-license-timestamp')
    const nonce = header(request, 'x-license-nonce')
    const signature = header(request, 'x-license-signature')

    if (!instanceId || !timestamp || !nonce || !signature) {
      throw new BusinessException(ErrorEnum.SIGNATURE_INVALID)
    }

    const timestampSec = Number(timestamp)
    if (!this.hmac.isTimestampFresh(timestampSec)) {
      throw new BusinessException(ErrorEnum.TIMESTAMP_SKEW)
    }

    const instance = await this.instanceRepo.findOne({ where: { _id: instanceId } })
    if (!instance || instance.status !== 'active') {
      // 不区分「不存在」与「已停用」，避免拿这个接口探测实例 id 是否有效
      throw new BusinessException(ErrorEnum.INSTANCE_NOT_FOUND)
    }

    const secret = this.decryptSecret(instance)
    if (!secret) {
      throw new BusinessException(ErrorEnum.SIGNATURE_INVALID)
    }

    const parts = {
      method: request.method,
      // 必须与客户端签名时用的路径完全一致，因此取原始 path 而非路由模板
      path: request.path,
      timestampSec,
      nonce,
      rawBody: request.rawBody?.toString('utf8') ?? '',
    }

    if (!this.hmac.verify(parts, secret, signature)) {
      this.logger.warn(`实例 ${instanceId} 签名校验失败`)
      throw new BusinessException(ErrorEnum.SIGNATURE_INVALID)
    }

    if (!(await this.nonce.claim(instanceId, nonce))) {
      throw new BusinessException(ErrorEnum.NONCE_REPLAY)
    }

    request.licenseInstance = instance
    return true
  }

  private decryptSecret(instance: InstanceEntity): string | null {
    try {
      return this.crypto.decrypt(instance.secretCipher).toString('utf8')
    } catch (error) {
      // 主密钥被换过时会走到这里。这是配置事故，不是客户的问题，必须留下痕迹
      this.logger.error(
        `实例 ${instance._id} 的密钥无法解密，请检查 LICENSE_MASTER_KEY：${describe(error)}`,
      )
      return null
    }
  }
}

function header(request: Request, name: string): string | undefined {
  const value = request.headers[name]
  return Array.isArray(value) ? value[0] : value
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
