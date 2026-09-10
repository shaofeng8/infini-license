import { AppConfig, appRegToken } from './app.config'
import { DatabaseConfig, dbRegToken, RedisConfig, redisRegToken } from './database.config'
import { SecurityConfig, securityRegToken } from './security.config'
import { TrialConfig, trialRegToken } from './trial.config'

export * from './app.config'
export * from './database.config'
export * from './security.config'
export * from './trial.config'

export const ConfigKeyPaths = {
  app: appRegToken,
  database: dbRegToken,
  redis: redisRegToken,
  security: securityRegToken,
  trial: trialRegToken,
} as const

export default {
  AppConfig,
  DatabaseConfig,
  RedisConfig,
  SecurityConfig,
  TrialConfig,
}
