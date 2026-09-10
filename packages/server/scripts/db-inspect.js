/**
 * 打印库里的授权与凭证现状，用于人工核对。
 * 用法：pnpm run db:inspect
 */
const { existsSync, readFileSync } = require('fs')
const { join } = require('path')
const dotenv = require('dotenv')
const mysql = require('mysql2/promise')

const SERVER_ROOT = join(__dirname, '..')
loadEnv()

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'infini_license',
  })

  const [licenses] = await connection.query(
    `SELECT l.license_no, l.type, l.status, l.renew_count,
            DATE_FORMAT(l.start_at, '%Y-%m-%d') AS start_at,
            DATE_FORMAT(l.end_at, '%Y-%m-%d') AS end_at,
            l.max_users, l.token_quota, c.name AS customer,
            (SELECT COUNT(*) FROM lc_credential WHERE license_id = l._id) AS creds
     FROM lc_license l JOIN lc_customer c ON c._id = l.customer_id
     ORDER BY l.created_at`,
  )

  console.log('授权：')
  for (const row of licenses) {
    console.log(
      `  ${row.license_no}  ${row.type}/${row.status}  ${row.start_at} → ${row.end_at}  ` +
        `续期${row.renew_count}次  凭证${row.creds}份  users=${row.max_users ?? '∞'}  ` +
        `tokens=${row.token_quota ?? '∞'}  ${row.customer}`,
    )
  }

  const [keys] = await connection.query(
    'SELECT kid, status, algorithm, LENGTH(private_key_cipher) AS cipher_bytes FROM lc_signing_key',
  )
  console.log('\n签名密钥：')
  for (const row of keys) {
    console.log(`  ${row.kid}  ${row.algorithm}/${row.status}  私钥密文 ${row.cipher_bytes} 字节`)
  }

  const [audit] = await connection.query(
    'SELECT action, COUNT(*) AS n FROM lc_audit_log GROUP BY action ORDER BY n DESC',
  )
  console.log('\n审计：')
  for (const row of audit) {
    console.log(`  ${String(row.action).padEnd(24)} ${row.n}`)
  }

  await connection.end()
}

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

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
