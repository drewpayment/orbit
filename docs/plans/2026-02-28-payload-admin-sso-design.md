# Payload Admin SSO via Better Auth — Design Document

## Overview

When a user is logged into Orbit via Better Auth with an admin role (`super_admin` or `admin`), they can seamlessly access the Payload admin panel at `/admin` without a second login. Non-admin users are blocked from the admin panel entirely. Payload's built-in email/password login is disabled — Better Auth is the only authentication path.

## User Role Model

A new `role` field is added directly to the Users collection (both Better Auth and Payload), separate from workspace-scoped roles:

- **`super_admin`** — Full platform access, all Payload admin capabilities
- **`admin`** — Payload admin access (can be restricted further in the future)
- **`user`** — Default role, no Payload admin access

This is distinct from workspace roles (`user-workspace-roles`) which are scoped to individual workspaces.

## Auth Flow

```
User logged into Orbit (Better Auth session) → navigates to /admin
  → Payload calls custom AuthStrategy "better-auth"
    → reads better-auth.session_token cookie from request headers
    → calls auth.api.getSession({ headers }) to validate session
    → if no valid session → return { user: null } (Payload shows unauthorized)
    → if session valid → read user.role from Better Auth user record
      → if role is not super_admin or admin → return { user: null }
      → if role is super_admin or admin → find matching Payload user by email
        → return { user: payloadUser }
```

## Data Model Changes

### Better Auth `user` — new field
- `role`: `"super_admin" | "admin" | "user"` (default: `"user"`, `input: false`)

### Payload `Users` collection — new field
- `role`: select field with options `super_admin | admin | user` (default: `user`)
- Admin sidebar placement, only editable by other admins

## Components

### 1. Custom AuthStrategy (`src/lib/payload-better-auth-strategy.ts`)

Implements Payload's `AuthStrategy` interface:
- `name: "better-auth"`
- `authenticate({ headers, payload })`:
  1. Call `auth.api.getSession({ headers })` to validate the Better Auth session
  2. Check if `session.user.role` is `super_admin` or `admin`
  3. If yes, find the Payload user by email via `payload.find({ collection: 'users', where: { email: { equals: session.user.email } } })`
  4. Return `{ user: payloadUser }` or `{ user: null }`

### 2. Users Collection Changes (`src/collections/Users.ts`)

- Add `role` select field (`super_admin`, `admin`, `user`) with default `user`
- Add custom strategy: `auth: { disableLocalStrategy: true, strategies: [betterAuthStrategy] }`
- Update the existing `afterChange` hook to sync role changes to Better Auth

### 3. Better Auth Config Changes (`src/lib/auth.ts`)

- Add `role` to `user.additionalFields` with `defaultValue: "user"` and `input: false`

### 4. Payload Admin Access Gate (`src/payload.config.ts`)

- Add `admin.access` callback that validates the request has a valid Better Auth session with an admin role

### 5. `isAdmin` Access Helper (`src/access/isAdmin.ts`)

- Replace the current stub with a real check: query the Better Auth user's role from the request

### 6. UI: Admin Link in Sidebar + User Dropdown

- Add "Admin" link at bottom of sidebar nav, visible only when `user.role` is `super_admin` or `admin`
- Add "Admin Panel" item in user dropdown menu, same condition
- Both link to `/admin` (opens in same tab since it's the same domain)

## Error Handling

- **No Better Auth session** → Strategy returns `null` → Payload shows unauthorized. Since local strategy is disabled, configure a redirect to `/login`.
- **Valid session, not admin** → Strategy returns `null` → Payload shows unauthorized
- **Valid session, admin, no Payload user** → Log warning, return `null`. The Payload user should exist from signup flow, but if missing, admin can create it manually.

## What Changes for Existing Admin User

The first user (created via `/setup`) needs their Better Auth `user` record updated with `role: "super_admin"`. This can be done:
- Via a migration script that sets `role: "super_admin"` on users who don't have a role yet (same birthright pattern as the status field)
- Or manually in MongoDB

## Out of Scope

- Granular permission differences between `super_admin` and `admin` (future)
- Custom Payload admin theme/branding to match Orbit UI
- Automatic Payload user creation from Better Auth (users are created during signup)
