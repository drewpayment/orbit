# Admin-Gated User Registration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Gate new user registrations behind admin approval. Users sign up → held as "pending" → admin approves in Payload admin panel → verification email sent (or bypassed) → user can log in.

**Architecture:** Better Auth gets a `status` additional field (`pending|approved|rejected`). Payload Users collection gets matching fields plus approval metadata. Signup creates both records as `pending`. Payload `afterChange` hook syncs admin approval decisions back to Better Auth via direct MongoDB writes. Better Auth `denySession` hook blocks login for non-approved users.

**Tech Stack:** Better Auth, Payload 3.0, MongoDB (direct via `getMongoClient`), Resend (via Payload email adapter), Next.js 15 App Router

---

### Task 1: Add `status` field to Better Auth configuration

**Files:**
- Modify: `orbit-www/src/lib/auth.ts`

**Step 1: Add `status` to `user.additionalFields` in auth config**

In `orbit-www/src/lib/auth.ts`, add the `status` field to `user.additionalFields`:

```typescript
import { betterAuth } from "better-auth"
import { mongodbAdapter } from "better-auth/adapters/mongodb"
import { MongoClient } from "mongodb"
import { getEnv } from "./env"

const client = new MongoClient(process.env.DATABASE_URI || "")

const appUrl = getEnv('NEXT_PUBLIC_APP_URL') || "http://localhost:3000"

export const auth = betterAuth({
  database: mongodbAdapter(client.db()),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      // Only send verification email if user is approved
      // This callback is triggered by Better Auth when email verification is needed
      const { Resend } = await import("resend")
      const resend = new Resend(process.env.RESEND_API_KEY)
      const fromEmail = process.env.RESEND_FROM_EMAIL || "noreply@hoytlabs.app"

      await resend.emails.send({
        from: fromEmail,
        to: user.email,
        subject: "Verify your Orbit account",
        html: `
          <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1a1a1a;">Verify your email address</h2>
            <p>Your Orbit account has been approved! Click the link below to verify your email and start using Orbit.</p>
            <p style="margin: 24px 0;">
              <a href="${url}" style="display: inline-block; background: #FF5C00; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500;">
                Verify Email
              </a>
            </p>
            <p style="color: #666; font-size: 14px;">If you didn't create an Orbit account, you can ignore this email.</p>
          </div>
        `,
      })
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day (every 1 day session is updated)
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes
    },
  },
  user: {
    additionalFields: {
      name: {
        type: "string",
        required: false,
      },
      avatar: {
        type: "string",
        required: false,
      },
      status: {
        type: "string",
        required: false,
        defaultValue: "pending",
        input: false, // Users cannot set this themselves
      },
    },
  },
  denySession: async ({ user }) => {
    // Block login for non-approved or unverified users
    const status = (user as any).status || "pending"
    if (status === "pending") {
      return { error: "REGISTRATION_PENDING", message: "Your registration is pending admin approval." }
    }
    if (status === "rejected") {
      return { error: "REGISTRATION_REJECTED", message: "Your registration was not approved. Contact an administrator." }
    }
    if (status === "approved" && !user.emailVerified) {
      return { error: "EMAIL_NOT_VERIFIED", message: "Please verify your email before logging in. Check your inbox." }
    }
    return undefined // Allow session
  },
  baseURL: appUrl,
  trustedOrigins: [
    appUrl,
    "http://localhost:3000",
  ],
})

export type Session = typeof auth.$Infer.Session
export type User = Session['user']
```

**Step 2: Verify the build compiles**

Run: `cd orbit-www && DOCKER_BUILD=1 bun run build`
Expected: Build succeeds (may show warnings but no errors)

**Step 3: Commit**

```bash
git add orbit-www/src/lib/auth.ts
git commit -m "feat: add status field and session gating to Better Auth config"
```

---

### Task 2: Add approval fields to Payload Users collection

**Files:**
- Modify: `orbit-www/src/collections/Users.ts`

**Step 1: Add status, approval metadata, and skipEmailVerification fields**

Replace the entire `orbit-www/src/collections/Users.ts` with:

```typescript
import type { CollectionConfig } from 'payload'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
  },
  auth: true,
  fields: [
    {
      name: 'name',
      type: 'text',
      label: 'Full Name',
    },
    {
      name: 'avatar',
      type: 'upload',
      relationTo: 'media',
      label: 'Profile Picture',
    },
    {
      name: 'status',
      type: 'select',
      label: 'Registration Status',
      defaultValue: 'pending',
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Approved', value: 'approved' },
        { label: 'Rejected', value: 'rejected' },
      ],
      admin: {
        position: 'sidebar',
        description: 'Change to "Approved" to allow this user to log in.',
      },
    },
    {
      name: 'skipEmailVerification',
      type: 'checkbox',
      label: 'Skip Email Verification',
      defaultValue: false,
      admin: {
        position: 'sidebar',
        description: 'If checked, user can log in immediately after approval without verifying their email.',
        condition: (data) => data?.status === 'approved',
      },
    },
    {
      name: 'registrationApprovedAt',
      type: 'date',
      label: 'Approved At',
      admin: {
        position: 'sidebar',
        readOnly: true,
      },
    },
    {
      name: 'registrationApprovedBy',
      type: 'relationship',
      relationTo: 'users',
      label: 'Approved By',
      admin: {
        position: 'sidebar',
        readOnly: true,
      },
    },
  ],
}
```

