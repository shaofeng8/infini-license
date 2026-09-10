import { useRequest } from 'alova/client'
import { Button, Result, Space, Tabs, Tooltip, message } from 'antd'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { licenseApi } from '@/api'
import { LicenseStatusDot } from '@/components/LicenseStatusDot'
import { LicenseTypeBadge } from '@/components/LicenseTypeBadge'
import Loading from '@/components/Loading'
import { PageHeader } from '@/components/PageHeader'
import { canIssue, useCurrentUser } from '@/stores/userStore'
import type {
  IssueResult,
  LicenseDetail as LicenseDetailType,
} from '@/types/license'
import { CredentialDeliveryModal } from './CredentialDeliveryModal'
import { CredentialsTab } from './tabs/CredentialsTab'
import { OverviewTab } from './tabs/OverviewTab'
import { TimelineTab } from './tabs/TimelineTab'
import { UsageTab } from './tabs/UsageTab'
import { RenewModal } from './RenewModal'
import { VoidModal } from './VoidModal'

export default function LicenseDetailPage() {
  const { id = '' } = useParams()
  const user = useCurrentUser()
  const editable = canIssue(user)

  const [renewOpen, setRenewOpen] = useState(false)
  const [voidOpen, setVoidOpen] = useState(false)
  const [issued, setIssued] = useState<IssueResult | null>(null)

  const { data, loading, send: reload } = useRequest(
    () => licenseApi.detail(id),
    { immediate: true },
  )

  if (loading && !data) return <Loading />

  if (!data) {
    return (
      <Result
        status="404"
        title="授权不存在"
        subTitle="可能已被删除，或者链接里的编号有误。"
      />
    )
  }

  const license = data as LicenseDetailType

  return (
    <>
      <PageHeader
        backTo="/license"
        title={license.licenseNo}
        description={license.customerName ?? '未知客户'}
        tags={
          <Space size={8}>
            <LicenseTypeBadge type={license.type} />
            <LicenseStatusDot
              status={license.status}
              type={license.type}
              remainingDays={license.remainingDays}
              endAt={license.endAt}
              warnDays={license.warnDays}
            />
          </Space>
        }
        extra={
          <Space>
            <Tooltip title={editable ? '' : '需要运维及以上角色'}>
              <Button
                disabled={!editable || license.status === 'void'}
                onClick={() => setRenewOpen(true)}
              >
                续期
              </Button>
            </Tooltip>
            <Tooltip title={editable ? '' : '需要运维及以上角色'}>
              <Button
                danger
                disabled={!editable || license.status === 'void'}
                onClick={() => setVoidOpen(true)}
              >
                作废
              </Button>
            </Tooltip>
          </Space>
        }
      />

      <Tabs
        defaultActiveKey="overview"
        items={[
          {
            key: 'overview',
            label: '概览',
            children: <OverviewTab license={license} />,
          },
          {
            key: 'credentials',
            label: `凭证（${license.credentials.length}）`,
            children: (
              <CredentialsTab
                license={license}
                editable={editable}
                onReissued={result => {
                  setIssued(result)
                  void reload()
                }}
              />
            ),
          },
          {
            key: 'usage',
            label: '用量',
            children: <UsageTab license={license} />,
          },
          {
            key: 'timeline',
            label: '事件时间线',
            children: <TimelineTab license={license} />,
          },
        ]}
      />

      <RenewModal
        open={renewOpen}
        license={license}
        onCancel={() => setRenewOpen(false)}
        onRenewed={result => {
          setRenewOpen(false)
          setIssued(result)
          void reload()
        }}
      />

      <VoidModal
        open={voidOpen}
        license={license}
        onCancel={() => setVoidOpen(false)}
        onVoided={() => {
          setVoidOpen(false)
          message.success('已作废')
          void reload()
        }}
      />

      <CredentialDeliveryModal result={issued} onClose={() => setIssued(null)} />
    </>
  )
}
