# Deployment Pull Credentials Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement internal token auth system for Orbit registry pull operations.

**Architecture:** Docker token auth server pattern - registry redirects to our token endpoint, which validates JWTs and returns Docker-format tokens. Two endpoints: internal pull-token generator and public token endpoint.

**Tech Stack:** jose (JWT), Next.js API routes, Docker Registry token auth

---

## Task 1: Install jose Library

**Files:**
- Modify: `orbit-www/package.json`

**Step 1: Install jose**

```bash
cd orbit-www && bun add jose
```

**Step 2: Verify installation**

```bash
cd orbit-www && bun pm ls | grep jose
```

Expected: `jose@<version>` in output

**Step 3: Commit**

```bash
git add orbit-www/package.json orbit-www/bun.lock
git commit -m "chore: add jose library for JWT handling"
```

---

## Task 2: Create Registry Auth Utility

**Files:**
- Create: `orbit-www/src/lib/registry-auth/index.ts`
- Create: `orbit-www/src/lib/registry-auth/index.test.ts`

**Step 1: Write the failing test**

Create `orbit-www/src/lib/registry-auth/index.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock environment variable
const MOCK_SECRET = 'test-secret-key-for-jwt-signing-min-32-chars'

vi.stubEnv('ORBIT_REGISTRY_JWT_SECRET', MOCK_SECRET)

// Import after mocking env
const { generatePullToken, validatePullToken, generateDockerToken } = await import('./index')

describe('registry-auth', () => {
  describe('generatePullToken', () => {
    it('generates a valid JWT with correct claims', async () => {
      const token = await generatePullToken({
        workspaceSlug: 'my-workspace',
        appSlug: 'my-app',
      })

      expect(token).toBeTruthy()
      expect(typeof token).toBe('string')
      expect(token.split('.')).toHaveLength(3) // JWT format
    })
  })

  describe('validatePullToken', () => {
    it('validates a token and returns claims', async () => {
      const token = await generatePullToken({
        workspaceSlug: 'my-workspace',
        appSlug: 'my-app',
      })

      const claims = await validatePullToken(token)

      expect(claims.scope).toBe('repository:my-workspace/my-app:pull')
      expect(claims.sub).toBe('orbit-deployment')
      expect(claims.iss).toBe('orbit')
    })

    it('rejects expired tokens', async () => {
      // Create a token that's already expired
      const token = await generatePullToken({
        workspaceSlug: 'test',
        appSlug: 'test',
        expiresInSeconds: -1, // Already expired
      })

      await expect(validatePullToken(token)).rejects.toThrow()
    })

    it('rejects invalid tokens', async () => {
      await expect(validatePullToken('invalid.token.here')).rejects.toThrow()
    })
  })

  describe('generateDockerToken', () => {
    it('generates Docker-format token response', async () => {
      const result = await generateDockerToken({
        scope: 'repository:my-workspace/my-app:pull',
      })

      expect(result.token).toBeTruthy()
      expect(result.expires_in).toBe(3600)
      expect(result.issued_at).toBeTruthy()
    })
  })
})
```

**Step 2: Run test to verify it fails**

```bash
cd orbit-www && NODE_OPTIONS=--no-deprecation bunx vitest run src/lib/registry-auth/index.test.ts
```

Expected: FAIL - module not found

**Step 3: Write the implementation**

Create `orbit-www/src/lib/registry-auth/index.ts`:

