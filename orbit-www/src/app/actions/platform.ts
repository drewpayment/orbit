'use server'

import { getActor } from '@/lib/authz'

/**
 * Check if the current user has platform admin privileges.
 * `userId` is the Better-Auth id, matching the session id the old
 * implementation returned here (no caller in the repo consumes it).
 */
export async function checkPlatformAdmin(): Promise<{
  isAdmin: boolean
  userId?: string
}> {
  const actor = await getActor()

  if (!actor) {
    return { isAdmin: false }
  }

  return { isAdmin: actor.isPlatformAdmin, userId: actor.betterAuthId }
}
