import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppErrorBoundary } from './components/app/AppErrorBoundary'
import { AdminRoute } from './components/auth/AdminRoute'
import { AuthProvider } from './components/auth/AuthProvider'
import { PrivateRoute } from './components/auth/PrivateRoute'
import { AppLayout } from './components/layout/AppLayout'
import { RouteLoader } from './components/layout/RouteLoader'

const LandingPage = lazy(async () => ({ default: (await import('./pages/LandingPage')).LandingPage }))
const LoginPage = lazy(async () => ({ default: (await import('./pages/LoginPage')).LoginPage }))
const RegisterPage = lazy(async () => ({ default: (await import('./pages/RegisterPage')).RegisterPage }))
const DashboardPage = lazy(async () => ({ default: (await import('./pages/DashboardPage')).DashboardPage }))
const POSPage = lazy(async () => ({ default: (await import('./pages/POSPage')).POSPage }))
const CustomersPage = lazy(async () => ({ default: (await import('./pages/CustomersPage')).CustomersPage }))
const GuidePage = lazy(async () => ({ default: (await import('./pages/GuidePage')).GuidePage }))
const ProductsPage = lazy(async () => ({ default: (await import('./pages/ProductsPage')).ProductsPage }))
const StockPage = lazy(async () => ({ default: (await import('./pages/StockPage')).StockPage }))
const ReportsPage = lazy(async () => ({ default: (await import('./pages/ReportsPage')).ReportsPage }))
const AuditPage = lazy(async () => ({ default: (await import('./pages/AuditPage')).AuditPage }))
const SettingsPage = lazy(async () => ({ default: (await import('./pages/SettingsPage')).SettingsPage }))
const NotFoundPage = lazy(async () => ({ default: (await import('./pages/NotFoundPage')).NotFoundPage }))

function App() {
  return (
    <AppErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={<RouteLoader />}>
            <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route
              element={
                <PrivateRoute>
                  <AppLayout />
                </PrivateRoute>
              }
            >
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/pos" element={<POSPage />} />
              <Route path="/pelanggan" element={<CustomersPage />} />
              <Route path="/panduan" element={<GuidePage />} />
              <Route
                path="/produk"
                element={
                  <AdminRoute>
                    <ProductsPage />
                  </AdminRoute>
                }
              />
              <Route
                path="/stok"
                element={
                  <AdminRoute>
                    <StockPage />
                  </AdminRoute>
                }
              />
              <Route
                path="/laporan"
                element={
                  <AdminRoute>
                    <ReportsPage />
                  </AdminRoute>
                }
              />
              <Route
                path="/audit"
                element={
                  <AdminRoute>
                    <AuditPage />
                  </AdminRoute>
                }
              />
              <Route
                path="/pengaturan"
                element={
                  <AdminRoute>
                    <SettingsPage />
                  </AdminRoute>
                }
              />
            </Route>
            <Route
              path="/admin"
              element={
                <Navigate to="/pengaturan" replace />
              }
            />
            <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </AppErrorBoundary>
  )
}

export default App
