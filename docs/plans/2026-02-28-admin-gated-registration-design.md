# Admin-Gated User Registration — Design Document

## Overview

When a user registers, they are held in a "pending" state. A platform admin must approve their registration through the Payload admin panel before the user can log in. Upon approval, an email verification is sent (unless the admin bypasses verification). Rejected users are kept for audit trail with no notification.

## User Status Lifecycle

```
signup → PENDING → admin approves → APPROVED (emailVerified=false)
                                        ↓
                              user clicks email link → APPROVED (emailVerified=true) → can log in
                              OR admin bypasses verification → APPROVED (emailVerified=true) → can log in
                 → admin rejects → REJECTED (kept for audit, no notification)
```

## Data Model Changes

### Better Auth `user` — additional field
- `status`: `"pending" | "approved" | "rejected"` (default: `"pending"`)
- Better Auth already has `emailVerified` as a built-in boolean field

### Payload `Users` collection — new fields
- `status`: select field with options `pending | approved | rejected` (default: `pending`)
- `registrationApprovedAt`: date (set when admin approves)
- `registrationApprovedBy`: relationship to Users (the admin who approved)
- `skipEmailVerification`: checkbox (admin can toggle this when approving — if true, sets `emailVerified=true` in Better Auth)

## Flow Changes

### Signup Flow (modified)
1. User fills out `/signup` form (name, email, password, confirm password)
2. Better Auth creates user with `status: "pending"`, `emailVerified: false`
3. **New**: After Better Auth user creation, also create a Payload `Users` record with matching email and `status: "pending"` — solves the dual-store sync gap
4. User sees a "Registration submitted" confirmation page (NOT redirected to dashboard)
5. User cannot log in until approved + email verified

### Login Flow (modified)
Check `user.status` before allowing session:
- `"pending"` → "Your registration is pending admin approval"
- `"rejected"` → "Your registration was not approved"
- `"approved"` + `emailVerified === false` → "Please check your email and verify your account"
- `"approved"` + `emailVerified === true` → allow login, create session

### Admin Approval (Payload Admin Panel at /admin)
- Admin navigates to Users collection, filters by `status: pending`
- Admin opens a pending user record and changes status:
  - **Set to `approved`** — Payload `afterChange` hook triggers:
    1. Updates Better Auth user: `status = "approved"`
    2. If `skipEmailVerification` is checked: also sets `emailVerified = true` in Better Auth
    3. If `skipEmailVerification` is NOT checked: sends verification email via Resend
    4. Sets `registrationApprovedAt` and `registrationApprovedBy`
  - **Set to `rejected`** — Payload `afterChange` hook:
    1. Updates Better Auth user: `status = "rejected"`
    2. No notification sent, record kept for audit

### Email Verification
- Verification emails sent via Resend (already installed and configured in Payload)
- Need to wire Resend into Better Auth's `emailAndPassword.sendVerificationEmail` callback
- User clicks verification link → Better Auth sets `emailVerified = true`
- User can now log in

## UI Changes

### `/signup` page
- **Success state**: After form submission, show "Registration submitted! An admin will review your request. You'll receive an email when your account is approved." instead of redirecting to `/dashboard`
- Error handling unchanged

### `/login` page
- Add contextual error messages for each rejection reason:
  - "Your registration is pending admin approval" (for status=pending)
  - "Your registration was not approved. Contact an administrator." (for status=rejected)
  - "Please verify your email before logging in. Check your inbox." (for approved but unverified)

### Payload Admin Panel
- No custom admin components needed — standard Payload field editing
- Admin sees `status` dropdown, `skipEmailVerification` checkbox on user records
- Can filter Users list by `status: pending` to see pending approvals

## Technical Details

### Better Auth Configuration Changes (`auth.ts`)
- Add `status` to `user.additionalFields`
- Enable `requireEmailVerification: true`
- Add `sendVerificationEmail` callback using Resend
- Add login hook to check `status` before session creation

### Payload Users Collection Changes (`Users.ts`)
- Add `status` select field (pending/approved/rejected)
- Add `registrationApprovedAt` date field
- Add `registrationApprovedBy` relationship field
- Add `skipEmailVerification` checkbox field
- Add `afterChange` hook to sync approval to Better Auth

### Signup API Changes
- After Better Auth `signUp.email()`, create Payload user record
- Return "pending" status to the client instead of session

## Out of Scope
- Admin notification when new registration arrives (future: could add email/webhook)
- Self-service email verification re-send
- Password reset flow
- Custom Payload admin UI components for approval workflow
