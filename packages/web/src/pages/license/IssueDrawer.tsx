import {
  Alert,
  Button,
  Checkbox,
  DatePicker,
  Descriptions,
  Drawer,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Tooltip,
  message,
} from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { customerApi, licenseApi } from '@/api'
import { LimitField } from '@/components/LimitField'
import { isOwner, useCurrentUser } from '@/stores/userStore'
import type { Customer } from '@/types/customer'
import type { IssueLicensePayload, IssueResult, QuotaPeriod } from '@/types/license'
import { UNLIMITED_TEXT, formatDate, formatNumber } from '@/utils/format'
import { CredentialDeliveryModal } from './CredentialDeliveryModal'

/**
 * 可选功能开关。
 *
 * 后端 `features_json` 为 NULL 表示全功能，所以默认全选 = 不传这个字段。
 * 取值需要与客户端 SDK 认的 feature 名对齐 —— 这里先放一组占位，等产品侧
 * 定稿后替换（写错的 feature 名不会报错，只会让客户少一个功能，很难发现）。
 */
const FEATURE_OPTIONS = [
  { label: '数据库问答', value: 'db_qa' },
  { label: 'RAG 知识库', value: 'rag' },
  { label: '数据看板', value: 'dashboard' },
  { label: 'API 开放接口', value: 'open_api' },
]

const ALL_FEATURES = FEATURE_OPTIONS.map(item => item.value)

interface IssueDrawerProps {
  open: boolean
  onClose: () => void
  onIssued: () => void
  /** 从客户详情进来时预选客户 */
  presetCustomerId?: string
}

interface FormValues {
  customerId: string
  edition: string
  term: [Dayjs, Dayjs] | null
  startAt: Dayjs | null
  perpetual: boolean
  warnDays: number
  contractNo?: string
  remark?: string
  features: string[]
  bindMode: 'tofu' | 'none'
}

interface Limits {
  maxUsers: number | null
  maxConcurrentTasks: number | null
  tokenQuota: number | null
  tokenQuotaPeriod: QuotaPeriod
  taskQuota: number | null
  taskQuotaPeriod: QuotaPeriod
}

const INITIAL_LIMITS: Limits = {
  maxUsers: null,
  maxConcurrentTasks: null,
  tokenQuota: null,
  tokenQuotaPeriod: 'total',
  taskQuota: null,
  taskQuotaPeriod: 'total',
}

