/**
 * 试用上报的请求与响应类型。
 *
 * 必须与服务端 packages/server/src/modules/client/client.dto.ts 保持一致。
 * 服务端用 StrictBodyGuard 开了 forbidNonWhitelisted，多传字段会被整个请求
 * 拒绝 —— 这是对客户的隐私承诺的技术保证，不是可以放宽的校验。
 *
 * 注意这只管住了最后一跳（宿主 → license 服务）。上报数据是从宿主自己的用量
 * 接收端点进来的，那一跳得由宿主自己把关。P8 上报载荷白名单演练在 proxy 上
 * 发现过一次：接收端点没挂校验管道，任务级字段整个对象透传进 outbox，于是
 * 任务标题能一路发到我方，只是最后被这里的 Guard 剥掉 —— 数据已经离开客户
 * 环境了。宿主侧接收端点必须自己做白名单，见 infini-proxy 的
 * license.controller.ts。
 */

export interface TrialRegisterRequest {
  fingerprint: string
  installId: string
  hostSignalHash: string | null
  dbSignal: string | null
  instance: {
    productVersion?: string
    hostName?: string
    os?: string
    cpuCores?: number
    deployKind?: string
  }
}

export interface TrialRegisterResponse {
  instanceId: string
  instanceSecret: string
  credential: string
  licenseNo: string
  trialStartedAt: string
  serverTime: string
}

export interface HeartbeatRequest {
  productVersion?: string
  localState?: string
  localUserCount?: number
  clientTime?: string
  counters?: {
    periodKey?: string
    taskCount?: number
    totalTokens?: number
  }
  credentialJti?: string
  outboxPending?: number
}

export interface HeartbeatResponse {
  serverTime: string
  /** 仅在运营延长了试用期时返回新凭证，否则为 null */
  credential: string | null
  policy: { heartbeatSec: number; usageSec: number }
}

/**
 * 单个任务的用量。
 *
 * 刻意不含任务标题、提示词、产出内容或任何真实用户标识 —— `userRef` 是客户
 * 侧加盐哈希出来的假名，我方无法反推。上报的是「用了多少」而非「用来做什么」。
 */
export interface UsageTask {
  taskId: string
  parentTaskId?: string | null
  userRef: string
  status?: string
  startedAt?: string
  finishedAt?: string
  durationMs?: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  llmCallCount?: number
}

export interface UsageRequest {
  /** 客户端生成的批次 id，重传时保持不变以实现幂等 */
  batchId: string
  source: 'app' | 'proxy'
  windowStart: string
  windowEnd: string
  tasks: UsageTask[]
  aggregate?: { activeUserCount?: number }
}

export interface UsageResponse {
  accepted: boolean
  batchId: string
  duplicated: boolean
}

/**
 * 上报结果。
 *
 * 失败一律以返回值表达而不抛异常：上报是旁路功能，任何情况下都不能让它
 * 影响客户的正常使用。`retryable` 区分「网络抖动，稍后重试」与「请求本身
 * 有问题，重试也没用」，后者继续重试只会堆积无效流量。
 */
export type TrialResult<T> =
  | { ok: true; data: T }
  | { ok: false; retryable: boolean; error: string; code?: number }
