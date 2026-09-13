import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppErrorBoundary } from './components/app/AppErrorBoundary'
import { AdminRoute } from './components/auth/AdminRoute'
import { AuthProvider } from './components/auth/AuthProvider'
import { PrivateRoute } from './components/auth/PrivateRoute'
import { AppLayout } from './components/layout/AppLayout'
import { DashboardPage } from './pages/DashboardPage'
import { AuditPage } from './pages/AuditPage'
import { GuidePage } from './pages/GuidePage'
import { LandingPage } from './pages/LandingPage'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { POSPage } from './pages/POSPage'
import { ProductsPage } from './pages/ProductsPage'
import { CustomersPage } from './pages/CustomersPage'
import { RegisterPage } from './pages/RegisterPage'
import { ReportsPage } from './pages/ReportsPage'
import { SettingsPage } from './pages/SettingsPage'
import { StockPage } from './pages/StockPage'

function App() {
  return (
    <AppErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
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
        </AuthProvider>
      </BrowserRouter>
    </AppErrorBoundary>
  )
}

export default App