```typescript
import * as jose from 'jose'

const JWT_SECRET = process.env.ORBIT_REGISTRY_JWT_SECRET

if (!JWT_SECRET) {
  console.warn('ORBIT_REGISTRY_JWT_SECRET not set - registry auth will fail')
}

const DEFAULT_EXPIRY_SECONDS = 3600 // 1 hour

/**
 * Generate a pull token for an app
 */
export async function generatePullToken(options: {
  workspaceSlug: string
  appSlug: string
  expiresInSeconds?: number
}): Promise<string> {
  const { workspaceSlug, appSlug, expiresInSeconds = DEFAULT_EXPIRY_SECONDS } = options

  if (!JWT_SECRET) {
    throw new Error('ORBIT_REGISTRY_JWT_SECRET not configured')
  }

  const secret = new TextEncoder().encode(JWT_SECRET)
  const scope = `repository:${workspaceSlug}/${appSlug}:pull`

  const token = await new jose.SignJWT({
    scope,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('orbit')
    .setSubject('orbit-deployment')
    .setAudience('orbit-registry')
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
    .sign(secret)

  return token
}

export interface PullTokenClaims {
  iss: string
  sub: string
  aud: string
  exp: number
  iat: number
  scope: string
}

/**
 * Validate a pull token and return its claims
 */
export async function validatePullToken(token: string): Promise<PullTokenClaims> {
  if (!JWT_SECRET) {
    throw new Error('ORBIT_REGISTRY_JWT_SECRET not configured')
  }

  const secret = new TextEncoder().encode(JWT_SECRET)

  const { payload } = await jose.jwtVerify(token, secret, {
    issuer: 'orbit',
    audience: 'orbit-registry',
  })

  return {
    iss: payload.iss as string,
    sub: payload.sub as string,
    aud: payload.aud as string,
    exp: payload.exp as number,
    iat: payload.iat as number,
    scope: payload.scope as string,
  }
}

/**
 * Generate a Docker registry token response
 * This is the format Docker clients expect from the token endpoint
 */
export async function generateDockerToken(options: {
  scope: string
}): Promise<{
  token: string
  expires_in: number
  issued_at: string
}> {
  if (!JWT_SECRET) {
    throw new Error('ORBIT_REGISTRY_JWT_SECRET not configured')
  }

  const secret = new TextEncoder().encode(JWT_SECRET)
  const now = new Date()

  // Docker registry token format
  const token = await new jose.SignJWT({
    access: [
      {
        type: 'repository',
        name: options.scope.replace('repository:', '').replace(':pull', ''),
        actions: ['pull'],
      },
    ],
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('orbit')
    .setSubject('orbit-deployment')
    .setAudience('orbit-registry')
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + DEFAULT_EXPIRY_SECONDS)
    .sign(secret)

  return {
    token,
    expires_in: DEFAULT_EXPIRY_SECONDS,
    issued_at: now.toISOString(),
  }
}
```

**Step 4: Run test to verify it passes**

```bash
cd orbit-www && NODE_OPTIONS=--no-deprecation bunx vitest run src/lib/registry-auth/index.test.ts
```

Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add orbit-www/src/lib/registry-auth/
git commit -m "feat: add registry-auth utility for JWT token handling"
```

---

## Task 3: Create Internal Pull Token Endpoint

**Files:**
- Create: `orbit-www/src/app/api/internal/registry/pull-token/route.ts`
- Create: `orbit-www/src/app/api/internal/registry/pull-token/route.test.ts`

**Step 1: Write the failing test**

Create `orbit-www/src/app/api/internal/registry/pull-token/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('payload', () => ({
  getPayload: vi.fn(),
}))

vi.mock('@payload-config', () => ({
  default: {},
}))

vi.stubEnv('ORBIT_INTERNAL_API_KEY', 'test-api-key')
vi.stubEnv('ORBIT_REGISTRY_JWT_SECRET', 'test-secret-key-for-jwt-signing-min-32-chars')
vi.stubEnv('ORBIT_REGISTRY_URL', 'registry.orbit.local:5050')

import { getPayload } from 'payload'
import { POST } from './route'

