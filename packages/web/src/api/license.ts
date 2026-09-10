import type { PageResult } from '@/types/base'
import type {
  IssueLicensePayload,
  IssueResult,
  LicenseDetail,
  LicenseListItem,
  LicenseQuery,
  RenewLicensePayload,
} from '@/types/license'
import alovaInstance from '@/utils/http'

export const licenseApi = {
  list: (params: LicenseQuery) =>
    alovaInstance.Get<PageResult<LicenseListItem>>('/license/list', { params }),

  /** 即将到期的正式授权，不分页，按剩余天数升序 */
  expiring: (days = 30) =>
    alovaInstance.Get<LicenseListItem[]>('/license/expiring', {
      params: { days },
    }),

  detail: (id: string) => alovaInstance.Get<LicenseDetail>(`/license/${id}`),

  issue: (data: IssueLicensePayload) =>
    alovaInstance.Post<IssueResult>('/license/issue', data),

  renew: (id: string, data: RenewLicensePayload) =>
    alovaInstance.Post<IssueResult>(`/license/${id}/renew`, data),

  reissue: (id: string, reason: string) =>
    alovaInstance.Post<IssueResult>(`/license/${id}/reissue`, { reason }),

  void: (id: string, reason: string) =>
    alovaInstance.Put<null>(`/license/${id}/void`, { reason }),

  /**
   * 下载 license.key。
   *
   * 走 `rawText` 拿纯文本而不是 blob：签发抽屉与详情页都要先把内容摊给运维
   * 确认（checksum 对不对、客户名有没有签错）再另存，拿到 blob 还得再读一次。
   * 存盘由调用方用 `saveTextAsFile` 完成。
   *
   * **每次调用都会在后端留一条 `credential.download` 审计**，所以不要为了
   * 预览而调它 —— 预览用签发返回体里的 `envelope`。
   */
  downloadCredential: (credentialId: string) =>
    alovaInstance.Get<string>(
      `/license/credential/${credentialId}/download`,
      { meta: { rawText: true } },
    ),
}
