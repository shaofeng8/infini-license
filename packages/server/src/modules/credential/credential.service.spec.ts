import { generateKeyPairSync } from 'crypto'
import { Repository } from 'typeorm'
import { JwsService } from '../crypto/jws.service'
import { CustomerEntity } from '../customer/customer.entity'
import { LicenseEntity } from '../license/license.entity'
import { SigningKeyService } from '../signing-key/signing-key.service'
import { CredentialEntity } from './credential.entity'
import { CredentialService } from './credential.service'
import { LicensePayload } from './credential.types'
import { parseLicenseEnvelope } from './license-envelope.util'

const KID = 'lk_2026a'

/**
 * 任意链式调用都返回自身的 QueryBuilder 替身，execute 返回空。
 * 不逐层手写 mock 是为了让测试不因 service 里多加一个 andWhere 就崩。
 */
function chainableStub(): any {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'execute' || prop === 'getMany' || prop === 'getOne') {
          return async () => undefined
        }
        return () => chainableStub()
      },
    },
  )
}

function makeKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  }
}

function makeLicense(overrides: Partial<LicenseEntity> = {}): LicenseEntity {
  return Object.assign(new (LicenseEntity as any)(), {
    _id: '68b0f1c2a3d4e5f601234567',
    licenseNo: 'LIC-2026-0007',
    customerId: '68b0f1c2a3d4e5f600000001',
    type: 'formal',
    product: 'infinisynapse',
    edition: 'enterprise',
    status: 'active',
    startAt: new Date('2026-09-09T00:00:00Z'),
    endAt: new Date('2027-09-09T00:00:00Z'),
    warnDays: 15,
    maxUsers: 50,
    maxConcurrentTasks: 10,
    tokenQuota: 100_000_000,
    tokenQuotaPeriod: 'total',
    taskQuota: null,
    taskQuotaPeriod: null,
    overLimitRatio: 1.1,
    featuresJson: ['wiki', 'dashboard'],
    bindMode: 'tofu',
    maxInstances: 1,
    telemetryEnabled: false,
    renewCount: 0,
    ...overrides,
  }) as LicenseEntity
}

function makeCustomer(): CustomerEntity {
  return Object.assign(new (CustomerEntity as any)(), {
    _id: '68b0f1c2a3d4e5f600000001',
    name: '某某集团',
    status: 1,
  }) as CustomerEntity
}

