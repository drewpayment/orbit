import type { AuthStrategy, AuthStrategyFunctionArgs, AuthStrategyResult } from 'payload'
import { auth } from '@/lib/auth'

/**
 * Custom Payload AuthStrategy that validates Better Auth sessions.
 * All authenticated users get req.user populated.
 * Admin panel access is gated separately via Users.access.admin.
 */
async function authenticate({ headers, payload }: AuthStrategyFunctionArgs): Promise<AuthStrategyResult> {
  try {
    const session = await auth.api.getSession({ headers })

    if (!session?.user?.email) {
      return { user: null }
    }

    const betterAuthId = session.user.id
    const result = await payload.find({
      collection: 'users',
      where: { email: { equals: session.user.email } },
      limit: 1,
      overrideAccess: true,
    })

    let payloadUser = result.docs[0]
    if (!payloadUser) {
      console.warn(`[better-auth-strategy] No Payload user found for email: ${session.user.email}`)
      return { user: null }
    }

    // Lazy-populate betterAuthId on first authentication
    if (!payloadUser.betterAuthId && betterAuthId) {
      try {
        payloadUser = await payload.update({
          collection: 'users',
          id: payloadUser.id,
          data: { betterAuthId },
          overrideAccess: true,
          context: { skipApprovalHook: true },
        })
      } catch (error) {
        console.error('[better-auth-strategy] Failed to populate betterAuthId:', error)
      }
    }

    return {
      user: {
        ...payloadUser,
        collection: 'users',
        _strategy: 'better-auth',
      },
    }
  } catch (error) {
    console.error('[better-auth-strategy] Authentication error:', error)
    return { user: null }
  }
}

export const betterAuthStrategy: AuthStrategy = {
  name: 'better-auth',
  authenticate,
}
