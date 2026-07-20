import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getPayload } from 'payload'
import config from '@payload-config'
import { ensurePayloadUser } from '@/lib/auth/ensure-payload-user'

/**
 * Get the current user from the session on the server side.
 * Returns null if not authenticated (or deactivated).
 *
 * The session cookie cache is disabled globally in lib/auth.ts, so getSession
 * already reads fresh from the DB. disableCookieCache + the status check here are
 * belt-and-suspenders: if the cache were ever re-enabled, this path (and its ~33
 * callers plus the gRPC authInterceptor) would still reject a deactivated user
 * on the next request rather than serving a stale cached session for up to
 * maxAge. See docs/plans/2026-07-11-platform-user-management.md (UAC 20).
 */
export async function getCurrentUser() {
  const reqHeaders = await headers()
  const session = await auth.api.getSession({
    headers: reqHeaders,
    query: { disableCookieCache: true },
  })
  const user = session?.user
  if (!user) return null
  if ((user as { status?: string | null }).status === 'deactivated') return null
  return user
}

/**
 * Get the full session on the server side.
 * Returns null if not authenticated.
 */
export async function getSession() {
  const reqHeaders = await headers()
  return auth.api.getSession({ headers: reqHeaders })
}

/**
 * Get the authenticated Payload user from the current Better Auth session.
 * Returns the Payload user document with betterAuthId populated, or null.
 * A missing Payload doc is self-healed from the session (see ensurePayloadUser).
 * Use this in server actions to pass `user` to Payload local API calls.
 */
export async function getPayloadUserFromSession() {
  const reqHeaders = await headers()
  const session = await auth.api.getSession({ headers: reqHeaders })

  if (!session?.user?.email) return null

  const payload = await getPayload({ config })

  const payloadUser = await ensurePayloadUser(payload, session.user)
  if (!payloadUser) return null

  // A deactivated user may still hold a valid session cookie (Better-Auth caches
  // sessions for a few minutes independent of the DB). Treat them as signed out
  // here so deactivation takes effect on the next request, not on cache expiry.
  if (payloadUser.status === 'deactivated') return null

  return {
    ...payloadUser,
    collection: 'users' as const,
    _strategy: 'better-auth',
  }
}