export function IssueDrawer({
  open,
  onClose,
  onIssued,
  presetCustomerId,
}: IssueDrawerProps) {
  const [form] = Form.useForm<FormValues>()
  const user = useCurrentUser()
  const [limits, setLimits] = useState<Limits>(INITIAL_LIMITS)
  const [perpetual, setPerpetual] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [issued, setIssued] = useState<IssueResult | null>(null)

  /**
   * 客户下拉：签发必须挂在已有客户上，这里只取正常状态的。
   *
   * 手写 state + `useCallback([])` 而不用 alova 的 `useRequest`：`send` 的
   * 函数身份每次渲染都变，放进下面 effect 的依赖里会造成无限重渲染循环。
   * 这里的 `loadCustomers` 是稳定引用，effect 只在抽屉开合时跑。
   */
  const [customers, setCustomers] = useState<Customer[]>([])
  const loadCustomers = useCallback((keyword?: string) => {
    customerApi
      .list({ page: 1, pageSize: 50, keyword, status: 1 })
      .send()
      .then(res => setCustomers(res.items ?? []))
      .catch(() => {
        // 提示已由 http 拦截器统一处理；下拉留空时 notFoundContent 会给出引导
      })
  }, [])

  useEffect(() => {
    if (!open) return
    form.resetFields()
    form.setFieldsValue({
      customerId: presetCustomerId ?? undefined,
      edition: 'enterprise',
      startAt: dayjs().startOf('day'),
      warnDays: 15,
      features: ALL_FEATURES,
      bindMode: 'tofu',
    } as never)
    setLimits(INITIAL_LIMITS)
    setPerpetual(false)
    setIssued(null)
    void loadCustomers()
  }, [open, form, presetCustomerId, loadCustomers])

  const customerOptions = useMemo(
    () =>
      customers.map(item => ({
        value: item._id,
        label: item.shortName ? `${item.name}（${item.shortName}）` : item.name,
      })),
    [customers],
  )

  const buildPayload = (values: FormValues): IssueLicensePayload => {
    const payload: IssueLicensePayload = {
      customerId: values.customerId,
      edition: values.edition,
      startAt: values.startAt!.startOf('day').toISOString(),
      warnDays: values.warnDays,
      bindMode: values.bindMode,
    }

    if (!perpetual && values.term?.[1]) {
      payload.endAt = values.term[1].endOf('day').toISOString()
    }
    if (values.contractNo) payload.contractNo = values.contractNo
    if (values.remark) payload.remark = values.remark

    // 全选等于不限制，此时不传 features —— 后端 NULL 才是「全功能」，
    // 传一个当前全集会把授权钉死在今天的功能列表上，将来新增功能客户用不了
    if (values.features.length !== ALL_FEATURES.length) {
      payload.features = values.features
    }

    // null 的限额项一律不传，让后端存 NULL（= 不限制）
    if (limits.maxUsers !== null) payload.maxUsers = limits.maxUsers
    if (limits.maxConcurrentTasks !== null) {
      payload.maxConcurrentTasks = limits.maxConcurrentTasks
    }
    if (limits.tokenQuota !== null) {
      payload.tokenQuota = limits.tokenQuota
      payload.tokenQuotaPeriod = limits.tokenQuotaPeriod
    }
    if (limits.taskQuota !== null) {
      payload.taskQuota = limits.taskQuota
      payload.taskQuotaPeriod = limits.taskQuotaPeriod
    }

    return payload
  }

  const handleConfirm = async () => {
    const values = await form.validateFields()
    if (!perpetual && !values.term?.[1]) {
      message.error('请选择到期日期，或打开「永久授权」')
      return
    }
    setConfirming(true)
  }

  const handleSubmit = async () => {
    const values = form.getFieldsValue()
    setSubmitting(true)
    try {
      const result = await licenseApi.issue(buildPayload(values)).send()
      setConfirming(false)
      setIssued(result)
      message.success(`已签发 ${result.licenseNo}`)
    } finally {
      setSubmitting(false)
    }
  }

  const values = Form.useWatch([], form) as FormValues | undefined

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title="签发正式授权"
        width={640}
        destroyOnClose
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" onClick={handleConfirm}>
              下一步：确认凭证内容
            </Button>
          </div>
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 24 }}
          message="凭证一旦签发并下载就无法收回"
          description="正式授权走离线交付，我方无法远程吊销。请确认客户、有效期与限额后再提交。"
        />

        <Form form={form} layout="vertical" requiredMark={false}>
          <SectionTitle index={1} title="基本信息" />

          <Form.Item
            name="customerId"
            label="客户"
            rules={[{ required: true, message: '请选择客户' }]}
          >
            <Select
              showSearch
              filterOption={false}
              placeholder="搜索客户名称"
              options={customerOptions}
              onSearch={keyword => void loadCustomers(keyword)}
              notFoundContent="没有匹配的客户，请先到客户管理新建"
            />
          </Form.Item>

          <Form.Item name="edition" label="版本">
            <Select
              options={[
                { value: 'enterprise', label: 'enterprise（企业版）' },
                { value: 'standard', label: 'standard（标准版）' },
              ]}
            />
          </Form.Item>

          <Form.Item
            name="startAt"
            label="生效日期"
            rules={[{ required: true, message: '请选择生效日期' }]}
          >
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item label="有效期">
            <Space align="center" style={{ marginBottom: 8 }}>
              <Tooltip
                title={isOwner(user) ? '' : '永久授权仅超级管理员可签发'}
              >
                <Switch
                  checked={perpetual}
                  disabled={!isOwner(user)}
                  onChange={setPerpetual}
                />
              </Tooltip>
              <span>永久授权（不设到期日）</span>
            </Space>

            {perpetual ? (
              <Alert
                type="warning"
                showIcon
                message="永久授权签出后不会到期，客户环境永久可用，请确认合同确实如此约定。"
              />
            ) : (
              <Form.Item name="term" noStyle>
                <DatePicker.RangePicker
                  style={{ width: '100%' }}
                  disabledDate={current =>
                    current && current < dayjs().startOf('day')
                  }
                />
              </Form.Item>
            )}
          </Form.Item>

          <Form.Item
            name="warnDays"
            label="到期预警天数"
            extra="客户端在到期前这么多天开始弹窗提醒"
          >
            <Select
              options={[7, 15, 30, 60].map(d => ({
                value: d,
                label: `${d} 天`,
              }))}
            />
          </Form.Item>

          <Form.Item name="contractNo" label="合同号">
            <Input placeholder="选填，便于与合同对账" maxLength={64} />
          </Form.Item>

          <SectionTitle index={2} title="限额配置" />
          <div
            style={{
              fontSize: 12,
              color: 'var(--lc-color-text-secondary)',
              marginBottom: 8,
            }}
          >
            关闭开关即「{UNLIMITED_TEXT}」。正式客户零上报，这些上限由客户端本地判断。
          </div>

          <LimitField
            label="最大用户数"
            value={limits.maxUsers}
            onChange={v => setLimits(s => ({ ...s, maxUsers: v }))}
            min={1}
            max={100000}
            unit="人"
          />
          <LimitField
            label="最大并发任务数"
            value={limits.maxConcurrentTasks}
            onChange={v => setLimits(s => ({ ...s, maxConcurrentTasks: v }))}
            min={1}
            max={10000}
            unit="个"
          />
          <LimitField
            label="Token 配额"
            hint="按累计或每月计算，超过软阈值后客户端拦截新任务"
            value={limits.tokenQuota}
            onChange={v => setLimits(s => ({ ...s, tokenQuota: v }))}
            period={limits.tokenQuotaPeriod}
            onPeriodChange={p => setLimits(s => ({ ...s, tokenQuotaPeriod: p }))}
            min={1}
            step={1_000_000}
          />
          <LimitField
            label="任务数配额"
            value={limits.taskQuota}
            onChange={v => setLimits(s => ({ ...s, taskQuota: v }))}
            period={limits.taskQuotaPeriod}
            onPeriodChange={p => setLimits(s => ({ ...s, taskQuotaPeriod: p }))}
            min={1}
            unit="个"
          />

          <div style={{ marginTop: 16 }}>
            <LimitPreview limits={limits} />
          </div>

          <SectionTitle index={3} title="功能开关" />
          <Form.Item
            name="features"
            extra="默认全选，即不限制功能。取消勾选会把授权钉在当前功能列表上，将来新增的功能客户用不了。"
          >
            <Checkbox.Group options={FEATURE_OPTIONS} />
          </Form.Item>

          <Form.Item
            name="bindMode"
            label="机器绑定"
            extra="tofu：首次运行记录机器指纹，之后换机需补发凭证"
          >
            <Select
              options={[
                { value: 'tofu', label: 'tofu（首次使用即绑定）' },
                { value: 'none', label: 'none（不绑定机器）' },
              ]}
            />
          </Form.Item>

          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} maxLength={500} showCount />
          </Form.Item>
        </Form>
      </Drawer>

      {/* 提交前的最后一道：把即将写进凭证的内容原样摊开 */}
      <Modal
        open={confirming}
        title="确认凭证内容"
        okText="确认签发"
        cancelText="返回修改"
        confirmLoading={submitting}
        onOk={handleSubmit}
        onCancel={() => setConfirming(false)}
        width={560}
        maskClosable={false}
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="以下内容将写入 license.key，签发后不可修改。如需变更只能作废重签。"
        />
        <ConfirmSummary
          values={values}
          limits={limits}
          perpetual={perpetual}
          customerLabel={
            customerOptions.find(o => o.value === values?.customerId)?.label
          }
        />
      </Modal>

      {/* 签发成功后立刻交付：这是唯一一次不额外产生审计记录的下载机会 */}
      <CredentialDeliveryModal
        result={issued}
        onClose={() => {
          setIssued(null)
          onIssued()
        }}
      />
    </>
  )
}

