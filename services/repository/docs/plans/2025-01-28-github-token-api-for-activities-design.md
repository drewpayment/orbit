# GitHub Token API for Temporal Activities - Design Document

**Date**: 2025-01-28
**Status**: Approved
**Author**: Claude (brainstorming session)

## Problem Statement

Template instantiation activities cannot create real GitHub repositories because the `GitHubTemplateClient` is created at worker startup with empty credentials. Activities need authenticated access to GitHub APIs.

## Design Decisions

1. **Authentication Strategy**: API endpoint in Payload
   - Activities call Payload API to get tokens
   - Keeps GitHub App credentials centralized in Payload
   - Avoids spreading credentials to worker

2. **Token API Behavior**: Return decrypted stored token
   - Simple approach relying on existing token refresh workflow
   - Token refresh workflow keeps tokens fresh (runs every 50 minutes)

3. **API Authentication**: Shared secret (API key)
   - `ORBIT_INTERNAL_API_KEY` environment variable
   - Simple and sufficient for internal service-to-service calls

## Architecture

### Data Flow

```
1. Frontend → Server Action → gRPC StartInstantiation (includes installation_id)
2. Repository-service → Temporal workflow (with installation_id in input)
3. Activity needs token → HTTP call to Payload API
4. Payload API → Decrypts stored token → Returns to activity
5. Activity → GitHub API (with fresh token)
```

### Components

1. **Payload API Endpoint**: `POST /api/internal/github/token`
2. **Token Service in Worker**: Go service that activities use
3. **Updated Activities**: Fetch token via service, create client on-demand

## Detailed Design

### 1. Payload API Endpoint

**File**: `orbit-www/src/app/api/internal/github/token/route.ts`

**Endpoint**: `POST /api/internal/github/token`

**Request**:
```typescript
{
  installationId: string  // GitHub App installation ID (numeric as string)
}
```

**Response (Success)**:
```typescript
{
  token: string,          // Decrypted installation access token
  expiresAt: string       // ISO timestamp when token expires
}
```

**Response (Error)**:
```typescript
{
  error: string,          // Error message
  code: string            // NOT_FOUND | EXPIRED | UNAUTHORIZED
}
```

**Security**:
- Requires `X-API-Key` header matching `ORBIT_INTERNAL_API_KEY`
- Returns 401 if API key missing or invalid
- Returns 404 if installation not found

### 2. Worker Token Service

**File**: `temporal-workflows/internal/services/token_service.go`

**Interface**:
```go
type TokenService interface {
    GetInstallationToken(ctx context.Context, installationID string) (string, error)
}
```

**Implementation**:
```go
type PayloadTokenService struct {
    orbitAPIURL string
    apiKey      string
    httpClient  *http.Client
}
```

### 3. Activity Changes

**Updated struct**:
```go
type TemplateActivities struct {
    tokenService TokenService   // For fetching GitHub tokens
    workDir      string
    logger       *slog.Logger
}
```

**Activities that need tokens**:
- `CreateRepoFromTemplate` - GitHub API
- `CreateEmptyRepo` - GitHub API
- `CloneTemplateRepo` - git clone (private repos)
- `PushToNewRepo` - git push

### 4. Workflow Input Changes

Add to `types.TemplateInstantiationInput`:
```go
InstallationID string  // GitHub App installation ID for auth
```

### 5. Frontend Changes

`startInstantiation()` must:
1. Look up installation ID for selected org
2. Pass `githubInstallationId` to gRPC call

## Environment Variables

| Variable | Service | Description |
|----------|---------|-------------|
| `ORBIT_INTERNAL_API_KEY` | Payload (orbit-www) | Shared secret for API auth |
| `ORBIT_INTERNAL_API_KEY` | Temporal Worker | Same secret to call API |
| `ORBIT_API_URL` | Temporal Worker | Base URL for Payload API |

## Security Considerations

1. **Token Exposure**: Tokens are only exposed in memory during activity execution
2. **API Key**: Shared between services, should be rotated periodically
3. **Network**: API can be restricted to internal Docker network
4. **Logging**: Never log tokens, only log installation IDs

## Testing Strategy

1. **Unit Tests**: Mock TokenService for activity tests
2. **Integration Tests**: Test real API → Worker flow with test installation
3. **E2E Tests**: Full template instantiation with real GitHub

## Implementation Order

1. Create Payload API endpoint
2. Create Token Service in worker
3. Update activities to use token service
4. Update worker main.go to wire up token service
5. Update frontend to pass installation ID
6. Update repository-service to pass installation ID to workflow
7. Integration testing
