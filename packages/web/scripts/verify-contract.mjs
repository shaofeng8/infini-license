/**
 * 契约校验：拿真后端的响应逐字段核对前端类型的假设。
 *
 * 前端类型是手写镜像（web 不依赖 server），`tsc` 只能保证前端内部自洽，
 * 保证不了「后端真的叫这个字段名」。这个脚本专门抓那类错误 —— 分页字段是
 * items 还是 list、主键是 _id 还是 id、expiresIn 是秒还是毫秒。
 *
 * 用法：node scripts/verify-contract.mjs [baseUrl] [username] [password]
 */

const BASE = process.argv[2] || 'http://localhost:3010/api'
const USERNAME = process.argv[3] || 'admin'
const PASSWORD = process.argv[4] || 'LocalDev123456'

let token = ''
let passed = 0
const failures = []

function check(label, condition, detail) {
  if (condition) {
    passed++
    console.log(`  ok   ${label}`)
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    return { httpStatus: res.status, raw: text }
  }
  return { httpStatus: res.status, ...json }
}

// -- 1. 响应信封 -------------------------------------------------------------

console.log('\n[1] 响应信封与登录')
{
  const res = await call('POST', '/auth/login', {
    username: USERNAME,
    password: PASSWORD,
  })

  // NestJS 的 @Post 默认回 201 Created，不是 200。
  // 前端 http.ts 判的是 `response.ok`（200-299）而不是 `=== 200`，所以两者都行；
  // 这里把 201 也算通过，但仍拒绝 4xx/5xx
  check(
    `登录返回 2xx（实际 ${res.httpStatus}）`,
    res.httpStatus >= 200 && res.httpStatus < 300,
  )
  check('信封含 code/message/data', res.code === 200 && 'message' in res && 'data' in res)

  const data = res.data ?? {}
  check('字段名是 accessToken（不是 token）', typeof data.accessToken === 'string')
  check('不存在 token 字段', data.token === undefined)
  check('expiresIn 是数字', typeof data.expiresIn === 'number')
  // 8h = 28800 秒。若是毫秒会是 28800000
  check(
    `expiresIn 单位是秒（收到 ${data.expiresIn}）`,
    data.expiresIn > 0 && data.expiresIn < 1_000_000,
    '大于 100 万说明是毫秒，前端 ×1000 会算错',
  )
  check('user.id 存在（登录响应是手工 DTO，用 id）', typeof data.user?.id === 'string')
  check(
    `user.role 是四角色之一（收到 ${data.user?.role}）`,
    ['owner', 'ops', 'sales', 'viewer'].includes(data.user?.role),
  )

  token = data.accessToken
  if (!token) {
    console.error('\n登录失败，后续检查无法进行:', JSON.stringify(res))
    process.exit(1)
  }
}

// -- 2. 鉴权失败的表达方式 ---------------------------------------------------

console.log('\n[2] 鉴权失败走 HTTP 200 + 业务码（前端拦截器依赖这点）')
{
  const saved = token
  token = 'obviously-not-a-jwt'
  const res = await call('GET', '/auth/profile')
  check(
    'token 无效时 HTTP 状态仍是 200',
    res.httpStatus === 200,
    `实际 ${res.httpStatus}，若是 401 则前端应改判 response.status`,
  )
  check(`业务码是 1103（收到 ${res.code}）`, res.code === 1103)
  token = saved
}

// -- 3. 分页返回体 -----------------------------------------------------------

console.log('\n[3] 分页返回体形状')
for (const path of ['/license/list', '/customer/list', '/audit/list']) {
  const res = await call('GET', `${path}?page=1&pageSize=5`)
  const d = res.data ?? {}
  console.log(`  ${path}`)
  check(`  ${path} 有 items 数组`, Array.isArray(d.items))
  check(`  ${path} 没有 list 字段`, d.list === undefined)
  check(`  ${path} total 是数字`, typeof d.total === 'number')
  check(`  ${path} page/pageSize 平铺（不是 meta 嵌套）`,
    typeof d.page === 'number' && typeof d.pageSize === 'number' && d.meta === undefined)
}

// -- 4. 授权列表项字段 -------------------------------------------------------

