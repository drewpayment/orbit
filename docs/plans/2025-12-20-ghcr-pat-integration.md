# GHCR PAT Integration - Implementation Plan

## Overview

Phase 3 of Container Registry Strategy: Add Personal Access Token (PAT) support for GitHub Container Registry. GitHub App installation tokens cannot push to GHCR, so users must provide their own PAT with `write:packages` scope.

**Design Document**: `docs/plans/2025-12-20-ghcr-pat-integration-design.md`

## Implementation Tasks

---

### Task 1: Add GHCR PAT Fields to RegistryConfigs Collection

**File**: `orbit-www/src/collections/RegistryConfigs.ts`

**Changes**:
1. Add `ghcrPat` field (encrypted text, never exposed in API)
2. Add `ghcrValidatedAt` field (date, read-only)
3. Add `ghcrValidationStatus` field (select: pending/valid/invalid)
4. Add `beforeChange` hook to encrypt PAT on save

**Code to add after `ghcrOwner` field (around line 161)**:
```typescript
// GHCR Personal Access Token (encrypted)
{
  name: 'ghcrPat',
  type: 'text',
  admin: {
    description: 'GitHub Personal Access Token (classic) with write:packages scope',
    condition: (data) => data?.type === 'ghcr',
  },
  access: {
    read: () => false, // Never expose in API responses
  },
},
// Last validation timestamp
{
  name: 'ghcrValidatedAt',
  type: 'date',
  admin: {
    readOnly: true,
    condition: (data) => data?.type === 'ghcr',
    description: 'Last successful connection test',
  },
},
// Validation status
{
  name: 'ghcrValidationStatus',
  type: 'select',
  options: [
    { label: 'Not tested', value: 'pending' },
    { label: 'Valid', value: 'valid' },
    { label: 'Invalid', value: 'invalid' },
  ],
  defaultValue: 'pending',
  admin: {
    readOnly: true,
    condition: (data) => data?.type === 'ghcr',
  },
},
```

**Add hooks at collection level** (follow EnvironmentVariables pattern):
```typescript
import { encrypt } from '@/lib/encryption'

hooks: {
  beforeChange: [
    async ({ data }) => {
      // Encrypt GHCR PAT if present and not already encrypted
      if (data?.ghcrPat) {
        const isEncrypted = data.ghcrPat.includes(':') &&
                           data.ghcrPat.split(':').length === 3
        if (!isEncrypted) {
          data.ghcrPat = encrypt(data.ghcrPat)
        }
      }
      return data
    },
  ],
},
```

**Verification**:
- [ ] Build passes: `cd orbit-www && bun run build`
- [ ] Fields appear in Payload admin for GHCR type registries
- [ ] PAT field is never returned in API responses

---

### Task 2: Create Internal API Endpoint for Registry Credentials

**File**: `orbit-www/src/app/api/internal/registry-configs/[id]/credentials/route.ts` (new)

**Purpose**: Allow Temporal worker to fetch decrypted registry credentials

**Code**:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { decrypt } from '@/lib/encryption'

