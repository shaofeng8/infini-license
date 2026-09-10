import { Column, Entity } from 'typeorm'
import { DocumentEntity } from '@/common/entity/common.entity'

export type SigningKeyStatus = 'active' | 'retiring' | 'retired'

@Entity('lc_signing_key')
export class SigningKeyEntity extends DocumentEntity {
  @Column({ length: 32, unique: true })
  kid: string

  @Column({ length: 16, default: 'EdDSA' })
  algorithm: string

  @Column({ name: 'public_key', type: 'text' })
  publicKey: string

  @Column({ name: 'private_key_cipher', type: 'varbinary', length: 1024, select: false })
  privateKeyCipher: Buffer

  @Column({ length: 16, default: 'active' })
  status: SigningKeyStatus

  /**
   * 从哪个客户端版本起内置了这把公钥。
   * 离线客户端拿不到新公钥，用比它更新的 kid 签发的凭证在它那里必然验签失败，
   * 所以签发时要拿这个字段跟目标客户的版本比一比再告警。
   */
  @Column({ name: 'client_since', length: 32, nullable: true })
  clientSince: string | null

  @Column({ length: 255, nullable: true })
  remark: string | null

  @Column({ name: 'activated_at', type: 'datetime', precision: 3 })
  activatedAt: Date

  @Column({ name: 'retired_at', type: 'datetime', precision: 3, nullable: true })
  retiredAt: Date | null

  @Column({ name: 'created_at', type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' })
  createdAt: Date
}
