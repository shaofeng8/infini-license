import { existsSync, readFileSync } from 'fs'
import { config, parse } from 'dotenv'

/**
 * 环境变量加载顺序：外部注入 > .env.development > .env
 *
 * 容器里注入的变量优先级最高，本地的 .env.development 不能覆盖它 ——
 * 否则开发机上残留的一份配置文件被打进镜像就会静默劫持生产配置。
 */
const externalEnvKeys = new Set(Object.keys(process.env))

config({ path: '.env' })

if (existsSync('.env.development')) {
  const developmentEnv = parse(readFileSync('.env.development'))
  for (const [key, value] of Object.entries(developmentEnv)) {
    if (!externalEnvKeys.has(key)) {
      process.env[key] = value
    }
  }
}
