import { randomBytes } from 'crypto'
import { ConfigService } from '@nestjs/config'
import { CryptoService } from './crypto.service'
import { securityRegToken } from '@/config'

function makeService(masterKey: string | undefined) {
  const configService = {
    get: (token: string) => (token === securityRegToken ? { masterKey } : undefined),
  } as unknown as ConfigService
  return new CryptoService(configService)
}

describe('CryptoService', () => {
  const validKey = randomBytes(32).toString('base64')

  describe('口令加密（签名密钥导出包）', () => {
    const passphrase = 'a-long-enough-passphrase'

    it('加解密往返一致', () => {
      const service = makeService(validKey)
      const pem = '-----BEGIN PRIVATE KEY-----\nMC4C...\n-----END PRIVATE KEY-----\n'

      const bundle = service.encryptWithPassphrase(pem, passphrase)

      expect(service.decryptWithPassphrase(bundle, passphrase).toString('utf8')).toBe(pem)
    })

    it('换一个主密钥的实例也能解开 —— 导出包跨实例搬运的前提', () => {
      // 这条是整个导出/导入功能存在的理由：目标实例的 LICENSE_MASTER_KEY
      // 与源实例不同，若导出包依赖主密钥，搬过去根本解不开
      const source = makeService(validKey)
      const target = makeService(randomBytes(32).toString('base64'))

      const bundle = source.encryptWithPassphrase('private-key-material', passphrase)

      expect(target.decryptWithPassphrase(bundle, passphrase).toString('utf8')).toBe(
        'private-key-material',
      )
    })

    it('口令错误时解不开', () => {
      const service = makeService(validKey)
      const bundle = service.encryptWithPassphrase('secret', passphrase)

      expect(() => service.decryptWithPassphrase(bundle, 'wrong-passphrase-x')).toThrow(
        /导出包/,
      )
    })

    it('导出包被改过一个字节就必须失败', () => {
      const service = makeService(validKey)
      const raw = Buffer.from(service.encryptWithPassphrase('secret', passphrase), 'base64')
      raw[raw.length - 1] ^= 0xff

      expect(() => service.decryptWithPassphrase(raw.toString('base64'), passphrase)).toThrow(
        /导出包/,
      )
    })

    it('相同明文两次导出产出不同密文（salt 与 IV 随机）', () => {
      const service = makeService(validKey)

      expect(service.encryptWithPassphrase('same', passphrase)).not.toBe(
        service.encryptWithPassphrase('same', passphrase),
      )
    })
  })

  describe('公钥指纹与配对校验', () => {
    it('同一把密钥指纹稳定，不同密钥指纹不同', () => {
      const service = makeService(validKey)
      const a = service.generateEd25519KeyPair()
      const b = service.generateEd25519KeyPair()

      expect(service.publicKeyFingerprint(a.publicKeyPem)).toBe(
        service.publicKeyFingerprint(a.publicKeyPem),
      )
      expect(service.publicKeyFingerprint(a.publicKeyPem)).not.toBe(
        service.publicKeyFingerprint(b.publicKeyPem),
      )
    })

    it('PEM 行尾从 LF 换成 CRLF 不影响指纹', () => {
      // 指纹哈希的是 SPKI DER 而不是 PEM 文本。若哈希文本，同一把密钥
      // 在 Windows 和 Linux 上会算出两个指纹，kid 就不再可比
      const service = makeService(validKey)
      const { publicKeyPem } = service.generateEd25519KeyPair()

      expect(service.publicKeyFingerprint(publicKeyPem.replace(/\n/g, '\r\n'))).toBe(
        service.publicKeyFingerprint(publicKeyPem),
      )
    })

    it('配对的公私钥通过校验，不配对的被识别出来', () => {
      const service = makeService(validKey)
      const a = service.generateEd25519KeyPair()
      const b = service.generateEd25519KeyPair()

      expect(service.isKeyPairMatched(a.publicKeyPem, a.privateKeyPem)).toBe(true)
      expect(service.isKeyPairMatched(a.publicKeyPem, b.privateKeyPem)).toBe(false)
    })

    it('传入垃圾内容时返回 false 而不是抛异常', () => {
      const service = makeService(validKey)

      expect(service.isKeyPairMatched('not-a-key', 'also-not-a-key')).toBe(false)
    })
  })

  describe('对称加密', () => {
    it('加解密往返一致', () => {
      const service = makeService(validKey)
      const plaintext = '-----BEGIN PRIVATE KEY-----\nMC4C...\n-----END PRIVATE KEY-----\n'

      expect(service.decryptToString(service.encrypt(plaintext))).toBe(plaintext)
    })

    it('相同明文两次加密产出不同密文（IV 随机）', () => {
      const service = makeService(validKey)

      expect(service.encrypt('same').equals(service.encrypt('same'))).toBe(false)
    })

    it('换掉主密钥后无法解密，且报的是主密钥不匹配', () => {
      const cipher = makeService(validKey).encrypt('secret')
      const other = makeService(randomBytes(32).toString('base64'))

      expect(() => other.decrypt(cipher)).toThrow(/主密钥/)
    })

    it('密文被篡改时 GCM 校验必须失败', () => {
      const service = makeService(validKey)
      const cipher = service.encrypt('secret')
      cipher[cipher.length - 1] ^= 0xff

      expect(() => service.decrypt(cipher)).toThrow(/主密钥/)
    })

    it('未配置主密钥时明确报错，而不是用空密钥加密', () => {
      const service = makeService('')

      expect(service.hasMasterKey()).toBe(false)
      expect(() => service.encrypt('x')).toThrow(/LICENSE_MASTER_KEY/)
    })

    it('主密钥长度不对时拒绝工作', () => {
      const service = makeService(randomBytes(16).toString('base64'))

      expect(service.hasMasterKey()).toBe(false)
      expect(() => service.encrypt('x')).toThrow(/32 字节/)
    })
  })

  describe('口令哈希', () => {
    const service = makeService(validKey)

    it('正确口令通过，错误口令不通过', () => {
      const hash = service.hashPassword('Str0ngPassword!')

      expect(service.verifyPassword('Str0ngPassword!', hash)).toBe(true)
      expect(service.verifyPassword('str0ngpassword!', hash)).toBe(false)
    })

    it('同一口令两次哈希结果不同（salt 随机）', () => {
      expect(service.hashPassword('same')).not.toBe(service.hashPassword('same'))
    })

    it('哈希串格式损坏时返回 false 而不是抛异常', () => {
      expect(service.verifyPassword('x', '')).toBe(false)
      expect(service.verifyPassword('x', 'bcrypt$whatever')).toBe(false)
      expect(service.verifyPassword('x', 'scrypt$1$2$3')).toBe(false)
    })
  })

  describe('哈希与比较', () => {
    const service = makeService(validKey)

    it('分段哈希不会因拼接方式不同而碰撞', () => {
      expect(service.sha256Hex('ab', 'c')).not.toBe(service.sha256Hex('a', 'bc'))
    })

    it('safeEqual 对长度不同的输入返回 false 而不抛异常', () => {
      expect(service.safeEqual('abc', 'abcd')).toBe(false)
      expect(service.safeEqual('abc', 'abc')).toBe(true)
    })
  })

  it('生成的 Ed25519 密钥对是合法 PEM', () => {
    const { publicKeyPem, privateKeyPem } = makeService(validKey).generateEd25519KeyPair()

    expect(publicKeyPem).toContain('BEGIN PUBLIC KEY')
    expect(privateKeyPem).toContain('BEGIN PRIVATE KEY')
  })
})
