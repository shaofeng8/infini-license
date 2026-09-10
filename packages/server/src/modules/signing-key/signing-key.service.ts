import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { BusinessException } from '@/common/exceptions/biz.exception'
import { ErrorEnum } from '@/constants/error-code.constant'
import { CryptoService } from '../crypto/crypto.service'
import { SigningKeyEntity } from './signing-key.entity'

export interface CreateSigningKeyOptions {
  clientSince?: string
  remark?: string
  /**
   * 是否让这把新密钥立刻接管签发。**默认 false。**
   *
   * 默认不接管，是因为客户端内置的公钥清单随产品版本发布，离线客户装的
   * 是老版本、根本没有新公钥。用一把它们不认识的密钥去签，等于让此后
   * 每一份新发和续期的凭证在所有客户现场都验不过。
   *
   * 正确顺序永远是：生成（不激活）→ 公钥进客户端版本 → 版本铺到客户 →
   * 才 `activate`。
   */
  activate?: boolean
}

/** 导出包的格式标识。改结构时一并升版，避免老包被当成新格式解析 */
export const SIGNING_KEY_EXPORT_FORMAT = 'infini-license/signing-key@1'

/**
 * 签名密钥导出包。
 *
 * `privateKeyCipher` 是用**操作者口令**加密的（不是主密钥），所以这个
 * 结构可以安全地落在磁盘、走邮件、进密码管理器。但它加上口令就等于
 * 完整的签发能力，两者必须分开保管、分开传输。
 */
export interface SigningKeyExport {
  format: string
  kid: string
  algorithm: string
  publicKey: string
  clientSince: string | null
  remark: string | null
  exportedAt: string
  /** 公钥指纹，便于人工核对导入的是不是同一把 */
  fingerprint: string
  privateKeyCipher: string
}

@Injectable()
export class SigningKeyService {
  private readonly logger = new Logger(SigningKeyService.name)

  constructor(
    @InjectRepository(SigningKeyEntity)
    private readonly repo: Repository<SigningKeyEntity>,
    private readonly cryptoService: CryptoService,
  ) {}

  /**
   * 生成新的签名密钥对。私钥加密后落库，明文不出这个方法。
   *
   * **新密钥默认不接管签发**，只是入库等着被打包进客户端。要它真正开始
   * 签发得显式传 `activate: true`，或事后调 `activate(kid)`。
   *
   * 这里曾经有个很难看的缺陷，值得留着说明为什么现在要写得这么啰嗦：
   * 原实现无论如何都把新密钥存成 `status: 'active'`，只用一个
   * `supersedeCurrent` 决定要不要把老的降级。而 `getActiveKey()` 是按
   * `activatedAt DESC` 取第一条的，新密钥的 `activatedAt` 必然最新 ——
   * 于是传 `supersedeCurrent: false`（后台弹窗的默认值就是它）的结果是：
   * 老密钥仍标着 active、新密钥也标着 active 且排在前面，签发**立刻**
   * 改用了那把客户端根本不认识的新密钥。那个开关的文案写着「不立即启用」，
   * 干的却正好是它声称要避免的事，而且要等到客户换新凭证验不过才会发现。
   */
  async create(options: CreateSigningKeyOptions = {}): Promise<SigningKeyEntity> {
    const { publicKeyPem, privateKeyPem } = this.cryptoService.generateEd25519KeyPair()
    const kid = await this.nextKid(publicKeyPem)
    const activate = options.activate === true

    if (activate) {
      await this.repo.update({ status: 'active' }, { status: 'retiring' })
    }

    const entity = this.repo.create({
      kid,
      algorithm: 'EdDSA',
      publicKey: publicKeyPem,
      privateKeyCipher: this.cryptoService.encrypt(privateKeyPem),
      // 未激活的存成 retiring 而不是 retired：retiring 仍会出现在
      // listPublicKeys() 里，这正是"先把公钥打进客户端、之后再切换"
      // 所需要的状态。retired 则会被排除，公钥永远进不了客户端
      status: activate ? 'active' : 'retiring',
      clientSince: options.clientSince ?? null,
      remark: options.remark ?? null,
      activatedAt: new Date(),
      retiredAt: null,
    })

    const saved = await this.repo.save(entity)
    this.logger.log(
      activate
        ? `已生成签名密钥 ${kid} 并立即接管签发`
        : `已生成签名密钥 ${kid}（未接管签发，需先把公钥铺进客户端再 activate）`,
    )
    return saved
  }

  /** 当前用于签发的密钥 */
  async getActiveKey(): Promise<SigningKeyEntity> {
    const key = await this.repo.findOne({
      where: { status: 'active' },
      order: { activatedAt: 'DESC' },
    })
    if (!key) {
      throw new BusinessException(ErrorEnum.NO_ACTIVE_SIGNING_KEY)
    }
    return key
  }

  async findByKid(kid: string): Promise<SigningKeyEntity> {
    const key = await this.repo.findOne({ where: { kid } })
    if (!key) {
      throw new BusinessException(ErrorEnum.SIGNING_KEY_NOT_FOUND)
    }
    return key
  }

