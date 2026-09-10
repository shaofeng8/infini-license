import {
  AuditOutlined,
  DatabaseOutlined,
  DashboardOutlined,
  ExperimentOutlined,
  IdcardOutlined,
  KeyOutlined,
  LineChartOutlined,
  LogoutOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { Dropdown, Layout, Menu, Tag, Tooltip, message } from 'antd'
import type { MenuProps } from 'antd'
import { Suspense, useEffect, useMemo } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { authApi } from '@/api'
import Loading from '@/components/Loading'
import { MENU, type MenuNode } from '@/router/menu'
import { roleAtLeast, useUserStore } from '@/stores/userStore'
import { ROLE_LABEL, type AdminRole } from '@/types/auth'
import { palette } from '@/theme'

const ICONS: Record<string, React.ReactNode> = {
  '/overview': <DashboardOutlined />,
  '/license': <SafetyCertificateOutlined />,
  '/customer': <TeamOutlined />,
  '/trial': <ExperimentOutlined />,
  '/usage': <LineChartOutlined />,
  '/settings/signing-key': <KeyOutlined />,
  '/settings/admin': <IdcardOutlined />,
  '/settings/audit': <AuditOutlined />,
  'license-group': <SafetyCertificateOutlined />,
  'trial-group': <ExperimentOutlined />,
  'system-group': <DatabaseOutlined />,
}

export default function AdminLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const user = useUserStore(state => state.user)
  const setUser = useUserStore(state => state.setUser)
  const clearSession = useUserStore(state => state.clearSession)

  /**
   * 进入后台时拉一次 profile。
   *
   * localStorage 里的角色可能是旧的 —— 超管刚把某人从 ops 降成 viewer，
   * 而他的浏览器还存着 ops，菜单会显示出他已经点不动的入口。以服务端为准。
   */
  useEffect(() => {
    authApi
      .profile()
      .then(setUser)
      .catch(() => {
        // 失败不做处理：真是 token 失效的话 http 拦截器已经跳登录页了，
        // 这里再来一次会和它抢
      })
  }, [setUser])

  const menuItems = useMemo(() => buildMenu(MENU, user?.role), [user?.role])

  const selectedKeys = useMemo(() => {
    // 详情页（/license/xxx）要让父级「授权管理」保持选中，
    // 否则从列表点进详情后侧边栏整个失去高亮，不知道自己在哪
    const match = flatten(MENU)
      .filter(node => location.pathname.startsWith(node.key))
      .sort((a, b) => b.key.length - a.key.length)[0]
    return match ? [match.key] : []
  }, [location.pathname])

  const handleClick: MenuProps['onClick'] = ({ key }) => {
    const node = flatten(MENU).find(item => item.key === key)
    if (node?.pending) {
      message.info(`${node.label}还没做：${node.pending}`)
      return
    }
    navigate(key)
  }

  const userMenu: MenuProps['items'] = [
    {
      key: 'password',
      icon: <UserOutlined />,
      label: '修改密码',
      onClick: () => navigate('/settings/password'),
    },
    { type: 'divider' },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      danger: true,
      // 后端没有 logout 接口（JWT 无状态，见 04-api.md），清本地即可
      onClick: () => clearSession(true),
    },
  ]

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider
        width="var(--lc-sider-width)"
        theme="dark"
        style={{ background: palette.siderBg }}
      >
        <div
          style={{
            height: 56,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '0 20px',
            color: '#fff',
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: '.02em',
          }}
        >
          <SafetyCertificateOutlined style={{ color: palette.primary, fontSize: 18 }} />
          License 管理后台
        </div>

        <Menu
          theme="dark"
          mode="inline"
          items={menuItems}
          selectedKeys={selectedKeys}
          defaultOpenKeys={['license-group', 'system-group']}
          onClick={handleClick}
          style={{ background: palette.siderBg, borderInlineEnd: 'none' }}
        />
      </Layout.Sider>

      <Layout>
        <Layout.Header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 12,
            padding: '0 24px',
            background: palette.surface,
            borderBottom: `1px solid ${palette.border}`,
          }}
        >
          <Dropdown menu={{ items: userMenu }} placement="bottomRight">
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer',
              }}
            >
              <UserOutlined />
              <span>{user?.realName || user?.username || '未登录'}</span>
              {user ? (
                <Tag
                  bordered={false}
                  color={user.role === 'owner' ? 'blue' : 'default'}
                >
                  {ROLE_LABEL[user.role]}
                </Tag>
              ) : null}
            </span>
          </Dropdown>
        </Layout.Header>

        <Layout.Content>
          <div className="lc-content">
            <Suspense fallback={<Loading />}>
              <Outlet />
            </Suspense>
          </div>
        </Layout.Content>
      </Layout>
    </Layout>
  )
}

/** 未实现菜单项的压暗程度：还看得清，但一眼能看出跟可用项不是一档 */
const PENDING_STYLE = { opacity: 0.45 } as const

/** 按角色过滤菜单，并把 pending 项灰掉 */
function buildMenu(
  nodes: MenuNode[],
  role?: AdminRole,
): NonNullable<MenuProps['items']> {
  const result: NonNullable<MenuProps['items']> = []

  for (const node of nodes) {
    if (node.minRole && !roleAtLeast(role, node.minRole)) {
      continue
    }

    if (node.children?.length) {
      const children = buildMenu(node.children, role)
      // 子项被角色过滤到一个不剩时，父级分组也别留 —— 空的「系统」分组
      // 点开是空白，会让人以为没加载出来
      if (children.length === 0) continue
      result.push({
        key: node.key,
        icon: ICONS[node.key],
        label: node.label,
        children,
      })
      continue
    }

    // 未实现的菜单项整条压暗。图标和文字要一起压 —— 只压文字的话，
    // 旁边亮着的图标会让人觉得是渲染没对齐，而不是「这项还不能点」。
    //
    // 没用 antd 的 `disabled`：那样点击事件根本不触发，也就没法弹出
    // 「为什么还不能点」的说明，用户只会以为菜单坏了
    result.push({
      key: node.key,
      icon: node.pending ? (
        <span style={PENDING_STYLE}>{ICONS[node.key]}</span>
      ) : (
        ICONS[node.key]
      ),
      label: node.pending ? (
        <Tooltip title={node.pending} placement="right">
          <span style={PENDING_STYLE}>{node.label}</span>
        </Tooltip>
      ) : (
        node.label
      ),
    })
  }

  return result
}

function flatten(nodes: MenuNode[]): MenuNode[] {
  return nodes.flatMap(node =>
    node.children?.length ? flatten(node.children) : [node],
  )
}
