/**
 * 后端 API 根地址。
 *
 * 优先取构建期注入的 VITE_API_BASE_URL；开发环境回落到后端默认端口 3010；
 * 生产环境按当前域名同源推导（后台与 API 通常同机部署在反代之后）。
 */
export function getApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim()
  if (configured) {
    return configured.replace(/\/$/, '')
  }

  if (import.meta.env.DEV) {
    return 'http://localhost:3010/api'
  }

  return `${location.origin}/api`
}