console.log('\n[4] 授权列表项字段')
{
  const res = await call('GET', '/license/list?page=1&pageSize=5')
  const rows = res.data?.items ?? []
  if (rows.length === 0) {
    console.log('  (库里没有授权数据，跳过字段核对)')
  } else {
    const row = rows[0]
    check('主键是 _id（不是 id）', typeof row._id === 'string' && row.id === undefined)
    check('licenseNo 存在', typeof row.licenseNo === 'string')
    check('customerName 派生字段存在', 'customerName' in row)
    check('remainingDays 派生字段存在', 'remainingDays' in row)
    check(
      `type 是 formal/trial（收到 ${row.type}）`,
      ['formal', 'trial'].includes(row.type),
    )
    check(
      `status 是四态之一（收到 ${row.status}）`,
      ['pending', 'active', 'expired', 'void'].includes(row.status),
    )
    check('限额字段用 null 表达不限制', 'maxUsers' in row && 'tokenQuota' in row)
    check('featuresJson 存在（null = 全功能）', 'featuresJson' in row)
    check('overLimitRatio 是数字', typeof row.overLimitRatio === 'number')

    // 详情：凭证历史
    const detail = await call('GET', `/license/${row._id}`)
    const dd = detail.data ?? {}
    check('详情含 credentials 数组', Array.isArray(dd.credentials))
    if (dd.credentials?.length) {
      const c = dd.credentials[0]
      check('凭证项用 id（不是 _id）', typeof c.id === 'string' && c._id === undefined)
      check('凭证项含 isCurrent 布尔', typeof c.isCurrent === 'boolean')
      check('凭证项含 downloadCount 数字', typeof c.downloadCount === 'number')
      check('凭证项含 issueReason', typeof c.issueReason === 'string')
    } else {
      console.log('  (该授权无凭证，跳过凭证项核对)')
    }
  }
}

// -- 5. 客户列表项 -----------------------------------------------------------

console.log('\n[5] 客户列表项字段')
{
  const res = await call('GET', '/customer/list?page=1&pageSize=5')
  const rows = res.data?.items ?? []
  if (rows.length === 0) {
    console.log('  (库里没有客户数据，跳过)')
  } else {
    const row = rows[0]
    check('主键是 _id', typeof row._id === 'string')
    check(
      `stage 是四阶段之一（收到 ${row.stage}）`,
      ['lead', 'trial', 'customer', 'churned'].includes(row.stage),
    )
    check(
      `source 是 manual/trial_auto（收到 ${row.source}）`,
      ['manual', 'trial_auto'].includes(row.source),
    )
    check(`status 是数字 tinyint（收到 ${row.status}）`, typeof row.status === 'number')
  }
}

// -- 6. 管理员列表 -----------------------------------------------------------

console.log('\n[6] 管理员列表字段')
{
  const res = await call('GET', '/auth/users')
  const rows = res.data ?? []
  if (!Array.isArray(rows)) {
    check('返回数组', false, `收到 ${typeof rows}`)
  } else if (rows.length === 0) {
    console.log('  (没有账号，跳过)')
  } else {
    const row = rows[0]
    check('主键是 _id（实体直出，与登录响应的 id 不同）', typeof row._id === 'string')
    check('不泄露 passwordHash', row.passwordHash === undefined)
    check(`status 是数字（收到 ${row.status}）`, typeof row.status === 'number')
    check('含 lockedUntil 字段', 'lockedUntil' in row)
    check('含 lastLoginAt 字段', 'lastLoginAt' in row)
  }
}

// -- 7. 签名密钥 -------------------------------------------------------------

console.log('\n[7] 签名密钥字段')
{
  const res = await call('GET', '/signing-key/list')
  const rows = res.data ?? []
  if (!Array.isArray(rows) || rows.length === 0) {
    check('返回数组', Array.isArray(rows))
    if (Array.isArray(rows) && rows.length === 0) console.log('  (没有密钥，跳过字段核对)')
  } else {
    const row = rows[0]
    check('含 kid', typeof row.kid === 'string')
    check('不泄露 privateKeyCipher', row.privateKeyCipher === undefined)
    check(
      `status 是三态之一（收到 ${row.status}）`,
      ['active', 'retiring', 'retired'].includes(row.status),
    )
    check('含 clientSince 字段（可为 null）', 'clientSince' in row)
    check('含 publicKey', typeof row.publicKey === 'string')
  }
}

