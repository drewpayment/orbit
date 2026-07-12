# Platform User Management

**Status**: In progress
**Branch**: `feat/platform-user-management`
**Date**: 2026-07-11
**Owner**: Drew (PM: Claude)

## Problem

Users can self-register, but every administrative action on a user (approving
registrations, changing roles, fixing accounts) requires the Payload admin UI at
`/admin`. User management must be a first-class citizen in the app: platform
admins need to create and manage users from a dedicated page.

## Decisions (confirmed with Drew 2026-07-11)

1. **Create flow: both.** Invite email is the default (user sets own password via
   secure link); "set password manually" is an escape hatch for no-email
   environments.
2. **Scope: platform-level only.** One new `/platform/users` area. Workspace
   member management (`MemberManagementDialog`) is untouched.
3. **Removal: deactivate only.** New `deactivated` status; no hard delete in the
   app UI (Payload admin remains the escape hatch).

## Non-goals

- Workspace invite upgrades (inviting emails that don't exist yet)
- Hard delete
- Wiring the latent RBAC collections (`roles`, `permissions`, `user-workspace-roles`)
- Account/profile self-service page wiring
- Impersonation

## UX Spec

### Navigation
- New sidebar item **Users** in the Platform nav group (`nav-platform.tsx`),
  visible only to platform admins (`usePlatformAdmin`), linking to `/platform/users`.

### `/platform/users` page
- Server component, gated: `getPayloadUserFromSession()` → redirect `/login` if
  none, redirect `/` if not `isPlatformAdmin`. (Copy the `platform/llm-providers`
  pattern.)
- Header: title "Users", subtitle, primary button **Create user**.
- Summary strip: counts of total / pending approval / deactivated. Pending > 0 is
  visually prominent (badge/amber).
- **Table** (client component): columns Avatar+Name, Email, Role (badge), Status
  (badge: pending=amber, approved=green, rejected=red, deactivated=gray),
  Email verified (icon), Created date, row-actions dropdown.
- **Search** input (name or email, client-side or server-side filter) and
  **filter** selects for role and status.
- Empty and loading states consistent with existing tables.

### Create user dialog
- Fields: Name (required), Email (required, validated), Role (select: User /
  Admin / Super Admin — options limited by actor policy below), and a
  **credential mode** radio:
  - **Send invite email** (default): user receives an email with a secure link to
    set their password.
  - **Set password manually**: reveals Password + Confirm password fields
    (min 8 chars); account is created with email already verified (the admin
    vouches for it).
- On success: toast, dialog closes, table refreshes. Duplicate email shows an
  inline error, not a toast-only failure.

### Row actions (dropdown per user)
- **Edit** — dialog to change Name and Role (policy-gated).
- **Approve** / **Reject** — only for `pending` users; approve triggers the
  existing verification-email pipeline (`userApprovalHook`).
- **Resend verification email** — only for approved + unverified users.
- **Send password reset** — approved users with verified email.
- **Resend invite** — invited users who haven't set a password yet.
- **Deactivate** (confirm dialog) / **Reactivate** — see policy below.
- Actions that don't apply to a row are hidden, not disabled-with-mystery.

## Policy matrix (server-enforced, UI mirrors it)

| Actor → Target | regular user | admin | super_admin |
|---|---|---|---|
| **admin** | full manage | view only | view only |
| **super_admin** | full manage | full manage | full manage* |

- Role escalation: only `super_admin` may grant or revoke `admin`/`super_admin`.
  An `admin` can only create/edit users with role `user`.
- *Self-protection: no actor may change their own role or deactivate themselves.
- Last-super_admin protection: the system must refuse to demote or deactivate the
  last active `super_admin`.
- Every server action re-checks the session server-side (never trust the client).

## Deactivation semantics

- Add `deactivated` to the `Users.status` select (and the Better-Auth mirror).
- The Better-Auth session gate (`databaseHooks.session.create.before` in
  `lib/auth.ts`) must reject sign-in for `deactivated` (same shape as
  pending/rejected, with a distinct message).
- On deactivation, **revoke existing sessions** so the user is signed out
  everywhere (delete the user's rows in the Better-Auth `session` collection, or
  use the Better-Auth admin plugin's `revokeUserSessions` — engineer's choice,
  verify whichever path actually kills a live session).
- Reactivation restores the prior `approved` status.

## Invite flow semantics

- Admin-created invite: Better-Auth user + Payload user are created with
  `status: approved`, no password usable by anyone else, and an **invite email**
  sent via the existing Resend infrastructure in `lib/auth.ts`.
- The invite link lets the user set a password; completing it marks the email
  verified (the link proves mailbox ownership) and lands them signed in or at
  `/login` with a success message.
- Implementation hint (engineer to verify): Better-Auth's password-reset token
  flow can serve as "set your password" — or the Better-Auth `admin()` plugin's
  `createUser` + a reset link. Reuse `reset-password/page.tsx` UI if possible,
  with invite-specific copy. Whatever the mechanism: UAC-9/10 below are the
  contract.
- Invites must be re-sendable and must expire (Better-Auth token TTL is fine).

## User Acceptance Criteria

Auth/gating
1. A non-authenticated visitor to `/platform/users` is redirected to `/login`.
2. A signed-in non-admin (`role: user`) visiting `/platform/users` is redirected
   away and never sees the Users nav item.
3. A platform admin sees the Users nav item and the page renders a table
   containing all users with name, email, role badge, status badge, verified
   indicator, and created date.

List
4. Searching by partial name or email filters the table.
5. Filtering by role and by status works and can combine with search.
6. Pending registrations are visible (status badge + count in the summary strip).

Create — invite
7. Admin creates a user (name, email, role=user, invite mode): success toast,
   user appears in the table with status `approved`, email unverified, and an
   invite email is sent (dev mode: link logged to server console).
8. Creating a user with an email that already exists shows a clear inline error;
   no duplicate account is created in either Better-Auth or Payload.
9. Opening the invite link lets the invitee set a password (with confirmation);
   after completing it they can sign in with that password.
10. After the invitee completes the invite, their email shows as verified and no
    "resend verification" action is offered for them.

Create — manual password
11. Admin creates a user with a manually set password: the user can sign in
    immediately with that password; their email shows as verified.
12. Password fields enforce a minimum of 8 characters and matching confirmation.

Manage
13. Approving a pending user flips status to `approved` and sends the
    verification email (existing pipeline); rejecting flips to `rejected` and the
    user cannot sign in.
14. Editing a user's name updates the table and the Payload doc.
15. A super_admin can change a user's role between user/admin; the change is
    reflected in both Payload and the Better-Auth user doc (sign-in as that user
    shows the new capabilities).
16. An admin (non-super) cannot edit or deactivate another admin/super_admin —
    the actions are absent in the UI AND the server action refuses if called
    directly.
17. An admin cannot grant any role above `user` (option not offered; server
    refuses).
18. No user can change their own role or deactivate themselves (server refuses;
    UI hides).
19. The last active super_admin cannot be demoted or deactivated (server refuses
    with a clear error).

Deactivation
20. Deactivating a user (confirm dialog) sets status `deactivated`; the user's
    existing session is terminated (a logged-in browser for that user loses
    access on next request/refresh) and sign-in is refused with a clear message.
21. Reactivating restores access: the user can sign in again.

Email utilities
22. "Resend verification" for an approved+unverified user sends the verification
    email (dev: logged link) and shows a success toast.
23. "Send password reset" sends the reset email for the target user.

Quality bar
24. All new server actions have server-side authorization tests (vitest) covering
    the policy matrix, including the self-protection and last-super_admin rules.
25. `pnpm build` / `tsc` stays at 0 errors; no new vitest failures beyond the
    known pre-existing main debt.

## Technical design

### New files
- `orbit-www/src/app/(frontend)/platform/users/page.tsx` — gated server page,
  fetches users via Payload local API.
- `orbit-www/src/app/(frontend)/platform/users/actions.ts` — `'use server'`
  actions (see signatures below).
- `orbit-www/src/app/(frontend)/platform/users/users-table.tsx` — client table +
  search/filters + row actions.
- `orbit-www/src/app/(frontend)/platform/users/create-user-dialog.tsx`
- `orbit-www/src/app/(frontend)/platform/users/edit-user-dialog.tsx` (or inline
  in table file, engineer's call)
- `orbit-www/src/app/(frontend)/platform/users/__tests__/actions.test.ts`
- Invite acceptance page if the reset-password page can't be reused directly:
  `orbit-www/src/app/(auth)/accept-invite/page.tsx` (or reuse
  `reset-password` with copy variant).

### Server action signatures (contract for the UI)

```ts
type ActionResult<T = void> = { ok: true; data?: T } | { ok: false; error: string }

createUser(input: {
  name: string; email: string; role: 'user' | 'admin' | 'super_admin';
  mode: 'invite' | 'password'; password?: string;
}): Promise<ActionResult<{ userId: string }>>

updateUser(input: { userId: string; name?: string; role?: Role }): Promise<ActionResult>
approveUser(userId: string): Promise<ActionResult>
rejectUser(userId: string): Promise<ActionResult>
deactivateUser(userId: string): Promise<ActionResult>
reactivateUser(userId: string): Promise<ActionResult>
resendVerification(userId: string): Promise<ActionResult>
sendPasswordReset(userId: string): Promise<ActionResult>
resendInvite(userId: string): Promise<ActionResult>
```

Every action: `getPayloadUserFromSession()` → `isPlatformAdmin` check → policy
matrix check (role comparisons + self check + last-super_admin check) → mutate
via Payload local API (`overrideAccess: true`, `context.skipApprovalHook` where
the approval hook must not re-fire) and/or Better-Auth server API → keep the
Better-Auth user doc mirror in sync (role/status fields) → `revalidatePath('/platform/users')`.

### Modified files
- `orbit-www/src/collections/Users.ts` — add `deactivated` to status options.
- `orbit-www/src/lib/auth.ts` — session-create gate rejects `deactivated`;
  invite email sender if needed.
- `orbit-www/src/components/nav-platform.tsx` (and/or `app-sidebar.tsx`) — Users
  nav item.
- `orbit-www/src/collections/hooks/userApprovalHook.ts` — only if status-mirror
  logic needs the new status (verify).

### Constraints / gotchas (from repo memory)
- Payload↔Better-Auth bridge: always set/propagate `betterAuthId`; workspace
  memberships key on Better-Auth id, not Payload id.
- When creating Payload users outside signup, pass `context.skipApprovalHook`.
- Payload relationship writes need real doc ids.
- Follow `lib/access/collection-access.ts` factories if any collection access
  changes are made (should not be needed — server actions use `overrideAccess`
  after explicit checks, same as llm-providers).
- Frontend package manager is `pnpm`. TDD: write the actions tests first.

## Task breakdown

### Task 1 — Backend/domain (engineer A)
1. Add `deactivated` status (Users collection + BA mirror + session gate +
   sign-in error message). Test: gate rejects deactivated.
2. Implement all server actions with policy enforcement, TDD (tests first).
3. Invite flow end-to-end (token issue + email + acceptance page/copy).
4. Session revocation on deactivate (verify a real session dies).
Verification: `pnpm exec vitest run src/app/\(frontend\)/platform/users` green,
`pnpm exec tsc --noEmit` 0 errors.

### Task 2 — Frontend (engineer B, after Task 1 merges to the feature branch)
1. Page + gate + summary strip.
2. Table + search + filters + badges.
3. Create dialog (both modes), edit dialog, row actions with confirm for
   deactivate.
4. Sidebar nav item.
Verification: `pnpm exec tsc --noEmit`, `pnpm build` passes; manual smoke via
dev server.

### Task 3 — Review + QA
1. Code review (code-reviewer agent) against this plan.
2. QA agent uses agent-browser against `make dev-local` dev server, walks UAC
   1–23 (UAC 24–25 verified by commands), files findings; fixes looped back to
   engineers until green.

## QA notes
- Dev login: `drew.payment@gmail.com` / `Password1234` (platform admin).
- Email in dev logs links to console when `RESEND_API_KEY` is absent — QA should
  scrape invite/verification links from the dev-server output.
- QA must create throwaway users with `+tag` emails (e.g.
  `drew.payment+qa1@gmail.com`) and finish by deactivating them.
