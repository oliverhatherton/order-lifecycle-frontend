import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/useAuth.js'
import { CenterLoading } from './CenterLoading.jsx'

export function ProtectedRoute({ children }) {
  const { status, isAuthenticated } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <CenterLoading />
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return children
}

export function AdminRoute({ children }) {
  const { status, isAuthenticated, isAdmin } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <CenterLoading />
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (!isAdmin) return <Navigate to="/orders" replace />
  return children
}
