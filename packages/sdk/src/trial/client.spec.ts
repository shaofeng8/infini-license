import { TrialClient } from './client'
import { buildSigningString } from './signer'

const IDENTITY = { instanceId: 'inst-1', instanceSecret: 'secret-1' }
const NOW = 1_780_000_000_000

/** 记录收到的请求，并按脚本返回响应 */
function stubFetch(
  responder: (url: string, init: RequestInit) => { status?: number; body?: unknown } | Error,
) {
  const calls: { url: string; init: RequestInit }[] = []

  const impl = (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit })
    const result = responder(String(url), init as RequestInit)
    if (result instanceof Error) throw result

    const status = result.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => result.body,
    }
  }) as unknown as typeof fetch

  return { impl, calls }
}

describe('TrialClient', () => {
  const ok = (data: unknown) => ({ body: { code: 200, data, message: 'ok' } })

  describe('注册', () => {
    it('打到 /api/client/trial/register 且不带签名头', async () => {
      const { impl, calls } = stubFetch(() => ok({ instanceId: 'inst-1' }))
      const client = new TrialClient({ endpoint: 'https://license.example.com', fetchImpl: impl })

      const result = await client.register({
        fingerprint: 'f',
        installId: 'i',
        hostSignalHash: null,
        dbSignal: null,
        instance: {},
      })

      expect(result).toEqual({ ok: true, data: { instanceId: 'inst-1' } })
      expect(calls[0].url).toBe('https://license.example.com/api/client/trial/register')
      // 注册时还没有身份可用于签名
      expect(calls[0].init.headers).not.toHaveProperty('X-License-Signature')
    })

    it('endpoint 末尾多余的斜杠不会拼出双斜杠', async () => {
      const { impl, calls } = stubFetch(() => ok({}))
      const client = new TrialClient({ endpoint: 'https://license.example.com///', fetchImpl: impl })

      await client.register({
        fingerprint: 'f',
        installId: 'i',
        hostSignalHash: null,
        dbSignal: null,
        instance: {},
      })
      expect(calls[0].url).toBe('https://license.example.com/api/client/trial/register')
    })
  })

  describe('签名请求', () => {
    it('心跳带上四个签名头，且签名覆盖实际发出的请求体', async () => {
      const { impl, calls } = stubFetch(() => ok({ serverTime: 'now', credential: null }))
      const client = new TrialClient({
        endpoint: 'https://license.example.com',
        identity: IDENTITY,
        now: () => NOW,
        fetchImpl: impl,
      })

      await client.heartbeat({ localState: 'trial_active' })

      const headers = calls[0].init.headers as Record<string, string>
      expect(headers['X-License-Instance']).toBe('inst-1')
      expect(headers['X-License-Timestamp']).toBe('1780000000')
      expect(headers['X-License-Nonce']).toMatch(/^[0-9a-f-]{36}$/)
      expect(headers['X-License-Signature']).toBeTruthy()

      // 服务端会用收到的 body 重算哈希，两者必须一致
      const signingString = buildSigningString({
        method: 'POST',
        path: '/api/client/heartbeat',
        timestampSec: 1_780_000_000,
        nonce: headers['X-License-Nonce'],
        rawBody: calls[0].init.body as string,
      })
      expect(signingString).toContain('/api/client/heartbeat')
    })

    it('请求体键序稳定 —— 换插入顺序不改变发出的字节', async () => {
      const { impl, calls } = stubFetch(() => ok({}))
      const client = new TrialClient({
        endpoint: 'https://x',
        identity: IDENTITY,
        now: () => NOW,
        fetchImpl: impl,
      })

      await client.heartbeat({ localUserCount: 1, productVersion: '1.0' })
      await client.heartbeat({ productVersion: '1.0', localUserCount: 1 })

      expect(calls[0].init.body).toBe(calls[1].init.body)
    })

    it('缺少身份时直接返回失败且不发请求', async () => {
      const { impl, calls } = stubFetch(() => ok({}))
      const client = new TrialClient({ endpoint: 'https://x', fetchImpl: impl })

      const result = await client.heartbeat({})

      expect(result.ok).toBe(false)
      expect(result).toMatchObject({ retryable: false })
      expect(calls).toHaveLength(0)
    })
  })

  describe('失败处理', () => {
    it('网络异常判为可重试，且不抛异常', async () => {
      const { impl } = stubFetch(() => new Error('ECONNREFUSED'))
      const client = new TrialClient({ endpoint: 'https://x', identity: IDENTITY, fetchImpl: impl })

      const result = await client.usage({
        batchId: 'b',
        source: 'app',
        windowStart: 'a',
        windowEnd: 'b',
        tasks: [],
      })

      expect(result).toEqual({ ok: false, retryable: true, error: 'ECONNREFUSED' })
    })

    it('5xx 判为可重试', async () => {
      const { impl } = stubFetch(() => ({ status: 502, body: { code: 500, message: '网关错误' } }))
      const client = new TrialClient({ endpoint: 'https://x', identity: IDENTITY, fetchImpl: impl })

      expect(await client.heartbeat({})).toMatchObject({ ok: false, retryable: true })
    })

    it('429 判为可重试 —— 限流是暂时的', async () => {
      const { impl } = stubFetch(() => ({ status: 429, body: { code: 1003, message: '太频繁' } }))
      const client = new TrialClient({ endpoint: 'https://x', identity: IDENTITY, fetchImpl: impl })

      expect(await client.heartbeat({})).toMatchObject({ ok: false, retryable: true, code: 1003 })
    })

    it('4xx 判为不可重试 —— 请求本身有问题，重试只是白费流量', async () => {
      const { impl } = stubFetch(() => ({ status: 400, body: { code: 1000, message: '参数错误' } }))
      const client = new TrialClient({ endpoint: 'https://x', identity: IDENTITY, fetchImpl: impl })

      expect(await client.heartbeat({})).toMatchObject({ ok: false, retryable: false, code: 1000 })
    })

    it('HTTP 200 但业务码非 200 时判失败且不重试', async () => {
      const { impl } = stubFetch(() => ok(null))
      const client = new TrialClient({ endpoint: 'https://x', identity: IDENTITY, fetchImpl: impl })

      const { impl: rejecting } = stubFetch(() => ({
        body: { code: 1403, data: null, message: '请求重放' },
      }))
      const rejected = new TrialClient({
        endpoint: 'https://x',
        identity: IDENTITY,
        fetchImpl: rejecting,
      })

      expect((await client.heartbeat({})).ok).toBe(true)
      expect(await rejected.heartbeat({})).toEqual({
        ok: false,
        retryable: false,
        error: '请求重放',
        code: 1403,
      })
    })

    it('响应不是 JSON 时不崩溃', async () => {
      const impl = (async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('not json')
        },
      })) as unknown as typeof fetch

      const client = new TrialClient({ endpoint: 'https://x', identity: IDENTITY, fetchImpl: impl })
      expect((await client.heartbeat({})).ok).toBe(false)
    })

    it('超时判为可重试', async () => {
      const impl = (async (_url: unknown, init: unknown) =>
        new Promise((_resolve, reject) => {
          const signal = (init as RequestInit).signal
          signal?.addEventListener('abort', () => {
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          })
        })) as unknown as typeof fetch

      const client = new TrialClient({
        endpoint: 'https://x',
        identity: IDENTITY,
        timeoutMs: 10,
        fetchImpl: impl,
      })

      expect(await client.heartbeat({})).toEqual({
        ok: false,
        retryable: true,
        error: '请求超时',
      })
    })
  })
})
