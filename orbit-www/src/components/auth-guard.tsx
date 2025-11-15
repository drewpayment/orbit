import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
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
  // Get current session using better-auth API
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  // Redirect to login if no valid session
  if (!session?.user) {
    redirect('/login')
  }

  // User is authenticated, render children
  return <>{children}</>
}
