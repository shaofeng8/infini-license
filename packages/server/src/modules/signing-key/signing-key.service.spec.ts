import { randomBytes } from 'crypto'
import { ConfigService } from '@nestjs/config'
import { Repository } from 'typeorm'
import { securityRegToken } from '@/config'
import { CryptoService } from '../crypto/crypto.service'
import { SigningKeyEntity } from './signing-key.entity'
import { SigningKeyService } from './signing-key.service'

function makeCrypto(masterKey = randomBytes(32).toString('base64')) {
  return new CryptoService({
    get: (token: string) => (token === securityRegToken ? { masterKey } : undefined),
  } as unknown as ConfigService)
}

/**
 * 内存版仓库替身。只实现 service 真正用到的那几个方法 —— 用真 TypeORM
 * 就得拉起数据库，而这里要验的是 kid 生成与导入校验的逻辑，跟持久化无关。
 */
function makeRepo(rows: Partial<SigningKeyEntity>[] = []) {
  const store = [...rows]
  return {
    store,
    count: async () => store.length,
    // where 要真的生效：listPublicKeys 靠 [{active},{retiring}] 过滤，
    // 替身若原样返回全部，"未激活的密钥也在公钥清单里"那条断言就永远为真，
    // 哪怕实现把它存成了 retired
    find: async (options: any = {}) => {
      const where = options.where
      if (!where) return store
      const clauses = Array.isArray(where) ? where : [where]
      return store.filter(row =>
        clauses.some(clause =>
          Object.entries(clause).every(([field, value]) => (row as any)[field] === value),
        ),
      )
    },
    findOne: async ({ where }: any) =>
      store.find(k =>
        Object.entries(where).every(([field, value]) => (k as any)[field] === value),
      ) ?? null,
    create: (input: any) => input,
    save: async (entity: any) => {
      store.push(entity)
      return entity
    },
    update: async (criteria: any, patch: any) => {
      for (const row of store) {
        if (criteria.status && row.status === criteria.status) Object.assign(row, patch)
        if (criteria.kid && row.kid === criteria.kid) Object.assign(row, patch)
      }
    },
    createQueryBuilder: () => ({
      where: () => ({ getCount: async () => store.length }),
    }),
  } as unknown as Repository<SigningKeyEntity> & { store: Partial<SigningKeyEntity>[] }
}

