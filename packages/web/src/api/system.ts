import type { PageResult } from '@/types/base'
import type {
  AuditLog,
  AuditQuery,
  CreateSigningKeyPayload,
  CreateSigningKeyResult,
  SigningKey,
} from '@/types/system'
import alovaInstance from '@/utils/http'

export const signingKeyApi = {
  list: () => alovaInstance.Get<SigningKey[]>('/signing-key/list'),

  /** 公钥清单，用于打包进客户端 SDK */
  publicKeys: () =>
    alovaInstance.Get<Pick<SigningKey, 'kid' | 'publicKey' | 'clientSince'>[]>(
      '/signing-key/public-keys',
    ),

  create: (data: CreateSigningKeyPayload) =>
    alovaInstance.Post<CreateSigningKeyResult>('/signing-key', data),

  activate: (kid: string) =>
    alovaInstance.Put<Pick<SigningKey, 'kid' | 'status'>>(
      `/signing-key/${kid}/activate`,
    ),

  retire: (kid: string) =>
    alovaInstance.Put<null>(`/signing-key/${kid}/retire`),
}

export const auditApi = {
  list: (params: AuditQuery) =>
    alovaInstance.Get<PageResult<AuditLog>>('/audit/list', { params }),
}
