# Email verification flow fix

**Date:** 2026-07-06
**Status:** Implemented on `fix/email-verification-flow` — QA validated live across two passes (full verify journey with a real Better-Auth token, resend→verify→login, retroactive skip, register-500 fix with auto-created Payload user, error classification, admin-gate exemption). Scope grew: + register-route 500 fix (autoSignIn:false), + first-setup-user is super_admin in all three role stores.
**Owner:** PM session (Claude) directing engineer + QA agents
**Context:** Drew locked out of the deployed site — "verify your email" on a
6-month-old approved account, no email ever delivered.

## Problems (verified on main, 2026-07-06)

1. **Invalid tokens.** `src/collections/hooks/userApprovalHook.ts` hand-rolls a
   verification token (random hex inserted into the `verification` collection)
   and links to `/api/auth/verify-email?token=...`. Better-Auth's verify-email
   endpoint expects its own signed token — the emailed link does not verify.
   Never validated end-to-end.
2. **Silent production no-op.** Both send paths (`auth.ts`
   `emailVerification.sendVerificationEmail` and the approval hook) skip sending
   with no log at all when `RESEND_API_KEY` is unset outside development; send
   errors are swallowed.
3. **No resend path.** Login error says "check your inbox" but nothing can
   regenerate the email: `auth.ts` sender is unreachable (`sendOnSignUp: false`,
   zero client call sites), hook tokens expire in 24h, login page has no action.
4. **Gate exemptions too narrow / checkbox not retroactive.** Session-create
   gate (`auth.ts:117`) exempts only `super_admin`. The `skipEmailVerification`
   checkbox only takes effect if checked before the status flip (hook fires
   only on status *change*).

## Design

1. **Single sender, valid tokens.** The approval hook stops minting tokens and
   calls Better-Auth's server API instead:
   `auth.api.sendVerificationEmail({ body: { email, callbackURL: '/login' } })`.
   That routes through `auth.ts`'s `emailVerification.sendVerificationEmail`
   with a token Better-Auth itself validates. Delete the hook's duplicated
   HTML template and hand-rolled `verification` insert.
2. **Loud failures.** In `auth.ts` sender: if `RESEND_API_KEY` is missing and
   `NODE_ENV === 'production'`, `console.error` a `[email-verification]`-tagged
   line (unmissable in pod logs) — keep dev behavior (log the URL to console,
   skip send). In the approval hook, catch + `console.error` send failures and
   continue (approval itself must not roll back), but include the email + error.
3. **Resend action.** On the login page, when sign-in fails with the
   verify-your-email FORBIDDEN message, render a "Resend verification email"
   button that calls the Better-Auth client `sendVerificationEmail({ email,
   callbackURL: '/login' })` with the entered email. Show success/failure
   feedback. (Better-Auth no-ops for unknown emails — no enumeration issue.)
4. **Policy** (PM decision): exempt `admin` alongside `super_admin` in the
   session gate (admins are hand-vetted; today they're approved via the panel
   where email delivery may not even be configured). Keep the gate for `user`.
   Make `skipEmailVerification` retroactive: hook also fires when the checkbox
   flips true on an already-approved user → set `emailVerified: true` on the
   Better-Auth doc (no email sent).
5. **No schema changes**; no collection access changes.

## Files

- `orbit-www/src/collections/hooks/userApprovalHook.ts` — rewrite send path
  (auth.api call), add retroactive-skip branch, keep status sync + metadata.
- `orbit-www/src/lib/auth.ts` — sender: loud prod failure; gate: exempt
  `admin` + `super_admin` (line ~117).
- `orbit-www/src/app/(auth)/login/page.tsx` (or its client component) — resend
  button on the verification error state.
- Tests: hook unit tests (mock auth.api + mongo), auth-gate test if a harness
  exists, login-page component test for the resend state.

## UAC

- **UAC-1** Approving a user (status → approved, skip unchecked) triggers exactly
  one Better-Auth-issued verification email; clicking the emailed link verifies
  the account and login then succeeds. Proven live in dev via the console-logged
  URL (dev mode logs it; QA follows it in the browser).
- **UAC-2** `skipEmailVerification` checked at approval time ⇒ `emailVerified:
  true`, no email. Checking it AFTER approval (separate save) also sets
  `emailVerified: true` (retroactive).
- **UAC-3** Login blocked by the gate shows the message AND a working "Resend
  verification email" action; resent link verifies successfully.
- **UAC-4** `role: admin` and `super_admin` are exempt from the gate; `user` is
  not. Legacy docs without `status` still pass.
- **UAC-5** With `RESEND_API_KEY` unset: dev logs the URL and continues;
  production path logs a loud `[email-verification]` error (unit-tested via
  NODE_ENV stub) — never a silent skip.
- **UAC-6** No hand-rolled `verification` inserts remain; single email template
  lives in `auth.ts`.
- **UAC-7** `bunx vitest run` on touched areas green; `bunx tsc --noEmit` at the
  ~111 main baseline (zero new); eslint clean on touched files.
- **UAC-8** Browser QA (dev server): full signup → admin-approve → verify-link →
  login journey; resend journey; skip-checkbox journey. Existing seeded admin
  login unaffected.

## Verification

1. `cd orbit-www && bunx vitest run src/collections src/app` (touched suites)
2. `bunx tsc --noEmit` baseline check; eslint on touched files
3. agent-browser QA per UAC-8 with screenshots
4. PR references the deployed-site incident; deployment notes: requires
   `ORBIT_RESEND_API_KEY`/`ORBIT_RESEND_FROM_EMAIL` in Doppler (and the
   already-missing `ORBIT_SVC_AUTH_SECRET` for the stuck rollout — separate
   infra action, not this PR).
