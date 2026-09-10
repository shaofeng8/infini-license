import { Result } from 'antd'
import { Navigate, createBrowserRouter } from 'react-router-dom'
import AdminLayout from '@/layouts/AdminLayout'
import { DEFAULT_ROUTE } from './menu'
import { RedirectIfAuthed, RequireAuth, RequireRole } from './RouteGuards'
import { lazyWithRetry } from './lazyWithRetry'

const LoginPage = lazyWithRetry(() => import('@/pages/login'))
const LicenseListPage = lazyWithRetry(() => import('@/pages/license/List'))
const LicenseDetailPage = lazyWithRetry(() => import('@/pages/license/Detail'))
const CustomerListPage = lazyWithRetry(() => import('@/pages/customer/List'))
const CustomerDetailPage = lazyWithRetry(() => import('@/pages/customer/Detail'))
const SigningKeyPage = lazyWithRetry(() => import('@/pages/settings/SigningKey'))
const AdminUserPage = lazyWithRetry(() => import('@/pages/settings/AdminUser'))
const AuditLogPage = lazyWithRetry(() => import('@/pages/settings/AuditLog'))
const ChangePasswordPage = lazyWithRetry(
  () => import('@/pages/settings/ChangePassword'),
)

const router = createBrowserRouter([
  {
    path: '/login',
    element: (
      <RedirectIfAuthed>
        <LoginPage />
      </RedirectIfAuthed>
    ),
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AdminLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to={DEFAULT_ROUTE} replace /> },

      { path: 'license', element: <LicenseListPage /> },
      { path: 'license/:id', element: <LicenseDetailPage /> },

      { path: 'customer', element: <CustomerListPage /> },
      { path: 'customer/:id', element: <CustomerDetailPage /> },

      { path: 'settings/password', element: <ChangePasswordPage /> },
      {
        path: 'settings/signing-key',
        element: (
          <RequireRole min="owner">
            <SigningKeyPage />
          </RequireRole>
        ),
      },
      {
        path: 'settings/admin',
        element: (
          <RequireRole min="owner">
            <AdminUserPage />
          </RequireRole>
        ),
      },
      {
        path: 'settings/audit',
        element: (
          <RequireRole min="ops">
            <AuditLogPage />
          </RequireRole>
        ),
      },

      {
        path: '*',
        element: (
          <Result
            status="404"
            title="页面不存在"
            subTitle="概览、试用实例与用量分析尚未开放，其余地址请检查是否输入有误。"
          />
        ),
      },
    ],
  },
])

export default router
