'use server'

import { auth } from '@/lib/auth'
import { headers } from 'next/headers'

/**
 * Check if the current user has platform admin privileges.
 * Uses the role field on the Better Auth user record.
 */
export async function checkPlatformAdmin(): Promise<{
  isAdmin: boolean
  userId?: string
}> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { isAdmin: false }
  }

  const role = (session.user as any).role || 'user'
  const isAdmin = role === 'super_admin' || role === 'admin'

  return { isAdmin, userId: session.user.id }
}
