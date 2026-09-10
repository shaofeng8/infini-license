/** 后端 TransformInterceptor 统一包装的响应信封 */
export interface ResOp<T = unknown> {
  code: number
  data?: T
  message: string
}

/**
 * 分页返回体。
 *
 * 字段名是 `items` 而不是 docs/04-api.md 早先写的 `list`，也不是 infini-proxy
 * 的 `{items, meta:{totalItems}}` —— 以 server 的 `PageResult<T>` 为准。
 */
export interface PageResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface PageQuery {
  page?: number
  pageSize?: number
}

export function emptyPage<T>(pageSize = 20): PageResult<T> {
  return { items: [], total: 0, page: 1, pageSize }
}