**Step 2: Verify the build compiles**

Run: `cd orbit-www && DOCKER_BUILD=1 bun run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add orbit-www/src/collections/Users.ts
git commit -m "feat: add registration status and approval fields to Payload Users collection"
```

---

### Task 3: Add Payload `afterChange` hook to sync approval to Better Auth

**Files:**
- Create: `orbit-www/src/collections/hooks/userApprovalHook.ts`
- Modify: `orbit-www/src/collections/Users.ts` (add hook import)

**Step 1: Create the afterChange hook**

Create `orbit-www/src/collections/hooks/userApprovalHook.ts`:

```typescript
import type { CollectionAfterChangeHook } from 'payload'
import { getMongoClient } from '@/lib/mongodb'

/**
 * Syncs user approval status changes from Payload admin to Better Auth.
 *
 * When an admin changes a user's status in Payload:
 * - approved: Updates Better Auth user status, optionally sets emailVerified
 *   and triggers verification email
 * - rejected: Updates Better Auth user status
 */
export const userApprovalAfterChangeHook: CollectionAfterChangeHook = async ({
  operation,
  doc,
  previousDoc,
  req: { payload, user: adminUser },
}) => {
  // Only run on update (not create — create is handled by signup flow)
  if (operation !== 'update') return doc

  const previousStatus = previousDoc?.status
  const newStatus = doc.status

  // Only act when status actually changed
  if (previousStatus === newStatus) return doc

  const mongoClient = await getMongoClient()
  const db = mongoClient.db()
  const baUserCollection = db.collection('user')

  // Find the Better Auth user by email
  const baUser = await baUserCollection.findOne({ email: doc.email })
  if (!baUser) {
    console.warn(`[userApprovalHook] No Better Auth user found for email: ${doc.email}`)
    return doc
  }

  if (newStatus === 'approved') {
    const skipVerification = doc.skipEmailVerification === true

    // Update Better Auth user
    const updateData: Record<string, unknown> = {
      status: 'approved',
    }
    if (skipVerification) {
      updateData.emailVerified = true
    }
    await baUserCollection.updateOne(
      { _id: baUser._id },
      { $set: updateData }
    )

    // Update Payload doc with approval metadata
    await payload.update({
      collection: 'users',
      id: doc.id,
      data: {
        registrationApprovedAt: new Date().toISOString(),
        registrationApprovedBy: adminUser?.id,
      },
      // Prevent infinite hook loop
      context: { skipApprovalHook: true },
    })

    // If NOT skipping verification, trigger Better Auth verification email
    if (!skipVerification) {
      try {
        // Send verification email via Resend directly
        const { Resend } = await import('resend')
        const resend = new Resend(process.env.RESEND_API_KEY)
        const fromEmail = process.env.RESEND_FROM_EMAIL || 'noreply@hoytlabs.app'
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

        // Generate a verification token and store it
        // Better Auth stores verification tokens in its own collection
        const crypto = await import('crypto')
        const token = crypto.randomBytes(32).toString('hex')
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

        await db.collection('verification').insertOne({
          identifier: doc.email,
          token,
          value: JSON.stringify({ email: doc.email, userId: baUser._id.toString() }),
          expiresAt,
          createdAt: new Date(),
        })

        const verificationUrl = `${appUrl}/api/auth/verify-email?token=${token}`

        await resend.emails.send({
          from: fromEmail,
          to: doc.email,
          subject: 'Verify your Orbit account',
          html: `
            <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #1a1a1a;">Verify your email address</h2>
              <p>Your Orbit account has been approved! Click the link below to verify your email and start using Orbit.</p>
              <p style="margin: 24px 0;">
                <a href="${verificationUrl}" style="display: inline-block; background: #FF5C00; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500;">
                  Verify Email
                </a>
              </p>
              <p style="color: #666; font-size: 14px;">This link expires in 24 hours. If you didn't create an Orbit account, you can ignore this email.</p>
            </div>
          `,
        })

        console.log(`[userApprovalHook] Verification email sent to ${doc.email}`)
      } catch (error) {
        console.error(`[userApprovalHook] Failed to send verification email to ${doc.email}:`, error)
        // Don't fail the approval — email can be re-sent
      }
    } else {
      console.log(`[userApprovalHook] User ${doc.email} approved with email verification bypassed`)
    }
  } else if (newStatus === 'rejected') {
    // Update Better Auth user status to rejected
    await baUserCollection.updateOne(
      { _id: baUser._id },
      { $set: { status: 'rejected' } }
    )
    console.log(`[userApprovalHook] User ${doc.email} registration rejected`)
  }

  return doc
}
```

