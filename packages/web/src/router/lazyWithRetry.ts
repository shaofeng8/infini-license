import { lazy } from 'react'
import type { ComponentType } from 'react'

const RELOAD_FLAG = 'lc-chunk-reload-attempted'

function isDynamicImportError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error)
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
    text,
  )
}

/**
 * 懒加载 + 失败自动重载一次。
 *
 * 发新版本后旧页面还挂着，它引用的 chunk 文件名已经带了新 hash、老文件被
 * 清掉了，此时点任何一个懒加载路由都会白屏。刷一次就能拿到新 index.html，
 * 所以自动刷。用 sessionStorage 记标记避免刷不出来时陷入无限重载。
 */
export function lazyWithRetry<T extends ComponentType<Record<string, never>>>(
  importer: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      const mod = await importer()
      sessionStorage.removeItem(RELOAD_FLAG)
      return mod
    } catch (error) {
      if (typeof window !== 'undefined' && isDynamicImportError(error)) {
        if (sessionStorage.getItem(RELOAD_FLAG) !== 'true') {
          sessionStorage.setItem(RELOAD_FLAG, 'true')
          window.location.reload()
          // 永不 resolve，避免在刷新前先渲染出一个错误界面闪一下
          return new Promise<never>(() => {})
        }
        sessionStorage.removeItem(RELOAD_FLAG)
      }
      throw error
    }
  })
}
