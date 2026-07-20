import type { AuthStrategy, AuthStrategyFunctionArgs, AuthStrategyResult } from 'payload'
import { auth } from '@/lib/auth'
import { ensurePayloadUser } from '@/lib/auth/ensure-payload-user'

/**
 * Custom Payload AuthStrategy that validates Better Auth sessions.
 * All authenticated users get req.user populated; a missing Payload user
 * doc is self-healed from the session (see ensurePayloadUser).
 * Admin panel access is gated separately via Users.access.admin.
 */
async function authenticate({ headers, payload }: AuthStrategyFunctionArgs): Promise<AuthStrategyResult> {
  try {
    const session = await auth.api.getSession({ headers })

    if (!session?.user?.email) {
      return { user: null }
    }

    const payloadUser = await ensurePayloadUser(payload, session.user)
    if (!payloadUser) {
      return { user: null }
    }

    // ensurePayloadUser reads the Payload doc fresh from Mongo, so its status is
    // current even when Better-Auth served the session from its cookie cache.
    // A deactivated user is treated as unauthenticated (no /admin, no req.user).
    if (payloadUser.status === 'deactivated') {
      return { user: null }
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