**Step 2: Wire the hook into Users collection**

Add to `orbit-www/src/collections/Users.ts`:

```typescript
import type { CollectionConfig } from 'payload'
import { userApprovalAfterChangeHook } from './hooks/userApprovalHook'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
  },
  auth: true,
  hooks: {
    afterChange: [
      async (args) => {
        // Skip if triggered by the hook itself (prevent infinite loop)
        if (args.context?.skipApprovalHook) return args.doc
        return userApprovalAfterChangeHook(args)
      },
    ],
  },
  fields: [
    // ... (same fields as Task 2)
  ],
}
```

**Step 3: Verify the build compiles**

Run: `cd orbit-www && DOCKER_BUILD=1 bun run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add orbit-www/src/collections/hooks/userApprovalHook.ts orbit-www/src/collections/Users.ts
git commit -m "feat: add afterChange hook to sync Payload approval to Better Auth"
```

---

### Task 4: Modify signup flow to create Payload user and show pending state

**Files:**
- Modify: `orbit-www/src/app/(auth)/signup/page.tsx`
- Create: `orbit-www/src/app/api/register/route.ts`

**Step 1: Create a server-side registration API route**

The signup needs to: (1) create Better Auth user with `status: pending`, (2) create Payload user record. We need a server route because Payload operations require server-side access.

Create `orbit-www/src/app/api/register/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getPayload } from 'payload'
import config from '@payload-config'

export async function POST(request: NextRequest) {
  try {
    const { name, email, password } = await request.json()

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      )
    }

    // 1. Create Better Auth user with status: pending
    // Use Better Auth's internal API to create the user
    const signUpResponse = await auth.api.signUpEmail({
      body: {
        email,
        password,
        name: name || '',
      },
    })

    if (!signUpResponse) {
      return NextResponse.json(
        { error: 'Failed to create account' },
        { status: 500 }
      )
    }

    // 2. Create matching Payload user record with status: pending
    try {
      const payload = await getPayload({ config })
      await payload.create({
        collection: 'users',
        data: {
          email,
          password, // Payload will hash this
          name: name || '',
          status: 'pending',
        },
        overrideAccess: true,
      })
    } catch (payloadError) {
      // Log but don't fail — Better Auth user was created successfully
      // The Payload record can be created later by admin if needed
      console.error('[register] Failed to create Payload user record:', payloadError)
    }

    return NextResponse.json({
      success: true,
      message: 'Registration submitted. An admin will review your request.',
    })
  } catch (error: any) {
    console.error('[register] Registration error:', error)

    // Handle Better Auth duplicate email error
    if (error?.message?.includes('already exists') || error?.status === 422) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 }
      )
    }

    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
```

**Step 2: Update signup page to use new API and show pending confirmation**

Replace `orbit-www/src/app/(auth)/signup/page.tsx` with:

```typescript
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function SignupPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to create account')
      } else {
        setSubmitted(true)
      }
    } catch (err) {
      setError('An unexpected error occurred')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-md text-center">
        <div className="mb-4">
          <div className="mx-auto w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
            <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          Registration Submitted
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          An admin will review your request. You&apos;ll receive an email when your account is approved.
        </p>
        <Link
          href="/login"
          className="text-sm font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400"
        >
          Back to login
        </Link>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-md">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
          Create your account
        </h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Already have an account?{' '}
          <Link
            href="/login"
            className="font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400"
          >
            Sign in
          </Link>
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded">
            {error}
          </div>
        )}

        <div>
          <Label htmlFor="name">Full Name</Label>
          <Input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1"
          />
          <p className="mt-1 text-xs text-gray-500">
            Must be at least 8 characters
          </p>
        </div>

        <div>
          <Label htmlFor="confirmPassword">Confirm Password</Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="mt-1"
          />
        </div>

        <Button
          type="submit"
          className="w-full"
          disabled={loading}
        >
          {loading ? 'Creating account...' : 'Create account'}
        </Button>
      </form>
    </div>
  )
}
```

**Step 3: Verify the build compiles**

Run: `cd orbit-www && DOCKER_BUILD=1 bun run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add orbit-www/src/app/api/register/route.ts orbit-www/src/app/(auth)/signup/page.tsx
git commit -m "feat: gate signup behind admin approval with pending confirmation"
```

---

### Task 5: Update login page with contextual error messages

