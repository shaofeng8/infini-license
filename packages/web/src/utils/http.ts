import { createAlova } from 'alova'
import adapterFetch from 'alova/fetch'
import ReactHook from 'alova/react'
import { message } from 'antd'
import { useUserStore } from '@/stores/userStore'
import type { ResOp } from '@/types/base'
import { getApiBaseUrl } from './apiBaseUrl'

/** 后端 `ResOp` 的成功码 */
const SUCCESS_CODE = 200

/**
 * 鉴权相关的业务码，取自 server 的 `ErrorEnum`。
 *
 * **这些都是走 HTTP 200 回来的，不是 401/403。** `AllExceptionsFilter` 只对
 * 非 `BusinessException` 保留真实状态码，而 `JwtAuthGuard.handleRequest` 与
 * `RolesGuard` 两个守卫都是抛 `BusinessException`，所以身份失效和权限不足
 * 全部是 `200 + code`。按 `response.status` 判断会写出永远不执行的分支。
 */
const CODE_TOKEN_INVALID = 1103
const CODE_PERMISSION_DENIED = 1104

/** 并发请求同时失效时只提示一次，否则会叠一屏「登录已过期」 */
let handlingUnauthorized = false

function handleUnauthorized(text: string) {
  if (!handlingUnauthorized) {
    handlingUnauthorized = true
    message.error(text)
    setTimeout(() => {
      handlingUnauthorized = false
    }, 3000)
  }
  useUserStore.getState().clearSession(true)
}

/**
 * 请求级开关，挂在 alova 的 `meta` 上。
 *
 * - `rawText`  ：跳过 `ResOp` 解包直接取响应体文本。凭证下载走 `@Bypass`
 *                返回裸文件，走普通解包路径会因为「没有 code 字段」被判成异常
 * - `silent`   ：不弹错误提示，由调用方自己处理
 * - `skipAuth` ：不带 Authorization 头（登录接口）
 */
export interface RequestMeta {
  rawText?: boolean
  silent?: boolean
  skipAuth?: boolean
}

/** 已经弹过提示的错误打个标，避免 onError 再弹一次 */
const REPORTED = Symbol('reported')

function metaOf(method: unknown): RequestMeta {
  return ((method as { meta?: RequestMeta })?.meta ?? {}) as RequestMeta
}

function fail(text: string, silent: boolean, extra?: Record<string, unknown>) {
  if (!silent) message.error(text)
  return Object.assign(new Error(text), { [REPORTED]: !silent }, extra)
}

const alovaInstance = createAlova({
  baseURL: getApiBaseUrl(),
  timeout: 30_000,
  requestAdapter: adapterFetch(),
  statesHook: ReactHook,
  // 后台数据时效性要求高（刚签发就要在列表里看到），默认不缓存响应；
  // 个别需要缓存的地方在调用处显式开
  cacheFor: null,
  shareRequest: true,

  beforeRequest(method) {
    if (metaOf(method).skipAuth) return
    const { token } = useUserStore.getState()
    if (token) {
      method.config.headers.Authorization = `Bearer ${token}`
    }
  },

  responded: {
    async onSuccess(response, method) {
      const { rawText, silent = false } = metaOf(method)

      // 真实 HTTP 错误码只会来自非业务异常：限流（429）、请求体过大（413）、
      // 反代 502 之类。业务错误一律是 200
      if (!response.ok) {
        if (response.status === 429) {
          throw fail('请求过于频繁，请稍后再试', silent)
        }
        throw fail(`请求失败（HTTP ${response.status}）`, silent)
      }

      // @Bypass 接口返回裸文本，没有 ResOp 外壳
      if (rawText) {
        return response.text()
      }

      const body = (await response.json()) as ResOp<unknown>

      if (body.code === CODE_TOKEN_INVALID) {
        handleUnauthorized(body.message || '登录状态已失效，请重新登录')
        throw Object.assign(new Error(body.message), { [REPORTED]: true })
      }

      // 权限不足不清登录态：这是角色不够，不是身份失效。viewer 误点一下
      // 签发按钮就被踢下线，只会让人以为系统坏了
      if (body.code === CODE_PERMISSION_DENIED) {
        throw fail(body.message || '没有该操作的权限', silent, {
          forbidden: true,
          code: body.code,
        })
      }

      if (body.code !== SUCCESS_CODE) {
        throw fail(body.message || '请求失败', silent, { code: body.code })
      }

      return body.data
    },

    onError(error, method) {
      const alreadyReported = (error as Record<symbol, unknown>)?.[REPORTED]
      if (!alreadyReported && !metaOf(method).silent) {
        message.error(
          error instanceof Error && error.message
            ? error.message
            : '网络异常，请稍后重试',
        )
      }
      throw error
    },
  },
})

export default alovaInstance

/** 判断一个请求错误是否是「权限不足」，供页面决定要不要渲染 403 占位 */
export function isForbiddenError(error: unknown): boolean {
  return (error as { forbidden?: boolean })?.forbidden === true
}
