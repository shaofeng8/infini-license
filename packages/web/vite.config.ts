import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

/**
 * 从 API base URL 里取出 origin 作为代理目标。
 *
 * 解析失败时兜底到后端默认端口 3010 —— 开发环境 .env 写错不应该让整个 dev
 * server 起不来，那会把「环境变量拼错」这种小问题伪装成构建故障。
 */
function getProxyTarget(apiBaseUrl: string): string {
  try {
    return new URL(apiBaseUrl).origin
  } catch {
    return 'http://127.0.0.1:3010'
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = getProxyTarget(
    env.VITE_API_BASE_URL || 'http://127.0.0.1:3010/api',
  )

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      // infini-proxy 没配 alias，全用相对路径。这里加上是因为本项目页面层级更深
      // （pages/license/detail/tabs/xxx.tsx），相对路径会出现 ../../../../
      alias: { '@': resolve(__dirname, './src') },
    },
    build: {
      // 后台是内部系统，产物不对外，不生成 sourcemap 以免泄露源码结构
      sourcemap: false,
    },
    server: {
      host: '0.0.0.0',
      // 与 infini-proxy web（5173）、infiniSynapse web 错开，三个前端可同时开
      port: 5273,
      proxy: {
        '^/api/.*': { target: proxyTarget, changeOrigin: true },
      },
    },
    preview: { port: 5273 },
  }
})