const INTERNAL_API_KEY = process.env.ORBIT_INTERNAL_API_KEY

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Validate API key
  const apiKey = request.headers.get('X-API-Key')
  if (!INTERNAL_API_KEY || apiKey !== INTERNAL_API_KEY) {
    return NextResponse.json(
      { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      { status: 401 }
    )
  }

  try {
    const { id } = await params
    const payload = await getPayload({ config: configPromise })

    const config = await payload.findByID({
      collection: 'registry-configs',
      id,
      overrideAccess: true,
    })

    if (!config) {
      return NextResponse.json(
        { error: 'Registry config not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    // Build response based on registry type
    if (config.type === 'ghcr') {
      if (!config.ghcrPat || !config.ghcrOwner) {
        return NextResponse.json(
          { error: 'GHCR credentials incomplete', code: 'INCOMPLETE_CREDENTIALS' },
          { status: 400 }
        )
      }

      return NextResponse.json({
        type: 'ghcr',
        url: 'ghcr.io',
        repository: config.ghcrOwner,
        token: decrypt(config.ghcrPat),
        username: 'x-access-token',
      })
    }

    if (config.type === 'acr') {
      if (!config.acrToken || !config.acrLoginServer || !config.acrUsername) {
        return NextResponse.json(
          { error: 'ACR credentials incomplete', code: 'INCOMPLETE_CREDENTIALS' },
          { status: 400 }
        )
      }

      return NextResponse.json({
        type: 'acr',
        url: config.acrLoginServer,
        repository: '', // Determined by app slug
        token: decrypt(config.acrToken),
        username: config.acrUsername,
      })
    }

    if (config.type === 'orbit') {
      return NextResponse.json({
        type: 'orbit',
        url: process.env.ORBIT_REGISTRY_URL || 'localhost:5050',
        repository: '', // Determined by app slug
        token: process.env.ORBIT_REGISTRY_TOKEN || '',
        username: 'orbit-service',
      })
    }

    return NextResponse.json(
      { error: 'Unknown registry type', code: 'UNKNOWN_TYPE' },
      { status: 400 }
    )
  } catch (error) {
    console.error('[Internal API] Registry credentials fetch error:', error)
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
```

**Verification**:
- [ ] Endpoint returns 401 without API key
- [ ] Endpoint returns 404 for non-existent registry
- [ ] Endpoint returns decrypted credentials for valid GHCR config

---

### Task 3: Create Test Connection Server Action

**File**: `orbit-www/src/app/actions/registries.ts` (add to existing)

**Purpose**: Allow UI to test GHCR PAT validity and update validation status

**Code to add**:
```typescript
import { decrypt } from '@/lib/encryption'

/**
 * Test GHCR connection and update validation status
 */
export async function testGhcrConnection(configId: string): Promise<{
  success: boolean
  error?: string
}> {
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session?.user?.id) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  // Get the registry config
  const registryConfig = await payload.findByID({
    collection: 'registry-configs',
    id: configId,
    overrideAccess: true,
  })

  if (!registryConfig) {
    return { success: false, error: 'Registry not found' }
  }

  if (registryConfig.type !== 'ghcr') {
    return { success: false, error: 'Not a GHCR registry' }
  }

  if (!registryConfig.ghcrPat) {
    return { success: false, error: 'No PAT configured' }
  }

  // Verify user has access to this registry's workspace
  const workspaceId = typeof registryConfig.workspace === 'string'
    ? registryConfig.workspace
    : registryConfig.workspace.id

  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { user: { equals: session.user.id } },
        { role: { in: ['owner', 'admin'] } },
        { status: { equals: 'active' } },
      ],
    },
  })

  if (membership.docs.length === 0) {
    return { success: false, error: 'Not authorized for this workspace' }
  }

  try {
    // Decrypt PAT and test GitHub API
    const pat = decrypt(registryConfig.ghcrPat)

    const response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })

    const isValid = response.ok

    // Update validation status
    await payload.update({
      collection: 'registry-configs',
      id: configId,
      data: {
        ghcrValidationStatus: isValid ? 'valid' : 'invalid',
        ghcrValidatedAt: isValid ? new Date().toISOString() : null,
      },
      overrideAccess: true,
    })

    if (!isValid) {
      const errorBody = await response.text()
      console.error('[GHCR Test] Validation failed:', response.status, errorBody)
      return {
        success: false,
        error: `GitHub API returned ${response.status}. Check that your PAT has write:packages scope.`
      }
    }

    return { success: true }
  } catch (error) {
    console.error('[GHCR Test] Connection error:', error)
    return { success: false, error: 'Failed to connect to GitHub API' }
  }
}
```

**Verification**:
- [ ] Returns error for non-existent registry
- [ ] Returns error for non-GHCR registry
- [ ] Returns error for missing PAT
- [ ] Updates validation status on success/failure

---

### Task 4: Update Registry UI for PAT and Validation Status

**File**: `orbit-www/src/app/(frontend)/settings/registries/registries-settings-client.tsx`

**Changes**:
1. Add `ghcrPat` to form state
2. Add PAT input field for GHCR type (password field)
3. Add "Test Connection" button
4. Add validation status badge to registry cards
5. Import and use `testGhcrConnection` action

**Form state update**:
```typescript
const [formData, setFormData] = useState({
  // ... existing fields
  ghcrPat: '',  // Add this
})

