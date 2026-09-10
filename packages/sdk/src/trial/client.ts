import { stableStringify } from '../stable-json'
import { signRequest } from './signer'
import {
  HeartbeatRequest,
  HeartbeatResponse,
  TrialRegisterRequest,
  TrialRegisterResponse,
  TrialResult,
  UsageRequest,
  UsageResponse,
} from './types'

export interface TrialClientOptions {
  /** license 服务地址，例如 https://license.infinisynapse.cn */
  endpoint: string
  /** 试用实例身份。注册接口不需要 */
  identity?: { instanceId: string; instanceSecret: string } | null
  timeoutMs?: number
  now?: () => number
  /** 便于测试注入；默认用全局 fetch */
  fetchImpl?: typeof fetch
}

const PREFIX = '/api/client'
const DEFAULT_TIMEOUT_MS = 10_000

/**
 * 试用上报客户端。
 *
 * 只有试用客户会用到它 —— 正式客户的凭证里 `telemetry.enabled` 为 false，
 * 宿主项目根本不会构造这个类。
 *
 * 全部方法都不抛异常，失败以 `TrialResult` 返回。客户环境断网、我方服务
 * 挂掉、证书过期都不能影响客户用产品；把上报失败做成异常，早晚会有人忘记
 * 兜住而让整个功能崩掉。
 */
export class TrialClient {
  constructor(private readonly options: TrialClientOptions) {}

  async register(body: TrialRegisterRequest): Promise<TrialResult<TrialRegisterResponse>> {
    // 注册时还没有身份，这个接口靠限流和指纹查重而非 HMAC 保护
    return this.send('POST', '/trial/register', body, false)
  }

  async heartbeat(body: HeartbeatRequest): Promise<TrialResult<HeartbeatResponse>> {
    return this.send('POST', '/heartbeat', body, true)
  }

  async usage(body: UsageRequest): Promise<TrialResult<UsageResponse>> {
    return this.send('POST', '/usage', body, true)
  }

  private async send<T>(
    method: string,
    route: string,
    body: unknown,
    signed: boolean,
  ): Promise<TrialResult<T>> {
    const path = `${PREFIX}${route}`
    // 键序必须稳定：body 的哈希进了签名串，重新序列化换了顺序就验不过
    const rawBody = stableStringify(body)

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }

    if (signed) {
      const identity = this.options.identity
      if (!identity) {
        return { ok: false, retryable: false, error: '缺少试用实例身份，需先完成注册' }
      }
      Object.assign(
        headers,
        signRequest({
          method,
          path,
          rawBody,
          instanceId: identity.instanceId,
          instanceSecret: identity.instanceSecret,
          now: this.now(),
        }),
      )
    }

    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    )

    try {
      const fetchImpl = this.options.fetchImpl ?? fetch
      const response = await fetchImpl(`${trimEnd(this.options.endpoint)}${path}`, {
        method,
        headers,
        body: rawBody,
        signal: controller.signal,
      })

      const payload = (await response.json().catch(() => null)) as {
        code?: number
        data?: T
        message?: string
      } | null

      if (!response.ok || !payload) {
        return {
          ok: false,
          // 5xx 是我方的问题，重试有意义；4xx 是请求本身不对，重试只是白费流量
          retryable: response.status >= 500 || response.status === 429,
          error: payload?.message ?? `HTTP ${response.status}`,
          code: payload?.code,
        }
      }

      if (payload.code !== 200) {
        return {
          ok: false,
          retryable: false,
          error: payload.message ?? `业务错误 ${payload.code}`,
          code: payload.code,
        }
      }

      return { ok: true, data: payload.data as T }
    } catch (error) {
      // 网络不可达、超时、DNS 失败：客户内网离线是常态，这里必须安静地失败
      return { ok: false, retryable: true, error: describeError(error) }
    } finally {
      clearTimeout(timer)
    }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }
}

function trimEnd(endpoint: string): string {
  return endpoint.replace(/\/+$/, '')
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.name === 'AbortError' ? '请求超时' : error.message
  }
  return '网络异常'
}
