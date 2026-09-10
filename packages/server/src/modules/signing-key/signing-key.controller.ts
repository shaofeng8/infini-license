import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { BusinessException } from '@/common/exceptions/biz.exception'
import { ErrorEnum } from '@/constants/error-code.constant'
import { AuditService } from '../audit/audit.service'
import { AdminRole } from '../auth/admin-user.entity'
import { AuthUser, CurrentUser, MinRole } from '../auth/auth.decorator'
import { SigningKeyExport, SigningKeyService } from './signing-key.service'

/**
 * 导出包的口令要求。
 *
 * 比登录密码更长：登录有 5 次失败锁定 15 分钟兜着，而导出包是一个静态
 * 文件，攻击者可以拿回去离线爆破，次数不受任何限制。这里唯一的防线
 * 就是口令本身的强度和 scrypt 的计算代价。
 */
const MIN_PASSPHRASE_LENGTH = 16

function assertPassphrase(passphrase: string): void {
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new BusinessException(
      ErrorEnum.PARAM_INVALID,
      `导出口令至少 ${MIN_PASSPHRASE_LENGTH} 位：导出包可被离线爆破，没有锁定机制兜底`,
    )
  }
}

@ApiTags('签名密钥')
@Controller('signing-key')
@MinRole(AdminRole.OWNER)
export class SigningKeyController {
  constructor(
    private readonly signingKeyService: SigningKeyService,
    private readonly auditService: AuditService,
  ) {}

  @Get('list')
  @ApiOperation({ summary: '密钥列表（不含私钥）' })
  list() {
    return this.signingKeyService.list()
  }

  @Get('public-keys')
  @ApiOperation({ summary: '公钥清单，用于打包进客户端 SDK' })
  publicKeys() {
    return this.signingKeyService.listPublicKeys()
  }

  @Post()
  @ApiOperation({ summary: '生成新密钥对' })
  async create(
    @Body('clientSince') clientSince: string,
    @Body('remark') remark: string,
    @Body('activate') activate: boolean,
    @CurrentUser() user: AuthUser,
  ) {
    const key = await this.signingKeyService.create({ clientSince, remark, activate })
    await this.auditService.record({
      actorId: user.id,
      actorName: user.username,
      action: 'signing_key.create',
      targetType: 'signing_key',
      targetId: key.kid,
      summary: `生成签名密钥 ${key.kid}${key.status === 'active' ? '并立即接管签发' : ''}`,
      detail: { clientSince: clientSince ?? null, activate: key.status === 'active' },
    })
    return { kid: key.kid, publicKey: key.publicKey, status: key.status }
  }

  @Put(':kid/activate')
  @ApiOperation({ summary: '切换为当前签发密钥' })
  async activate(@Param('kid') kid: string, @CurrentUser() user: AuthUser) {
    const key = await this.signingKeyService.activate(kid)
    await this.auditService.record({
      actorId: user.id,
      actorName: user.username,
      action: 'signing_key.activate',
      targetType: 'signing_key',
      targetId: kid,
      summary: `将 ${kid} 切为当前签发密钥`,
    })
    return { kid: key.kid, status: key.status }
  }

  /**
   * 导出密钥，供灾备重建 / 迁移 / 新建实例时恢复。
   *
   * 这是全系统权限最高的操作：导出包 + 口令 = 可以签发任意凭证。
   * 用 POST 而不是 GET，是为了让口令走请求体而不是 URL —— query string
   * 会被 nginx 的 access_log 原样记下来，那等于把口令写进了明文日志。
   */
  @Post(':kid/export')
  @ApiOperation({ summary: '导出密钥（私钥用口令加密）' })
  async exportKey(
    @Param('kid') kid: string,
    @Body('passphrase') passphrase: string,
    @CurrentUser() user: AuthUser,
  ) {
    assertPassphrase(passphrase)
    const bundle = await this.signingKeyService.exportKey(kid, passphrase)

    await this.auditService.record({
      actorId: user.id,
      actorName: user.username,
      action: 'signing_key.export',
      targetType: 'signing_key',
      targetId: kid,
      summary: `导出签名密钥 ${kid}`,
      // 只记指纹，绝不记口令，也不记密文本身
      detail: { fingerprint: bundle.fingerprint },
    })

    return bundle
  }

  @Post('import')
  @ApiOperation({ summary: '导入密钥（灾备恢复 / 迁移）' })
  async importKey(
    @Body('bundle') bundle: SigningKeyExport,
    @Body('passphrase') passphrase: string,
    @Body('activate') activate: boolean,
    @CurrentUser() user: AuthUser,
  ) {
    assertPassphrase(passphrase)
    const key = await this.signingKeyService.importKey(bundle, passphrase, { activate })

    await this.auditService.record({
      actorId: user.id,
      actorName: user.username,
      action: 'signing_key.import',
      targetType: 'signing_key',
      targetId: key.kid,
      summary: `导入签名密钥 ${key.kid}${activate ? '并切为当前签发密钥' : ''}`,
      detail: { activate: Boolean(activate), status: key.status },
    })

    return { kid: key.kid, publicKey: key.publicKey, status: key.status }
  }

  @Put(':kid/retire')
  @ApiOperation({ summary: '停用密钥（不影响已签发凭证）' })
  async retire(@Param('kid') kid: string, @CurrentUser() user: AuthUser) {
    await this.signingKeyService.retire(kid)
    await this.auditService.record({
      actorId: user.id,
      actorName: user.username,
      action: 'signing_key.retire',
      targetType: 'signing_key',
      targetId: kid,
      summary: `停用 ${kid}`,
      detail: { note: '仅影响将来的签发，不构成对已发凭证的吊销' },
    })
  }
}
