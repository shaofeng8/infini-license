/**
 * lc_usage_task 的容量压测。
 *
 * 为什么要这么一出：用量明细是这套系统里唯一会无界增长的表 —— 客户每跑一个
 * 任务就多一行，而聚合是**每次上报都重算当天**的。空表上 EXPLAIN 看不出问题，
 * 优化器在小表上会选全表扫且代价确实更低；只有真堆到千万行，索引选得对不对
 * 才会变成秒与分钟的差别。
 *
 * 跑在独立的影子库里，表结构从真库 SHOW CREATE TABLE 抄过来 —— 手写一份 DDL
 * 迟早会与真库漂移，那时压测量的就是另一张表了。
 *
 * **为什么默认一百万行而不是一千万。** 要量的是「一次上报要扫多少行」，而聚合
 * 是按 `instance_id` 收敛的，所以这个量只跟**单个实例有多少行**成正比，跟全表
 * 多少行无关。堆到一千万不会让结论更成立，只是把同一个放大倍数换个绝对数字
 * 说一遍，代价是 6.6 GB 和越写越慢的生成过程（写到三百万时已从 1.8 万行/秒掉
 * 到 6 千行/秒）。所以规模用在偏斜上：一百万行里让一个重度实例占六十万，相当
 * 于一个跑满一年的重度客户。真要看一千万的数字，`--rows=10000000`。
 *
 * 用法：
 *   node scripts/usage-loadtest.js              # 建库造数 + 出报告
 *   node scripts/usage-loadtest.js --rows=10000000
 *   node scripts/usage-loadtest.js --reuse      # 复用上次的数据，只重跑查询
 *   node scripts/usage-loadtest.js --fix        # 补上候选索引后再量一遍
 *   node scripts/usage-loadtest.js --drop       # 清掉影子库
 */
require('dotenv').config()

const mysql = require('mysql2/promise')

