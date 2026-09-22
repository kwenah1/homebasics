import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from './AuthContext'

/** ADM-04 in the UI. The API enforces the same rule; this only decides what to render. */
export function RequireAdmin() {
  const { status, user } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <p className="text-sm text-stone-500">Loading…</p>
  if (status === 'anonymous') {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />
  }
  if (user?.role !== 'admin') {
    return (
      <div className="py-16 text-center" data-testid="forbidden">
        <h1 className="text-2xl font-bold">Staff only</h1>
        <p className="mt-2 text-stone-600">Your account doesn't have access to this area.</p>
        <Link to="/" className="mt-4 inline-block font-medium text-brand-700 underline">
          Back to the store
        </Link>
      </div>
    )
  }
  return <Outlet />
}
