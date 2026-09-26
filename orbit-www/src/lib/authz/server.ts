import 'server-only'
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getActor, UnauthenticatedError, type Actor } from './actor'
import { can, type Decision, type Resource, type Verb } from './policy'
import { membershipRole, workspaceIdsFor, type MembershipScope, type WorkspaceRole } from './membership'

/**
 * Server-side authorization for server actions, RSC pages and Route Handlers.
 *
 *   const actor = await authorize('manage', { kind: 'workspace', id })
 *   … payload.update({ …, overrideAccess: true })   // established pattern (D2)
 *
 * `authorize` resolves the Actor for the current request (or takes one), runs
 * the policy in `./policy.ts`, and throws:
 *   - `UnauthenticatedError` (status 401) when there is no session, or
 *   - `AuthzError` (status 403) carrying the policy `Decision`.
 *
 * Route Handlers map either with `authzErrorResponse(err)`. Server actions
 * that return `{ success, error }` objects use `check()` instead, which never
 * throws. The same `can()` drives Payload collection access via `./payload.ts`,
 * so a decision made here matches the one Payload would make.
 *
 * Do NOT query `workspace-members` in feature code; use `memberWorkspaceIds`
 * / `workspaceRole` here. Both are request-cached via `./membership.ts`.
 */

export class AuthzError extends Error {
  readonly status = 403
  constructor(
    readonly decision: Decision,
    readonly verb: Verb,
    readonly resource: Resource,
  ) {
    super(`Forbidden: ${decision.reason}`)
    this.name = 'AuthzError'
  }
}

/** The current actor, or the one supplied. `undefined` means "resolve it". */
async function resolveActor(actor: Actor | null | undefined): Promise<Actor | null> {
  return actor === undefined ? getActor() : actor
}

/** Evaluate the policy without throwing. `actor` is null when unauthenticated. */
export async function check(
  verb: Verb,
  resource: Resource,
  actor?: Actor | null,
): Promise<Decision & { actor: Actor | null }> {
  const a = await resolveActor(actor)
  if (!a) return { allowed: false, reason: 'unauthenticated', actor: null }
  const payload = await getPayload({ config })
  const decision = await can(payload, a, verb, resource)
  return { ...decision, actor: a }
}

/** Evaluate the policy; throw `UnauthenticatedError` / `AuthzError` on deny. */
export async function authorize(verb: Verb, resource: Resource, actor?: Actor | null): Promise<Actor> {
  const a = await resolveActor(actor)
  if (!a) throw new UnauthenticatedError()
  const payload = await getPayload({ config })
  const decision = await can(payload, a, verb, resource)
  if (!decision.allowed) throw new AuthzError(decision, verb, resource)
  return a
}

/**
 * Ids of the workspaces the actor holds a role in (`'member'` = any active
 * role, `'manage'` = owner/admin, `'owner'`). Platform admins get ONLY their
 * own memberships here; a caller that wants "admins see everything" checks
 * `actor.isPlatformAdmin` itself. `[]` when unauthenticated.
 */
export async function memberWorkspaceIds(scope: MembershipScope = 'member', actor?: Actor | null): Promise<string[]> {
  const a = await resolveActor(actor)
  if (!a) return []
  const payload = await getPayload({ config })
  return workspaceIdsFor(payload, a.betterAuthId, scope)
}

/** The actor's active role in `workspaceId`, or null. */
export async function workspaceRole(workspaceId: string, actor?: Actor | null): Promise<WorkspaceRole | null> {
  const a = await resolveActor(actor)
  if (!a) return null
  const payload = await getPayload({ config })
  return membershipRole(payload, a.betterAuthId, workspaceId)
}

/** True for the two errors `authorize` throws. */
export function isAuthzError(err: unknown): err is AuthzError | UnauthenticatedError {
  return err instanceof AuthzError || err instanceof UnauthenticatedError
}

/**
 * Route Handler helper: a 401/403 JSON response for the errors `authorize`
 * throws, or null for anything else (rethrow / handle as usual).
 *
 *   try { … } catch (err) { return authzErrorResponse(err) ?? NextResponse.json({ error: 'Internal error' }, { status: 500 }) }
 */
export function authzErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof UnauthenticatedError) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  if (err instanceof AuthzError) {
    return NextResponse.json({ error: 'Forbidden', reason: err.decision.reason }, { status: 403 })
  }
  return null
}
