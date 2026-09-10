import { Controller, Get } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import { Public } from '../auth/auth.decorator'

@ApiTags('健康检查')
@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Public()
  @Get()
  @ApiOperation({ summary: '存活探针' })
  async check() {
    let db = 'down'
    try {
      await this.dataSource.query('SELECT 1')
      db = 'up'
    } catch {
      db = 'down'
    }
    return { status: db === 'up' ? 'ok' : 'degraded', db, timestamp: new Date().toISOString() }
  }
}