const args = process.argv.slice(2)
const flag = name => args.includes(`--${name}`)
const option = (name, fallback) => {
  const hit = args.find(a => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const TOTAL_ROWS = Number(option('rows', 1_000_000))
const SHADOW_DB = option('db', 'infini_license_loadtest')
const SOURCE_DB = process.env.MYSQL_DATABASE || 'infini_license'
const TABLES = ['lc_usage_task', 'lc_user_ref', 'lc_usage_daily']

/**
 * 数据分布。
 *
 * 刻意做成偏斜的：一个重度客户占大头，其余分散。均匀分布会把问题冲淡 ——
 * 聚合是按 instance_id 收敛的，所以真正决定单次聚合代价的是**最大那个实例
 * 有多少行**，而不是全表多少行。真实场景里一个跑满一年的重度客户就是这样。
 */
const HEAVY_SHARE = 0.6
const OTHER_INSTANCES = 19
const DAYS = 180

const REPORT = []

async function main() {
  const pool = await mysql.createPool({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || process.env.MYSQL_ROOT_PASSWORD,
    multipleStatements: true,
    connectionLimit: 4,
  })

  try {
    if (flag('drop')) {
      await pool.query(`DROP DATABASE IF EXISTS \`${SHADOW_DB}\``)
      console.log(`已清掉影子库 ${SHADOW_DB}`)
      return
    }

    if (!flag('reuse')) {
      await prepareSchema(pool)
      await generate(pool)
    }

    await pool.query(`USE \`${SHADOW_DB}\``)
    const scale = await describeScale(pool)

    console.log('\n== 现状：查询计划与耗时 ==\n')
    await measureAll(pool, scale, '现状')
    printReport('现状')

    if (flag('fix')) {
      console.log('\n补上候选索引 idx_usage_task_instance_date …')
      const t = Date.now()
      await pool.query(
        'CREATE INDEX idx_usage_task_instance_date ON lc_usage_task (instance_id, stat_date)',
      )
      await pool.query('ANALYZE TABLE lc_usage_task')
      console.log(`建索引用时 ${((Date.now() - t) / 1000).toFixed(1)}s`)

      console.log('\n== 补索引后 ==\n')
      await measureAll(pool, scale, '补索引后')
      printReport('补索引后')
      printDelta()
    }
  } finally {
    await pool.end()
  }
}

// -- 建库造数 ----------------------------------------------------------------

async function prepareSchema(pool) {
  console.log(`影子库 ${SHADOW_DB}：从 ${SOURCE_DB} 抄表结构`)
  await pool.query(`DROP DATABASE IF EXISTS \`${SHADOW_DB}\``)
  await pool.query(`CREATE DATABASE \`${SHADOW_DB}\``)

  for (const table of TABLES) {
    const [rows] = await pool.query(`SHOW CREATE TABLE \`${SOURCE_DB}\`.\`${table}\``)
    const ddl = rows[0]['Create Table']
    await pool.query(`USE \`${SHADOW_DB}\``)
    await pool.query(ddl)
    console.log(`  ${table} 已建`)
  }

  // 造数用的序号表。1 万行，两两交叉就能一次生成到百万级
  await pool.query('CREATE TABLE seq (n INT PRIMARY KEY)')
  await pool.query('SET SESSION cte_max_recursion_depth = 20000')
  await pool.query(
    'INSERT INTO seq WITH RECURSIVE c(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM c WHERE n < 9999) SELECT n FROM c',
  )
}

async function generate(pool) {
  await pool.query(`USE \`${SHADOW_DB}\``)
  const conn = await pool.getConnection()
  try {
    // 造数期间关掉逐事务刷盘。这是影子库，崩了就重跑，没有耐久性要求，
    // 但它能把千万行的写入从几十分钟压到几分钟。
    await conn.query('SET SESSION cte_max_recursion_depth = 20000')
    await conn.query('SET SESSION unique_checks = 0')
    await conn.query('SET SESSION foreign_key_checks = 0')

    const CHUNK = 500_000
    const chunks = Math.ceil(TOTAL_ROWS / CHUNK)
    console.log(`\n造数 ${TOTAL_ROWS.toLocaleString()} 行，分 ${chunks} 批`)

    const startedAt = Date.now()
    for (let i = 0; i < chunks; i++) {
      const offset = i * CHUNK
      const size = Math.min(CHUNK, TOTAL_ROWS - offset)
      await conn.query(insertSql(size, offset))
      const done = offset + size
      const rate = done / ((Date.now() - startedAt) / 1000)
      process.stdout.write(
        `\r  已写 ${done.toLocaleString()} 行（${Math.round(rate).toLocaleString()} 行/秒）    `,
      )
    }
    console.log(`\n造数用时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)

    // 用户假名表：聚合里的 new_user_count 子查询要读它
    await conn.query(`
      INSERT INTO lc_user_ref (_id, license_id, instance_id, user_ref, first_seen_at, last_seen_at, task_count, total_tokens)
      SELECT LPAD(CONV(a.n * 10000 + b.n, 10, 36), 24, '0'),
             CONCAT('lic', LPAD((a.n * 10000 + b.n) % ${OTHER_INSTANCES + 1}, 3, '0')),
             CONCAT('inst', LPAD((a.n * 10000 + b.n) % ${OTHER_INSTANCES + 1}, 3, '0')),
             SHA2(CONCAT('user', a.n * 10000 + b.n), 256),
             DATE_ADD('2026-01-01', INTERVAL (a.n * 10000 + b.n) % ${DAYS} DAY),
             NOW(3), 1, 1000
        FROM seq a JOIN seq b ON b.n < 5
       WHERE a.n < 1000
    `)

    console.log('统计信息重算中…')
    await conn.query('ANALYZE TABLE lc_usage_task, lc_user_ref')
  } finally {
    conn.release()
  }
}

/**
 * 一批明细的生成 SQL。
 *
 * `instance_id` 的分配是偏斜的：序号落在前 HEAVY_SHARE 的都归重度实例，
 * 其余按取模散开。`stat_date` 在 DAYS 天里循环，于是「某实例某一天」的行数
 * 就是聚合每次要碰的量。
 */
function insertSql(size, offset) {
  const heavyCut = Math.floor(TOTAL_ROWS * HEAVY_SHARE)
  // 序号在 SQL 里出现十来次，用占位符要传十几个同值参数，不如直接拼 —— 它是
  // 脚本自己算出来的整数，没有注入面。
  // b 的取值范围是每批算出来的，序号必须按它跨步而不是按固定的 10000 ——
  // 否则序号是稀疏的（0..19, 10000..10019, …），偏斜分布会整个失效。
  const bCount = Math.ceil(size / 10000)
  const seq = `(${offset} + a.n * ${bCount} + b.n)`
  const instance = `LPAD(IF(${seq} < ${heavyCut}, 0, ${seq} % ${OTHER_INSTANCES} + 1), 3, '0')`

  return `
    INSERT INTO lc_usage_task
      (_id, license_id, instance_id, task_id, parent_task_id, user_ref, source, status,
       started_at, finished_at, duration_ms, input_tokens, output_tokens,
       cache_read_tokens, cache_write_tokens, llm_call_count, stat_date)
    SELECT LPAD(CONV(${seq}, 10, 36), 24, '0'),
           CONCAT('lic', ${instance}),
           CONCAT('inst', ${instance}),
           CONCAT('task-', ${seq}),
           NULL,
           SHA2(CONCAT('user', ${seq} % 5000), 256),
           'app',
           ELT(1 + (a.n + b.n) % 3, 'completed', 'completed', 'failed'),
           DATE_ADD('2026-01-01 08:00:00', INTERVAL ${seq} % ${DAYS} DAY),
           DATE_ADD('2026-01-01 08:05:00', INTERVAL ${seq} % ${DAYS} DAY),
           300000,
           1000 + b.n, 200 + b.n, 0, 0, 3,
           DATE_ADD('2026-01-01', INTERVAL ${seq} % ${DAYS} DAY)
      FROM seq a JOIN seq b ON b.n < ${bCount}
     WHERE a.n < 10000
     LIMIT ${size}
  `
}

// -- 度量 --------------------------------------------------------------------

async function describeScale(pool) {
  const [[total]] = await pool.query('SELECT COUNT(*) AS c FROM lc_usage_task')
  const [heavy] = await pool.query(
    `SELECT instance_id, COUNT(*) AS c FROM lc_usage_task
      GROUP BY instance_id ORDER BY c DESC LIMIT 1`,
  )
  const [[day]] = await pool.query(
    `SELECT COUNT(*) AS c FROM lc_usage_task WHERE instance_id = ? AND stat_date = '2026-03-01'`,
    [heavy[0].instance_id],
  )
  const [[size]] = await pool.query(
    `SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024) AS mb
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'lc_usage_task'`,
    [SHADOW_DB],
  )

  // 取一个真实存在的 task_id，否则幂等查重那条会命中「const table 里没有行」
  // 的短路，测出来的是空查询而不是索引查找
  const [[sample]] = await pool.query(
    'SELECT task_id FROM lc_usage_task WHERE instance_id = ? LIMIT 1',
    [heavy[0].instance_id],
  )

  console.log(
    `\n规模：全表 ${Number(total.c).toLocaleString()} 行 / ${size.mb} MB，` +
      `最大实例 ${heavy[0].instance_id} 占 ${Number(heavy[0].c).toLocaleString()} 行，` +
      `该实例单日 ${Number(day.c).toLocaleString()} 行`,
  )

  return {
    instanceId: heavy[0].instance_id,
    instanceRows: Number(heavy[0].c),
    taskId: sample.task_id,
  }
}

const CASES = scale => [
  {
    name: '聚合当天（每次上报都跑）',
    why: '真实调用点：usage.service.ts 的 recomputeDaily，每批上报一次',
    sql: `SELECT COUNT(*), SUM(status = 'completed'), COUNT(DISTINCT user_ref),
                 SUM(input_tokens), SUM(output_tokens), SUM(llm_call_count)
            FROM lc_usage_task WHERE instance_id = ? AND stat_date = ?`,
    params: [scale.instanceId, '2026-03-01'],
  },
  {
    name: '新用户数子查询',
    why: '同一条聚合语句里的相关子查询，DATE() 包住了列',
    sql: `SELECT COUNT(*) FROM lc_user_ref r
           WHERE r.instance_id = ? AND DATE(r.first_seen_at) = ?`,
    params: [scale.instanceId, '2026-03-01'],
  },
  {
    name: '上报幂等查重（每个任务一次）',
    why: 'upsertTask 的 ON DUPLICATE KEY，命中 uk_usage_task',
    sql: 'SELECT _id FROM lc_usage_task WHERE instance_id = ? AND task_id = ?',
    params: [scale.instanceId, scale.taskId],
  },
  {
    name: '按授权拉一段时间的明细（管理端）',
    why: '未来的用量分析页会这么查，验 idx_usage_task_license_date 够不够',
    sql: `SELECT COUNT(*), SUM(input_tokens + output_tokens) FROM lc_usage_task
           WHERE license_id = ? AND stat_date BETWEEN ? AND ?`,
    params: ['lic000', '2026-03-01', '2026-03-31'],
  },
  {
    name: '按授权拉一段时间的明细（占比小的授权）',
    why: '对照上一条：验「索引没被选中」是不是只因为那个授权占了全表大头',
    sql: `SELECT COUNT(*), SUM(input_tokens + output_tokens) FROM lc_usage_task
           WHERE license_id = ? AND stat_date BETWEEN ? AND ?`,
    params: ['lic005', '2026-03-01', '2026-03-31'],
  },
  {
    name: '按用户看用量（管理端）',
    why: '验 idx_usage_task_user',
    sql: `SELECT COUNT(*), SUM(input_tokens) FROM lc_usage_task
           WHERE instance_id = ? AND user_ref = ? AND stat_date BETWEEN ? AND ?`,
    params: [
      scale.instanceId,
      // 与造数时同一套假名算法
      require('crypto').createHash('sha256').update('user42').digest('hex'),
      '2026-01-01',
      '2026-06-30',
    ],
  },
]

async function measureAll(pool, scale, phase) {
  for (const item of CASES(scale)) {
    const [plan] = await pool.query(`EXPLAIN FORMAT=TRADITIONAL ${item.sql}`, item.params)
    const row = plan[0]

    // 跑三次取中位数：第一次含冷缓冲池，单次数字噪声太大
    const timings = []
    for (let i = 0; i < 3; i++) {
      const t = process.hrtime.bigint()
      await pool.query(item.sql, item.params)
      timings.push(Number(process.hrtime.bigint() - t) / 1e6)
    }
    timings.sort((a, b) => a - b)

    REPORT.push({
      phase,
      name: item.name,
      why: item.why,
      key: row.key || '（无）',
      rows: Number(row.rows),
      filtered: row.filtered,
      extra: row.Extra || '',
      ms: timings[1],
    })
  }
}

function printReport(phase) {
  for (const r of REPORT.filter(x => x.phase === phase)) {
    console.log(`【${r.name}】`)
    console.log(`  用途    ${r.why}`)
    console.log(`  用索引  ${r.key}`)
    console.log(`  预估行  ${r.rows.toLocaleString()}（filtered ${r.filtered}%）`)
    if (r.extra) console.log(`  Extra   ${r.extra}`)
    console.log(`  中位耗时 ${r.ms.toFixed(1)} ms`)
    console.log('')
  }
}

function printDelta() {
  console.log('== 对照 ==\n')
  for (const before of REPORT.filter(x => x.phase === '现状')) {
    const after = REPORT.find(x => x.phase === '补索引后' && x.name === before.name)
    if (!after) continue
    const times = before.ms / after.ms
    console.log(
      `${before.name}：${before.ms.toFixed(1)}ms → ${after.ms.toFixed(1)}ms（${times.toFixed(1)}×）` +
        `，扫描行 ${before.rows.toLocaleString()} → ${after.rows.toLocaleString()}` +
        `，索引 ${before.key} → ${after.key}`,
    )
  }
  console.log('')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
