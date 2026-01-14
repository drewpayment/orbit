# GHCR PAT Integration Design

## Overview

Phase 3 of the Container Registry Strategy: Add Personal Access Token (PAT) support for GitHub Container Registry (GHCR). GitHub App installation tokens cannot push to GHCR, so users must provide their own PAT.

## Background

- GitHub App tokens lack GHCR push permissions (GitHub limitation)
- Current GHCR configs have `ghcrOwner` but no authentication mechanism
- PATs with `write:packages` scope can push to GHCR
- System is not in production - no migration complexity needed

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Token storage | Encrypted at rest (AES-256-GCM) | Follows existing pattern, mandatory per SOP |
| Validation | Separate "Test Connection" button | Non-blocking saves, user controls when to test |
| Validation caching | Store last result + timestamp | User can see connection status at a glance |
| Migration | None needed | System not in production |

## Schema Changes

### RegistryConfigs Collection

Add three new fields for GHCR:

```typescript
// New field: Personal Access Token (encrypted)
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

// New field: Last validation timestamp
{
  name: 'ghcrValidatedAt',
  type: 'date',
  admin: {
    readOnly: true,
    condition: (data) => data?.type === 'ghcr',
    description: 'Last successful connection test',
  },
},

// New field: Validation status
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

### Encryption Hook

Add `beforeChange` hook following EnvironmentVariables pattern:

```typescript
hooks: {
  beforeChange: [
    async ({ data }) => {
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

## Build Service Integration

### Data Flow

```
1. Frontend triggers build via Temporal workflow
   └─> BuildWorkflowInput includes Registry config ID

2. Temporal activity fetches registry credentials
   └─> GET /api/internal/registry-configs/{id}/credentials
   └─> Internal API decrypts ghcrPat

3. Build service receives credentials
   └─> Registry.Token = decrypted ghcrPat
   └─> Registry.Type = "ghcr"

4. Docker login (existing code unchanged)
   └─> docker login ghcr.io -u x-access-token --password-stdin
```

### New Internal API Endpoint

```
GET /api/internal/registry-configs/{id}/credentials
Headers: X-API-Key: {ORBIT_INTERNAL_API_KEY}

Response (200):
{
  "type": "ghcr",
  "url": "ghcr.io",
  "repository": "{ghcrOwner}/{app-slug}",
  "token": "<decrypted PAT>",
  "username": "x-access-token"
}

Response (404): Registry config not found
Response (400): Missing credentials for registry type
```

## UI Changes

### Registry Settings Form

For GHCR type registries, display:

1. **ghcrOwner** - Text field (existing)
2. **ghcrPat** - Password field with show/hide toggle
3. **Validation status badge**:
   - "Not tested" (gray)
   - "Valid ✓" with timestamp (green)
   - "Invalid ✗" (red)
4. **"Test Connection" button**

### Test Connection Flow

```typescript
// Server action: testGhcrConnection(configId: string)
async function testGhcrConnection(configId: string) {
  // 1. Fetch config and decrypt PAT
  const config = await payload.findByID({ ... })
  const pat = decrypt(config.ghcrPat)

  // 2. Test GitHub API
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/vnd.github+json',
    },
  })

  // 3. Update validation status
  const status = response.ok ? 'valid' : 'invalid'
  await payload.update({
    collection: 'registry-configs',
    id: configId,
    data: {
      ghcrValidationStatus: status,
      ghcrValidatedAt: status === 'valid' ? new Date() : null,
    },
  })

  return { success: response.ok, status }
}
```

### Registry List Display

| Name | Type | Status | Actions |
|------|------|--------|---------|
| Production GHCR | ghcr | ✓ Valid (2h ago) | Edit / Delete |
| Dev GHCR | ghcr | ⚠ Not tested | Edit / Delete |
| My ACR | acr | - | Edit / Delete |

## Error Handling

### Build-time Error (PAT missing)

```
Error: GHCR authentication failed

Your GitHub Personal Access Token (PAT) is missing or invalid.

To fix this:
1. Go to GitHub → Settings → Developer settings → Personal access tokens
2. Create a classic token with 'write:packages' scope
3. Add it in Orbit → Settings → Registries → [Your GHCR config]
4. Click "Test Connection" to verify
```

### UI Guidance

Display in PAT field description:
> Requires a GitHub Personal Access Token (classic) with `write:packages` and `read:packages` scopes. Fine-grained tokens are not supported for GHCR.

## Implementation Tasks

1. **Schema**: Add `ghcrPat`, `ghcrValidatedAt`, `ghcrValidationStatus` fields to RegistryConfigs
2. **Encryption**: Add `beforeChange` hook to encrypt PAT on save
3. **Internal API**: Create `/api/internal/registry-configs/[id]/credentials` endpoint
4. **Temporal**: Update build activities to fetch credentials via internal API
5. **Server Action**: Create `testGhcrConnection` action
6. **UI**: Update registry form with PAT field, validation status, test button
7. **Error Messages**: Add user-friendly GHCR auth failure messages

## Security Considerations

- PAT encrypted at rest using AES-256-GCM (existing `encrypt()` utility)
- PAT never exposed in API responses (`access: { read: () => false }`)
- Decryption only happens server-side for build operations
- Internal API protected by `ORBIT_INTERNAL_API_KEY`

## References

- Container Registry Strategy: `docs/plans/2025-12-20-container-registry-strategy-design.md`
- GitHub App Installation SOP: `.agent/SOPs/github-app-installation.md`
- Encryption utilities: `orbit-www/src/lib/encryption/index.ts`
- EnvironmentVariables (encryption pattern): `orbit-www/src/collections/EnvironmentVariables.ts`
