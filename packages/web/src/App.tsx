import { App as AntdApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { RouterProvider } from 'react-router-dom'
import router from '@/router/routes'
import { antdTheme } from '@/theme'

export default function App() {
  return (
    <ConfigProvider locale={zhCN} theme={antdTheme}>
      {/* AntdApp 提供 message / modal 的 context 版本，让弹层继承主题 */}
      <AntdApp>
        <RouterProvider router={router} />
      </AntdApp>
    </ConfigProvider>
  )
}
