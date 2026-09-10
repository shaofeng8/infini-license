/**
 * 把 SDK 源码同步到宿主项目。
 *
 * SDK 采用源码内嵌分发（见 docs/05-client-integration.md §1.3），不走私有
 * registry。手工复制迟早会漏文件或改错方向，所以固化成脚本：**同步只有一个
 * 方向，infini-license 是唯一源头。**
 *
 * 单测一起拷。宿主项目的 jest 会扫到它们，于是「拷坏了」在宿主项目跑测试时
 * 当场暴露，而不是等到客户环境验签失败。
 *
 * 用法：
 *   node scripts/sync-sdk.js            # 同步到所有已存在的目标
 *   node scripts/sync-sdk.js --check    # 只报告差异，不写入（给 CI 用）
 */
const {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} = require('fs')
const { join, resolve } = require('path')

const REPO_ROOT = resolve(__dirname, '..')
const SDK_SRC = join(REPO_ROOT, 'packages/sdk/src')
const WORKSPACE_ROOT = resolve(REPO_ROOT, '..')

/**
 * 同步目标。
 *
 * **只有会验签的项目才列在这里。** 这个清单编码的是架构决定，不是一个目录
 * 检查的结果 —— 早先的门槛是「`modules/license/` 存在就同步」，而 infiniSynapse
 * 后来也有了 `modules/license/`，干的却是「通过 HTTP 读 infini-proxy 的授权
 * 状态」这件事：它不碰 license.key、不验签、也不该有验签能力（见
 * docs/01-architecture.md）。按那个门槛跑一次同步，就会把整套验签代码塞进去，
 * 悄悄破掉这条边界，而且 `--check` 会一直报 31 处差异、逼着人去跑同步。
 *
 * 以后真有第三个项目需要验签，显式加进来，并在架构文档里说明为什么它需要。
 *
 * 只同步「父目录已存在」的目标：那说明该项目确实已经接入，避免往还没开始
 * 改造的项目里凭空塞代码。
 */
const TARGETS = [
  {
    name: 'infini-proxy',
    dir: join(WORKSPACE_ROOT, 'infini-proxy/packages/server/src/modules/license/sdk'),
  },
]

const BANNER = `# SDK 内嵌副本 —— 请勿手工修改

本目录由 \`infini-license/scripts/sync-sdk.js\` 从 \`infini-license/packages/sdk/src\`
整目录同步而来。**改这里的文件会在下次同步时被覆盖。**

要改动 SDK：

1. 在 \`infini-license/packages/sdk\` 里改，并补充单测
2. 在那边跑 \`pnpm test\`
3. 回到 \`infini-license\` 跑 \`node scripts/sync-sdk.js\`
4. 在本项目跑 \`pnpm test\` —— 单测一起同步过来了，能验证这次复制是完好的

之所以内嵌而不是发包：SDK 要随产品交付到客户私有环境，不能依赖私有 registry。
代价是多处副本，因此 SDK 有两条硬约束 —— **运行时依赖为空**（只用 Node 内置
\`crypto\`）、**核心逻辑是纯函数**。满足这两条时同步就是一次无脑覆盖。
`

function main() {
  const checkOnly = process.argv.includes('--check')
  const files = collect(SDK_SRC)
  let drifted = 0

  for (const target of TARGETS) {
    const moduleDir = resolve(target.dir, '..')
    if (!existsSync(moduleDir)) {
      console.log(`跳过 ${target.name}：尚未接入（${shortPath(moduleDir)} 不存在）`)
      continue
    }

    const changes = diff(files, target.dir)

    if (changes.length === 0) {
      console.log(`${target.name}：已是最新（${files.length} 个文件）`)
      continue
    }

    drifted += changes.length

    if (checkOnly) {
      console.log(`${target.name}：${changes.length} 处差异`)
      for (const change of changes) console.log(`  ${change.kind}  ${change.path}`)
      continue
    }

    apply(files, target.dir)
    writeFileSync(join(target.dir, 'README.md'), BANNER, 'utf8')
    console.log(`${target.name}：已同步 ${files.length} 个文件（${changes.length} 处变更）`)
    for (const change of changes) console.log(`  ${change.kind}  ${change.path}`)
  }

  if (checkOnly && drifted > 0) {
    console.error(`\n有 ${drifted} 处未同步。请运行 node scripts/sync-sdk.js`)
    process.exit(1)
  }

  if (!checkOnly && drifted > 0) {
    console.log('\n请在宿主项目里跑一遍单测确认复制完好。')
  }
}

function shortPath(absolute) {
  return absolute.slice(WORKSPACE_ROOT.length + 1).replace(/\\/g, '/')
}

/** 递归收集源文件。相对路径作为身份，保证目录结构一致 */
function collect(root, prefix = '') {
  const files = []
  for (const name of readdirSync(join(root, prefix))) {
    const rel = prefix ? `${prefix}/${name}` : name
    if (statSync(join(root, rel)).isDirectory()) {
      files.push(...collect(root, rel))
    } else if (name.endsWith('.ts')) {
      files.push({ path: rel, content: readFileSync(join(root, rel), 'utf8') })
    }
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : 1))
}

function diff(files, targetDir) {
  const changes = []
  const expected = new Set(files.map(file => file.path))

  for (const file of files) {
    const dest = join(targetDir, file.path)
    if (!existsSync(dest)) {
      changes.push({ kind: '新增', path: file.path })
    } else if (readFileSync(dest, 'utf8') !== file.content) {
      changes.push({ kind: '更新', path: file.path })
    }
  }

  // 源头删掉的文件必须在副本里也消失，否则会留下一个还能被 import 的旧模块
  if (existsSync(targetDir)) {
    for (const stale of collect(targetDir)) {
      if (!expected.has(stale.path)) {
        changes.push({ kind: '删除', path: stale.path })
      }
    }
  }

  return changes
}

function apply(files, targetDir) {
  // 整目录重建而不是增量覆盖：残留的旧文件仍然能被 import，是最难查的一类问题
  if (existsSync(targetDir)) {
    rmSync(targetDir, { recursive: true, force: true })
  }

  for (const file of files) {
    const dest = join(targetDir, file.path)
    mkdirSync(resolve(dest, '..'), { recursive: true })
    writeFileSync(dest, file.content, 'utf8')
  }
}

main()
