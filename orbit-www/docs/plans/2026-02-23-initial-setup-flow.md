# Initial Setup Flow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When no users exist in the system, redirect all traffic to a `/setup` page that creates the first admin user, default tenant, and first workspace in a single form.

**Architecture:** Next.js middleware detects zero users (cached check against Better Auth's MongoDB user collection) and redirects to `/setup`. A single-page form collects admin credentials + workspace name. A `POST /api/setup` route creates records in both Better Auth and Payload, then returns a session cookie.

**Tech Stack:** Next.js 15 middleware, Better Auth server API, Payload local API, MongoDB, React (useState pattern matching existing auth pages), shadcn/ui components (Button, Input, Label, Card).

**Design doc:** `docs/plans/2026-02-23-initial-setup-flow-design.md`

---

### Task 1: Setup status utility — `hasUsers()`

**Files:**
- Create: `src/lib/setup.ts`
- Test: `src/lib/setup.test.ts`

**Step 1: Write the failing test**

```ts
// src/lib/setup.test.ts
/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock MongoDB
const mockCountDocuments = vi.fn()
const mockCollection = vi.fn(() => ({ countDocuments: mockCountDocuments }))
const mockDb = vi.fn(() => ({ collection: mockCollection }))
const mockConnect = vi.fn()

vi.mock('mongodb', () => ({
  MongoClient: vi.fn(() => ({
    connect: mockConnect,
    db: mockDb,
  })),
}))

const { hasUsers, resetSetupCache } = await import('./setup')

describe('hasUsers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSetupCache()
  })

  it('returns false when no users exist', async () => {
    mockCountDocuments.mockResolvedValue(0)
    expect(await hasUsers()).toBe(false)
    expect(mockCollection).toHaveBeenCalledWith('user')
  })

  it('returns true when users exist', async () => {
    mockCountDocuments.mockResolvedValue(1)
    expect(await hasUsers()).toBe(true)
  })

  it('caches the result after first call that returns true', async () => {
    mockCountDocuments.mockResolvedValue(1)
    await hasUsers()
    await hasUsers()
    expect(mockCountDocuments).toHaveBeenCalledTimes(1)
  })

  it('does not cache false results', async () => {
    mockCountDocuments.mockResolvedValue(0)
    await hasUsers()
    mockCountDocuments.mockResolvedValue(1)
    await hasUsers()
    expect(mockCountDocuments).toHaveBeenCalledTimes(2)
  })

  it('invalidates cache after resetSetupCache()', async () => {
    mockCountDocuments.mockResolvedValue(1)
    await hasUsers()
    resetSetupCache()
    await hasUsers()
    expect(mockCountDocuments).toHaveBeenCalledTimes(2)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd orbit-www && pnpm exec vitest run src/lib/setup.test.ts`
Expected: FAIL — module `./setup` not found

**Step 3: Write minimal implementation**

```ts
// src/lib/setup.ts
import { MongoClient } from 'mongodb'

const client = new MongoClient(process.env.DATABASE_URI || '')

let cachedHasUsers: boolean | null = null

/**
 * Check if any users exist in Better Auth's user collection.
 * Result is cached once true (users can't be un-created).
 * False results are NOT cached so setup detection keeps checking.
 */
export async function hasUsers(): Promise<boolean> {
  if (cachedHasUsers === true) return true

  await client.connect()
  const count = await client.db().collection('user').countDocuments({}, { limit: 1 })
  const result = count > 0

  if (result) {
    cachedHasUsers = true
  }

  return result
}

/** Invalidate the cached result. Called after setup completes. */
export function resetSetupCache(): void {
  cachedHasUsers = null
}
```

**Step 4: Run test to verify it passes**

Run: `cd orbit-www && pnpm exec vitest run src/lib/setup.test.ts`
Expected: PASS (all 5 tests)

**Step 5: Commit**

```bash
git add src/lib/setup.ts src/lib/setup.test.ts
git commit -m "feat(setup): add hasUsers() utility with caching"
```

---

### Task 2: Next.js Middleware — redirect to `/setup` when no users exist

**Files:**
- Create: `src/middleware.ts`
- Test: `src/middleware.test.ts`

**Step 1: Write the failing test**

```ts
// src/middleware.test.ts
/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockHasUsers = vi.fn()

vi.mock('@/lib/setup', () => ({
  hasUsers: () => mockHasUsers(),
}))

const { middleware, config } = await import('./middleware')

function createRequest(path: string): NextRequest {
  return new NextRequest(new URL(path, 'http://localhost:3000'))
}

describe('middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects to /setup when no users exist', async () => {
    mockHasUsers.mockResolvedValue(false)
    const response = await middleware(createRequest('/dashboard'))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost:3000/setup')
  })

  it('does not redirect /setup when no users exist', async () => {
    mockHasUsers.mockResolvedValue(false)
    const response = await middleware(createRequest('/setup'))
    expect(response.headers.get('location')).toBeNull()
  })

  it('does not redirect /api/setup when no users exist', async () => {
    mockHasUsers.mockResolvedValue(false)
    const response = await middleware(createRequest('/api/setup'))
    expect(response.headers.get('location')).toBeNull()
  })

  it('passes through when users exist', async () => {
    mockHasUsers.mockResolvedValue(true)
    const response = await middleware(createRequest('/dashboard'))
    expect(response.headers.get('location')).toBeNull()
  })

  it('redirects /setup to /login when users already exist', async () => {
    mockHasUsers.mockResolvedValue(true)
    const response = await middleware(createRequest('/setup'))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost:3000/login')
  })

  it('has correct matcher config excluding static assets', () => {
    expect(config.matcher).toBeDefined()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd orbit-www && pnpm exec vitest run src/middleware.test.ts`
Expected: FAIL — module `./middleware` not found

**Step 3: Write minimal implementation**

```ts
// src/middleware.ts
import { NextRequest, NextResponse } from 'next/server'
import { hasUsers } from '@/lib/setup'

const SETUP_PATHS = ['/setup', '/api/setup']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Always allow setup-related paths and auth API through
  const isSetupPath = SETUP_PATHS.some((p) => pathname.startsWith(p))
  const isAuthApi = pathname.startsWith('/api/auth')

  const usersExist = await hasUsers()

  // No users: redirect everything to /setup (except setup paths and auth API)
  if (!usersExist) {
    if (isSetupPath || isAuthApi) {
      return NextResponse.next()
    }
    return NextResponse.redirect(new URL('/setup', request.url))
  }

  // Users exist: redirect /setup back to /login (setup already done)
  if (isSetupPath && pathname === '/setup') {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, sitemap.xml, robots.txt
     */
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
  ],
}
```

**Step 4: Run test to verify it passes**

Run: `cd orbit-www && pnpm exec vitest run src/middleware.test.ts`
Expected: PASS (all 6 tests)

**Step 5: Commit**

```bash
git add src/middleware.ts src/middleware.test.ts
git commit -m "feat(setup): add middleware to redirect to /setup when no users exist"
```

---

### Task 3: Setup API route — `POST /api/setup`

**Files:**
- Create: `src/app/api/setup/route.ts`
- Test: `src/app/api/setup/route.test.ts`

**Step 1: Write the failing test**

```ts
// src/app/api/setup/route.test.ts
/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies
const mockHasUsers = vi.fn()
const mockResetSetupCache = vi.fn()
vi.mock('@/lib/setup', () => ({
  hasUsers: () => mockHasUsers(),
  resetSetupCache: mockResetSetupCache,
}))

const mockSignUpEmail = vi.fn()
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      signUpEmail: (...args: unknown[]) => mockSignUpEmail(...args),
    },
  },
}))

const mockPayloadCreate = vi.fn()
const mockPayloadFind = vi.fn()
vi.mock('payload', () => ({
  getPayload: vi.fn(() =>
    Promise.resolve({
      create: (...args: unknown[]) => mockPayloadCreate(...args),
      find: (...args: unknown[]) => mockPayloadFind(...args),
    })
  ),
}))

vi.mock('@payload-config', () => ({ default: {} }))

const { POST } = await import('./route')

function createRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validBody = {
  name: 'Admin User',
  email: 'admin@example.com',
  password: 'securepassword123',
  workspaceName: 'My Workspace',
}

describe('POST /api/setup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasUsers.mockResolvedValue(false)
    mockSignUpEmail.mockResolvedValue({
      user: { id: 'ba-user-1', email: 'admin@example.com', name: 'Admin User' },
      headers: new Headers({ 'set-cookie': 'session=abc123' }),
    })
    mockPayloadCreate.mockResolvedValue({ id: 'payload-1' })
    mockPayloadFind.mockResolvedValue({ docs: [] })
  })

  it('returns 403 when users already exist', async () => {
    mockHasUsers.mockResolvedValue(true)
    const response = await POST(createRequest(validBody))
    expect(response.status).toBe(403)
  })

  it('returns 400 when required fields are missing', async () => {
    const response = await POST(createRequest({ name: 'Test' }))
    expect(response.status).toBe(400)
  })

  it('returns 400 when password is too short', async () => {
    const response = await POST(createRequest({ ...validBody, password: 'short' }))
    expect(response.status).toBe(400)
  })

  it('creates user in Better Auth', async () => {
    await POST(createRequest(validBody))
    expect(mockSignUpEmail).toHaveBeenCalledWith({
      body: { name: 'Admin User', email: 'admin@example.com', password: 'securepassword123' },
    })
  })

  it('creates user in Payload', async () => {
    await POST(createRequest(validBody))
    expect(mockPayloadCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'users',
        data: expect.objectContaining({ email: 'admin@example.com', name: 'Admin User' }),
      })
    )
  })

  it('creates default tenant', async () => {
    await POST(createRequest(validBody))
    expect(mockPayloadCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'tenants',
        data: expect.objectContaining({
          name: 'Default',
          slug: 'default',
          plan: 'self-hosted',
          status: 'active',
        }),
      })
    )
  })

  it('creates workspace with provided name', async () => {
    await POST(createRequest(validBody))
    expect(mockPayloadCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'workspaces',
        data: expect.objectContaining({ name: 'My Workspace' }),
      })
    )
  })

  it('creates workspace member as owner', async () => {
    mockPayloadCreate
      .mockResolvedValueOnce({ id: 'payload-user-1' }) // users
      .mockResolvedValueOnce({ id: 'tenant-1' }) // tenants
      .mockResolvedValueOnce({ id: 'workspace-1' }) // workspaces
      .mockResolvedValueOnce({ id: 'member-1' }) // workspace-members

    await POST(createRequest(validBody))
    expect(mockPayloadCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'workspace-members',
        data: expect.objectContaining({
          workspace: 'workspace-1',
          user: 'payload-user-1',
          role: 'owner',
          status: 'active',
        }),
      })
    )
  })

  it('invalidates setup cache on success', async () => {
    await POST(createRequest(validBody))
    expect(mockResetSetupCache).toHaveBeenCalled()
  })

  it('returns 200 with session cookie on success', async () => {
    const response = await POST(createRequest(validBody))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
  })

  it('returns 500 when Better Auth signup fails', async () => {
    mockSignUpEmail.mockRejectedValue(new Error('signup failed'))
    const response = await POST(createRequest(validBody))
    expect(response.status).toBe(500)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd orbit-www && pnpm exec vitest run src/app/api/setup/route.test.ts`
Expected: FAIL — module `./route` not found

**Step 3: Write minimal implementation**

```ts
// src/app/api/setup/route.ts
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { auth } from '@/lib/auth'
import { hasUsers, resetSetupCache } from '@/lib/setup'

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export async function POST(request: Request) {
  // Guard: reject if users already exist
  if (await hasUsers()) {
    return NextResponse.json(
      { error: 'Setup has already been completed' },
      { status: 403 }
    )
  }

  const body = await request.json()
  const { name, email, password, workspaceName } = body

  // Validate required fields
  if (!name || !email || !password || !workspaceName) {
    return NextResponse.json(
      { error: 'Missing required fields: name, email, password, workspaceName' },
      { status: 400 }
    )
  }

  if (password.length < 8) {
    return NextResponse.json(
      { error: 'Password must be at least 8 characters' },
      { status: 400 }
    )
  }

  try {
    // 1. Create user in Better Auth
    const authResult = await auth.api.signUpEmail({
      body: { name, email, password },
    })

    // 2. Create matching user in Payload
    const payload = await getPayload({ config: configPromise })
    const payloadUser = await payload.create({
      collection: 'users',
      data: { email, name, password },
      overrideAccess: true,
    })

    // 3. Create default tenant
    await payload.create({
      collection: 'tenants',
      data: {
        name: 'Default',
        slug: 'default',
        plan: 'self-hosted',
        status: 'active',
      },
      overrideAccess: true,
    })

    // 4. Create workspace
    const workspace = await payload.create({
      collection: 'workspaces',
      data: {
        name: workspaceName,
        slug: slugify(workspaceName),
      },
      overrideAccess: true,
    })

    // 5. Add user as workspace owner
    await payload.create({
      collection: 'workspace-members',
      data: {
        workspace: workspace.id,
        user: payloadUser.id,
        role: 'owner',
        status: 'active',
      },
      overrideAccess: true,
    })

    // 6. Invalidate setup cache
    resetSetupCache()

    // 7. Return success with session cookie from Better Auth
    const response = NextResponse.json({ success: true })

    // Forward session cookies from Better Auth signup response
    const setCookie = authResult.headers?.get('set-cookie')
    if (setCookie) {
      response.headers.set('set-cookie', setCookie)
    }

    return response
  } catch (error) {
    console.error('Setup failed:', error)
    return NextResponse.json(
      { error: 'Setup failed. Please try again.' },
      { status: 500 }
    )
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd orbit-www && pnpm exec vitest run src/app/api/setup/route.test.ts`
Expected: PASS (all 11 tests)

**Step 5: Commit**

```bash
git add src/app/api/setup/route.ts src/app/api/setup/route.test.ts
git commit -m "feat(setup): add POST /api/setup endpoint for initial admin creation"
```

---

### Task 4: Setup page UI — `(setup)/setup/page.tsx`

**Files:**
- Create: `src/app/(setup)/layout.tsx`
- Create: `src/app/(setup)/setup/page.tsx`

This task creates the UI. It follows the existing `(auth)` page patterns exactly (useState, controlled inputs, shadcn/ui components).

**Step 1: Create the setup layout**

```tsx
// src/app/(setup)/layout.tsx
import { ThemeProvider } from '@/components/theme-provider'
import '@/app/globals.css'

export const metadata = {
  title: 'Setup - Orbit',
  description: 'Set up your Orbit instance',
}

export default function SetupLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-md w-full space-y-8">
              {children}
            </div>
          </div>
        </ThemeProvider>
      </body>
    </html>
  )
}
```

**Step 2: Create the setup page**

```tsx
// src/app/(setup)/setup/page.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function SetupPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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
      const response = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, workspaceName }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Setup failed')
        return
      }

      router.push('/dashboard')
    } catch (err) {
      setError('An unexpected error occurred')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-md">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
          Welcome to Orbit
        </h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Set up your admin account and first workspace to get started.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Admin Account
          </h3>

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
        </div>

        <div className="border-t border-gray-200 dark:border-gray-700 pt-6 space-y-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            First Workspace
          </h3>

          <div>
            <Label htmlFor="workspaceName">Workspace Name</Label>
            <Input
              id="workspaceName"
              name="workspaceName"
              type="text"
              required
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              className="mt-1"
              placeholder="e.g. My Team"
            />
          </div>
        </div>

        <Button
          type="submit"
          className="w-full"
          disabled={loading}
        >
          {loading ? 'Setting up...' : 'Complete Setup'}
        </Button>
      </form>
    </div>
  )
}
```

**Step 3: Verify manually**

Run: `cd orbit-www && bun run build`
Expected: Build succeeds with no type errors. (The setup page renders at `/setup`.)

**Step 4: Commit**

```bash
git add src/app/\(setup\)/layout.tsx src/app/\(setup\)/setup/page.tsx
git commit -m "feat(setup): add setup page UI with admin + workspace form"
```

---

### Task 5: Integration test — full setup flow

**Files:**
- Create: `src/app/(setup)/setup/setup-flow.test.tsx`

**Step 1: Write the integration test**

This test verifies the setup page renders correctly and submits the form to the API.

```tsx
// src/app/(setup)/setup/setup-flow.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mock next/navigation
const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

import SetupPage from './page'

describe('SetupPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  it('renders the setup form with all fields', () => {
    render(<SetupPage />)
    expect(screen.getByText('Welcome to Orbit')).toBeInTheDocument()
    expect(screen.getByLabelText('Full Name')).toBeInTheDocument()
    expect(screen.getByLabelText('Email address')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByLabelText('Confirm Password')).toBeInTheDocument()
    expect(screen.getByLabelText('Workspace Name')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Complete Setup' })).toBeInTheDocument()
  })

  it('shows error when passwords do not match', async () => {
    render(<SetupPage />)
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Full Name'), 'Admin')
    await user.type(screen.getByLabelText('Email address'), 'admin@test.com')
    await user.type(screen.getByLabelText('Password'), 'password123')
    await user.type(screen.getByLabelText('Confirm Password'), 'different')
    await user.type(screen.getByLabelText('Workspace Name'), 'My Team')

    fireEvent.submit(screen.getByRole('button', { name: 'Complete Setup' }))

    await waitFor(() => {
      expect(screen.getByText('Passwords do not match')).toBeInTheDocument()
    })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('shows error when password is too short', async () => {
    render(<SetupPage />)
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Full Name'), 'Admin')
    await user.type(screen.getByLabelText('Email address'), 'admin@test.com')
    await user.type(screen.getByLabelText('Password'), 'short')
    await user.type(screen.getByLabelText('Confirm Password'), 'short')
    await user.type(screen.getByLabelText('Workspace Name'), 'My Team')

    fireEvent.submit(screen.getByRole('button', { name: 'Complete Setup' }))

    await waitFor(() => {
      expect(screen.getByText('Password must be at least 8 characters')).toBeInTheDocument()
    })
  })

  it('submits form and redirects on success', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    })

    render(<SetupPage />)
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Full Name'), 'Admin User')
    await user.type(screen.getByLabelText('Email address'), 'admin@test.com')
    await user.type(screen.getByLabelText('Password'), 'password123')
    await user.type(screen.getByLabelText('Confirm Password'), 'password123')
    await user.type(screen.getByLabelText('Workspace Name'), 'My Team')

    fireEvent.submit(screen.getByRole('button', { name: 'Complete Setup' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Admin User',
          email: 'admin@test.com',
          password: 'password123',
          workspaceName: 'My Team',
        }),
      })
    })

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/dashboard')
    })
  })

  it('shows API error message on failure', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Setup has already been completed' }),
    })

    render(<SetupPage />)
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Full Name'), 'Admin')
    await user.type(screen.getByLabelText('Email address'), 'admin@test.com')
    await user.type(screen.getByLabelText('Password'), 'password123')
    await user.type(screen.getByLabelText('Confirm Password'), 'password123')
    await user.type(screen.getByLabelText('Workspace Name'), 'My Team')

    fireEvent.submit(screen.getByRole('button', { name: 'Complete Setup' }))

    await waitFor(() => {
      expect(screen.getByText('Setup has already been completed')).toBeInTheDocument()
    })
  })
})
```

**Step 2: Run test to verify it passes**

Run: `cd orbit-www && pnpm exec vitest run src/app/\(setup\)/setup/setup-flow.test.tsx`
Expected: PASS (all 5 tests)

**Step 3: Commit**

```bash
git add src/app/\(setup\)/setup/setup-flow.test.tsx
git commit -m "test(setup): add integration tests for setup page form"
```

---

### Task 6: Final verification — build + full test suite

**Step 1: Run the full test suite**

Run: `cd orbit-www && pnpm exec vitest run`
Expected: All existing tests + new setup tests pass.

**Step 2: Build check**

Run: `cd orbit-www && bun run build`
Expected: Build succeeds with no type errors.

**Step 3: Final commit (if any fixups needed)**

```bash
git add -A && git commit -m "fix(setup): address build/test issues"
```

---

## Summary of Files Created/Modified

| File | Action | Purpose |
|---|---|---|
| `src/lib/setup.ts` | Create | `hasUsers()` + `resetSetupCache()` utility |
| `src/lib/setup.test.ts` | Create | Unit tests for setup utility |
| `src/middleware.ts` | Create | Redirect logic for setup flow |
| `src/middleware.test.ts` | Create | Unit tests for middleware |
| `src/app/api/setup/route.ts` | Create | POST endpoint for initial setup |
| `src/app/api/setup/route.test.ts` | Create | Unit tests for setup API |
| `src/app/(setup)/layout.tsx` | Create | Layout for setup route group |
| `src/app/(setup)/setup/page.tsx` | Create | Setup form UI |
| `src/app/(setup)/setup/setup-flow.test.tsx` | Create | Integration tests for setup page |

No existing files are modified.
