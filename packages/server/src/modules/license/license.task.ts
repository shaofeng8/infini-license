import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { LicenseService } from './license.service'

@Injectable()
export class LicenseTask {
  private readonly logger = new Logger(LicenseTask.name)

  constructor(private readonly licenseService: LicenseService) {}

  /**
   * 刷新授权的派生状态。
   *
   * 只影响后台列表的筛选结果，与客户环境的实际生效状态无关 —— 客户端是
   * 自己拿凭证里的 lic.end 跟本地时间比的，我们改不了也不需要改。
   */
  @Cron(CronExpression.EVERY_HOUR, { name: 'license-status-refresh' })
  async refreshStatuses(): Promise<void> {
    try {
      await this.licenseService.refreshStatuses()
    } catch (error) {
      this.logger.error('刷新授权状态失败', (error as Error)?.stack)
    }
  }
}