**Files:**
- Modify: `orbit-www/src/app/(auth)/login/page.tsx`

**Step 1: Update login page to show status-specific error messages**

Better Auth's `denySession` returns error codes in the response. The login page needs to interpret these and show contextual messages.

Replace `orbit-www/src/app/(auth)/login/page.tsx` with:

```typescript
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { signIn } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function getErrorDisplay(error: any): { message: string; type: 'error' | 'info' | 'warning' } {
  const code = error?.code || error?.error || ''
  const message = error?.message || ''

  if (code === 'REGISTRATION_PENDING' || message.includes('pending')) {
    return {
      message: 'Your registration is pending admin approval. You\'ll receive an email when your account is approved.',
      type: 'info',
    }
  }
  if (code === 'REGISTRATION_REJECTED' || message.includes('not approved')) {
    return {
      message: 'Your registration was not approved. Contact an administrator for assistance.',
      type: 'error',
    }
  }
  if (code === 'EMAIL_NOT_VERIFIED' || message.includes('verify your email')) {
    return {
      message: 'Please verify your email before logging in. Check your inbox for a verification link.',
      type: 'warning',
    }
  }

  return {
    message: message || 'Failed to sign in',
    type: 'error',
  }
}

const alertStyles = {
  error: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-600 dark:text-red-400',
  warning: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800 text-yellow-700 dark:text-yellow-400',
  info: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400',
}

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorDisplay, setErrorDisplay] = useState<{ message: string; type: 'error' | 'info' | 'warning' } | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorDisplay(null)
    setLoading(true)

    try {
      const result = await signIn.email({
        email,
        password,
      })

      if (result.error) {
        setErrorDisplay(getErrorDisplay(result.error))
      } else {
        router.push('/dashboard')
      }
    } catch (err) {
      setErrorDisplay({ message: 'An unexpected error occurred', type: 'error' })
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-md">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
          Sign in to Orbit
        </h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Or{' '}
          <Link
            href="/signup"
            className="font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400"
          >
            create a new account
          </Link>
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {errorDisplay && (
          <div className={`border px-4 py-3 rounded ${alertStyles[errorDisplay.type]}`}>
            {errorDisplay.message}
          </div>
        )}

        <div>
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1"
          />
        </div>

        <Button
          type="submit"
          className="w-full"
          disabled={loading}
        >
          {loading ? 'Signing in...' : 'Sign in'}
        </Button>
      </form>
    </div>
  )
}
```

**Step 2: Verify the build compiles**

Run: `cd orbit-www && DOCKER_BUILD=1 bun run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add orbit-www/src/app/(auth)/login/page.tsx
git commit -m "feat: add contextual login error messages for registration status"
```

---

### Task 6: Manual integration testing

**Step 1: Start the local dev environment**

Run: `cd orbit-www && bun run dev`

**Step 2: Test signup flow**

1. Navigate to `http://localhost:3000/signup`
2. Fill in name, email, password, confirm password
3. Submit the form
4. **Expected**: See "Registration Submitted" confirmation page with message about admin review
5. **Verify**: Check MongoDB `user` collection — new record should have `status: "pending"`, `emailVerified: false`
6. **Verify**: Check Payload admin at `/admin` → Users — new record should have `status: pending`

**Step 3: Test login while pending**

1. Navigate to `http://localhost:3000/login`
2. Enter the email and password from step 2
3. **Expected**: Blue info banner: "Your registration is pending admin approval..."
4. **Not expected**: Redirect to dashboard

**Step 4: Test admin approval (without email verification bypass)**

1. Go to `http://localhost:3000/admin`
2. Navigate to Users collection
3. Find the pending user
4. Change status to "Approved", leave "Skip Email Verification" unchecked
5. Save
6. **Expected**: Better Auth `user` collection updated with `status: "approved"`
7. **Expected**: Console log shows verification email sent (or Resend sends it if API key is configured)
8. **Verify**: `registrationApprovedAt` and `registrationApprovedBy` fields are populated

**Step 5: Test login while approved but unverified**

1. Try logging in again with the same credentials
2. **Expected**: Yellow warning banner: "Please verify your email before logging in..."

**Step 6: Test admin approval with email verification bypass**

1. Create another test user via signup
2. In Payload admin, approve the user AND check "Skip Email Verification"
3. Save
4. **Expected**: Better Auth user has `status: "approved"` AND `emailVerified: true`
5. Try logging in
6. **Expected**: Successful login, redirect to `/dashboard`

**Step 7: Test rejection flow**

1. Create another test user via signup
2. In Payload admin, change status to "Rejected"
3. Try logging in
4. **Expected**: Red error banner: "Your registration was not approved..."

**Step 8: Commit any test fixes**

If any issues were found and fixed during testing, commit them:
```bash
git add -A
git commit -m "fix: address issues found during integration testing"
```