// -- 8. 审计日志 -------------------------------------------------------------

console.log('\n[8] 审计日志字段与 action 取值')
{
  const res = await call('GET', '/audit/list?page=1&pageSize=20')
  const rows = res.data?.items ?? []
  if (rows.length === 0) {
    console.log('  (没有审计记录，跳过)')
  } else {
    const row = rows[0]
    check('主键是 _id', typeof row._id === 'string')
    check('含 detailJson 字段', 'detailJson' in row)
    check('含 actorName（冗余存名字）', 'actorName' in row)

    // 前端 AUDIT_ACTION_LABEL 覆盖了 16 个 action，核对真实数据里没有漏的
    const KNOWN = new Set([
      'admin.login', 'admin.locked', 'admin.create_user', 'admin.set_status',
      'admin.change_password', 'admin.reset_password',
      'customer.create', 'customer.update',
      'license.issue', 'license.renew', 'license.reissue', 'license.void',
      'credential.download',
      'signing_key.create', 'signing_key.activate', 'signing_key.retire',
    ])
    const unknown = [...new Set(rows.map(r => r.action))].filter(a => !KNOWN.has(a))
    check(
      '实际数据里的 action 都有中文标签',
      unknown.length === 0,
      unknown.length ? `未覆盖: ${unknown.join(', ')}` : '',
    )
  }
}

// -- 9. 权限不足的表达 -------------------------------------------------------

console.log('\n[9] 权限不足走 HTTP 200 + 业务码 1104')
{
  // 用 owner 账号访问不了任何越权接口，所以要一个 viewer 来试。
  //
  // 固定用户名、跑完复用，不要带时间戳。后端只有停用、没有删除管理员的
  // 接口，用时间戳的话每跑一次就在管理员列表里多留一个停用账号，跑十次
  // 列表里就有十行垃圾，真人账号反而被淹掉了。
  const username = '_contract_viewer'
  const password = 'ContractTest123456'

  const created = await call('POST', '/auth/users', {
    username,
    password,
    realName: '契约校验临时账号',
    role: 'viewer',
  })

  let userId = created.code === 200 ? created.data?._id : undefined

  if (!userId) {
    // 已经存在（上一次跑剩下的），找出来重新启用并把密码重置回已知值
    const list = await call('GET', '/auth/users')
    const rows = Array.isArray(list.data) ? list.data : (list.data?.items ?? [])
    const existing = rows.find(u => u.username === username)
    if (existing) {
      userId = existing._id
      await call('PUT', `/auth/users/${userId}/status`, { status: 1 })
      await call('PUT', `/auth/users/${userId}/password`, { password })
    }
  }

  if (!userId) {
    console.log(`  (拿不到临时 viewer 账号，跳过: ${created.message})`)
  } else {
    const login = await call('POST', '/auth/login', { username, password })
    const saved = token
    token = login.data?.accessToken

    // viewer 访问 owner 专属接口
    const denied = await call('GET', '/signing-key/list')
    check('越权时 HTTP 状态是 200', denied.httpStatus === 200, `实际 ${denied.httpStatus}`)
    check(`业务码是 1104（收到 ${denied.code}）`, denied.code === 1104)

    // viewer 能读授权列表（未标 @MinRole 的接口任意登录用户可访问）
    const allowed = await call('GET', '/license/list?page=1&pageSize=1')
    check('viewer 可以读授权列表', allowed.code === 200)

    token = saved
    await call('PUT', `/auth/users/${userId}/status`, { status: 0 })
    console.log(`  (已停用临时账号 ${username}，下次跑会复用同一个)`)
  }
}

// -- 汇总 --------------------------------------------------------------------

console.log(`\n${'='.repeat(60)}`)
console.log(`通过 ${passed} 项，失败 ${failures.length} 项`)
if (failures.length) {
  console.log('\n失败项：')
  failures.forEach(f => console.log(`  - ${f}`))
  process.exit(1)
}
console.log('前端类型假设与真后端响应一致')