  /** 取出解密后的私钥 PEM。调用方用完即弃，不要缓存 */
  async getPrivateKeyPem(kid: string): Promise<string> {
    const key = await this.repo
      .createQueryBuilder('k')
      .addSelect('k.privateKeyCipher')
      .where('k.kid = :kid', { kid })
      .getOne()

    if (!key) {
      throw new BusinessException(ErrorEnum.SIGNING_KEY_NOT_FOUND)
    }
    return this.cryptoService.decryptToString(key.privateKeyCipher)
  }

  async list(): Promise<SigningKeyEntity[]> {
    return this.repo.find({ order: { activatedAt: 'DESC' } })
  }

  /** 公钥清单，供打包进客户端 SDK */
  async listPublicKeys(): Promise<{ kid: string; publicKey: string; clientSince: string | null }[]> {
    const keys = await this.repo.find({
      where: [{ status: 'active' }, { status: 'retiring' }],
      order: { activatedAt: 'ASC' },
    })
    return keys.map(k => ({ kid: k.kid, publicKey: k.publicKey, clientSince: k.clientSince }))
  }

  /** 提升为 active，同时把原 active 降为 retiring */
  async activate(kid: string): Promise<SigningKeyEntity> {
    const key = await this.findByKid(kid)
    if (key.status === 'retired') {
      throw new BusinessException(ErrorEnum.SIGNING_KEY_RETIRED)
    }
    await this.repo.update({ status: 'active' }, { status: 'retiring' })
    await this.repo.update({ kid }, { status: 'active', activatedAt: new Date(), retiredAt: null })
    return this.findByKid(kid)
  }

  /**
   * 彻底停用一把密钥。
   *
   * 注意这只影响**将来的签发**：已经发到客户手里的凭证仍然用这把密钥的签名，
   * 客户端也仍然内置着对应公钥，停用不构成吊销。真要作废已发凭证，只能
   * 重新签发一份并让客户替换文件。
   */
  async retire(kid: string): Promise<void> {
    const key = await this.findByKid(kid)
    if (key.status === 'active') {
      const otherUsable = await this.repo.count({ where: { status: 'retiring' } })
      if (otherUsable === 0) {
        throw new BusinessException(ErrorEnum.LAST_ACTIVE_KEY)
      }
    }
    await this.repo.update({ kid }, { status: 'retired', retiredAt: new Date() })
  }

  /**
   * 服务首次启动时确保有一把可用密钥。
   *
   * 生产环境默认**不自动生成**，必须显式开 `ALLOW_BOOTSTRAP_SIGNING_KEY=true`。
   *
   * 因为"库里一把密钥都没有"在生产上有两种截然不同的含义：一种是全新装机
   * （该生成），另一种是灾备重建、迁移、误清库（绝不该生成 —— 该做的是把
   * 原来那把导入回来）。这两种情况从代码里分辨不出来，而猜错第二种的代价
   * 是：服务默默生成一把新密钥，存量客户毫无感知地继续用着，但之后每一份
   * 续期凭证在客户现场都验不过，且离线客户拿不到内置新公钥的版本。
   *
   * 所以这里选择"不猜"：生产上宁可起不来签发（`getActiveKey()` 会抛出
   * 明确的 NO_ACTIVE_SIGNING_KEY），也不要静默生成。服务本身照常启动，
   * 运维可以登进后台导入密钥。
   */
  async ensureBootstrapKey(): Promise<SigningKeyEntity | null> {
    const existing = await this.repo.count()
    if (existing > 0) {
      return null
    }

    const isProduction = process.env.NODE_ENV === 'production'
    const allowed = process.env.ALLOW_BOOTSTRAP_SIGNING_KEY === 'true'

    if (isProduction && !allowed) {
      this.logger.error(
        '库中没有任何签名密钥，且生产环境不会自动生成。\n'
          + '  · 如果这是全新部署：设 ALLOW_BOOTSTRAP_SIGNING_KEY=true 重启一次，之后请立刻把公钥打包进客户端 SDK；\n'
          + '  · 如果这是灾备重建或迁移：不要生成新密钥，请用「导入签名密钥」把原来那把恢复回来。\n'
          + '  自动生成一把新密钥会让此后所有新签发的凭证在存量客户端上验签失败。',
      )
      return null
    }

    // 首把密钥必须直接接管签发：库里没有别的密钥，不激活就等于装完之后
    // 一份凭证都签不出来。这也是唯一一处该传 activate: true 的地方 ——
    // 此时还没有任何客户端在跑，不存在"客户端不认识这把公钥"的问题
    this.logger.warn('库中没有任何签名密钥，正在生成首把密钥')
    return this.create({ remark: '服务初始化自动生成', activate: true })
  }

