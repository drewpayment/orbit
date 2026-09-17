import { getActor } from '@/lib/authz'
import { redirect } from 'next/navigation'

interface AuthGuardProps {
  children: React.ReactNode
}

/**
 * Auth Guard - Server Component
 *
 * Protects routes by checking for valid user session.
 * Redirects to /login if user is not authenticated.
 *
 * Usage: Wrap protected layouts or pages with this component.
 */
export async function AuthGuard({ children }: AuthGuardProps) {
  // Resolve the current Actor.
  const actor = await getActor()

  // Redirect to login if no valid session
  if (!actor) {
    redirect('/login')
  }

  // User is authenticated, render children
  return <>{children}</>
}
