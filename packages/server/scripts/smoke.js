/**
 * 端到端冒烟：登录 → 建客户 → 签发 → 下载 license.key → 用客户端 SDK 验签 → 续期。
 *
 * 单测用的是 mock 仓储，跑不到真实的 SQL、列名映射、事务与序列号分配。
 * 这个脚本打通真库，是「签发链路可用」的最终判据。
 *
 * 前置：服务已在 APP_PORT 上运行，且已执行过 db:init。
 * 用法：pnpm run smoke
 */
const { existsSync, readFileSync } = require('fs')
const { join } = require('path')
const dotenv = require('dotenv')

const SERVER_ROOT = join(__dirname, '..')
loadEnv()

const BASE = `http://127.0.0.1:${process.env.APP_PORT || 3010}/api`
const USERNAME = process.env.BOOTSTRAP_ADMIN_USERNAME || 'admin'
const PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD

const sdk = require(join(SERVER_ROOT, '../sdk/dist/index.js'))

let token = null
let passed = 0
const failures = []

async function main() {
  if (!PASSWORD) throw new Error('未配置 BOOTSTRAP_ADMIN_PASSWORD，无法登录')

  await step('健康检查', async () => {
    const health = await call('GET', '/health')
    assert(health.db === 'up', `数据库未连通：${health.db}`)
  })

  await step('登录并拿到令牌', async () => {
    const result = await call('POST', '/auth/login', { username: USERNAME, password: PASSWORD })
    assert(result.accessToken, '未返回 accessToken')
    assert(result.user.role === 'owner', `初始账号角色应为 owner，实际 ${result.user.role}`)
    token = result.accessToken
  })

  await step('错误密码被拒绝', async () => {
    const raw = await callRaw('POST', '/auth/login', { username: USERNAME, password: 'wrong-one' })
    assert(raw.code === 1100, `期望错误码 1100，实际 ${raw.code}`)
  })

  await step('未带令牌访问受保护接口被拒绝', async () => {
    const saved = token
    token = null
    const raw = await callRaw('GET', '/customer/list')
    token = saved
    assert(raw.code === 1103, `期望错误码 1103，实际 ${raw.code}`)
  })

  let trustedKeys = []
  await step('取出内置公钥清单', async () => {
    const keys = await call('GET', '/signing-key/public-keys')
    assert(keys.length >= 1, '没有可用的签名公钥')
    trustedKeys = keys.map(k => ({ kid: k.kid, publicKey: k.publicKey }))
  })

  let customerId = null
  await step('创建客户', async () => {
    const customer = await call('POST', '/customer', {
      name: `冒烟测试客户 ${Date.now()}`,
      shortName: '冒烟',
      stage: 'customer',
      contactName: '张三',
      contactPhone: '13800000000',
    })
    assert(customer._id, '未返回客户 id')
    customerId = customer._id
  })

  let licenseId = null
  let licenseNo = null
  let credentialId = null
  let envelope = null

  await step('签发正式授权', async () => {
    const issued = await call('POST', '/license/issue', {
      customerId,
      startAt: new Date(Date.now() - 86400_000).toISOString(),
      endAt: new Date(Date.now() + 365 * 86400_000).toISOString(),
      warnDays: 15,
      maxUsers: 50,
      tokenQuota: 100_000_000,
      tokenQuotaPeriod: 'total',
      features: ['wiki', 'dashboard'],
      contractNo: 'HT-2026-001',
    })
    assert(/^LIC-\d{4}-\d{4}$/.test(issued.licenseNo), `授权编号格式异常：${issued.licenseNo}`)
    assert(issued.checksum && issued.checksum.length === 16, 'checksum 异常')
    licenseId = issued.licenseId
    licenseNo = issued.licenseNo
    credentialId = issued.credentialId
    envelope = issued.envelope
  })

  await step('下载 license.key 且内容与签发时一致', async () => {
    const downloaded = await download(`/license/credential/${credentialId}/download`)
    assert(downloaded.includes('BEGIN INFINISYNAPSE LICENSE'), '下载内容不是信封格式')
    assert(downloaded.includes(`License-No:   ${licenseNo}`), '信封头部授权编号不符')
    assert(
      sdk.parseLicenseEnvelope(downloaded) === sdk.parseLicenseEnvelope(envelope),
      '下载内容与签发时的 JWS 不一致',
    )
  })

  await step('客户端 SDK 验签通过并求值为有效', async () => {
    const jws = sdk.parseLicenseEnvelope(envelope)
    assert(jws, '信封解析失败')

    const verified = sdk.verifyCredential(jws, trustedKeys)
    assert(verified.valid, `验签失败：${verified.reason}`)

    const payload = verified.payload
    assert(payload.lno === licenseNo, '凭证内的授权编号不符')
    assert(payload.typ === 'formal', '凭证类型应为 formal')
    assert(payload.telemetry.enabled === false, '正式凭证必须关闭上报')
    assert(payload.limits.maxUsers === 50, '限额未正确写入凭证')
    assert(payload.support.phone, '未写入支持联系方式')

    const state = sdk.evaluateLicense({ now: Date.now(), payload })
    assert(state.status === 'formal_active', `状态应为 formal_active，实际 ${state.status}`)
    assert(state.loginBlocked === false, '有效授权不应阻断登录')
    assert(state.remainingDays > 350, `剩余天数异常：${state.remainingDays}`)
  })

  await step('篡改凭证后验签失败', async () => {
    const jws = sdk.parseLicenseEnvelope(envelope)
    const [header, payloadSeg, signature] = jws.split('.')
    const decoded = JSON.parse(Buffer.from(payloadSeg, 'base64url').toString('utf8'))
    decoded.lic.end = decoded.lic.end + 365 * 86400
    const forged = Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url')

    const result = sdk.verifyCredential(`${header}.${forged}.${signature}`, trustedKeys)
    assert(result.valid === false, '篡改到期日后竟然通过了验签')
    assert(result.reason === 'signature', `期望 signature，实际 ${result.reason}`)
  })

  await step('续期后授权编号不变，到期日延长', async () => {
    const newEnd = new Date(Date.now() + 730 * 86400_000).toISOString()
    const renewed = await call('POST', `/license/${licenseId}/renew`, {
      endAt: newEnd,
      reason: '冒烟测试续期',
    })

    assert(renewed.licenseNo === licenseNo, `续期后编号变了：${licenseNo} → ${renewed.licenseNo}`)
    assert(renewed.credentialId !== credentialId, '续期应签发新凭证')

    const payload = sdk.verifyCredential(sdk.parseLicenseEnvelope(renewed.envelope), trustedKeys)
      .payload
    assert(
      payload.lic.end * 1000 > Date.now() + 700 * 86400_000,
      '续期后的凭证到期日未延长',
    )
  })

  await step('授权详情含完整凭证链，只有一份是当前凭证', async () => {
    const detail = await call('GET', `/license/${licenseId}`)
    assert(detail.credentials.length === 2, `应有 2 份凭证，实际 ${detail.credentials.length}`)
    const current = detail.credentials.filter(c => c.isCurrent)
    assert(current.length === 1, `当前凭证应恰好 1 份，实际 ${current.length}`)
    assert(current[0].issueReason === 'renew', '当前凭证应来自续期')
    assert(detail.renewCount === 1, `续期次数应为 1，实际 ${detail.renewCount}`)
  })

  await step('到期日早于生效日被拒绝', async () => {
    const raw = await callRaw('POST', '/license/issue', {
      customerId,
      startAt: new Date(Date.now() + 86400_000).toISOString(),
      endAt: new Date(Date.now() - 86400_000).toISOString(),
    })
    assert(raw.code === 1204, `期望错误码 1204，实际 ${raw.code}`)
  })

  await step('并发签发的编号不重复', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        call('POST', '/license/issue', {
          customerId,
          startAt: new Date().toISOString(),
          endAt: new Date(Date.now() + 30 * 86400_000).toISOString(),
        }),
      ),
    )
    const numbers = results.map(r => r.licenseNo)
    assert(new Set(numbers).size === 5, `编号重复：${numbers.join(', ')}`)
  })

  await step('关键操作都留下了审计', async () => {
    const audit = await call('GET', '/audit/list', null, { pageSize: 50 })
    const actions = new Set(audit.items.map(item => item.action))
    for (const expected of [
      'admin.login',
      'customer.create',
      'license.issue',
      'license.renew',
      'credential.download',
    ]) {
      assert(actions.has(expected), `缺少审计记录：${expected}`)
    }
  })

  report()
}

// -- 工具 --------------------------------------------------------------------

async function step(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  PASS  ${name}`)
  } catch (error) {
    failures.push({ name, message: error.message })
    console.log(`  FAIL  ${name}\n          ${error.message}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function call(method, path, body, query) {
  const raw = await callRaw(method, path, body, query)
  if (raw.code !== 200) {
    throw new Error(`${method} ${path} 返回 ${raw.code}: ${raw.message}`)
  }
  return raw.data
}

async function callRaw(method, path, body, query) {
  const url = new URL(BASE + path)
  for (const [key, value] of Object.entries(query || {})) {
    url.searchParams.set(key, String(value))
  }

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return response.json()
}

async function download(path) {
  const response = await fetch(BASE + path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  return response.text()
}

function report() {
  console.log(`\n${passed} 通过，${failures.length} 失败`)
  if (failures.length > 0) {
    process.exit(1)
  }
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
  console.error(`\n冒烟中断：${error.message}`)
  process.exit(1)
})
