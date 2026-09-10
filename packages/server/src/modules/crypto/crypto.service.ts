import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  scryptSync,
  sign,
  timingSafeEqual,
  verify,
} from 'crypto'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ErrorEnum } from '@/constants/error-code.constant'
import { BusinessException } from '@/common/exceptions/biz.exception'
import { ISecurityConfig, securityRegToken } from '@/config'

const CIPHER_VERSION = 1
const IV_LENGTH = 12
const TAG_LENGTH = 16

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 32

/**
 * 对称加密、口令哈希与密钥对生成。
 *
 * 库里所有敏感字节（签名私钥、试用实例密钥）都用 LICENSE_MASTER_KEY 派生的
 * 密钥做 AES-256-GCM 加密后再落盘。这样 DB 备份泄露不等于签名能力泄露。
 */
@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name)
  private cachedMasterKey: Buffer | null = null

  constructor(private readonly configService: ConfigService) {}

  // -- 主密钥 ---------------------------------------------------------------

  private getMasterKey(): Buffer {
    if (this.cachedMasterKey) return this.cachedMasterKey

    const { masterKey } = this.configService.get<ISecurityConfig>(securityRegToken)
    if (!masterKey) {
      throw new BusinessException(ErrorEnum.MASTER_KEY_MISSING)
    }

    const raw = Buffer.from(masterKey, 'base64')
    if (raw.length !== 32) {
      throw new BusinessException(
        ErrorEnum.MASTER_KEY_MISSING,
        `期望 32 字节 base64，实际解出 ${raw.length} 字节`,
      )
    }

    this.cachedMasterKey = raw
    return raw
  }

  hasMasterKey(): boolean {
    const { masterKey } = this.configService.get<ISecurityConfig>(securityRegToken)
    return Boolean(masterKey) && Buffer.from(masterKey, 'base64').length === 32
  }

  // -- 对称加密 -------------------------------------------------------------

  /** 输出布局：[version(1)][iv(12)][tag(16)][ciphertext] */
  encrypt(plaintext: string | Buffer): Buffer {
    const key = this.getMasterKey()
    const iv = randomBytes(IV_LENGTH)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const data = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()])
    return Buffer.concat([Buffer.from([CIPHER_VERSION]), iv, cipher.getAuthTag(), encrypted])
  }

  decrypt(payload: Buffer): Buffer {
    const key = this.getMasterKey()

    if (!Buffer.isBuffer(payload) || payload.length < 1 + IV_LENGTH + TAG_LENGTH) {
      throw new BusinessException(ErrorEnum.MASTER_KEY_MISMATCH, '密文长度异常')
    }
    if (payload[0] !== CIPHER_VERSION) {
      throw new BusinessException(ErrorEnum.MASTER_KEY_MISMATCH, `未知密文版本 ${payload[0]}`)
    }

    const iv = payload.subarray(1, 1 + IV_LENGTH)
    const tag = payload.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + TAG_LENGTH)
    const ciphertext = payload.subarray(1 + IV_LENGTH + TAG_LENGTH)

    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(ciphertext), decipher.final()])
    } catch {
      // GCM 校验失败只有两种可能：主密钥被换了，或密文被改过。
      // 两种都是运维级事故，必须明确报出来而不是当成普通解析错误。
      this.logger.error('AES-GCM 解密失败，LICENSE_MASTER_KEY 可能已被更换')
      throw new BusinessException(ErrorEnum.MASTER_KEY_MISMATCH)
    }
  }

  decryptToString(payload: Buffer): string {
    return this.decrypt(payload).toString('utf8')
  }

  // -- 口令哈希 -------------------------------------------------------------

  /** 格式：scrypt$N$r$p$saltHex$hashHex */
  hashPassword(password: string): string {
    const salt = randomBytes(16)
    const hash = scryptSync(password, salt, SCRYPT_KEYLEN, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
    })
    return [
      'scrypt',
      SCRYPT_N,
      SCRYPT_R,
      SCRYPT_P,
      salt.toString('hex'),
      hash.toString('hex'),
    ].join('$')
  }

  verifyPassword(password: string, stored: string): boolean {
    const parts = stored?.split('$')
    if (parts?.length !== 6 || parts[0] !== 'scrypt') return false

    const [, n, r, p, saltHex, hashHex] = parts
    try {
      const expected = Buffer.from(hashHex, 'hex')
      const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, {
        N: Number(n),
        r: Number(r),
        p: Number(p),
      })
      return this.safeEqual(actual, expected)
    } catch {
      return false
    }
  }

  // -- 哈希与比较 -----------------------------------------------------------

  sha256Hex(...parts: (string | Buffer)[]): string {
    const hash = createHash('sha256')
    for (const part of parts) {
      hash.update(part)
      // 分隔符防止 ('ab','c') 与 ('a','bc') 撞成同一个哈希
      hash.update(Buffer.from([0x1f]))
    }
    return hash.digest('hex')
  }

  hmacSha256Hex(key: string | Buffer, data: string | Buffer): string {
    return createHmac('sha256', key).update(data).digest('hex')
  }

  safeEqual(a: Buffer | string, b: Buffer | string): boolean {
    const bufA = Buffer.isBuffer(a) ? a : Buffer.from(a, 'utf8')
    const bufB = Buffer.isBuffer(b) ? b : Buffer.from(b, 'utf8')
    if (bufA.length !== bufB.length) return false
    return timingSafeEqual(bufA, bufB)
  }

  // -- 随机值 ---------------------------------------------------------------

  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url')
  }

  randomUuid(): string {
    return randomUUID()
  }

  // -- 口令加密（不依赖主密钥）-----------------------------------------------

  /**
   * 用操作者提供的口令加密，**刻意不使用 LICENSE_MASTER_KEY**。
   *
   * 用途是签名密钥的导出包：它天生要跨实例搬运，而目标实例的主密钥通常
   * 与源实例不同。若用主密钥加密，导出包在目标实例根本解不开，也就失去
   * 了意义。同时导出包落在磁盘和邮件里的时间可能很长，明文导出等于把
   * 签发能力直接寄出去，所以必须加密。
   *
   * 布局：[version(1)][salt(16)][iv(12)][tag(16)][ciphertext]
   */
  encryptWithPassphrase(plaintext: string | Buffer, passphrase: string): string {
    const salt = randomBytes(16)
    const key = scryptSync(passphrase, salt, SCRYPT_KEYLEN, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
    })
    const iv = randomBytes(IV_LENGTH)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const data = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()])

    return Buffer.concat([
      Buffer.from([CIPHER_VERSION]),
      salt,
      iv,
      cipher.getAuthTag(),
      encrypted,
    ]).toString('base64')
  }

  decryptWithPassphrase(bundle: string, passphrase: string): Buffer {
    let payload: Buffer
    try {
      payload = Buffer.from(bundle, 'base64')
    } catch {
      throw new BusinessException(ErrorEnum.KEY_BUNDLE_INVALID)
    }

    const headerLen = 1 + 16 + IV_LENGTH + TAG_LENGTH
    if (payload.length <= headerLen || payload[0] !== CIPHER_VERSION) {
      throw new BusinessException(ErrorEnum.KEY_BUNDLE_INVALID)
    }

    const salt = payload.subarray(1, 17)
    const iv = payload.subarray(17, 17 + IV_LENGTH)
    const tag = payload.subarray(17 + IV_LENGTH, headerLen)
    const ciphertext = payload.subarray(headerLen)

    try {
      const key = scryptSync(passphrase, salt, SCRYPT_KEYLEN, {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
      })
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(ciphertext), decipher.final()])
    } catch {
      // 口令错和文件被改过在 GCM 这里是同一种失败，无法区分，
      // 也不该区分 —— 区分了就等于给爆破口令的人一个进度条
      throw new BusinessException(ErrorEnum.KEY_BUNDLE_INVALID)
    }
  }

  // -- Ed25519 密钥对 -------------------------------------------------------

  generateEd25519KeyPair(): { publicKeyPem: string; privateKeyPem: string } {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    return {
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    }
  }

  /**
   * 公钥指纹，取 SPKI DER 的 sha256 前 6 个十六进制字符。
   *
   * 哈希 DER 而不是 PEM 字符串：PEM 的折行位置与行尾（LF/CRLF）在不同
   * 平台上不一样，同一把密钥会算出不同的指纹，那这个指纹就没法用来
   * 判断"是不是同一把密钥"了。
   */
  publicKeyFingerprint(publicKeyPem: string, length = 6): string {
    const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' })
    return createHash('sha256').update(der).digest('hex').slice(0, length)
  }

  /** 私钥与公钥是否真的配对：签一段随机数据再用公钥验一次 */
  isKeyPairMatched(publicKeyPem: string, privateKeyPem: string): boolean {
    try {
      const probe = randomBytes(32)
      const signature = sign(null, probe, createPrivateKey(privateKeyPem))
      return verify(null, probe, createPublicKey(publicKeyPem), signature)
    } catch {
      return false
    }
  }
}
