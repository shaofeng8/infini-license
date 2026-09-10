import type { ThemeConfig } from 'antd'

/**
 * 设计令牌的单一来源，对应 docs/06-admin-ui.md 第 2 节色板。
 *
 * 这里写字面量而不是 `var(--lc-color-primary)`：AntD 需要拿到真实色值去派生
 * hover / active / 浅底等一整套梯度，喂给它 CSS 变量字符串会让派生算法失效
 * （算不出 #2E5BFF 的浅 10%）。index.css 的变量供手写样式用，两者取值一致。
 */
export const palette = {
  primary: '#2E5BFF',
  primaryHover: '#1D47E0',
  primaryActive: '#1638B8',
  primaryBg: '#EEF2FF',

  success: '#12B76A',
  warning: '#F79009',
  danger: '#F04438',
  trial: '#0BA5EC',
  neutral: '#98A2B3',
  superseded: '#7A5AF8',

  text: '#101828',
  textSecondary: '#667085',
  border: '#EAECF0',
  pageBg: '#F7F8FA',
  surface: '#FFFFFF',
  siderBg: '#0F1729',
} as const

export const antdTheme: ThemeConfig = {
  token: {
    colorPrimary: palette.primary,
    colorPrimaryHover: palette.primaryHover,
    colorPrimaryActive: palette.primaryActive,
    colorPrimaryBg: palette.primaryBg,

    colorSuccess: palette.success,
    colorWarning: palette.warning,
    colorError: palette.danger,
    colorInfo: palette.primary,

    colorText: palette.text,
    colorTextSecondary: palette.textSecondary,
    colorBorder: palette.border,
    colorBorderSecondary: palette.border,
    colorBgLayout: palette.pageBg,
    colorBgContainer: palette.surface,

    borderRadius: 8,
    borderRadiusLG: 12,
    fontFamily:
      "-apple-system, 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
    fontSize: 14,

    // 间距节奏 8/12/16/24/32，不出现 10、14、18 这类破坏节奏的值
    padding: 16,
    margin: 16,
  },
  components: {
    Layout: {
      siderBg: palette.siderBg,
      headerBg: palette.surface,
      bodyBg: palette.pageBg,
      headerHeight: 56,
    },
    Menu: {
      darkItemBg: palette.siderBg,
      darkSubMenuItemBg: palette.siderBg,
      darkItemSelectedBg: palette.primary,
    },
    Card: {
      borderRadiusLG: 12,
    },
    Table: {
      headerBg: '#FCFCFD',
      headerColor: palette.textSecondary,
      borderColor: palette.border,
    },
    Statistic: {
      contentFontSize: 28,
    },
  },
}