function SectionTitle({ index, title }: { index: number; title: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        margin: '24px 0 12px',
        fontSize: 15,
        fontWeight: 500,
      }}
    >
      <span
        style={{
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: 'var(--lc-color-primary-bg)',
          color: 'var(--lc-color-primary)',
          fontSize: 12,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {index}
      </span>
      {title}
    </div>
  )
}

/** 限额摘要预览卡片，跟着开关实时变 */
/**
 * 签发前的限额清单。
 *
 * 全部走 `formatNumber`（精确 + 千分位），不用 `formatCompactNumber`：
 * 这块显示的就是要写进凭证的数字，5000.4 万 看不出原值是 50,004,000 还是
 * 50,003,900，而这个数字是跟合同对的，不能在确认环节被四舍五入掉。
 *
 * 四项必须用同一个格式化函数。混用会出现「50000 人」和「50,000,000」
 * 并排的情况，同一块面板里两种数字写法，读的人会怀疑哪个才是对的。
 */
function LimitPreview({ limits }: { limits: Limits }) {
  const rows: [string, string][] = [
    [
      '用户数',
      limits.maxUsers === null ? UNLIMITED_TEXT : `${formatNumber(limits.maxUsers)} 人`,
    ],
    [
      '并发任务',
      limits.maxConcurrentTasks === null
        ? UNLIMITED_TEXT
        : `${formatNumber(limits.maxConcurrentTasks)} 个`,
    ],
    [
      'Token',
      limits.tokenQuota === null
        ? UNLIMITED_TEXT
        : `${formatNumber(limits.tokenQuota)}（${
            limits.tokenQuotaPeriod === 'total' ? '累计' : '每月'
          }）`,
    ],
    [
      '任务数',
      limits.taskQuota === null
        ? UNLIMITED_TEXT
        : `${formatNumber(limits.taskQuota)} 个（${
            limits.taskQuotaPeriod === 'total' ? '累计' : '每月'
          }）`,
    ],
  ]

  return (
    <div
      className="lc-card-flat"
      style={{ padding: 12, background: 'var(--lc-color-page-bg)' }}
    >
      <div style={{ fontSize: 12, color: 'var(--lc-color-text-secondary)', marginBottom: 8 }}>
        限额摘要
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {rows.map(([label, value]) => (
          <div key={label} style={{ fontSize: 13 }}>
            <span style={{ color: 'var(--lc-color-text-secondary)' }}>{label}：</span>
            <span className="lc-num">{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ConfirmSummary({
  values,
  limits,
  perpetual,
  customerLabel,
}: {
  values?: FormValues
  limits: Limits
  perpetual: boolean
  customerLabel?: string
}) {
  if (!values) return null

  return (
    <Descriptions column={1} size="small" bordered>
      <Descriptions.Item label="客户">{customerLabel ?? '—'}</Descriptions.Item>
      <Descriptions.Item label="版本">{values.edition}</Descriptions.Item>
      <Descriptions.Item label="生效日期">
        {formatDate(values.startAt?.toISOString())}
      </Descriptions.Item>
      <Descriptions.Item label="到期日期">
        {perpetual ? (
          <span style={{ color: 'var(--lc-color-warning)' }}>永久授权</span>
        ) : (
          formatDate(values.term?.[1]?.toISOString())
        )}
      </Descriptions.Item>
      <Descriptions.Item label="预警天数">{values.warnDays} 天</Descriptions.Item>
      <Descriptions.Item label="限额">
        {/* 同 LimitPreview：确认清单四项统一走精确千分位，不混用写法 */}
        <div className="lc-num">
          用户 {formatNumber(limits.maxUsers)} · 并发{' '}
          {formatNumber(limits.maxConcurrentTasks)} · Token{' '}
          {formatNumber(limits.tokenQuota)} · 任务{' '}
          {formatNumber(limits.taskQuota)}
        </div>
      </Descriptions.Item>
      <Descriptions.Item label="功能">
        {values.features?.length === ALL_FEATURES.length
          ? '全功能（不限制）'
          : values.features
              ?.map(v => FEATURE_OPTIONS.find(o => o.value === v)?.label ?? v)
              .join('、')}
      </Descriptions.Item>
      <Descriptions.Item label="机器绑定">{values.bindMode}</Descriptions.Item>
      {values.contractNo ? (
        <Descriptions.Item label="合同号">{values.contractNo}</Descriptions.Item>
      ) : null}
    </Descriptions>
  )
}
