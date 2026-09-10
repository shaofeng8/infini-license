import { generateKeyPairSync, sign } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DAY_MS, LICENSE_ISSUER } from '../constants'
import { LicensePayload } from '../types'
import { TrustedKey } from '../verify'
import { LicenseManager, LicenseManagerOptions } from './manager'
import { LicenseEvent, LicenseStore, PersistedState, createInitialState } from './store'

const KID = 'lk_test'
const MIRROR_SECRET = 'mirror-secret'
const NOW = Date.UTC(2026, 5, 1)

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const TRUSTED: TrustedKey[] = [
  { kid: KID, publicKey: publicKey.export({ type: 'spki', format: 'pem' }) as string },
]

/** 可控的内存 store，同时记录事件便于断言 */
class MemoryStore implements LicenseStore {
  state: PersistedState | null = null
  events: LicenseEvent[] = []
  /**
   * 只让读失败、写照常成功。
   *
   * 这不是造出来的极端情况：读超时而写还通是数据库压力下的常见形态，
   * 也正是「读失败被当成首次运行」这个缺陷唯一会造成数据损坏的组合。
   */
  failRead = false

  async readState() {
    if (this.failRead) throw new Error('db read timeout')
    return this.state ? { ...this.state } : null
  }
  async writeState(state: PersistedState) {
    this.state = { ...state }
  }
  async recordEvent(event: LicenseEvent) {
    this.events.push(event)
  }
  kinds() {
    return this.events.map(event => event.kind)
  }
}

