import './load-env'

import { Logger, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'
import { NestExpressApplication } from '@nestjs/platform-express'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule } from './app.module'
import { BusinessException } from './common/exceptions/biz.exception'
import { ErrorEnum } from './constants/error-code.constant'
import { appRegToken, IAppConfig, ISecurityConfig, securityRegToken } from './config'

async function bootstrap() {
  const logger = new Logger('Bootstrap')
  // rawBody 是试用客户端 HMAC 校验的前提：签名覆盖的是请求体原始字节。
  // 用 JSON.stringify 重新序列化解析后的对象会因键序或空白差异算出不同的
  // 哈希，签名必然验不过。
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
    rawBody: true,
  })

  const configService = app.get(ConfigService)
  const { port, globalPrefix, isDev, trustProxyHops } =
    configService.get<IAppConfig>(appRegToken)
  const { jwtSecret } = configService.get<ISecurityConfig>(securityRegToken)

  // Express 默认不信任 X-Forwarded-For，`req.ip` 拿到的是直连对端地址。
  // 上了 nginx 之后那就是代理的地址，审计日志会把每个人都记成同一个 IP，
  // 限流也会退化成全员共用一个桶。设成准确的跳数（多设一跳等于允许客户端
  // 自己伪造 IP），0 表示直连、不信任任何转发头。
  if (trustProxyHops > 0) {
    app.set('trust proxy', trustProxyHops)
    logger.log(`已信任 ${trustProxyHops} 层反向代理，req.ip 取自 X-Forwarded-For`)
  }

  // 没有 JWT_SECRET 时 passport-jwt 会用 undefined 当密钥，任何伪造的 token
  // 都能通过校验。这种配置错误必须在启动时炸掉，不能带到运行期。
  if (!jwtSecret) {
    logger.error('未配置 JWT_SECRET，拒绝启动')
    process.exit(1)
  }

  app.setGlobalPrefix(globalPrefix)
  app.enableCors({ origin: true, credentials: true })

  // 默认的 100kb 装不下一批用量上报（单批上限 1000 条任务，约 300KB），
  // body-parser 会在进入校验管道之前就抛 PayloadTooLargeError。
  // 这里按 DTO 的 ArrayMaxSize 留够余量，真正超量的请求交给 DTO 去拒绝，
  // 那样客户端能拿到「单批过多，请拆批」而不是一个含义模糊的 413。
  app.useBodyParser('json', { limit: '4mb' })

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      exceptionFactory: errors => {
        const first = errors[0]
        const message = first ? Object.values(first.constraints ?? {})[0] : undefined
        return new BusinessException(ErrorEnum.PARAM_INVALID, message)
      },
    }),
  )

  if (isDev) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('InfiniSynapse License API')
        .setDescription('授权签发、管理与试用追踪')
        .setVersion('0.1.0')
        .addBearerAuth()
        .build(),
    )
    SwaggerModule.setup(`${globalPrefix}/docs`, app, document)
    logger.log(`Swagger: http://localhost:${port}/${globalPrefix}/docs`)
  }

  app.enableShutdownHooks()
  await app.listen(port)
  logger.log(`License 服务已启动：http://localhost:${port}/${globalPrefix}`)
}

void bootstrap()
