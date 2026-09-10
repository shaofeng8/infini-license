import { Column, Entity } from 'typeorm'
import { CreatedOnlyEntity } from '@/common/entity/common.entity'

@Entity('lc_audit_log')
export class AuditLogEntity extends CreatedOnlyEntity {
  @Column({ name: 'actor_id', length: 24, nullable: true })
  actorId: string | null

  /** 冗余存操作人名字：账号可能被改名或删除，审计记录必须自证 */
  @Column({ name: 'actor_name', length: 64, nullable: true })
  actorName: string | null

  @Column({ length: 64 })
  action: string

  @Column({ name: 'target_type', length: 32, nullable: true })
  targetType: string | null

  @Column({ name: 'target_id', length: 64, nullable: true })
  targetId: string | null

  @Column({ length: 255, nullable: true })
  summary: string | null

  @Column({ name: 'detail_json', type: 'json', nullable: true })
  detailJson: Record<string, any> | null

  @Column({ length: 64, nullable: true })
  ip: string | null
}
