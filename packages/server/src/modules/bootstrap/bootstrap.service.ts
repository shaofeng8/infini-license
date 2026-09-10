import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ISecurityConfig, securityRegToken } from '@/config'
import { CryptoService } from '../crypto/crypto.service'
import { AdminRole, AdminUserEntity } from '../auth/admin-user.entity'
import { SigningKeyService } from '../signing-key/signing-key.service'

/**
 * 首次启动的幂等初始化。
 *
 * 默认管理员和首把签名密钥都放在这里而不是 seed SQL 里，因为两者都需要
 * 应用层的密码学处理：密码要 scrypt 哈希，私钥要用 LICENSE_MASTER_KEY 做
 * AES-GCM 加密，SQL 干不了这些。
 */
@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapService.name)

  constructor(
    @InjectRepository(AdminUserEntity)
    private readonly adminRepo: Repository<AdminUserEntity>,
    private readonly signingKeyService: SigningKeyService,
    private readonly cryptoService: CryptoService,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureAdmin()
    await this.ensureSigningKey()
  }

  private async ensureAdmin(): Promise<void> {
    const existing = await this.adminRepo.count()
    if (existing > 0) return

    const { bootstrapAdminUsername, bootstrapAdminPassword } =
      this.configService.get<ISecurityConfig>(securityRegToken)

    if (!bootstrapAdminPassword) {
      // 不生成随机密码打进日志：日志会被收集、转发、长期留存，等于把
      // 唯一的管理员口令散播到运维链路的每一环。宁可让服务起来但没账号，
      // 强迫部署者显式设一次。
      this.logger.error(
        '库中没有任何管理员账号，且未配置 BOOTSTRAP_ADMIN_PASSWORD。' +
          '请在 .env 中设置该变量后重启，服务将自动创建 owner 账号。',
      )
      return
    }

    await this.adminRepo.save(
      this.adminRepo.create({
        username: bootstrapAdminUsername,
        passwordHash: this.cryptoService.hashPassword(bootstrapAdminPassword),
        realName: '初始管理员',
        role: AdminRole.OWNER,
        status: 1,
        failedAttempts: 0,
      }),
    )

    this.logger.warn(
      `已创建初始 owner 账号 ${bootstrapAdminUsername}。` +
        '请立即登录修改密码，并从 .env 中清空 BOOTSTRAP_ADMIN_PASSWORD。',
    )
  }

  private async ensureSigningKey(): Promise<void> {
    if (!this.cryptoService.hasMasterKey()) {
      this.logger.error(
        '未配置有效的 LICENSE_MASTER_KEY（需 32 字节 base64），签发相关功能将不可用。' +
          "生成命令：node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
      )
      return
    }

    try {
      const created = await this.signingKeyService.ensureBootstrapKey()
      if (created) {
        this.logger.warn(
          `已生成首把签名密钥 ${created.kid}。请把它的公钥打包进客户端 SDK，` +
            '否则客户端无法验证任何凭证。',
        )
      }
    } catch (error) {
      this.logger.error('初始化签名密钥失败', (error as Error)?.stack)
    }
  }
}