  /**
   * kid 形如 `lk_2026a_9f3c1d`：年份 + 当年序号 + **公钥指纹**。
   *
   * 指纹这一段是必须的，原因是个真事：序号只跟"库里已有几把"有关，所以
   * 任何一个全新的库在 2026 年生成的第一把密钥都叫 `lk_2026a`。开发库
   * 一把、容器里重建一次又一把、生产灾备重建再一把 —— 全都叫同一个名字，
   * 但密钥内容完全不同。
   *
   * 而客户端是把 kid → 公钥钉死在 `trusted-keys.ts` 里的。撞名的后果：
   *
   * - 存量客户不受影响（他们手上的凭证是老密钥签的，照常验过），所以
   *   不会有任何告警；
   * - 但此后**每一份新签发或续期的凭证，在所有已部署客户端上都验不过**，
   *   表现为「给客户续了期，客户换上新文件反而更进不去了」；
   * - 客户端报的 reason 是 `signature`，看起来像文件被篡改，排查方向
   *   会被带到传输损坏、编辑器改行尾上去，而真因是密钥换了。
   *
   * 加上指纹之后，新实例产出的 kid 必然与老 kid 不同，客户端会明确报
   * `unknown_kid` —— 一眼就能看出是「客户端没有这把公钥」，而不是
   * 一个含义模糊的签名错误。
   */
  private async nextKid(publicKeyPem: string): Promise<string> {
    const year = new Date().getUTCFullYear()
    const prefix = `lk_${year}`
    const fingerprint = this.cryptoService.publicKeyFingerprint(publicKeyPem)

    const sameYear = await this.repo
      .createQueryBuilder('k')
      .where('k.kid LIKE :prefix', { prefix: `${prefix}%` })
      .getCount()

    const seq =
      sameYear >= 26
        // 一年换 26 把密钥属于异常运维行为，退化成数字后缀而不是静默出错
        ? `_${sameYear + 1}`
        : String.fromCharCode(97 + sameYear)

    return `${prefix}${seq}_${fingerprint}`
  }

  // -- 导出 / 导入 -----------------------------------------------------------

  /**
   * 导出一把密钥，供跨实例搬运（灾备重建、迁移、新建生产实例）。
   *
   * 私钥用**操作者口令**加密，不是用 LICENSE_MASTER_KEY —— 目标实例的
   * 主密钥通常不一样，用主密钥加密的包在那边根本解不开。
   *
   * 这是全系统权限最高的一个操作：拿到导出包和口令的人就能签发任意凭证。
   * 接口限 owner，并且无条件写审计。
   */
  async exportKey(kid: string, passphrase: string): Promise<SigningKeyExport> {
    const key = await this.findByKid(kid)
    const privateKeyPem = await this.getPrivateKeyPem(kid)

    return {
      format: SIGNING_KEY_EXPORT_FORMAT,
      kid: key.kid,
      algorithm: key.algorithm,
      publicKey: key.publicKey,
      clientSince: key.clientSince,
      remark: key.remark,
      exportedAt: new Date().toISOString(),
      fingerprint: this.cryptoService.publicKeyFingerprint(key.publicKey),
      privateKeyCipher: this.cryptoService.encryptWithPassphrase(privateKeyPem, passphrase),
    }
  }

  /**
   * 导入一把密钥。私钥会用**本实例**的主密钥重新加密后落库。
   *
   * 导入时校验公私钥是否真的配对：不校验的话，一把配错的密钥要等到
   * 第一次签发才在自检里暴露，而那时运营已经以为交付完成了。
   */
  async importKey(
    bundle: SigningKeyExport,
    passphrase: string,
    options: { activate?: boolean } = {},
  ): Promise<SigningKeyEntity> {
    if (bundle?.format !== SIGNING_KEY_EXPORT_FORMAT || !bundle.kid || !bundle.publicKey) {
      throw new BusinessException(ErrorEnum.KEY_BUNDLE_INVALID)
    }

    const existing = await this.repo.findOne({ where: { kid: bundle.kid } })
    if (existing) {
      throw new BusinessException(ErrorEnum.SIGNING_KEY_EXISTS)
    }

    const privateKeyPem = this.cryptoService
      .decryptWithPassphrase(bundle.privateKeyCipher, passphrase)
      .toString('utf8')

    if (!this.cryptoService.isKeyPairMatched(bundle.publicKey, privateKeyPem)) {
      throw new BusinessException(ErrorEnum.KEY_BUNDLE_MISMATCH)
    }

    if (options.activate) {
      await this.repo.update({ status: 'active' }, { status: 'retiring' })
    }

    const entity = this.repo.create({
      kid: bundle.kid,
      algorithm: bundle.algorithm || 'EdDSA',
      publicKey: bundle.publicKey,
      privateKeyCipher: this.cryptoService.encrypt(privateKeyPem),
      // 导入的密钥默认不接管签发。客户端内置的公钥列表决定了哪一把能用，
      // 什么时候切换是运维决策，不该由"我刚导入了一把"自动触发
      status: options.activate ? 'active' : 'retiring',
      clientSince: bundle.clientSince ?? null,
      remark: bundle.remark
        ? `${bundle.remark}（导入自 ${bundle.exportedAt}）`
        : `导入自 ${bundle.exportedAt}`,
      activatedAt: new Date(),
      retiredAt: null,
    })

    const saved = await this.repo.save(entity)
    this.logger.log(`已导入签名密钥 ${saved.kid}，status=${saved.status}`)
    return saved
  }
}
