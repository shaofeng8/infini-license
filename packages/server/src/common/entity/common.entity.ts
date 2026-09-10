import { randomBytes } from 'crypto'
import { BeforeInsert, Column, CreateDateColumn, PrimaryColumn, UpdateDateColumn } from 'typeorm'

/**
 * 与 infini-proxy 保持一致：主键是 24 位 hex 字符串而非自增 id。
 * 好处是签发凭证、导出报表时不泄露业务规模，也便于跨库引用。
 */
export function createObjectId() {
  return randomBytes(12).toString('hex')
}

export function isObjectId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value)
}

/** BIGINT 在 mysql2 里回来是字符串，统一转成 number */
export const bigintNumberTransformer = {
  to(value?: number | string | null) {
    if (value === undefined) return null
    return value
  },
  from(value?: number | string | null) {
    if (value === null || value === undefined || value === '') return value as null | undefined
    const numeric = Number(value)
    return Number.isNaN(numeric) ? value : numeric
  },
}

export const decimalNumberTransformer = {
  to(value?: number | null) {
    // undefined 必须原样透传，不能折成 null：折了之后 TypeORM 会显式写入
    // NULL，把列上的 DEFAULT 冲掉，NOT NULL 的列直接插入失败。
    // 只有显式传 null 才表示「就是要存 NULL」。
    if (value === undefined) return undefined
    return value
  },
  from(value?: string | number | null) {
    if (value === null || value === undefined) return null
    const numeric = Number(value)
    return Number.isNaN(numeric) ? null : numeric
  },
}

export abstract class DocumentEntity {
  @PrimaryColumn({ name: '_id', type: 'varchar', length: 24 })
  _id: string

  @BeforeInsert()
  ensureId() {
    if (!this._id) {
      this._id = createObjectId()
    }
  }

  toObject(): Record<string, any> {
    return Object.entries(this).reduce<Record<string, any>>((result, [key, value]) => {
      if (!key.startsWith('__') && typeof value !== 'function') {
        result[key] = value
      }
      return result
    }, {})
  }

  toJSON(): Record<string, any> {
    return this.toObject()
  }
}

/** 带 created_at / updated_at 的实体基类 */
export abstract class TimestampedEntity extends DocumentEntity {
  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt: Date
}

/** 只有 created_at 的日志类实体基类 */
export abstract class CreatedOnlyEntity extends DocumentEntity {
  @Column({ name: 'created_at', type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' })
  createdAt: Date
}
