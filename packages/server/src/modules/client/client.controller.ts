import { Body, Controller, Ip, Post, Req, UseGuards } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { BusinessException } from '@/common/exceptions/biz.exception'
import { ITrialConfig, trialRegToken } from '@/config'
import { ErrorEnum } from '@/constants/error-code.constant'
import { Public } from '../auth/auth.decorator'
import { HeartbeatDto, TrialRegisterDto, UsageDto } from './client.dto'
import { ClientRequest, HmacAuthGuard } from './hmac-auth.guard'
import { RateLimitService } from './rate-limit.service'
import { StrictBody, StrictBodyGuard } from './strict-body.guard'
import { TrialService } from './trial.service'
import { UsageService } from './usage.service'

@ApiTags('试用客户端')
@Controller('client')
export class ClientController {
  constructor(
    private readonly trialService: TrialService,
    private readonly usageService: UsageService,
    private readonly rateLimit: RateLimitService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 试用注册。这是唯一不需要 HMAC 的客户端接口 —— 调用方此时还没有身份。
   * 代价是必须靠限流兜住：否则任何人都能靠它无限建客户和授权记录。
   */
  @Post('trial/register')
  @Public()
  @UseGuards(StrictBodyGuard)
  @StrictBody(TrialRegisterDto)
  @ApiOperation({ summary: '试用实例注册，重复注册不重置试用期' })
  async register(@Body() dto: TrialRegisterDto, @Ip() ip: string) {
    const trial = this.configService.get<ITrialConfig>(trialRegToken)

    const allowed = await Promise.all([
      this.rateLimit.consume({
        subject: `trial:ip:${ip}`,
        kind: 'hour',
        limit: trial.registerPerIpHourly,
      }),
      this.rateLimit.consume({
        subject: `trial:fp:${dto.fingerprint}`,
        kind: 'day',
        limit: trial.registerPerFingerprintDaily,
      }),
    ])

    if (allowed.some(ok => !ok)) {
      throw new BusinessException(ErrorEnum.TOO_MANY_REQUESTS)
    }

    return this.trialService.register(dto, ip ?? null)
  }

  @Post('heartbeat')
  @Public()
  @UseGuards(HmacAuthGuard, StrictBodyGuard)
  @StrictBody(HeartbeatDto)
  @ApiOperation({ summary: '心跳，必要时下发更新后的凭证' })
  async heartbeat(@Body() dto: HeartbeatDto, @Req() request: ClientRequest, @Ip() ip: string) {
    return this.trialService.heartbeat(request.licenseInstance!, dto, ip ?? null)
  }

  @Post('usage')
  @Public()
  @UseGuards(HmacAuthGuard, StrictBodyGuard)
  @StrictBody(UsageDto)
  @ApiOperation({ summary: '用量上报，同一 batchId 重复提交幂等' })
  async usage(@Body() dto: UsageDto, @Req() request: ClientRequest) {
    return this.usageService.ingest(request.licenseInstance!, dto)
  }
}
