import { ConfigType, registerAs } from '@nestjs/config'
import { TypeOrmModuleOptions } from '@nestjs/typeorm'

export const dbRegToken = 'database'

export const DatabaseConfig = registerAs(
  dbRegToken,
  (): TypeOrmModuleOptions => ({
    type: 'mysql',
    host: process.env.MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.MYSQL_PORT ?? 3306),
    // 变量名跟 infini-proxy / infiniSynapse 保持一致，三个项目共用一套本地 MySQL
    username: process.env.MYSQL_USER ?? 'root',
    password: process.env.MYSQL_PASSWORD ?? '',
    database: process.env.MYSQL_DATABASE ?? 'infini_license',
    // 表结构由 mysql_init 下的 SQL 维护，绝不让 TypeORM 改动线上结构
    synchronize: false,
    autoLoadEntities: true,
    timezone: 'Z',
    charset: 'utf8mb4',
    logging: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  }),
)

export type IDatabaseConfig = ConfigType<typeof DatabaseConfig>

export const redisRegToken = 'redis'

export const RedisConfig = registerAs(redisRegToken, () => ({
  host: process.env.REDIS_HOST ?? '127.0.0.1',
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  db: Number(process.env.REDIS_DB ?? 0),
}))

export type IRedisConfig = ConfigType<typeof RedisConfig>
