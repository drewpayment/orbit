import { headers } from 'next/headers'
import { auth } from '@/lib/auth'

/**
 * Get the current user from the session on the server side.
 * Returns null if not authenticated.
 */
export async function getCurrentUser() {
  const reqHeaders = await headers()
  const session = await auth.api.getSession({ headers: reqHeaders })
  return session?.user || null
}

/**
 * Get the full session on the server side.
 * Returns null if not authenticated.
 */
export async function getSession() {
  const reqHeaders = await headers()
  return auth.api.getSession({ headers: reqHeaders })
}