const [testing, setTesting] = useState(false)  // Add testing state
```

**Add to GHCR section (after ghcrOwner field)**:
```tsx
<div className="space-y-2">
  <Label htmlFor="ghcrPat">
    Personal Access Token {editingRegistry && '(leave blank to keep existing)'}
  </Label>
  <Input
    id="ghcrPat"
    type="password"
    placeholder={editingRegistry ? '********' : 'ghp_...'}
    value={formData.ghcrPat}
    onChange={(e) => setFormData({ ...formData, ghcrPat: e.target.value })}
  />
  <p className="text-xs text-muted-foreground">
    Requires a GitHub Personal Access Token (classic) with <code>write:packages</code> and <code>read:packages</code> scopes.
    Fine-grained tokens are not supported for GHCR.
  </p>
</div>
```

**Update RegistryCard to show validation status**:
```tsx
function RegistryCard({ registry, onEdit, onDelete, onSetDefault }: RegistryCardProps) {
  const [testing, setTesting] = useState(false)

  async function handleTestConnection() {
    setTesting(true)
    try {
      const result = await testGhcrConnection(registry.id)
      if (!result.success) {
        alert(result.error || 'Connection test failed')
      }
      // Refresh data to show updated status
      // This requires lifting state or using a callback
    } finally {
      setTesting(false)
    }
  }

  return (
    <Card>
      <CardContent className="p-6">
        {/* ... existing content ... */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="outline">
            {registry.type === 'ghcr' ? 'GHCR' : 'ACR'}
          </Badge>
          {/* Add validation status badge for GHCR */}
          {registry.type === 'ghcr' && registry.ghcrValidationStatus && (
            <Badge
              variant={
                registry.ghcrValidationStatus === 'valid' ? 'default' :
                registry.ghcrValidationStatus === 'invalid' ? 'destructive' : 'secondary'
              }
            >
              {registry.ghcrValidationStatus === 'valid' && '✓ Valid'}
              {registry.ghcrValidationStatus === 'invalid' && '✗ Invalid'}
              {registry.ghcrValidationStatus === 'pending' && 'Not tested'}
            </Badge>
          )}
          {/* ... rest of content ... */}
        </div>

        {/* Add Test Connection button for GHCR */}
        <div className="flex items-center gap-2">
          {registry.type === 'ghcr' && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleTestConnection}
              disabled={testing}
            >
              {testing ? 'Testing...' : 'Test Connection'}
            </Button>
          )}
          {/* ... existing buttons ... */}
        </div>
      </CardContent>
    </Card>
  )
}
```

**Update RegistryConfig type to include new fields**:
```typescript
export interface RegistryConfig {
  // ... existing fields
  ghcrValidationStatus?: 'pending' | 'valid' | 'invalid'
  ghcrValidatedAt?: string
}
```

**Update createRegistry and updateRegistry to handle ghcrPat**:
In `handleSave`:
```typescript
ghcrPat: formData.type === 'ghcr' && formData.ghcrPat ? formData.ghcrPat : undefined,
```

**Verification**:
- [ ] PAT field appears for GHCR registries
- [ ] Test Connection button appears and works
- [ ] Validation status badge displays correctly
- [ ] Status updates after test

---

### Task 5: Update Registry Actions to Handle PAT

**File**: `orbit-www/src/app/actions/registries.ts`

**Changes**: Update `createRegistry` and `updateRegistry` to accept `ghcrPat`

**Update createRegistry function signature and body**:
```typescript
export async function createRegistry(data: {
  // ... existing fields
  ghcrPat?: string  // Add this
}): Promise<{ success: boolean; registry?: RegistryConfig; error?: string }> {
  // ... existing code ...

  if (data.type === 'ghcr') {
    registryData.ghcrOwner = data.ghcrOwner
    if (data.ghcrPat) {
      registryData.ghcrPat = data.ghcrPat  // Will be encrypted by beforeChange hook
    }
  }
  // ... rest of function
}
```

**Update updateRegistry function signature and body**:
```typescript
export async function updateRegistry(
  id: string,
  data: {
    // ... existing fields
    ghcrPat?: string  // Add this
  }
): Promise<{ success: boolean; registry?: RegistryConfig; error?: string }> {
  // ... existing code ...

  if (data.ghcrPat) updateData.ghcrPat = data.ghcrPat
  // ... rest of function
}
```

**Verification**:
- [ ] Can create GHCR registry with PAT
- [ ] Can update GHCR registry with new PAT
- [ ] PAT is encrypted in database

---

### Task 6: Add Tests for GHCR PAT Integration

**Files to create**:
1. `orbit-www/src/app/api/internal/registry-configs/[id]/credentials/route.test.ts`
2. `orbit-www/src/app/actions/registries.test.ts` (add to existing or create)

**Test for credentials endpoint**:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from './route'
import { NextRequest } from 'next/server'

describe('GET /api/internal/registry-configs/[id]/credentials', () => {
  beforeEach(() => {
    vi.stubEnv('ORBIT_INTERNAL_API_KEY', 'test-key')
  })

  it('returns 401 without API key', async () => {
    const request = new NextRequest('http://localhost/api/internal/registry-configs/123/credentials')
    const response = await GET(request, { params: Promise.resolve({ id: '123' }) })
    expect(response.status).toBe(401)
  })

  it('returns 401 with wrong API key', async () => {
    const request = new NextRequest('http://localhost/api/internal/registry-configs/123/credentials', {
      headers: { 'X-API-Key': 'wrong-key' }
    })
    const response = await GET(request, { params: Promise.resolve({ id: '123' }) })
    expect(response.status).toBe(401)
  })

  // Add more tests for valid requests with mocked Payload
})
```