describe('POST /api/internal/registry/pull-token', () => {
  const mockPayload = {
    findByID: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(getPayload as any).mockResolvedValue(mockPayload)
  })

  it('returns 401 without API key', async () => {
    const request = new Request('http://localhost/api/internal/registry/pull-token', {
      method: 'POST',
      body: JSON.stringify({ appId: 'test-app' }),
    })

    const response = await POST(request)
    expect(response.status).toBe(401)
  })

  it('returns 401 with wrong API key', async () => {
    const request = new Request('http://localhost/api/internal/registry/pull-token', {
      method: 'POST',
      headers: { 'X-API-Key': 'wrong-key' },
      body: JSON.stringify({ appId: 'test-app' }),
    })

    const response = await POST(request)
    expect(response.status).toBe(401)
  })

  it('returns 400 without appId', async () => {
    const request = new Request('http://localhost/api/internal/registry/pull-token', {
      method: 'POST',
      headers: { 'X-API-Key': 'test-api-key' },
      body: JSON.stringify({}),
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  it('returns 404 if app not found', async () => {
    mockPayload.findByID.mockResolvedValue(null)

    const request = new Request('http://localhost/api/internal/registry/pull-token', {
      method: 'POST',
      headers: { 'X-API-Key': 'test-api-key' },
      body: JSON.stringify({ appId: 'nonexistent-app' }),
    })

    const response = await POST(request)
    expect(response.status).toBe(404)
  })

  it('returns pull credentials for valid app', async () => {
    mockPayload.findByID.mockResolvedValue({
      id: 'test-app',
      slug: 'my-app',
      workspace: {
        id: 'ws-123',
        slug: 'my-workspace',
      },
    })

    const request = new Request('http://localhost/api/internal/registry/pull-token', {
      method: 'POST',
      headers: { 'X-API-Key': 'test-api-key' },
      body: JSON.stringify({ appId: 'test-app' }),
    })

    const response = await POST(request)
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.username).toBe('orbit-pull')
    expect(data.password).toBeTruthy()
    expect(data.registry).toBe('registry.orbit.local:5050')
    expect(data.expiresAt).toBeTruthy()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
cd orbit-www && NODE_OPTIONS=--no-deprecation bunx vitest run src/app/api/internal/registry/pull-token/route.test.ts
```

Expected: FAIL - module not found

**Step 3: Write the implementation**

Create `orbit-www/src/app/api/internal/registry/pull-token/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { generatePullToken } from '@/lib/registry-auth'

const INTERNAL_API_KEY = process.env.ORBIT_INTERNAL_API_KEY
const REGISTRY_URL = process.env.ORBIT_REGISTRY_URL || 'localhost:5050'

export async function POST(request: NextRequest) {
  // Validate API key
  const apiKey = request.headers.get('X-API-Key')
  if (!INTERNAL_API_KEY || apiKey !== INTERNAL_API_KEY) {
    return NextResponse.json(
      { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      { status: 401 }
    )
  }

  try {
    const body = await request.json()
    const { appId } = body

    if (!appId) {
      return NextResponse.json(
        { error: 'appId is required', code: 'BAD_REQUEST' },
        { status: 400 }
      )
    }

    const payload = await getPayload({ config: configPromise })

    // Fetch app with workspace populated
    const app = await payload.findByID({
      collection: 'apps',
      id: appId,
      depth: 1,
      overrideAccess: true,
    })

    if (!app) {
      return NextResponse.json(
        { error: 'App not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    // Get workspace slug
    const workspace = typeof app.workspace === 'string'
      ? null
      : app.workspace

    if (!workspace?.slug) {
      return NextResponse.json(
        { error: 'App workspace not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    // Generate pull token
    const expiresInSeconds = 3600 // 1 hour
    const token = await generatePullToken({
      workspaceSlug: workspace.slug,
      appSlug: app.slug,
    })

    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString()

    return NextResponse.json({
      username: 'orbit-pull',
      password: token,
      registry: REGISTRY_URL,
      expiresAt,
    })
  } catch (error) {
    console.error('[Internal API] Pull token generation error:', error)
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
```

**Step 4: Run test to verify it passes**

```bash
cd orbit-www && NODE_OPTIONS=--no-deprecation bunx vitest run src/app/api/internal/registry/pull-token/route.test.ts
```

Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add orbit-www/src/app/api/internal/registry/pull-token/
git commit -m "feat: add internal pull-token endpoint for registry auth"
```

---

## Task 4: Create Docker Registry Token Endpoint

**Files:**
- Create: `orbit-www/src/app/api/registry/token/route.ts`
- Create: `orbit-www/src/app/api/registry/token/route.test.ts`

**Step 1: Write the failing test**

Create `orbit-www/src/app/api/registry/token/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.stubEnv('ORBIT_REGISTRY_JWT_SECRET', 'test-secret-key-for-jwt-signing-min-32-chars')

import { GET } from './route'
import { generatePullToken } from '@/lib/registry-auth'

describe('GET /api/registry/token', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 without authorization', async () => {
    const request = new Request(
      'http://localhost/api/registry/token?scope=repository:ws/app:pull&service=orbit-registry'
    )

    const response = await GET(request)
    expect(response.status).toBe(401)
  })

  it('returns 401 with invalid token', async () => {
    const credentials = Buffer.from('orbit-pull:invalid-token').toString('base64')
    const request = new Request(
      'http://localhost/api/registry/token?scope=repository:ws/app:pull&service=orbit-registry',
      {
        headers: { Authorization: `Basic ${credentials}` },
      }
    )

    const response = await GET(request)
    expect(response.status).toBe(401)
  })

  it('returns 403 when scope does not match token', async () => {
    const token = await generatePullToken({
      workspaceSlug: 'my-workspace',
      appSlug: 'my-app',
    })
    const credentials = Buffer.from(`orbit-pull:${token}`).toString('base64')

    const request = new Request(
      'http://localhost/api/registry/token?scope=repository:other-workspace/other-app:pull&service=orbit-registry',
      {
        headers: { Authorization: `Basic ${credentials}` },
      }
    )

    const response = await GET(request)
    expect(response.status).toBe(403)
  })

  it('returns Docker token for valid request', async () => {
    const token = await generatePullToken({
      workspaceSlug: 'my-workspace',
      appSlug: 'my-app',
    })
    const credentials = Buffer.from(`orbit-pull:${token}`).toString('base64')

    const request = new Request(
      'http://localhost/api/registry/token?scope=repository:my-workspace/my-app:pull&service=orbit-registry',
      {
        headers: { Authorization: `Basic ${credentials}` },
      }
    )

    const response = await GET(request)
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.token).toBeTruthy()
    expect(data.expires_in).toBe(3600)
    expect(data.issued_at).toBeTruthy()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
cd orbit-www && NODE_OPTIONS=--no-deprecation bunx vitest run src/app/api/registry/token/route.test.ts
```

Expected: FAIL - module not found

**Step 3: Write the implementation**

Create `orbit-www/src/app/api/registry/token/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { validatePullToken, generateDockerToken } from '@/lib/registry-auth'

export async function GET(request: NextRequest) {
  try {
    // Parse Basic auth header
    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Basic ')) {
      return NextResponse.json(
        { error: 'Authorization required' },
        {
          status: 401,
          headers: {
            'WWW-Authenticate': 'Basic realm="orbit-registry"',
          },
        }
      )
    }

    const base64Credentials = authHeader.slice(6)
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8')
    const [username, password] = credentials.split(':')

    if (username !== 'orbit-pull' || !password) {
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      )
    }

    // Validate the JWT from password field
    let claims
    try {
      claims = await validatePullToken(password)
    } catch (error) {
      console.error('[Registry Token] JWT validation failed:', error)
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 401 }
      )
    }

    // Get requested scope from query params
    const url = new URL(request.url)
    const requestedScope = url.searchParams.get('scope')

    if (!requestedScope) {
      return NextResponse.json(
        { error: 'Scope parameter required' },
        { status: 400 }
      )
    }

    // Verify requested scope matches token scope
    if (claims.scope !== requestedScope) {
      console.error(
        `[Registry Token] Scope mismatch: token=${claims.scope}, requested=${requestedScope}`
      )
      return NextResponse.json(
        { error: 'Scope not authorized' },
        { status: 403 }
      )
    }

    // Generate Docker registry token
    const dockerToken = await generateDockerToken({
      scope: requestedScope,
    })

    return NextResponse.json(dockerToken)
  } catch (error) {
    console.error('[Registry Token] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
```

**Step 4: Run test to verify it passes**

```bash
cd orbit-www && NODE_OPTIONS=--no-deprecation bunx vitest run src/app/api/registry/token/route.test.ts
```

Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add orbit-www/src/app/api/registry/token/
git commit -m "feat: add Docker registry token endpoint for auth flow"
```

---

## Task 5: Update Registry Configuration

**Files:**
- Modify: `infrastructure/registry/config.yml`

**Step 1: Read current config**

```bash
cat infrastructure/registry/config.yml
```

**Step 2: Update config with token auth**

Update `infrastructure/registry/config.yml` to add auth section:

```yaml
version: 0.1
log:
  level: info
  formatter: json
storage:
  s3:
    accesskey: orbit-admin
    secretkey: orbit-secret-key
    region: us-east-1
    regionendpoint: http://minio:9000
    bucket: orbit-registry
    encrypt: false
    secure: false
    v4auth: true
    rootdirectory: /
  delete:
    enabled: true
  cache:
    blobdescriptor: inmemory
http:
  addr: :5000
  headers:
    X-Content-Type-Options: [nosniff]
auth:
  token:
    realm: http://orbit-www:3000/api/registry/token
    service: orbit-registry
    issuer: orbit
health:
  storagedriver:
    enabled: true
    interval: 10s
    threshold: 3
```

**Step 3: Commit**

```bash
git add infrastructure/registry/config.yml
git commit -m "feat: configure registry for token-based authentication"
```

---

## Task 6: Update Docker Compose

**Files:**
- Modify: `docker-compose.yml`

**Step 1: Add environment variable**

Add `ORBIT_REGISTRY_JWT_SECRET` to the `orbit-www` service environment:

Find the `orbit-www` service and add to its environment section:

```yaml
  orbit-www:
    # ... existing config ...
    environment:
      # ... existing vars ...
      - ORBIT_REGISTRY_JWT_SECRET=${ORBIT_REGISTRY_JWT_SECRET:-orbit-registry-jwt-secret-dev-only-32chars}
```

**Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "chore: add ORBIT_REGISTRY_JWT_SECRET to docker-compose"
```

---

## Task 7: Run All Tests

**Step 1: Run full test suite**

```bash
cd orbit-www && NODE_OPTIONS=--no-deprecation bunx vitest run src/lib/registry-auth/ src/app/api/internal/registry/ src/app/api/registry/
```

Expected: All tests pass (12+ tests)

**Step 2: Verify existing tests still pass**

```bash
cd orbit-www && NODE_OPTIONS=--no-deprecation bunx vitest run src/app/actions/registries.test.ts
```

Expected: All 16 existing registry tests pass

---

## Task 8: Final Commit

**Step 1: Verify all changes**

```bash
git status
git log --oneline -5
```

**Step 2: Create summary commit if needed**

If there are any uncommitted changes, commit them:

```bash
git add -A
git commit -m "feat: complete Phase 5 - deployment pull credentials"
```

---

## Verification Checklist

After completing all tasks:

- [ ] `jose` library installed
- [ ] `registry-auth` utility with tests
- [ ] Internal pull-token endpoint with tests
- [ ] Docker token endpoint with tests
- [ ] Registry config updated for token auth
- [ ] Docker compose has JWT secret env var
- [ ] All tests passing
