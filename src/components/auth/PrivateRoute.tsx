import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'

interface PrivateRouteProps {
  children: ReactNode
}

export function PrivateRoute({ children }: PrivateRouteProps) {
  const session = useAuthStore((state) => state.session)
  const needsOnboarding = useAuthStore((state) => state.needsOnboarding)
  const location = useLocation()

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  if (needsOnboarding) {
    return <Navigate to="/register" replace />
  }

  return <>{children}</>
}
