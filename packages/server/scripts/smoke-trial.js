/**
 * 试用通道端到端冒烟：注册 → HMAC 心跳 → 用量上报。
 *
 * 客户端一侧全部走 SDK 的真实实现（TrialClient / signRequest），因此这个脚本
 * 同时验证了「SDK 签名」与「服务端校验」两份镜像实现是否逐字节一致 ——
 * 这是最容易悄悄跑偏的地方，两边各自的单测都发现不了。
 *
 * 前置：服务已启动，且已执行过 db:init。
 * 用法：pnpm run smoke:trial
 */
const { createHash, randomUUID } = require('crypto')
const { existsSync, readFileSync } = require('fs')
const { join } = require('path')
const dotenv = require('dotenv')

const SERVER_ROOT = join(__dirname, '..')
loadEnv()

const sdk = require(join(SERVER_ROOT, '../sdk/dist/index.js'))

const ENDPOINT = `http://127.0.0.1:${process.env.APP_PORT || 3010}`
const BASE = `${ENDPOINT}/api`

let passed = 0
const failures = []

async function main() {
  // 清掉自己的限流桶。脚本每轮要注册 3 次，而同 IP 每小时上限 10 次，
  // 不清的话连跑三轮就会被自己的限流器挡住 —— 那不是缺陷，但会让人误以为
  // 是。限流逻辑本身在最后有专门一项验证。
  await query("DELETE FROM lc_rate_limit WHERE bucket LIKE 'trial:%'")

  const fingerprint = hex64(`fp-${randomUUID()}`)
  const installId = randomUUID()
  const hostSignalHash = hex64(`host-${randomUUID()}`)

  const anonymous = new sdk.TrialClient({ endpoint: ENDPOINT })
  let identity = null
  let firstResponse = null

  await step('试用注册成功，返回身份与凭证', async () => {
    const result = await anonymous.register({
      fingerprint,
      installId,
      hostSignalHash,
      dbSignal: null,
      instance: {
        productVersion: '0.11.2',
        hostName: 'smoke-trial-01',
        os: 'linux/x64',
        cpuCores: 16,
        deployKind: 'docker',
      },
    })

    assert(result.ok, `注册失败：${!result.ok && result.error}`)
    firstResponse = result.data
    assert(/^TRL-\d{4}-\d{6}$/.test(result.data.licenseNo), `编号格式异常：${result.data.licenseNo}`)
    assert(result.data.instanceSecret.length >= 40, 'secret 长度异常')

    identity = {
      instanceId: result.data.instanceId,
      instanceSecret: result.data.instanceSecret,
    }
  })

  await step('下发的凭证能被 SDK 验签，且已开启上报', async () => {
    const keys = await getJson('/signing-key/public-keys', await adminToken())
    const verified = sdk.verifyCredential(firstResponse.credential, keys)

    assert(verified.valid, `验签失败：${verified.reason}`)
    assert(verified.payload.typ === 'trial', '凭证类型应为 trial')
    assert(verified.payload.telemetry.enabled === true, '试用凭证必须开启上报')
    assert(verified.payload.telemetry.instanceId === identity.instanceId, '凭证未绑定实例')
    assert(verified.payload.telemetry.endpoint, '凭证缺少上报地址')

    const state = sdk.evaluateLicense({ now: Date.now(), payload: verified.payload })
    assert(state.status === 'trial_active', `状态应为 trial_active，实际 ${state.status}`)
    assert(state.remainingDays === 30, `剩余天数应为 30，实际 ${state.remainingDays}`)
  })

  await step('同指纹重复注册不重置试用期，且返回同一个 secret', async () => {
    const again = await anonymous.register({
      fingerprint,
      installId,
      hostSignalHash,
      dbSignal: null,
      instance: { productVersion: '0.11.3', hostName: 'smoke-trial-01' },
    })

    assert(again.ok, `重复注册失败：${!again.ok && again.error}`)
    assert(again.data.instanceId === identity.instanceId, '重复注册产生了新实例')
    assert(again.data.trialStartedAt === firstResponse.trialStartedAt, '试用起点被重置了')
    // 客户端拿到 secret 后崩溃、没能落盘时会重试注册，必须能拿回同一个
    assert(again.data.instanceSecret === identity.instanceSecret, 'secret 变了，客户端将无法上报')
  })

  await step('换指纹但主机信号相同时判定疑似重装，沿用原起始时间', async () => {
    const reinstalled = await anonymous.register({
      fingerprint: hex64(`fp-${randomUUID()}`),
      installId: randomUUID(),
      hostSignalHash, // 同一台机器
      dbSignal: null,
      instance: { hostName: 'smoke-trial-01' },
    })

    assert(reinstalled.ok, `重装注册失败：${!reinstalled.ok && reinstalled.error}`)
    assert(
      reinstalled.data.trialStartedAt === firstResponse.trialStartedAt,
      `清库重装刷出了新的试用期：${reinstalled.data.trialStartedAt}`,
    )
    assert(reinstalled.data.instanceId !== identity.instanceId, '应当创建新实例')
  })

  const client = new sdk.TrialClient({ endpoint: ENDPOINT, identity })

  await step('HMAC 心跳通过 —— SDK 与服务端的签名实现一致', async () => {
    const result = await client.heartbeat({
      productVersion: '0.11.2',
      localState: 'trial_active',
      localUserCount: 8,
      clientTime: new Date().toISOString(),
      counters: { periodKey: 'total', taskCount: 142, totalTokens: 8_231_000 },
      credentialJti: 'cred_unknown_on_purpose',
      outboxPending: 3,
    })

    assert(result.ok, `心跳失败：${!result.ok && result.error}`)
    assert(result.data.policy.heartbeatSec > 0, '未下发心跳节奏')
    assert(result.data.serverTime, '未返回服务端时间')
  })

  await step('客户端报的 jti 已是最新时不重复下发凭证', async () => {
    const jti = sdk.peekPayloadUnsafe(firstResponse.credential).jti
    const result = await client.heartbeat({ credentialJti: jti })

    assert(result.ok, `心跳失败：${!result.ok && result.error}`)
    assert(result.data.credential === null, '凭证没变化却下发了，白耗带宽')
  })

  await step('签名错误被拒绝', async () => {
    const tampered = new sdk.TrialClient({
      endpoint: ENDPOINT,
      identity: { instanceId: identity.instanceId, instanceSecret: 'wrong-secret' },
    })
    const result = await tampered.heartbeat({ localState: 'trial_active' })

    assert(!result.ok, '错误的 secret 竟然通过了')
    assert(result.code === 1401, `期望错误码 1401，实际 ${result.code}`)
  })

  await step('请求体被改动后签名失效', async () => {
    // 用正确的 secret 对空体签名，但实际发送带内容的体
    const headers = sdk.signRequest({
      method: 'POST',
      path: '/api/client/heartbeat',
      rawBody: '{}',
      instanceId: identity.instanceId,
      instanceSecret: identity.instanceSecret,
      now: Date.now(),
    })

    const response = await fetch(`${BASE}/client/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ localUserCount: 999 }),
    })
    const payload = await response.json()
    assert(payload.code === 1401, `期望错误码 1401，实际 ${payload.code}`)
  })

  await step('时间戳偏差过大被拒绝', async () => {
    const stale = new sdk.TrialClient({
      endpoint: ENDPOINT,
      identity,
      now: () => Date.now() - 3600_000,
    })
    const result = await stale.heartbeat({ localState: 'trial_active' })

    assert(!result.ok, '一小时前的时间戳竟然通过了')
    assert(result.code === 1402, `期望错误码 1402，实际 ${result.code}`)
  })

  await step('重放同一个 nonce 被拒绝', async () => {
    const body = { localState: 'trial_active' }
    const rawBody = sdk.stableStringify(body)
    const headers = sdk.signRequest({
      method: 'POST',
      path: '/api/client/heartbeat',
      rawBody,
      instanceId: identity.instanceId,
      instanceSecret: identity.instanceSecret,
      now: Date.now(),
      nonce: randomUUID(),
    })

    const send = () =>
      fetch(`${BASE}/client/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: rawBody,
      }).then(response => response.json())

    const first = await send()
    assert(first.code === 200, `首次请求应成功，实际 ${first.code}`)

    const replayed = await send()
    assert(replayed.code === 1403, `重放应被拒绝，实际 ${replayed.code}`)
  })

  // -- 用量上报 -------------------------------------------------------------

  const day = new Date().toISOString().slice(0, 10)
  const userA = hex64('user-a')
  const userB = hex64('user-b')
  const batchId = randomUUID()
  const taskId = `task-${randomUUID()}`

  await step('用量上报被接收', async () => {
    const result = await client.usage(
      buildUsage(batchId, day, [
        task(taskId, userA, { inputTokens: 128_340, outputTokens: 9_821, status: 'completed' }),
        task(`task-${randomUUID()}`, userB, {
          inputTokens: 5_000,
          outputTokens: 800,
          status: 'failed',
        }),
      ]),
    )

    assert(result.ok, `上报失败：${!result.ok && result.error}`)
    assert(result.data.duplicated === false, '首次上报被判为重复')
  })

  await step('同一 batchId 重传幂等，不重复累加', async () => {
    const before = await readDaily(identity.instanceId, day)

    const result = await client.usage(
      buildUsage(batchId, day, [
        task(taskId, userA, { inputTokens: 128_340, outputTokens: 9_821, status: 'completed' }),
      ]),
    )

    assert(result.ok && result.data.duplicated === true, '重传未被识别为重复')

    const after = await readDaily(identity.instanceId, day)
    assert(
      after.total_tokens === before.total_tokens,
      `重传把用量算了两遍：${before.total_tokens} → ${after.total_tokens}`,
    )
  })

  await step('同一任务跨窗口续报时 token 累加、状态覆盖', async () => {
    const result = await client.usage(
      buildUsage(randomUUID(), day, [
        task(taskId, userA, { inputTokens: 1_000, outputTokens: 200, status: 'completed' }),
      ]),
    )
    assert(result.ok && !result.data.duplicated, '续报失败')

    const row = await queryOne(
      'SELECT input_tokens, output_tokens, status FROM lc_usage_task WHERE instance_id = ? AND task_id = ?',
      [identity.instanceId, taskId],
    )
    assert(Number(row.input_tokens) === 129_340, `input 未累加：${row.input_tokens}`)
    assert(Number(row.output_tokens) === 10_021, `output 未累加：${row.output_tokens}`)
  })

  await step('日聚合从明细重算，用户数去重正确', async () => {
    const daily = await readDaily(identity.instanceId, day)

    assert(Number(daily.task_count) === 2, `任务数应为 2，实际 ${daily.task_count}`)
    assert(Number(daily.active_user_count) === 2, `活跃用户应为 2，实际 ${daily.active_user_count}`)
    assert(Number(daily.task_success_count) === 1, `成功数应为 1，实际 ${daily.task_success_count}`)
    assert(Number(daily.task_failed_count) === 1, `失败数应为 1，实际 ${daily.task_failed_count}`)
    assert(Number(daily.total_tokens) > 0, 'token 总量为 0')
  })

  await step('假名用户表按 user_ref 去重累计', async () => {
    const rows = await query(
      'SELECT user_ref, total_tokens FROM lc_user_ref WHERE instance_id = ? ORDER BY total_tokens DESC',
      [identity.instanceId],
    )
    assert(rows.length === 2, `应有 2 个假名用户，实际 ${rows.length}`)
    assert(Number(rows[0].total_tokens) > Number(rows[1].total_tokens), '用量累计顺序异常')
  })

  await step('未声明的字段让整个请求被拒 —— 隐私白名单生效', async () => {
    const body = buildUsage(randomUUID(), day, [
      task(`task-${randomUUID()}`, userA, { inputTokens: 1, outputTokens: 1 }),
    ])
    // 客户端「顺手」多带了任务标题和提示词，这正是承诺过绝不接收的内容
    body.tasks[0].taskTitle = '客户的机密项目名称'
    body.tasks[0].prompt = '这里本不该出现在我方服务器上'

    const result = await client.usage(body)
    assert(!result.ok, '多余字段竟然被接受了 —— 隐私承诺失效')
    assert(result.code === 1000, `期望参数错误 1000，实际 ${result.code}`)
  })

  await step('超出单批上限的请求被拒', async () => {
    const tasks = Array.from({ length: 1001 }, () =>
      task(`task-${randomUUID()}`, userA, { inputTokens: 1, outputTokens: 1 }),
    )
    const result = await client.usage(buildUsage(randomUUID(), day, tasks))

    assert(!result.ok, '1001 条竟然被接受了')
    assert(result.code === 1000, `期望参数错误 1000，实际 ${result.code}`)
  })

  await step('未注册的实例无法上报', async () => {
    const ghost = new sdk.TrialClient({
      endpoint: ENDPOINT,
      identity: { instanceId: 'ffffffffffffffffffffffff', instanceSecret: 'whatever' },
    })
    const result = await ghost.heartbeat({ localState: 'trial_active' })

    assert(!result.ok, '不存在的实例竟然通过了')
    assert(result.code === 1400, `期望错误码 1400，实际 ${result.code}`)
  })

  await step('缺少身份时 SDK 拒绝发出请求', async () => {
    const noIdentity = new sdk.TrialClient({ endpoint: ENDPOINT })
    const result = await noIdentity.heartbeat({})

    assert(!result.ok, '没有身份竟然发出去了')
    assert(result.retryable === false, '缺少身份不该被判为可重试')
  })

  await step('注册限流达到阈值后拒绝 —— 唯一不需要签名的接口靠它兜住', async () => {
    const freshFingerprint = hex64(`fp-${randomUUID()}`)

    // 直接把桶预置到上限，而不是真发 10 次请求：后者会在库里留下 10 套
    // 垃圾客户与授权。桶键格式与 rate-limit.service.ts 的 windowKey 一致，
    // 那边改了这里要跟着改。
    const utc = new Date().toISOString()
    const dayBucket = `trial:fp:${freshFingerprint}:d${utc.slice(0, 10).replace(/-/g, '')}`
    await query(
      'INSERT INTO lc_rate_limit (bucket, hits, expires_at) VALUES (?, 99999, DATE_ADD(NOW(3), INTERVAL 1 DAY))',
      [dayBucket],
    )

    const result = await anonymous.register({
      fingerprint: freshFingerprint,
      installId: randomUUID(),
      hostSignalHash: null,
      dbSignal: null,
      instance: {},
    })

    assert(!result.ok, '超过限流阈值仍然注册成功了')
    assert(result.code === 1003, `期望错误码 1003，实际 ${result.code}`)

    const created = await queryOne(
      'SELECT COUNT(*) AS n FROM lc_instance WHERE fingerprint = ?',
      [freshFingerprint],
    )
    assert(Number(created.n) === 0, '被限流的请求竟然建出了实例')
  })

  await step('服务不可达时安静失败且标记可重试', async () => {
    const offline = new sdk.TrialClient({ endpoint: 'http://127.0.0.1:59999', timeoutMs: 2000 })
    const result = await offline.register({
      fingerprint: hex64('x'),
      installId: randomUUID(),
      hostSignalHash: null,
      dbSignal: null,
      instance: {},
    })

    assert(!result.ok, '连不通竟然返回成功')
    assert(result.retryable === true, '网络故障应标记为可重试')
  })

  report()
}