**Verification**:
- [ ] Tests pass: `cd orbit-www && pnpm exec vitest run src/app/api/internal/registry-configs`
- [ ] Coverage for error cases

---

### Task 7: Update Temporal Activities to Use Internal API (Optional Enhancement)

**Note**: The current workflow already passes `Registry.Token` directly in `BuildWorkflowInput`. This task is for future enhancement where Temporal could fetch credentials dynamically.

**Current flow** (no changes needed for MVP):
1. Frontend fetches registry config including decrypted PAT
2. Frontend passes PAT in `BuildWorkflowInput.Registry.Token`
3. Workflow passes token to build activity
4. Build service uses token for `docker login`

**Future enhancement** (out of scope for this phase):
- Temporal activity fetches credentials via internal API
- Allows token refresh without restarting workflow

**For now**: Ensure the frontend action that triggers builds includes the decrypted PAT in the workflow input.

---

## Implementation Order

1. **Task 1**: Schema changes (foundation for everything)
2. **Task 5**: Update registry actions (enable PAT storage)
3. **Task 4**: Update UI (allow users to enter PAT)
4. **Task 3**: Test connection action (validate PAT works)
5. **Task 2**: Internal API endpoint (for Temporal access)
6. **Task 6**: Tests (verify everything works)

## Notes

- System is not in production - no migration needed
- Follow existing encryption pattern from EnvironmentVariables
- Follow existing internal API pattern from github/token route
- PAT must never appear in API responses (use `access: { read: () => false }`)
