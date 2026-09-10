import type { AdminRole } from '@/types/auth'

export interface MenuNode {
  key: string
  label: string
  /** 访问所需的最低角色，缺省表示任意已登录用户 */
  minRole?: AdminRole
  children?: MenuNode[]
  /** 后端接口尚未实现，菜单里灰掉并给出说明 */
  pending?: string
}

/**
 * 侧边栏结构，对应 docs/06-admin-ui.md 第 4 节。
 *
 * 「概览」「试用」两组的后端读接口尚未实现（见 07-execution-plan 的 P2 遗留项
 * 与 P6 说明），这里保留占位并标 `pending` —— 直接删掉的话，后端补完接口时
 * 没人记得这里原本该有什么；灰掉并写清原因，谁点一下都能自己搞明白。
 */
export const MENU: MenuNode[] = [
  {
    key: '/overview',
    label: '概览',
    pending: '等待后端聚合统计接口',
  },
  {
    key: 'license-group',
    label: '授权',
    children: [
      { key: '/license', label: '授权管理' },
      { key: '/customer', label: '客户管理' },
    ],
  },
  {
    key: 'trial-group',
    label: '试用',
    children: [
      {
        key: '/trial',
        label: '试用实例',
        pending: '等待后端试用实例管理接口',
      },
      {
        key: '/usage',
        label: '用量分析',
        pending: '等待后端用量查询接口',
      },
    ],
  },
  {
    key: 'system-group',
    label: '系统',
    children: [
      { key: '/settings/signing-key', label: '签名密钥', minRole: 'owner' },
      { key: '/settings/admin', label: '管理员', minRole: 'owner' },
      { key: '/settings/audit', label: '审计日志', minRole: 'ops' },
    ],
  },
]

/** 登录后的落地页。首页概览还没做，先落在授权列表 —— 那是运维最常用的页 */
export const DEFAULT_ROUTE = '/license'
