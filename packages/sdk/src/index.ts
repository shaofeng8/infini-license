export * from './types'
export * from './constants'
export { verifyCredential, peekPayloadUnsafe } from './verify'
export type { TrustedKey, VerifyResult } from './verify'
export { parseLicenseEnvelope } from './envelope'
export { evaluateLicense } from './evaluate'
export { checkClock } from './clock'
export type { ClockCheckResult, ClockCheckOptions } from './clock'
export {
  checkLimits,
  blockedLimits,
  canCreateUser,
  isFeatureEnabled,
} from './limits'
export type { LimitKind, LimitVerdict, UsageSnapshot } from './limits'
export { buildNotice } from './notice'
export type { LicenseNotice, NoticeLevel } from './notice'
export { computeFingerprint, compareFingerprint } from './fingerprint'
export type { FingerprintSignals, FingerprintResult } from './fingerprint'
export { stableStringify } from './stable-json'

// -- IO 层。纯函数之上的副作用封装，宿主项目直接用 LicenseManager --
export { LicenseManager } from './io/manager'
export type { LicenseManagerOptions } from './io/manager'
export { loadKeyFile, resolveCandidates, checksumOf } from './io/keyfile'
export type { KeyFile, KeyFileLookup } from './io/keyfile'
export { readMirror, writeMirror, mirrorPath, fallbackMirrorPath } from './io/mirror'
export type { MirrorState, MirrorResult } from './io/mirror'
export { createInitialState } from './io/store'

// -- 试用上报通道。正式客户不会用到这些 --
export { TrialClient } from './trial/client'
export type { TrialClientOptions } from './trial/client'
export { buildSigningString, signRequest, sha256Hex } from './trial/signer'
export type { SignInput, SignedHeaders } from './trial/signer'
export type {
  TrialRegisterRequest,
  TrialRegisterResponse,
  HeartbeatRequest,
  HeartbeatResponse,
  UsageTask,
  UsageRequest,
  UsageResponse,
  TrialResult,
} from './trial/types'
export type {
  LicenseStore,
  PersistedState,
  LicenseEvent,
  LicenseEventKind,
} from './io/store'