describe('SigningKeyService', () => {
  describe('kid 生成', () => {
    it('kid 带上公钥指纹', async () => {
      const crypto = makeCrypto()
      const repo = makeRepo()
      const service = new SigningKeyService(repo, crypto)

      const key = await service.create()
      const year = new Date().getUTCFullYear()

      expect(key.kid).toMatch(new RegExp(`^lk_${year}a_[0-9a-f]{6}$`))
      expect(key.kid.endsWith(crypto.publicKeyFingerprint(key.publicKey))).toBe(true)
    })

    it('两个全新的库生成的首把密钥 kid 必须不同', async () => {
      // 这是本功能存在的全部理由。改回纯序号的话这条会失败：
      // 两个空库都会产出 lk_<year>a，而客户端按 kid 挑公钥，
      // 撞名会让新实例签出的凭证在存量客户端上报 signature 错误 ——
      // 一个看起来像"文件被篡改"、实际是"密钥换了"的误导性错误
      const freshA = new SigningKeyService(makeRepo(), makeCrypto())
      const freshB = new SigningKeyService(makeRepo(), makeCrypto())

      const a = await freshA.create()
      const b = await freshB.create()

      expect(a.kid).not.toBe(b.kid)
    })
  })

  describe('新密钥默认不接管签发', () => {
    it('不传 activate 时新密钥不是 active', async () => {
      const service = new SigningKeyService(makeRepo(), makeCrypto())

      expect((await service.create()).status).toBe('retiring')
    })

    it('不传 activate 时不动现有的 active 密钥', async () => {
      const repo = makeRepo([{ kid: 'lk_2026a_old', status: 'active' }])
      const service = new SigningKeyService(repo, makeCrypto())

      await service.create()

      expect(repo.store.find(k => k.kid === 'lk_2026a_old')?.status).toBe('active')
    })

    it('任何时候都只能有一把 active —— 老实现会同时留下两把', async () => {
      // 回归用例。老实现无论如何都把新密钥存成 active，只用 supersedeCurrent
      // 决定要不要降级老的；传 false 就会出现两把 active，而 getActiveKey()
      // 按 activatedAt DESC 取第一条，等于**静默**改用了客户端不认识的新密钥。
      // 那个开关的文案是「不立即启用」，干的却正好相反
      const repo = makeRepo([{ kid: 'lk_2026a_old', status: 'active' }])
      const service = new SigningKeyService(repo, makeCrypto())

      await service.create()
      await service.create()

      expect(repo.store.filter(k => k.status === 'active')).toHaveLength(1)
    })

    it('显式 activate 时才接管，并把老的降为 retiring', async () => {
      const repo = makeRepo([{ kid: 'lk_2026a_old', status: 'active' }])
      const service = new SigningKeyService(repo, makeCrypto())

      const created = await service.create({ activate: true })

      expect(created.status).toBe('active')
      expect(repo.store.find(k => k.kid === 'lk_2026a_old')?.status).toBe('retiring')
    })

    it('未激活的新密钥仍会出现在公钥清单里', async () => {
      // 这是"先把公钥铺进客户端、之后再切换"能成立的前提。
      // 若存成 retired 就会被 listPublicKeys 排除，公钥永远进不了客户端
      const service = new SigningKeyService(makeRepo(), makeCrypto())
      const created = await service.create()

      expect((await service.listPublicKeys()).map(k => k.kid)).toContain(created.kid)
    })

    it('引导生成的首把密钥必须直接可用', async () => {
      // 库里没有别的密钥，不激活就等于装完一份凭证都签不出来
      const saved = process.env.NODE_ENV
      process.env.NODE_ENV = 'development'
      try {
        const service = new SigningKeyService(makeRepo(), makeCrypto())
        expect((await service.ensureBootstrapKey())?.status).toBe('active')
      } finally {
        process.env.NODE_ENV = saved
      }
    })
  })

  describe('导出与导入', () => {
    const passphrase = 'export-passphrase-1234'

    async function exportedFrom(crypto = makeCrypto()) {
      const repo = makeRepo()
      const service = new SigningKeyService(repo, crypto)
      const created = await service.create()
      // getPrivateKeyPem 走的是 addSelect 查询，替身仓库不支持，这里补一个
      jest
        .spyOn(service, 'getPrivateKeyPem')
        .mockResolvedValue(crypto.decryptToString(created.privateKeyCipher as Buffer))
      return { service, created, bundle: await service.exportKey(created.kid, passphrase) }
    }

    it('导出包能被另一个主密钥不同的实例导入，且公钥一致', async () => {
      const { created, bundle } = await exportedFrom()

      // 目标实例：全新的库 + 完全不同的 LICENSE_MASTER_KEY
      const target = new SigningKeyService(makeRepo(), makeCrypto())
      const imported = await target.importKey(bundle, passphrase, { activate: true })

      expect(imported.kid).toBe(created.kid)
      expect(imported.publicKey).toBe(created.publicKey)
      expect(imported.status).toBe('active')
    })

    it('导入后私钥用目标实例的主密钥重新加密，能正常解出且与原私钥一致', async () => {
      const sourceCrypto = makeCrypto()
      const { created, bundle } = await exportedFrom(sourceCrypto)

      const targetCrypto = makeCrypto()
      const target = new SigningKeyService(makeRepo(), targetCrypto)
      const imported = await target.importKey(bundle, passphrase)

      expect(targetCrypto.decryptToString(imported.privateKeyCipher)).toBe(
        sourceCrypto.decryptToString(created.privateKeyCipher as Buffer),
      )
    })

    it('口令不对时拒绝导入', async () => {
      const { bundle } = await exportedFrom()
      const target = new SigningKeyService(makeRepo(), makeCrypto())

      await expect(target.importKey(bundle, 'wrong-passphrase-xx')).rejects.toThrow(/导出包/)
    })

    it('公私钥不配对时拒绝导入', async () => {
      // 不校验的话，配错的密钥要等到第一次签发才在自检里暴露，
      // 而那时运营已经以为交付准备好了
      const crypto = makeCrypto()
      const { bundle } = await exportedFrom(crypto)
      const stranger = crypto.generateEd25519KeyPair()
      const tampered = { ...bundle, publicKey: stranger.publicKeyPem }

      const target = new SigningKeyService(makeRepo(), makeCrypto())

      await expect(target.importKey(tampered, passphrase)).rejects.toThrow(/不配对/)
    })

    it('kid 已存在时拒绝导入，不覆盖现有密钥', async () => {
      const { created, bundle } = await exportedFrom()
      const target = new SigningKeyService(makeRepo([created as any]), makeCrypto())

      await expect(target.importKey(bundle, passphrase)).rejects.toThrow(/已存在/)
    })

    it('格式标识不对的包直接拒绝', async () => {
      const { bundle } = await exportedFrom()
      const target = new SigningKeyService(makeRepo(), makeCrypto())

      await expect(
        target.importKey({ ...bundle, format: 'something-else' }, passphrase),
      ).rejects.toThrow(/导出包/)
    })

    it('导出包里不含任何明文私钥', async () => {
      const { bundle } = await exportedFrom()

      expect(JSON.stringify(bundle)).not.toContain('BEGIN PRIVATE KEY')
    })

    it('默认导入为 retiring，不自动接管签发', async () => {
      // 哪一把密钥能用取决于客户端内置的公钥列表，切换时机是运维决策，
      // 不该由"我刚导入了一把"自动触发
      const { bundle } = await exportedFrom()
      const target = new SigningKeyService(makeRepo(), makeCrypto())

      expect((await target.importKey(bundle, passphrase)).status).toBe('retiring')
    })
  })

  describe('生产环境的引导保护', () => {
    const originalEnv = process.env.NODE_ENV
    const originalAllow = process.env.ALLOW_BOOTSTRAP_SIGNING_KEY

    afterEach(() => {
      process.env.NODE_ENV = originalEnv
      if (originalAllow === undefined) delete process.env.ALLOW_BOOTSTRAP_SIGNING_KEY
      else process.env.ALLOW_BOOTSTRAP_SIGNING_KEY = originalAllow
    })

    it('生产环境空库时不自动生成 —— 灾备重建不该静默换掉签名密钥', async () => {
      process.env.NODE_ENV = 'production'
      delete process.env.ALLOW_BOOTSTRAP_SIGNING_KEY
      const repo = makeRepo()

      expect(await new SigningKeyService(repo, makeCrypto()).ensureBootstrapKey()).toBeNull()
      expect(await repo.count()).toBe(0)
    })

    it('显式放行后才生成', async () => {
      process.env.NODE_ENV = 'production'
      process.env.ALLOW_BOOTSTRAP_SIGNING_KEY = 'true'

      expect(
        await new SigningKeyService(makeRepo(), makeCrypto()).ensureBootstrapKey(),
      ).not.toBeNull()
    })

    it('非生产环境照常自动生成，不影响本地开发', async () => {
      process.env.NODE_ENV = 'development'
      delete process.env.ALLOW_BOOTSTRAP_SIGNING_KEY

      expect(
        await new SigningKeyService(makeRepo(), makeCrypto()).ensureBootstrapKey(),
      ).not.toBeNull()
    })

    it('库里已有密钥时不重复生成', async () => {
      process.env.NODE_ENV = 'development'
      const repo = makeRepo([{ kid: 'lk_2026a_abc123' }])

      expect(await new SigningKeyService(repo, makeCrypto()).ensureBootstrapKey()).toBeNull()
    })
  })
})
