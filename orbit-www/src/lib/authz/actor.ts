import 'server-only'
import { cache } from 'react'
import { headers } from 'next/headers'
import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { ensurePayloadUser } from '@/lib/auth/ensure-payload-user'
import { isPlatformAdmin } from '@/lib/access/workspace-access'
import type { User } from '@/payload-types'

/**
 * The authenticated principal for the current server request.
 *
 * Orbit keeps two user records: Better-Auth (session/credential authority) and
 * the Payload `users` doc (roles, status, and the target of every `relationTo:
 * 'users'` field). Their ids are different strings. Every identity bug in this
 * codebase (#63, #69) came from passing one where the other was expected, so
 * the Actor has no bare `id` — callers must pick `payloadId` or `betterAuthId`
 * by name.
 *
 *   payloadId    → comparisons against relationship fields (createdBy, author,
 *                  triggeredBy, …) and `payload.local` `user:` arguments.
 *   betterAuthId → `workspace-members.user` lookups (until authz Phase E moves
 *                  that field to a relationship) and the svc-auth JWT `sub`.
 *
 * Obtain it with `getActor()` (nullable) or `requireActor()` (throws). Do not
 * call `getSession` / `getCurrentUser` / `getPayloadUserFromSession` from
 * feature code; those remain only as implementation details under `lib/auth`.
 */
export type Actor = {
  payloadId: string
  betterAuthId: string
  email: string
  role: NonNullable<User['role']>
  isPlatformAdmin: boolean
  /** Payload-shaped user for `payload.find({ user })` and friends. */
  user: User & { collection: 'users'; _strategy: 'better-auth' }
}

export class UnauthenticatedError extends Error {
  readonly status = 401
  constructor(message = 'Unauthenticated') {
    super(message)
    this.name = 'UnauthenticatedError'
  }
}

/** Pure: shape a Payload users doc into an Actor. */
export function actorFromPayloadUser(payloadUser: User, sessionBetterAuthId?: string): Actor {
  const betterAuthId = payloadUser.betterAuthId ?? sessionBetterAuthId
  if (!betterAuthId) {
    throw new Error(`Payload user ${payloadUser.id} has no betterAuthId and no session id was supplied`)
  }
  return {
    payloadId: String(payloadUser.id),
    betterAuthId,
    email: payloadUser.email,
    role: payloadUser.role ?? 'user',
    isPlatformAdmin: isPlatformAdmin(payloadUser),
    user: { ...payloadUser, collection: 'users', _strategy: 'better-auth' },
  }
}

/**
 * Resolve the current Actor, or null if unauthenticated / deactivated.
 * Memoised per request via React `cache` so layouts, pages and server actions in
 * the same render share one session read and one users lookup.
 *
 * Route Handlers: verified 2026-09-16 (Next 15.4 / React 19) that `cache` has no
 * request-scoped store there, so each call resolves fresh — no memoisation, and
 * therefore no possibility of one request observing another request's Actor.
 */
export const getActor = cache(async (): Promise<Actor | null> => {
  const reqHeaders = await headers()
  const session = await auth.api.getSession({
    headers: reqHeaders,
    query: { disableCookieCache: true },
  })
  const sessionUser = session?.user
  if (!sessionUser?.email) return null

  const payload = await getPayload({ config })
  const payloadUser = await ensurePayloadUser(payload, sessionUser)
  if (!payloadUser) return null
  if (payloadUser.status === 'deactivated') return null

  return actorFromPayloadUser(payloadUser, sessionUser.id)
})

/** Resolve the current Actor or throw `UnauthenticatedError`. */
export async function requireActor(): Promise<Actor> {
  const actor = await getActor()
  if (!actor) throw new UnauthenticatedError()
  return actor
}