describe('LicenseManager', () => {
  let dir: string
  let store: MemoryStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'infini-manager-'))
    store = new MemoryStore()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function build(overrides: Partial<LicenseManagerOptions> = {}, now = NOW) {
    return new LicenseManager({
      store,
      trustedKeys: TRUSTED,
      mirrorSecret: MIRROR_SECRET,
      mirrorFilePath: join(dir, 'mirror', '.runtime-state'),
      baseDir: dir,
      now: () => now,
      hostSignal: () => 'test-host',
      ...overrides,
    })
  }

  // -- 无凭证：试用 ---------------------------------------------------------

  describe('没有 license.key 时', () => {
    it('进入试用，并记下试用起点与 installId', async () => {
      const state = await build().init()

      expect(state.status).toBe('trial_active')
      expect(state.loginBlocked).toBe(false)
      expect(state.remainingDays).toBe(30)
      expect(store.state?.trialStartedAt).toBe(NOW)
      expect(store.state?.installId).toMatch(/^[0-9a-f-]{36}$/)
      expect(store.kinds()).toContain('file_missing')
    })

    it('试用起点只写一次，后续刷新不会顺延', async () => {
      await build().init()
      const original = store.state!.trialStartedAt

      const later = await build({}, NOW + 10 * DAY_MS).init()
      expect(store.state!.trialStartedAt).toBe(original)
      expect(later.remainingDays).toBe(20)
    })

    it('试用期满后阻断登录', async () => {
      await build().init()
      const state = await build({}, NOW + 31 * DAY_MS).init()

      expect(state.status).toBe('trial_expired')
      expect(state.loginBlocked).toBe(true)
    })

    it('关闭试用时直接进 missing 并阻断', async () => {
      const state = await build({ trialEnabled: false }).init()

      expect(state.status).toBe('missing')
      expect(state.loginBlocked).toBe(true)
      expect(store.state?.trialStartedAt).toBeNull()
    })

    it('清库但镜像还在时，试用期从原起点续算 —— 防重置的核心', async () => {
      await build().init()
      const originalStart = store.state!.trialStartedAt
      const originalInstallId = store.state!.installId

      // 模拟客户 DROP DATABASE 后重建
      store.state = null

      const state = await build({}, NOW + 25 * DAY_MS).init()

      expect(store.state!.trialStartedAt).toBe(originalStart)
      expect(store.state!.installId).toBe(originalInstallId)
      expect(state.remainingDays).toBe(5)
    })

    it('清库又删掉镜像才能真正重置 —— 两处都得处理', async () => {
      await build().init()
      store.state = null
      rmSync(join(dir, 'mirror'), { recursive: true, force: true })

      const state = await build({}, NOW + 25 * DAY_MS).init()
      expect(state.remainingDays).toBe(30)
    })
  })

  // -- 正式凭证 -------------------------------------------------------------

  describe('存在有效的 license.key 时', () => {
    beforeEach(() => {
      writeKeyFile(dir, mint({}))
    })

    it('判定为正式生效，并带出凭证里的展示信息', async () => {
      const state = await build().init()

      expect(state.status).toBe('formal_active')
      expect(state.loginBlocked).toBe(false)
      expect(state.licenseNo).toBe('LIC-2026-0001')
      expect(state.customerName).toBe('测试客户')
      expect(state.limits?.maxUsers).toBe(50)
      expect(store.kinds()).toContain('loaded')
    })

    it('不写入试用起点 —— 否则文件哪天读不到就会落回过期试用', async () => {
      await build().init()
      expect(store.state?.trialStartedAt).toBeNull()
    })

    it('首次运行完成 TOFU 指纹绑定', async () => {
      await build().init()

      expect(store.state?.boundFingerprint).toMatch(/^[0-9a-f]{64}$/)
      expect(store.kinds()).toContain('fingerprint_bound')
    })

    it('指纹不符只记事件，不阻断', async () => {
      await build().init()

      // installId 变了而绑定值还在。现实成因是基础设施变更——同一台主机上跑过
      // 别的实例、隐藏文件被带到了别处——不是盗用，所以不能据此锁人。
      store.state = { ...store.state!, installId: 'a-different-install' }
      rmSync(join(dir, 'mirror'), { recursive: true, force: true })

      const state = await build().init()
      expect(state.status).toBe('formal_active')
      expect(state.loginBlocked).toBe(false)
      expect(store.kinds()).toContain('fingerprint_mismatch')
    })

    it('bindMode 为 none 时不做指纹绑定', async () => {
      writeKeyFile(dir, mint({ bind: { mode: 'none' } }))
      await build().init()

      expect(store.state?.boundFingerprint).toBeNull()
      expect((await build().init()).status).toBe('formal_active')
    })

    it('临近到期时给出预警但不阻断', async () => {
      writeKeyFile(dir, mint({ lic: { start: sec(NOW - DAY_MS), end: sec(NOW + 5 * DAY_MS) } }))
      const state = await build().init()

      expect(state.status).toBe('formal_expiring')
      expect(state.warning).toBe(true)
      expect(state.loginBlocked).toBe(false)
    })

    it('过期后阻断登录', async () => {
      writeKeyFile(dir, mint({ lic: { start: sec(NOW - 90 * DAY_MS), end: sec(NOW - DAY_MS) } }))
      const state = await build().init()

      expect(state.status).toBe('formal_expired')
      expect(state.loginBlocked).toBe(true)
    })

    it('灰度模式下照常求值但不锁人', async () => {
      writeKeyFile(dir, mint({ lic: { start: sec(NOW - 90 * DAY_MS), end: sec(NOW - DAY_MS) } }))
      const state = await build({ enforce: false }).init()

      expect(state.status).toBe('formal_expired')
      expect(state.loginBlocked).toBe(false)
    })
  })

  // -- 坏凭证 ---------------------------------------------------------------

  describe('license.key 有问题时', () => {
    it('签名被篡改则判无效，且不降级成试用', async () => {
      const jws = mint({})
      const [header, payload, signature] = jws.split('.')
      const forged = Buffer.from(
        JSON.stringify({ ...decode(payload), lno: 'LIC-9999-9999' }),
        'utf8',
      ).toString('base64url')
      writeKeyFile(dir, `${header}.${forged}.${signature}`)

      const state = await build().init()
      expect(state.status).toBe('invalid')
      expect(state.invalidReason).toBe('signature')
      expect(state.loginBlocked).toBe(true)
      expect(store.kinds()).toContain('verify_failed')
    })

    it('公钥不认识的 kid 判无效', async () => {
      const other = generateKeyPairSync('ed25519')
      writeKeyFile(dir, mint({}, other.privateKey, 'lk_unknown'))

      expect((await build().init()).invalidReason).toBe('unknown_kid')
    })

    it('文件内容不是凭证时判 malformed，而不是当作没有文件', async () => {
      writeFileSync(join(dir, 'license.key'), '这里本该放凭证，但客户放错了内容')

      const state = await build().init()
      expect(state.status).toBe('invalid')
      expect(state.invalidReason).toBe('malformed')
      expect(store.state?.trialStartedAt).toBeNull()
    })

    it('签发方不符时判无效', async () => {
      writeKeyFile(dir, mint({ iss: 'someone-else' }))
      expect((await build().init()).invalidReason).toBe('issuer')
    })

    it('尚未到生效日时判无效', async () => {
      writeKeyFile(dir, mint({ lic: { start: sec(NOW + 10 * DAY_MS), end: sec(NOW + 400 * DAY_MS) } }))
      expect((await build().init()).invalidReason).toBe('not_yet_valid')
    })
  })

  // -- 热重载 ---------------------------------------------------------------

  describe('热重载', () => {
    it('换掉 license.key 后无需重启即可生效', async () => {
      writeKeyFile(dir, mint({ lic: { start: sec(NOW - 400 * DAY_MS), end: sec(NOW - DAY_MS) } }))
      const manager = build()

      expect((await manager.init()).status).toBe('formal_expired')

      // 客户运维把续期后的文件覆盖上去
      writeKeyFile(dir, mint({ lic: { start: sec(NOW - 400 * DAY_MS), end: sec(NOW + 365 * DAY_MS) } }))

      const state = await manager.refresh(true)
      expect(state.status).toBe('formal_active')
      expect(store.kinds()).toContain('reloaded')
    })

    it('文件没变化时不重复上报 reloaded', async () => {
      writeKeyFile(dir, mint({}))
      const manager = build()

      await manager.init()
      await manager.refresh(true)

      expect(store.kinds().filter(kind => kind === 'reloaded')).toHaveLength(0)
    })

    it('状态变化会留下事件，便于事后追查客户为何被锁', async () => {
      writeKeyFile(dir, mint({}))
      const manager = build()
      await manager.init()

      writeFileSync(join(dir, 'license.key'), 'broken')
      await manager.refresh(true)

      const changed = store.events.find(event => event.kind === 'status_changed')
      expect(changed?.status).toBe('invalid')
      expect(changed?.detail).toEqual({ from: 'formal_active' })
    })

    it('getState 同步返回缓存，不做 IO', async () => {
      writeKeyFile(dir, mint({}))
      const manager = build()
      await manager.init()

      expect(manager.getState().status).toBe('formal_active')
    })

    it('init 之前 getState 返回 checking 且不阻断', () => {
      // 启动瞬间就有请求进来时，不能因为还没判定完就把人拦在外面
      const state = build().getState()
      expect(state.status).toBe('checking')
      expect(state.loginBlocked).toBe(false)
    })
  })

  // -- 时钟 -----------------------------------------------------------------

  describe('时钟回拨', () => {
    it('大幅回拨直接阻断', async () => {
      writeKeyFile(dir, mint({}))
      await build().init()

      const state = await build({}, NOW - 30 * DAY_MS).init()
      expect(state.status).toBe('invalid')
      expect(state.invalidReason).toBe('clock_rollback')
      expect(store.kinds()).toContain('clock_rollback')
    })

    it('NTP 级别的小幅校时不受影响', async () => {
      writeKeyFile(dir, mint({}))
      await build().init()

      expect((await build({}, NOW - 60_000).init()).status).toBe('formal_active')
    })

    it('水位取库与镜像中更大的那个，改库调不低水位', async () => {
      writeKeyFile(dir, mint({}))
      await build({}, NOW + 5 * DAY_MS).init()

      // 客户直接改库把水位调回去
      store.state = { ...store.state!, maxSeenTs: NOW - 100 * DAY_MS }

      const state = await build({}, NOW + 5 * DAY_MS).init()
      expect(state.status).toBe('formal_active')
      expect(store.state.maxSeenTs).toBe(NOW + 5 * DAY_MS)
    })
  })

  // -- 试用身份 -------------------------------------------------------------

  describe('试用实例身份', () => {
    it('注册前拿不到身份', async () => {
      await build().init()
      expect(await build().getTrialIdentity()).toBeNull()
    })

    it('回填服务端下发的凭证后按试用凭证判定', async () => {
      const manager = build()
      await manager.init()

      const state = await manager.saveTrialIdentity({
        credentialJws: mint({
          typ: 'trial',
          lno: 'TRL-2026-000001',
          lic: { start: sec(NOW - DAY_MS), end: sec(NOW + 29 * DAY_MS) },
        }),
        instanceId: 'inst-1',
        instanceSecret: 'secret-1',
      })

      expect(state.status).toBe('trial_active')
      expect(state.licenseNo).toBe('TRL-2026-000001')
      expect(await manager.getTrialIdentity()).toEqual({
        instanceId: 'inst-1',
        instanceSecret: 'secret-1',
      })
    })

    it('试用凭证到期日与本地起点取更早的那个', async () => {
      const manager = build()
      await manager.init() // 本地起点 = NOW，30 天后到期

      // 服务端发了一份 90 天的试用凭证，本地起点应当压制它
      const state = await manager.saveTrialIdentity({
        credentialJws: mint({
          typ: 'trial',
          lic: { start: sec(NOW - DAY_MS), end: sec(NOW + 90 * DAY_MS) },
        }),
        instanceId: 'inst-1',
        instanceSecret: 'secret-1',
      })

      expect(state.remainingDays).toBe(30)
    })
  })

  // -- 容错 -----------------------------------------------------------------

  describe('依赖不可用时', () => {
    it('store 读写抛异常也不影响判定', async () => {
      writeKeyFile(dir, mint({}))
      const broken: LicenseStore = {
        readState: () => Promise.reject(new Error('db down')),
        writeState: () => Promise.reject(new Error('db down')),
        recordEvent: () => Promise.reject(new Error('db down')),
      }

      const state = await build({ store: broken }).init()
      expect(state.status).toBe('formal_active')
    })

    it('dbSignal 抛异常时按缺失处理', async () => {
      writeKeyFile(dir, mint({}))
      const state = await build({
        dbSignal: () => Promise.reject(new Error('no signal')),
      }).init()

      expect(state.status).toBe('formal_active')
    })

    it('镜像写不进去时只靠数据库那一份，不拒绝服务', async () => {
      writeKeyFile(dir, mint({}))
      writeFileSync(join(dir, 'blocker'), 'x')

      const state = await build({ mirrorFilePath: join(dir, 'blocker', 'sub', 'state') }).init()
      expect(state.status).toBe('formal_active')
      expect(store.state?.installId).toBeTruthy()
    })
  })

  // -- 凭证文件被误删 --------------------------------------------------------

  /**
   * 误删不是假想事故：挂载卷没挂上、compose 改错路径、运维清目录都会让文件
   * 凭空消失，而这些跟「授权到期」毫无关系。曾经这里有两种截然不同的坏结果
   * —— 原生正式客户被静默降级成 30 天试用（期间开始向我方上报，违背正式模式
   * 零出站的承诺），试用转正的客户则拿两年前的试用起点求值、当场全员锁死。
   */
  describe('license.key 被误删时', () => {
    it('正式客户仍按原到期日服务 —— 文件丢了不等于授权到期', async () => {
      writeKeyFile(dir, mint({}))
      const manager = build()
      expect((await manager.init()).status).toBe('formal_active')

      unlinkSync(join(dir, 'license.key'))
      const state = await manager.refresh(true)

      expect(state.status).toBe('formal_active')
      expect(state.loginBlocked).toBe(false)
      expect(state.remainingDays).toBe(365)
      expect(state.licenseNo).toBe('LIC-2026-0001')
    })

    it('重启后也能顶住 —— 容器重建时挂载卷丢了就是这个场景', async () => {
      writeKeyFile(dir, mint({}))
      await build().init()

      unlinkSync(join(dir, 'license.key'))

      // 新实例，只能从库里读
      const state = await build().init()
      expect(state.status).toBe('formal_active')
      expect(state.remainingDays).toBe(365)
    })

    it('试用转正的客户不会被那个早已过期的试用起点锁死', async () => {
      // 这台部署两年前先试用过，后来签了正式合同
      store.state = {
        ...createInitialState('install-1', NOW - 730 * DAY_MS),
        trialStartedAt: NOW - 730 * DAY_MS,
      }
      writeKeyFile(dir, mint({}))
      const manager = build()
      expect((await manager.init()).status).toBe('formal_active')

      unlinkSync(join(dir, 'license.key'))
      const state = await manager.refresh(true)

      expect(state.status).toBe('formal_active')
      expect(state.loginBlocked).toBe(false)
    })

    it('缓存不放宽授权：凭证本身到期了照样判过期', async () => {
      writeKeyFile(dir, mint({ lic: { start: sec(NOW - 400 * DAY_MS), end: sec(NOW + DAY_MS) } }))
      await build().init()
      unlinkSync(join(dir, 'license.key'))

      const state = await build({}, NOW + 10 * DAY_MS).init()
      expect(state.status).toBe('formal_expired')
      expect(state.loginBlocked).toBe(true)
    })

    it('验不过的文件不进缓存，换回正确文件仍能恢复', async () => {
      writeKeyFile(dir, '这不是一份凭证')
      expect((await build().init()).status).toBe('invalid')
      expect(store.state?.lastCredentialJws).toBeNull()

      writeKeyFile(dir, mint({}))
      expect((await build().init()).status).toBe('formal_active')
    })

    it('记一条事件说明文件丢了、正在用缓存顶着', async () => {
      writeKeyFile(dir, mint({}))
      const manager = build()
      await manager.init()

      unlinkSync(join(dir, 'license.key'))
      await manager.refresh(true)

      const missing = store.events.find(event => event.kind === 'file_missing')
      expect(missing?.detail?.servedFromCache).toBe(true)
    })

    it('热检查每分钟跑一次也只记一条，不把事件表刷满', async () => {
      writeKeyFile(dir, mint({}))
      const manager = build()
      await manager.init()
      unlinkSync(join(dir, 'license.key'))

      await manager.refresh(true)
      await manager.refresh(true)
      await manager.refresh(true)

      expect(store.events.filter(event => event.kind === 'file_missing')).toHaveLength(1)
    })

    it('文件放回来之后重新以文件为准', async () => {
      writeKeyFile(dir, mint({}))
      const manager = build()
      await manager.init()
      unlinkSync(join(dir, 'license.key'))
      await manager.refresh(true)

      // 客户把续期后的新文件放回来
      writeKeyFile(dir, mint({
        lno: 'LIC-2026-0002',
        lic: { start: sec(NOW - DAY_MS), end: sec(NOW + 700 * DAY_MS) },
      }))
      const state = await manager.refresh(true)

      expect(state.licenseNo).toBe('LIC-2026-0002')
      expect(state.remainingDays).toBe(700)
    })

    it('从来没放过文件的部署仍然正常进试用 —— 别把试用入口堵死', async () => {
      const state = await build().init()

      expect(state.status).toBe('trial_active')
      expect(store.state?.lastCredentialJws).toBeNull()
    })
  })

  // -- 读库失败 vs 读到空 ----------------------------------------------------

  /**
   * 这两件事以前都返回 null，于是一次读超时就被当成「首次运行」，再把临时
   * 拼出来的初始状态原封不动写回库，把真实记录整条盖掉。
   */
  describe('读库失败与读到空必须分开', () => {
    /** 真实记录：试用了 20 天、指纹已绑、实例已注册 */
    function seedRealRecord() {
      store.state = {
        ...createInitialState('install-real', NOW - 20 * DAY_MS),
        trialStartedAt: NOW - 20 * DAY_MS,
        boundFingerprint: 'fp-real',
        trialInstanceId: 'inst-real',
        trialInstanceSecret: 'secret-real',
      }
    }

    it('读库失败时不拿临时状态覆盖真实记录', async () => {
      seedRealRecord()
      store.failRead = true

      await build().init()

      expect(store.state!.installId).toBe('install-real')
      expect(store.state!.trialStartedAt).toBe(NOW - 20 * DAY_MS)
      expect(store.state!.boundFingerprint).toBe('fp-real')
      expect(store.state!.trialInstanceId).toBe('inst-real')
    })

    it('读库失败时也不写镜像 —— 那是库之外最后一份权威副本', async () => {
      seedRealRecord()
      store.failRead = true
      const mirrorFilePath = join(dir, 'mirror', '.runtime-state')

      await build({ mirrorFilePath }).init()

      expect(existsSync(mirrorFilePath)).toBe(false)
    })

    it('读库失败期间照常服务，不阻断', async () => {
      writeKeyFile(dir, mint({}))
      store.failRead = true

      const state = await build().init()
      expect(state.status).toBe('formal_active')
      expect(state.loginBlocked).toBe(false)
    })

    it('读库失败期间状态不权威，宿主靠它挡住试用注册', async () => {
      store.failRead = true
      const manager = build()
      await manager.init()

      expect(manager.isStateAuthoritative()).toBe(false)
    })

    it('读通之后恢复回写', async () => {
      seedRealRecord()
      store.failRead = true
      const manager = build()
      await manager.init()
      expect(manager.isStateAuthoritative()).toBe(false)

      store.failRead = false
      await manager.refresh(true)

      expect(manager.isStateAuthoritative()).toBe(true)
      expect(store.state!.installId).toBe('install-real')
      expect(store.state!.trialStartedAt).toBe(NOW - 20 * DAY_MS)
    })

    it('读到 null 才是首次运行，照常初始化并落库', async () => {
      store.state = null
      const manager = build()
      await manager.init()

      expect(manager.isStateAuthoritative()).toBe(true)
      expect(store.state).not.toBeNull()
      expect(store.state!.trialStartedAt).toBe(NOW)
    })
  })

  // -- 复制防护的真实边界 ----------------------------------------------------

  /**
   * 这一组不是「防护有效」的证明，恰恰相反：它把「防不住」这件事钉住。
   *
   * 交付方式是离线 + 放文件即生效、无激活动作，客户端首次启动时既不知道该绑谁、
   * 也没法问我们，技术上就无法阻止凭证被复制，约束只能靠合同。曾经有人以为 TOFU
   * 指纹拦得住并写进了注释和风险表，P8 演练把它证伪了。留这几条用例是为了让下一个
   * 想「加回那道校验」的人当场看见代价。
   */
  describe('复制防护的真实边界', () => {
    /** 另起一套部署：独立目录 + 独立 store */
    function otherDeployment() {
      const otherDir = mkdtempSync(join(tmpdir(), 'infini-other-'))
      const otherStore = new MemoryStore()
      return {
        dir: otherDir,
        store: otherStore,
        manager: () =>
          new LicenseManager({
            store: otherStore,
            trustedKeys: TRUSTED,
            mirrorSecret: MIRROR_SECRET,
            mirrorFilePath: join(otherDir, 'mirror', '.runtime-state'),
            baseDir: otherDir,
            now: () => NOW,
            hostSignal: () => 'other-host',
          }),
        cleanup: () => rmSync(otherDir, { recursive: true, force: true }),
      }
    }

    it('凭证被复制到全新部署会正常放行 —— 离线且免激活就是防不住', async () => {
      const jws = mint({})
      writeKeyFile(dir, jws)
      expect((await build().init()).status).toBe('formal_active')

      const other = otherDeployment()
      try {
        writeKeyFile(other.dir, jws)
        const copied = await other.manager().init()

        expect(copied.status).toBe('formal_active')
        expect(copied.loginBlocked).toBe(false)
      } finally {
        other.cleanup()
      }
    })

    it('整库迁移到新机器仍然正常 —— installId 跟着数据走，不跟机器', async () => {
      const jws = mint({})
      writeKeyFile(dir, jws)
      await build().init()
      const migrated = { ...store.state! }

      const other = otherDeployment()
      try {
        writeKeyFile(other.dir, jws)
        other.store.state = migrated

        const state = await other.manager().init()
        expect(state.status).toBe('formal_active')
        expect(other.store.state!.installId).toBe(migrated.installId)
      } finally {
        other.cleanup()
      }
    })

    it('容器重建（主机信号变了）仍然正常，且不该记指纹不符', async () => {
      writeKeyFile(dir, mint({}))
      await build().init()

      // docker compose down && up：hostname 变成新的容器短 ID
      const rebuilt = await build({ hostSignal: () => 'new-container-id' }).init()

      expect(rebuilt.status).toBe('formal_active')
      expect(store.kinds()).not.toContain('fingerprint_mismatch')
    })
  })

  // -- 时钟意外前跳后被修正 --------------------------------------------------

  /**
   * 走完整链路，因为纯函数级的用例盖不住一个致命细节：库与镜像调和时
   * `maxSeenTs` 取的是**更大**的那个。水位只在库里降下来是不够的，镜像会把
   * 毒化的值原样带回来，重启即复发。
   */
  describe('时钟意外前跳后被运维修正', () => {
    it('不锁人，且水位在库与镜像里都降了回来', async () => {
      writeKeyFile(dir, mint({}))
      await build().init()

      // BIOS 电池半死 / NTP 配错，时钟前拨 20 天
      const jumped = await build({}, NOW + 20 * DAY_MS).init()
      expect(jumped.loginBlocked).toBe(false)
      expect(store.state!.jumpBaseTs).toBe(NOW)

      const fixed = await build({}, NOW).init()
      expect(fixed.status).toBe('formal_active')
      expect(fixed.loginBlocked).toBe(false)
      expect(store.state!.maxSeenTs).toBe(NOW)
      expect(store.state!.jumpBaseTs).toBeNull()
      expect(store.kinds()).toContain('clock_corrected')

      // 关键一步：重启，镜像不能把毒化的水位带回来
      const restarted = await build({}, NOW + 60_000).init()
      expect(restarted.status).toBe('formal_active')
      expect(restarted.loginBlocked).toBe(false)
    })

    it('没有前跳记录的真实回拨照旧判死', async () => {
      writeKeyFile(dir, mint({}))
      await build({}, NOW + 20 * DAY_MS).init()

      const state = await build({}, NOW).init()
      expect(state.status).toBe('invalid')
      expect(state.invalidReason).toBe('clock_rollback')
      expect(state.loginBlocked).toBe(true)
    })

    /**
     * 恢复通道。留着它是因为「客户被时钟判死而我方在内网里毫无手段」是个真实
     * 事故面：重签凭证救不了（水位是本地状态，与凭证无关），清库也救不了
     * （镜像会把值带回来）。
     */
    it('resetClockWatermark() 能把被时钟判死的部署救回来', async () => {
      writeKeyFile(dir, mint({}))
      await build({}, NOW + 20 * DAY_MS).init()
      const locked = await build({}, NOW).init()
      expect(locked.loginBlocked).toBe(true)

      const manager = build({}, NOW)
      await manager.init()
      const rescued = await manager.resetClockWatermark()

      expect(rescued.status).toBe('formal_active')
      expect(rescued.loginBlocked).toBe(false)
      expect(store.state!.maxSeenTs).toBe(NOW)
      expect(store.state!.rollbackCount).toBe(0)
      expect(store.kinds()).toContain('clock_reset')

      // 重启后不能复发 —— 镜像里的水位也得跟着降
      expect((await build({}, NOW + 60_000).init()).loginBlocked).toBe(false)
    })

    it('镜像被改动过时记一条事件 —— 正常运维碰不到那个文件', async () => {
      await build().init()

      // MAC 对不上，readMirror 会判成被篡改
      const mirrorFile = join(dir, 'mirror', '.runtime-state')
      const payload = JSON.parse(readFileSync(mirrorFile, 'utf8'))
      payload.data.trialStartedAt = NOW - 100 * DAY_MS
      writeFileSync(mirrorFile, JSON.stringify(payload))

      const state = await build().init()

      expect(store.kinds()).toContain('mirror_tampered')
      // 判定不受影响：此时只剩数据库一份，而那一份并不因此变松
      expect(state.status).toBe('trial_active')
      expect(store.state!.trialStartedAt).toBe(NOW)
    })

    it('恢复通道只动水位，不碰试用起点与 installId', async () => {
      // 无凭证的试用部署：这里最怕它变成「一键重置试用期」
      const before = await build().init()
      expect(before.status).toBe('trial_active')
      const installId = store.state!.installId
      const trialStartedAt = store.state!.trialStartedAt

      const manager = build({}, NOW + 10 * DAY_MS)
      await manager.init()
      await manager.resetClockWatermark()

      expect(store.state!.installId).toBe(installId)
      expect(store.state!.trialStartedAt).toBe(trialStartedAt)
      // 试用照旧只剩 20 天，没有被续回 30 天
      expect((await build({}, NOW + 10 * DAY_MS).init()).remainingDays).toBe(20)
    })
  })
})

