import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getPayload } from 'payload'
import config from '@payload-config'

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

/**
 * Get the authenticated Payload user from the current Better Auth session.
 * Returns the Payload user document with betterAuthId populated, or null.
 * Use this in server actions to pass `user` to Payload local API calls.
 */
export async function getPayloadUserFromSession() {
  const reqHeaders = await headers()
  const session = await auth.api.getSession({ headers: reqHeaders })

  if (!session?.user?.email) return null

  const payload = await getPayload({ config })

  const result = await payload.find({
    collection: 'users',
    where: { email: { equals: session.user.email } },
    limit: 1,
    overrideAccess: true,
  })

  let payloadUser = result.docs[0]
  if (!payloadUser) return null

  // Lazy-populate betterAuthId if missing (mirrors strategy behavior)
  const betterAuthId = session.user.id
  if (!payloadUser.betterAuthId && betterAuthId) {
    try {
      payloadUser = await payload.update({
        collection: 'users',
        id: payloadUser.id,
        data: { betterAuthId },
        overrideAccess: true,
        context: { skipApprovalHook: true },
      })
    } catch {
      // Non-fatal — betterAuthId will be populated on next call
    }
  }

  return {
    ...payloadUser,
    collection: 'users' as const,
    _strategy: 'better-auth',
  }
}
