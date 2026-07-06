# Password reset (forgot password) flow

**Date:** 2026-07-06
**Status:** Implemented on `feat/password-reset` — QA validated live (full reset journey incl. old-password-rejected/new-accepted, no-enumeration, bad/missing/expired token states, inline validation, #75 regression check). Verdict: ship.
**Owner:** PM session (Claude) directing engineer + QA agents
**Context:** Prod lockout incident — Drew's password stopped working and the only
recovery was a manual scrypt-hash injection into the prod Mongo. There is no
self-service reset. Direct follow-on to PR #75 (verification/resend).

## Design (Better-Auth native)

1. **`orbit-www/src/lib/auth.ts`** — add to `emailAndPassword`:
   `sendResetPassword: async ({ user, url }) => { ... }` using the exact same
   pattern as `emailVerification.sendVerificationEmail` post-#75: dev-mode
   console block (📧 PASSWORD RESET + URL), loud
   `console.error('[password-reset] RESEND_API_KEY not configured …')` in
   production when the key is missing, Resend send with an Orbit-styled HTML
   template ("Reset your Orbit password", same visual language/orange button,
   "link expires in 1 hour; if you didn't request this, ignore").
   Keep default `resetPasswordTokenExpiresIn` (1h).
2. **Login page** (`src/app/(auth)/login/page.tsx`) — a small "Forgot password?"
   link near the password field → `/forgot-password`.
3. **NEW `/forgot-password` page** (`src/app/(auth)/forgot-password/page.tsx`) —
   email input + submit calling the Better-Auth client
   `requestPasswordReset({ email, redirectTo: '/reset-password' })`.
   ALWAYS render the same success state ("If an account exists for that email,
   a reset link is on its way") regardless of whether the account exists — no
   account enumeration. Match login-page styling.
4. **NEW `/reset-password` page** (`src/app/(auth)/reset-password/page.tsx`) —
   reads `token` from the query string (Better-Auth appends it to `redirectTo`);
   new password + confirm fields (min 8 chars, must match), submit calls client
   `resetPassword({ newPassword, token })`; success → redirect to `/login` with
   a "password updated" notice; invalid/expired token (`error=INVALID_TOKEN` in
   query or API error) → clear error state with a link back to `/forgot-password`.
5. No schema changes, no collection access changes, no new dependencies.

## UAC

- **UAC-1** Full journey: "Forgot password?" from login → submit email →
  always-success state → reset URL (dev-logged) opens the reset form → new
  password accepted → redirected to login → OLD password rejected, NEW password
  logs in.
- **UAC-2** Unknown email submits to the identical success state (no
  enumeration), and no reset URL is emitted for it.
- **UAC-3** Invalid/expired/missing token on `/reset-password` shows the error
  state with a path back to `/forgot-password`; no crash.
- **UAC-4** Password rules enforced client-side (min 8, confirm matches) and
  server errors surfaced inline.
- **UAC-5** Missing `RESEND_API_KEY`: dev logs the URL and continues; prod path
  logs the loud `[password-reset]` error (unit-testable branch mirror of #75).
- **UAC-6** Verification gate and all PR #75 behaviors unchanged (resend button
  etc. still work — regression check).
- **UAC-7** `bunx vitest run` on touched suites green; tsc at main baseline
  (zero new errors in touched files); eslint clean on touched files.
- **UAC-8** Browser QA: full UAC-1 journey live on the dev server as a real
  user (use a qa-verify-* account or a fresh @example.invalid signup +
  approval), plus UAC-2/3 spot checks and screenshots.

## Work packages

- **Engineer (Opus)** — all of Design; TDD for the two new pages' components
  and the auth-config branch where testable.
- **QA (agent-browser)** — UAC-8 with screenshots; verdict gates merge.

## Verification

1. `cd orbit-www && bunx vitest run src/app/\(auth\)` (+ any touched suites)
2. `bunx tsc --noEmit` baseline; eslint touched files
3. agent-browser QA per UAC-8
4. PR; deploy notes: no new env needed (reuses RESEND_*)
