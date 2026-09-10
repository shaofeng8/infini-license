/**
 * 把 mysql_init 下的 SQL 应用到本地数据库。
 *
 * 走 docker-compose 时这些 SQL 由 MySQL 容器的 entrypoint 自动执行，但本地
 * 开发常常直接连一个已有的 MySQL 实例（三个项目共用一套），那时就需要手动跑。
 *
 * 用法：pnpm run db:init
 */
const { existsSync, readFileSync, readdirSync } = require('fs')
const { join } = require('path')
const dotenv = require('dotenv')
const mysql = require('mysql2/promise')

const SERVER_ROOT = join(__dirname, '..')
const SQL_DIR = join(__dirname, '../../../mysql_init')

// 与 src/load-env.ts 同样的优先级：外部注入 > .env.development > .env。
// 不复用那个文件是因为它是 TypeScript，纯 JS 脚本 require 不动。
loadEnv()

function loadEnv() {
  const external = new Set(Object.keys(process.env))

  for (const name of ['.env', '.env.development']) {
    const path = join(SERVER_ROOT, name)
    if (!existsSync(path)) continue
    for (const [key, value] of Object.entries(dotenv.parse(readFileSync(path)))) {
      if (!external.has(key)) process.env[key] = value
    }
  }
}

async function main() {
  const database = process.env.MYSQL_DATABASE || 'infini_license'

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    multipleStatements: true,
  })

  const files = readdirSync(SQL_DIR)
    .filter(name => name.endsWith('.sql'))
    .sort()

  for (const name of files) {
    const sql = readFileSync(join(SQL_DIR, name), 'utf8')
    await connection.query(sql)
    console.log(`applied ${name}`)
  }

  const [tables] = await connection.query(
    'SELECT TABLE_NAME AS name, TABLE_COMMENT AS comment FROM information_schema.TABLES ' +
      'WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME',
    [database],
  )

  console.log(`\n${database} 共 ${tables.length} 张表：`)
  for (const table of tables) {
    console.log(`  ${table.name.padEnd(20)} ${table.comment}`)
  }

  await connection.end()
}

main().catch(error => {
  console.error(`建表失败：${error.message}`)
  process.exit(1)
})
