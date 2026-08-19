import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import type { Role } from '../lib/types'

/**
 * Client-side gate so a user never lands on a page the API would refuse.
 * This is a usability guard, not a security boundary — every one of these
 * routes is enforced again server-side by requireRole.
 */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth()

  if (!user) return <Navigate to="/login" replace />
  if (!roles.includes(user.role)) return <Navigate to="/dashboard" replace />

  return <>{children}</>
}
