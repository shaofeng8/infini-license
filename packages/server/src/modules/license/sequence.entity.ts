import { Column, Entity, PrimaryColumn } from 'typeorm'
import { bigintNumberTransformer } from '@/common/entity/common.entity'

@Entity('lc_sequence')
export class SequenceEntity {
  @PrimaryColumn({ length: 32 })
  name: string

  @Column({ name: 'next_value', type: 'bigint', transformer: bigintNumberTransformer })
  nextValue: number

  @Column({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt: Date
}
