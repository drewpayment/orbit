# SOP: Authorization in orbit-www

One Actor, one policy, three call sites. Plan: `docs/plans/2026-09-16-authz-consolidation.md`.

## Identity

Two user records exist: Better-Auth (session) and the Payload `users` doc. Their ids differ.
`workspace-members.user` stores the **Better-Auth id** (until Phase E); every `relationTo: 'users'`
field stores the **Payload id**. Never pass one where the other is expected.

```ts
import { getActor, requireActor } from '@/lib/authz'
const actor = await requireActor()      // throws UnauthenticatedError (401)
actor.payloadId      // createdBy / author / triggeredBy comparisons, `user:` args
actor.betterAuthId   // workspace membership, svc-auth JWT sub
actor.isPlatformAdmin
actor.user           // Payload-shaped user for payload.find({ user })
```

Do not import `getCurrentUser`, `getPayloadUserFromSession`, `getSession` or `auth` in feature code
(lint-enforced). Do not read `session.user.id`; it is ambiguous.

## Deciding

```ts
import { authorize, check, memberWorkspaceIds, workspaceRole } from '@/lib/authz'

// Throwing (RSC pages, route handlers, server actions that throw):
const actor = await authorize('manage', { kind: 'workspace', id: workspaceId })
// Non-throwing ({ success, error } server actions):
const d = await check('read', { kind: 'workspace', id })
if (!d.allowed) return { success: false, error: d.reason }
// Tenant scoping for list queries:
const ids = await memberWorkspaceIds()          // 'member' | 'manage' | 'owner'
// UI flags:
const role = await workspaceRole(workspaceId)   // 'owner' | 'admin' | 'member' | null
```

Verbs: `read` and `create` need any active role; `update`, `delete`, `manage` need owner/admin.
Pass `roles` to override. Resources: `{ kind: 'platform' }`, `{ kind: 'workspace', id }`,
`{ kind: 'doc', workspaceId, ownerPayloadId? }` (the owner passes regardless of role).
Platform admin passes everything. Anonymous fails everything.

Route Handlers:

```ts
try {
  const actor = await authorize('manage', { kind: 'platform' })
  …
} catch (err) {
  return authzErrorResponse(err) ?? NextResponse.json({ error: 'Internal error' }, { status: 500 })
}
```

After `authorize`, data calls use `overrideAccess: true` (decision D2). Payload collection `access`
rules use the adapters in `@/lib/authz/payload` (`workspaceScopedRead`, `memberCreate`,
`manageCreate`, `docWorkspaceMutate`, `adminOnly`, `authenticatedOnly`, `denyAll`) over the same
policy, so REST/GraphQL and server code agree.

## Roster data

Listing, counting, inviting, changing roles, removing members: `@/lib/workspaces/members`.
Never `payload.find({ collection: 'workspace-members' })` elsewhere (lint-enforced).

## Internal callers

`/api/internal/**` (shared secret) and Temporal activities are different actors; they do not use
the Actor and run with `overrideAccess: true` after `validateInternalApiKey`.

## Adding a capability

New capability = new `Resource` kind or `Verb` in `lib/authz/policy.ts` plus a test in
`lib/authz/__tests__/policy.test.ts`. Not a new helper module.