describe('CredentialService 签发往返', () => {
  const keyPair = makeKeyPair()
  let service: CredentialService
  let saved: CredentialEntity[]

  beforeEach(() => {
    saved = []

    const repo = {
      create: (input: Partial<CredentialEntity>) => ({ ...input }) as CredentialEntity,
      save: async (entity: CredentialEntity) => {
        const withId = { ...entity, _id: `cred${saved.length}` } as CredentialEntity
        saved.push(withId)
        return withId
      },
      findOne: async () => saved[0] ?? null,
      update: async () => undefined,
      createQueryBuilder: () => chainableStub(),
    } as unknown as Repository<CredentialEntity>

    const signingKeyService = {
      getActiveKey: async () => ({ kid: KID, publicKey: keyPair.publicKeyPem }),
      getPrivateKeyPem: async () => keyPair.privateKeyPem,
    } as unknown as SigningKeyService

    service = new CredentialService(repo, signingKeyService, new JwsService())
  })

  it('签发的 license.key 能被公钥验签，payload 与授权内容一致', async () => {
    const issued = await service.issue({
      license: makeLicense(),
      customer: makeCustomer(),
      reason: 'issue',
      operatorId: 'op1',
    })

    const jws = parseLicenseEnvelope(issued.envelope)
    expect(jws).toBe(issued.jws)

    const result = new JwsService().verify<LicensePayload>(jws, keyPair.publicKeyPem)
    expect(result.valid).toBe(true)
    expect(result.header.kid).toBe(KID)

    const payload = result.payload
    expect(payload.ver).toBe(2)
    expect(payload.typ).toBe('formal')
    expect(payload.lno).toBe('LIC-2026-0007')
    expect(payload.cname).toBe('某某集团')
    expect(payload.lic).toEqual({
      start: Math.floor(Date.parse('2026-09-09T00:00:00Z') / 1000),
      end: Math.floor(Date.parse('2027-09-09T00:00:00Z') / 1000),
    })
    expect(payload.limits.maxUsers).toBe(50)
    expect(payload.limits.tokenQuota).toEqual({ limit: 100_000_000, period: 'total' })
    expect(payload.features).toEqual(['wiki', 'dashboard'])
  })

  it('正式凭证的 telemetry 必须关闭 —— 这是与试用的根本区别', async () => {
    const issued = await service.issue({
      license: makeLicense(),
      customer: makeCustomer(),
      reason: 'issue',
    })

    const payload = new JwsService().verify<LicensePayload>(issued.jws, keyPair.publicKeyPem)
      .payload

    expect(payload.telemetry).toEqual({ enabled: false })
    expect(payload.telemetry).not.toHaveProperty('endpoint')
  })

  it('试用凭证携带上报端点与实例 id', async () => {
    const issued = await service.issue({
      license: makeLicense({ type: 'trial', licenseNo: 'TRL-2026-000042', telemetryEnabled: true }),
      customer: makeCustomer(),
      reason: 'trial_register',
      instanceId: 'inst1',
      telemetryEndpoint: 'https://license.example.com/api',
    })

    const payload = new JwsService().verify<LicensePayload>(issued.jws, keyPair.publicKeyPem)
      .payload

    expect(payload.typ).toBe('trial')
    expect(payload.telemetry.enabled).toBe(true)
    expect(payload.telemetry.endpoint).toBe('https://license.example.com/api')
    expect(payload.telemetry.instanceId).toBe('inst1')
  })

  it('永久授权的 lic.end 为 null，且信封头显示「永久」', async () => {
    const issued = await service.issue({
      license: makeLicense({ endAt: null }),
      customer: makeCustomer(),
      reason: 'issue',
    })

    const payload = new JwsService().verify<LicensePayload>(issued.jws, keyPair.publicKeyPem)
      .payload

    expect(payload.lic.end).toBeNull()
    expect(issued.envelope).toContain('Valid-Until:  永久')
  })

  it('限额为 null 时凭证里也是 null，代表不限制', async () => {
    const issued = await service.issue({
      license: makeLicense({
        maxUsers: null,
        maxConcurrentTasks: null,
        tokenQuota: null,
        tokenQuotaPeriod: null,
        featuresJson: null,
      }),
      customer: makeCustomer(),
      reason: 'issue',
    })

    const payload = new JwsService().verify<LicensePayload>(issued.jws, keyPair.publicKeyPem)
      .payload

    expect(payload.limits.maxUsers).toBeNull()
    expect(payload.limits.tokenQuota).toBeNull()
    expect(payload.features).toBeNull()
  })

  it('凭证里没有 exp —— 过期后仍要能解析出客户名与到期日用于阻断页', async () => {
    const issued = await service.issue({
      license: makeLicense(),
      customer: makeCustomer(),
      reason: 'issue',
    })

    const payload = new JwsService().verify<LicensePayload>(issued.jws, keyPair.publicKeyPem)
      .payload

    expect(payload).not.toHaveProperty('exp')
  })

  it('checksum 是 JWS 的 SHA-256 前 16 位，可用于人工核对', async () => {
    const issued = await service.issue({
      license: makeLicense(),
      customer: makeCustomer(),
      reason: 'issue',
    })

    expect(issued.credential.checksum).toHaveLength(16)
    expect(issued.envelope).toContain(`Fingerprint:  ${issued.credential.checksum}`)
  })

  it('两次签发的 jti 不同，凭证内容不同', async () => {
    const first = await service.issue({
      license: makeLicense(),
      customer: makeCustomer(),
      reason: 'issue',
    })
    const second = await service.issue({
      license: makeLicense(),
      customer: makeCustomer(),
      reason: 'reissue',
    })

    expect(first.credential.jti).not.toBe(second.credential.jti)
    expect(first.jws).not.toBe(second.jws)
  })

  it('自检失败时中止签发，绝不把验不过的凭证发出去', async () => {
    const stranger = makeKeyPair()
    const brokenSigningKey = {
      // 公钥与私钥不配对，模拟密钥库被写坏
      getActiveKey: async () => ({ kid: KID, publicKey: stranger.publicKeyPem }),
      getPrivateKeyPem: async () => keyPair.privateKeyPem,
    } as unknown as SigningKeyService

    const brokenService = new CredentialService(
      { create: (i: any) => i, save: async (e: any) => e } as unknown as Repository<CredentialEntity>,
      brokenSigningKey,
      new JwsService(),
    )

    await expect(
      brokenService.issue({
        license: makeLicense(),
        customer: makeCustomer(),
        reason: 'issue',
      }),
    ).rejects.toThrow(/自检/)
  })
})
