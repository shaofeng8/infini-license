import { Column, Entity } from 'typeorm'
import { DocumentEntity } from '@/common/entity/common.entity'
import { LicensePayload } from './credential.types'

export type CredentialType = 'formal' | 'trial'
export type IssueReason =
  | 'issue'
  | 'renew'
  | 'reissue'
  | 'convert'
  | 'trial_register'
  | 'trial_extend'

@Entity('lc_credential')
export class CredentialEntity extends DocumentEntity {
  @Column({ length: 40, unique: true })
  jti: string

  @Column({ name: 'license_id', length: 24 })
  licenseId: string

  /** 正式凭证签发时客户环境还不存在，为 NULL */
  @Column({ name: 'instance_id', length: 24, nullable: true })
  instanceId: string | null

  @Column({ length: 32 })
  kid: string

  @Column({ name: 'cred_type', length: 16 })
  credType: CredentialType

  @Column({ name: 'issue_reason', length: 16, default: 'issue' })
  issueReason: IssueReason

  @Column({ name: 'issued_at', type: 'datetime', precision: 3 })
  issuedAt: Date

  @Column({ name: 'valid_from', type: 'datetime', precision: 3 })
  validFrom: Date

  @Column({ name: 'valid_until', type: 'datetime', precision: 3, nullable: true })
  validUntil: Date | null

  @Column({ name: 'payload_json', type: 'json' })
  payloadJson: LicensePayload

  /**
   * 完整凭证原文。存下来是为了支持后台重新下载 —— 客户丢文件是常事，
   * 重新签发会换 jti 与有效期起点，不如原样重发。
   */
  @Column({ type: 'longtext' })
  jws: string

  /** JWS 的 SHA-256 前 16 位，供电话里跟客户口头核对文件是否传对 */
  @Column({ length: 32 })
  checksum: string

  @Column({ name: 'download_count', default: 0 })
  downloadCount: number

  @Column({ name: 'last_download_at', type: 'datetime', precision: 3, nullable: true })
  lastDownloadAt: Date | null

  @Column({ name: 'superseded_by', length: 24, nullable: true })
  supersededBy: string | null

  @Column({ name: 'created_by', length: 24, nullable: true })
  createdBy: string | null
}
