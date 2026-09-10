import { Body, Controller, Get, Header, Param, Post, Put, Query, Res } from '@nestjs/common'
import { ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger'
import { Response } from 'express'
import { Bypass } from '@/common/decorators/bypass.decorator'
import { AuditService } from '../audit/audit.service'
import { AdminRole } from '../auth/admin-user.entity'
import { AuthUser, CurrentUser, MinRole } from '../auth/auth.decorator'
import { CredentialService, IssuedCredential } from '../credential/credential.service'
import { IssueLicenseDto, QueryLicenseDto, RenewLicenseDto } from './license.dto'
import { LicenseService } from './license.service'

@ApiTags('授权')
@Controller('license')
export class LicenseController {
  constructor(
    private readonly licenseService: LicenseService,
    private readonly credentialService: CredentialService,
    private readonly auditService: AuditService,
  ) {}

  @Get('list')
  @ApiOperation({ summary: '授权分页列表' })
  list(@Query() query: QueryLicenseDto) {
    return this.licenseService.paginate(query)
  }

  @Get('expiring')
  @ApiOperation({ summary: '即将到期的正式授权' })
  expiring(@Query('days') days?: string) {
    return this.licenseService.expiringSoon(days ? Number(days) : 30)
  }

  @Get(':id')
  @ApiOperation({ summary: '授权详情，含凭证签发历史' })
  detail(@Param('id') id: string) {
    return this.licenseService.detail(id)
  }

  @Post('issue')
  @MinRole(AdminRole.OPS)
  @ApiOperation({ summary: '签发正式授权' })
  async issue(@Body() dto: IssueLicenseDto, @CurrentUser() user: AuthUser) {
    const issued = await this.licenseService.issue(dto, user)
    return this.toIssueResult(issued)
  }

  @Post(':id/renew')
  @MinRole(AdminRole.OPS)
  @ApiOperation({ summary: '续期并签发新凭证，授权编号不变' })
  async renew(
    @Param('id') id: string,
    @Body() dto: RenewLicenseDto,
    @CurrentUser() user: AuthUser,
  ) {
    const issued = await this.licenseService.renew(id, dto, user)
    return this.toIssueResult(issued)
  }

  @Post(':id/reissue')
  @MinRole(AdminRole.OPS)
  @ApiOperation({ summary: '重新签发一份内容相同的凭证（客户丢文件、指纹绑错）' })
  async reissue(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser() user: AuthUser,
  ) {
    const issued = await this.licenseService.reissue(id, user, reason)
    return this.toIssueResult(issued)
  }

  @Put(':id/void')
  @MinRole(AdminRole.OPS)
  @ApiOperation({ summary: '作废授权（仅后台状态，客户环境不受影响）' })
  voidLicense(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.licenseService.voidLicense(id, user, reason)
  }

  /**
   * 下载 license.key。
   *
   * 走 @Bypass 返回裸文本而不是包在 ResOp 里：客户运维拿到的必须是能直接
   * 放进部署目录的文件，多一层 JSON 包装就得先手工剥壳，容易剥错。
   */
  @Get('credential/:credentialId/download')
  @MinRole(AdminRole.OPS)
  @Bypass()
  @ApiProduces('application/octet-stream')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '下载 license.key 文件' })
  async download(
    @Param('credentialId') credentialId: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const issued = await this.credentialService.download(credentialId)

    await this.auditService.record({
      actorId: user.id,
      actorName: user.username,
      action: 'credential.download',
      targetType: 'credential',
      targetId: credentialId,
      summary: `下载 ${issued.credential.payloadJson.lno} 的 license.key`,
      detail: { checksum: issued.credential.checksum },
    })

    res.setHeader('Content-Type', 'application/octet-stream; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="license.key"')
    res.send(issued.envelope)
  }

  private toIssueResult(issued: IssuedCredential) {
    return {
      licenseId: issued.credential.licenseId,
      credentialId: issued.credential._id,
      licenseNo: issued.credential.payloadJson.lno,
      kid: issued.credential.kid,
      checksum: issued.credential.checksum,
      validFrom: issued.credential.validFrom,
      validUntil: issued.credential.validUntil,
      /** 直接把文件内容一并返回，前端可即时预览或另存 */
      envelope: issued.envelope,
    }
  }
}
