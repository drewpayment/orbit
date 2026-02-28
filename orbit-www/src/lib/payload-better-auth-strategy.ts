import type { AuthStrategy, AuthStrategyFunctionArgs, AuthStrategyResult } from 'payload'
import { auth } from '@/lib/auth'

const ADMIN_ROLES = ['super_admin', 'admin']

/**
 * Custom Payload AuthStrategy that validates Better Auth sessions.
 * Only allows users with super_admin or admin roles to access the Payload admin panel.
 */
async function authenticate({ headers, payload }: AuthStrategyFunctionArgs): Promise<AuthStrategyResult> {
  try {
    const session = await auth.api.getSession({ headers })

    if (!session?.user?.email) {
      return { user: null }
    }

    const userRole = (session.user as any).role || 'user'
    if (!ADMIN_ROLES.includes(userRole)) {
      return { user: null }
    }

    const result = await payload.find({
      collection: 'users',
      where: { email: { equals: session.user.email } },
      limit: 1,
      overrideAccess: true,
    })

    const payloadUser = result.docs[0]
    if (!payloadUser) {
      console.warn(`[better-auth-strategy] No Payload user found for admin email: ${session.user.email}`)
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