// -- 测试工具 ----------------------------------------------------------------

function sec(ms: number): number {
  return Math.floor(ms / 1000)
}

function decode(segment: string): LicensePayload {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
}

function writeKeyFile(dir: string, jws: string): void {
  writeFileSync(
    join(dir, 'license.key'),
    [
      '-----BEGIN INFINISYNAPSE LICENSE-----',
      'Customer:    测试客户',
      '',
      jws,
      '-----END INFINISYNAPSE LICENSE-----',
    ].join('\n'),
  )
}

/** 用测试密钥签一份凭证，只需覆盖关心的字段 */
function mint(
  overrides: Partial<LicensePayload>,
  key = privateKey,
  kid = KID,
): string {
  const payload: LicensePayload = {
    ver: 1,
    typ: 'formal',
    jti: 'cred-1',
    iss: LICENSE_ISSUER,
    lid: 'lic-1',
    lno: 'LIC-2026-0001',
    cid: 'cus-1',
    cname: '测试客户',
    prod: 'infinisynapse',
    edition: 'enterprise',
    iat: sec(NOW),
    lic: { start: sec(NOW - DAY_MS), end: sec(NOW + 365 * DAY_MS) },
    warnDays: 15,
    bind: { mode: 'tofu' },
    limits: { maxUsers: 50 },
    features: null,
    telemetry: { enabled: false },
    policy: {},
    ...overrides,
  }

  const header = Buffer.from(
    JSON.stringify({ alg: 'EdDSA', typ: 'INFI-LIC', kid }),
    'utf8',
  ).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const signature = sign(null, Buffer.from(`${header}.${body}`, 'utf8'), key).toString('base64url')

  return `${header}.${body}.${signature}`
}