// -- 工具 --------------------------------------------------------------------

function buildUsage(batchId, day, tasks) {
  return {
    batchId,
    source: 'app',
    windowStart: `${day}T01:45:00.000Z`,
    windowEnd: `${day}T02:00:00.000Z`,
    tasks,
    aggregate: { activeUserCount: 2 },
  }
}

function task(taskId, userRef, overrides) {
  return {
    taskId,
    parentTaskId: null,
    userRef,
    status: 'completed',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 1000,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    llmCallCount: 1,
    ...overrides,
  }
}

function hex64(seed) {
  return createHash('sha256').update(seed).digest('hex')
}

let cachedToken = null
async function adminToken() {
  if (cachedToken) return cachedToken
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: process.env.BOOTSTRAP_ADMIN_USERNAME || 'admin',
      password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
    }),
  })
  const payload = await response.json()
  cachedToken = payload.data.accessToken
  return cachedToken
}

async function getJson(path, token) {
  const response = await fetch(BASE + path, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const payload = await response.json()
  return payload.data
}

let connection = null
async function db() {
  if (connection) return connection
  const mysql = require('mysql2/promise')
  connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'infini_license',
  })
  return connection
}

async function query(sql, params) {
  const [rows] = await (await db()).query(sql, params)
  return rows
}

async function queryOne(sql, params) {
  const rows = await query(sql, params)
  return rows[0]
}

async function readDaily(instanceId, day) {
  const row = await queryOne(
    'SELECT * FROM lc_usage_daily WHERE instance_id = ? AND stat_date = ?',
    [instanceId, day],
  )
  if (!row) throw new Error(`没有 ${day} 的日聚合记录`)
  return row
}

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

function report() {
  console.log(`\n${passed} 通过，${failures.length} 失败`)
  if (connection) void connection.end()
  if (failures.length > 0) process.exit(1)
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
