import { ConfigType, registerAs } from '@nestjs/config'

export const appRegToken = 'app'

export const AppConfig = registerAs(appRegToken, () => ({
  name: process.env.APP_NAME ?? 'infini-license',
  port: Number(process.env.APP_PORT ?? 3010),
  globalPrefix: process.env.APP_GLOBAL_PREFIX ?? 'api',
  isDev: process.env.NODE_ENV === 'development',

  /**
   * 前面隔着几层反向代理。0 = 直连（默认，本地开发就是这样）。
   *
   * 这个值决定 `req.ip` 怎么算，而 `req.ip` 有两个要紧的下游：
   *
   * 1. **审计日志的 ip 列**（登录、凭证下载都记）。设成 0 而实际上了 nginx，
   *    每一条审计记的都是代理地址，「谁在哪里下载了这份凭证」就此失传 ——
   *    而这正是这套系统存在的理由之一。
   * 2. **ThrottlerGuard 的分桶键**。同样的错配会让所有运营共用一个
   *    300 次/分钟的桶，一个人手抖就把全组挡在门外。
   *
   * 反过来设大了同样危险：多信一跳，客户端就能自己伪造 X-Forwarded-For，
   * 把审计里的 IP 写成任意值、并绕开限流。所以这里要的是**准确的跳数**，
   * 不是「往大了设更安全」。当前拓扑只有宿主机 nginx 一层，故生产设 1。
   */
  trustProxyHops: Number(process.env.TRUST_PROXY_HOPS ?? 0),
}))

export type IAppConfig = ConfigType<typeof AppConfig>
