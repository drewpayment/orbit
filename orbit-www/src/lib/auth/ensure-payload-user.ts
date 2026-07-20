import crypto from 'node:crypto'
import type { Payload } from 'payload'
import type { User } from '@/payload-types'

/** Shape of the Better-Auth session user the bridge needs. */
export interface BridgeSessionUser {
  id: string
  email: string
  name?: string | null
  role?: string | null
  status?: string | null
}

const VALID_ROLES = new Set(['super_admin', 'admin', 'user'])
const VALID_STATUSES = new Set(['pending', 'approved', 'rejected', 'deactivated'])

async function findByEmail(payload: Payload, email: string): Promise<User | undefined> {
  const result = await payload.find({
    collection: 'users',
    where: { email: { equals: email } },
    limit: 1,
    overrideAccess: true,
  })
  return result.docs[0]
}

/**
 * Resolve the Payload user for a Better-Auth session, creating it when missing.
 *
 * Better-Auth and Payload keep separate user records; registration is supposed
 * to create both, but historically failed between the two writes and left
 * Better-Auth-only accounts that could sign in yet had no identity anywhere
 * Payload-backed (/platform guards, /admin). A valid session is proof the
 * login gate passed, so a missing Payload doc is repaired here from the
 * session's own fields rather than treated as unauthenticated.
 */
export async function ensurePayloadUser(
  payload: Payload,
  sessionUser: BridgeSessionUser,
): Promise<User | null> {
  if (!sessionUser.email) return null

  let payloadUser = await findByEmail(payload, sessionUser.email)

  if (!payloadUser) {
    const role = sessionUser.role && VALID_ROLES.has(sessionUser.role) ? sessionUser.role : 'user'
    // A live session means the session-create gate passed, so 'approved' is
    // the safe default for legacy Better-Auth users that predate the status field.
    const status =
      sessionUser.status && VALID_STATUSES.has(sessionUser.status) ? sessionUser.status : 'approved'

    try {
      payloadUser = await payload.create({
        collection: 'users',
        data: {
          email: sessionUser.email,
          name: sessionUser.name || '',
          role: role as User['role'],
          status: status as User['status'],
          betterAuthId: sessionUser.id,
          // Local strategy is disabled; this password is never usable for login
          // but satisfies the auth-collection field kept by enableFields.
          password: crypto.randomBytes(32).toString('hex'),
        },
        overrideAccess: true,
        context: { skipApprovalHook: true },
      })
      console.warn(
        `[better-auth-bridge] Self-healed missing Payload user for ${sessionUser.email} (role: ${role})`,
      )
      return payloadUser
    } catch (error) {
      // Most likely a concurrent request created it first (unique email) — re-find.
      payloadUser = await findByEmail(payload, sessionUser.email)
      if (!payloadUser) {
        console.error(
          `[better-auth-bridge] Failed to self-heal Payload user for ${sessionUser.email}:`,
          error,
        )
        return null
      }
    }
  }

  // Lazy-populate betterAuthId on users created before the bridge stored it.
  if (!payloadUser.betterAuthId && sessionUser.id) {
    try {
      payloadUser = await payload.update({
        collection: 'users',
        id: payloadUser.id,
        data: { betterAuthId: sessionUser.id },
        overrideAccess: true,
        context: { skipApprovalHook: true },
      })
    } catch (error) {
      // Non-fatal — will retry on the next request.
      console.error('[better-auth-bridge] Failed to populate betterAuthId:', error)
    }
  }

  return payloadUser
}
