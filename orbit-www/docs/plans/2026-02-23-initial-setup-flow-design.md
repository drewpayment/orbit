# Initial Setup Flow — Design Document

**Date**: 2026-02-23
**Status**: Approved

## Problem

When Orbit is first deployed, there is no admin user, tenant, or workspace. Users can navigate to `/login` or `/signup` and create accounts without any admin designation. There is no "first run" experience.

## Solution

A one-time setup flow that creates the first admin user (in both Better Auth and Payload), a default self-hosted tenant, and the first workspace — all from a single form.

## Detection — Next.js Middleware

- New `src/middleware.ts` intercepts all requests.
- On first request, queries Better Auth's `user` collection via `countDocuments()`.
- If count is 0, redirects to `/setup` (unless already on `/setup` or `/api/setup`).
- Caches the result in a module-level variable so subsequent requests skip the query.
- After setup completes, the API endpoint invalidates the cache.
- Allowlist: `/setup`, `/api/setup`, static assets (`_next/`, `favicon.ico`, etc.).

## UI — Single Page Setup Form

- Route: `src/app/(setup)/setup/page.tsx`
- Single form with two sections:
  - **Admin Account**: name, email, password, confirm password
  - **Workspace**: workspace name (slug auto-derived)
- Client-side validation: required fields, password match, 8+ characters.
- Submit button: "Complete Setup"
- On success: auto-login via Better Auth session cookie, redirect to `/dashboard`.
- On load: if users already exist, redirect to `/login`.

## API — Setup Endpoint

- `POST /api/setup` at `src/app/api/setup/route.ts`
- **Guard**: Rejects with 403 if any users already exist.
- **Actions** (in order):
  1. Create user in Better Auth via `auth.api.signUpEmail()`
  2. Create matching user in Payload via `payload.create({ collection: 'users' })`
  3. Create default Tenant (`name: "Default"`, `slug: "default"`, `plan: "self-hosted"`, `status: "active"`)
  4. Create default Workspace (user-provided name, auto-generated slug)
  5. Add user as workspace owner in `workspace-members`
  6. Create Better Auth session and return session cookie
- All operations wrapped in try/catch with cleanup on failure.
- Invalidates middleware cache flag on success.

## Security

- `/api/setup` is one-shot: returns 403 if any user exists.
- Middleware blocks all app access until setup completes (prevents rogue signups).
- Setup page checks on load — if users exist, redirects to `/login`.

## Data Created

| Collection | Record | Key Fields |
|---|---|---|
| Better Auth `user` | Admin user | name, email, password (hashed by BA) |
| Payload `users` | Matching admin | email, name |
| `tenants` | Default tenant | `plan: "self-hosted"`, `status: "active"` |
| `workspaces` | User's workspace | name, slug |
| `workspace-members` | Owner membership | `role: "owner"`, `status: "active"` |

## Out of Scope

- Multi-step wizard UI
- Tenant customization during setup
- GitHub/integration configuration during setup
- Email verification during setup
- Admin role field on user model (deferred — `isAdmin` stub stays)
