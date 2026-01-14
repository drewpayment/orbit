# Container Registry Strategy Design

## Overview

This design introduces a tiered container registry strategy for Orbit:

1. **Orbit-hosted registry** - Zero-config default for all users
2. **GHCR integration** - User provides PAT for GitHub Container Registry
3. **ACR integration** - Azure Container Registry (existing, with improvements)

## Background

GitHub App installation tokens cannot push to GHCR (GitHub limitation). This design replaces the GitHub App approach with PAT-based authentication and adds an Orbit-hosted registry as the default fallback.

## Architecture

### Orbit-Hosted Registry

**Infrastructure**:
- Docker Distribution (registry:2) deployed as `orbit-registry` service
- S3 backend using existing MinIO instance
- Dedicated bucket: `orbit-registry`
- Internal network access for build-service push
- External HTTPS access with token auth for deployment pulls

**Image Organization**:
```
registry.orbit.local/{workspace-slug}/{app-slug}:{tag}
```

**Quota Management**:
- Default: 10GB per workspace
- Auto-cleanup when usage > 80%:
  1. Keep 3 most recent tags per app
  2. Delete oldest tags until usage < 70%
  3. Reduce to 2 tags per app if still over
  4. Never delete sole "latest" tag
- User warnings at 70% usage
- Notification after auto-cleanup

### Registry Selection Priority

1. App-specific registry (if configured)
2. Workspace default registry (if set)
3. Orbit-hosted registry (if `allowOrbitRegistry` is true)
4. Error: "No registry configured"

### Credential Management

| Registry Type | Auth Method | Storage |
|---------------|-------------|---------|
| Orbit | Internal service token | Environment variable |
| GHCR | PAT + `x-access-token` username | Encrypted in DB |
| ACR | Username + token | Encrypted in DB |

All tokens encrypted using existing `encrypt()`/`decrypt()` utilities.

### Deployment Pull Credentials

For deploying to external targets (Kubernetes, Docker, cloud providers):

1. Orbit generates scoped, short-lived JWT (1 hour TTL)
2. JWT claims specify allowed workspace/app/tags
3. Injected into deployment target:
   - Kubernetes: `imagePullSecret`
   - Docker: `docker login`
   - Cloud providers: Native secret management

## Data Model Changes

### RegistryConfigs Collection

```typescript
// Type field update
type: 'orbit' | 'ghcr' | 'acr'

// GHCR fields
ghcrOwner: text
ghcrPat: text (encrypted)  // NEW - replaces GitHub App token

// ACR fields
acrLoginServer: text
acrUsername: text
acrToken: text (encrypted)  // UPDATE - add encryption
```

### New Collection: RegistryImages

```typescript
{
  workspace: relationship (required)
  app: relationship (required)
  tag: text (required)
  digest: text (required)
  sizeBytes: number (required)
  pushedAt: date (required)
}
```

### Workspaces Collection

```typescript
allowOrbitRegistry: checkbox (default: true)
registryQuotaBytes: number (default: 10737418240)  // 10GB
```

### Protobuf Updates

```proto
enum RegistryType {
  REGISTRY_TYPE_UNSPECIFIED = 0;
  REGISTRY_TYPE_GHCR = 1;
  REGISTRY_TYPE_ACR = 2;
  REGISTRY_TYPE_ORBIT = 3;  // NEW
}
```

## Implementation Phases

### Phase 1: Orbit-Hosted Registry (MVP)
- Deploy Docker Distribution with MinIO backend
- Add `orbit` registry type to schema and protobuf
- Update build service to push to Orbit registry
- Basic image tracking in `RegistryImages` collection
- Wire up as automatic fallback when no registry configured

### Phase 2: Quota and Cleanup
- Add workspace quota fields
- Implement storage usage calculation
- Build auto-cleanup logic (pre-build + scheduled)
- Add UI warnings for quota usage

### Phase 3: GHCR PAT Integration
- Add `ghcrPat` field to RegistryConfigs
- Encrypt PAT on save
- Update build service to use PAT instead of GitHub App token
- Add validation/test connection on save
- Migration warning for existing GHCR configs

### Phase 4: ACR Encryption + Consistency
- Encrypt existing `acrToken` field
- Migration to encrypt existing plaintext tokens
- Consistent validation on save

### Phase 5: Deployment Pull Credentials
- Internal pull token generation API
- JWT validation in Orbit registry
- Integration with first deployment target (likely Kubernetes)

## Security Considerations

- All registry tokens encrypted at rest
- Short-lived pull tokens (1 hour TTL) for deployments
- Scoped tokens limit blast radius (specific images only)
- Workspace isolation in image paths
- Service account for internal push (no user credential exposure)

## User Experience

**New users**: Builds "just work" with Orbit-hosted registry - no setup required.

**Power users**: Add their own GHCR/ACR registry for unlimited storage and control.

**Enterprises**: Can disable Orbit-hosted fallback to enforce approved registries only.

**Quota warnings**: Clear messaging when approaching limits with CTA to add own registry.
