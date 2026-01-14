# Deployment Pull Credentials Design

## Overview

Internal token auth system for the Orbit registry. When Orbit deploys an app, it generates scoped pull credentials that get injected into the deployment target. Users never interact with this directly.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | Start simple - token API only | Foundation first, deployment integration later |
| Token granularity | App-scoped | Balance of security and usability |
| Auth mechanism | Docker token auth server | Standard flow, works with all Docker clients |
| User visibility | Invisible | Purely internal, Orbit handles everything |
| Token format | Self-contained JWT | No DB lookups needed, claims describe permissions |

## Authentication Flow

```
1. Orbit deployment service calls internal API:
   POST /api/internal/registry/pull-token
   { appId: "abc123" }

2. API returns Docker-compatible credentials:
   { username: "orbit-pull", password: "<jwt>", registry: "...", expiresAt: "..." }

3. Deployment service injects into target (future phase):
   - Kubernetes: creates imagePullSecret
   - Docker: passes to docker login

4. Target pulls image → registry returns 401 with:
   WWW-Authenticate: Bearer realm="https://orbit.local/api/registry/token"

5. Target calls token endpoint with Basic auth (orbit-pull:<jwt>)

6. Token endpoint validates JWT, returns Docker registry token

7. Target retries pull with registry token → success
```

## Token Structure

### Pull Token (JWT we generate)

```json
{
  "iss": "orbit",
  "sub": "orbit-deployment",
  "aud": "orbit-registry",
  "exp": 1703120400,
  "iat": 1703116800,
  "scope": "repository:my-workspace/my-app:pull"
}
```

- 1-hour TTL (short-lived, regenerated per deployment)
- `scope` uses Docker Registry format: `repository:{name}:{action}`
- Signed with `ORBIT_REGISTRY_JWT_SECRET`

### Docker Registry Token (returned by token endpoint)

The token endpoint returns a Docker-format token that the registry accepts:

```json
{
  "token": "<registry-token>",
  "expires_in": 3600,
  "issued_at": "2024-12-21T00:00:00Z"
}
```

## API Endpoints

### 1. Internal Pull Token Generator

`POST /api/internal/registry/pull-token`

**Request:**
```json
{ "appId": "abc123" }
```

**Response:**
```json
{
  "username": "orbit-pull",
  "password": "<jwt>",
  "registry": "registry.orbit.local",
  "expiresAt": "2024-12-21T01:00:00Z"
}
```

- Protected by `X-API-Key` header (`ORBIT_INTERNAL_API_KEY`)
- Looks up app to get workspace slug and app slug
- Generates JWT with `scope: repository:{workspace}/{app}:pull`

### 2. Docker Registry Token Endpoint

`GET /api/registry/token`

**Request:**
- `Authorization: Basic base64(orbit-pull:<jwt>)`
- Query params: `scope=repository:my-workspace/my-app:pull&service=orbit-registry`

**Response:**
```json
{
  "token": "<docker-registry-token>",
  "expires_in": 3600,
  "issued_at": "2024-12-21T00:00:00Z"
}
```

- Extracts JWT from Basic auth password field
- Validates JWT signature and expiration
- Checks requested scope matches JWT scope
- Returns Docker-format token

## Implementation

### Files to Create

| File | Purpose |
|------|---------|
| `orbit-www/src/lib/registry-auth.ts` | JWT generation/validation utilities |
| `orbit-www/src/app/api/internal/registry/pull-token/route.ts` | Internal token generator |
| `orbit-www/src/app/api/registry/token/route.ts` | Docker token endpoint |

### Files to Modify

| File | Change |
|------|--------|
| `infrastructure/registry/config.yml` | Add token auth configuration |
| `docker-compose.yml` | Add `ORBIT_REGISTRY_JWT_SECRET` env var |

### Registry Configuration

Update `infrastructure/registry/config.yml`:

```yaml
auth:
  token:
    realm: http://orbit-www:3000/api/registry/token
    service: orbit-registry
    issuer: orbit
    rootcertbundle: /etc/docker/registry/cert.pem
```

### Environment Variables

```bash
ORBIT_REGISTRY_JWT_SECRET=<random-32-char-secret>
```

## Testing

### Unit Tests

- `registry-auth.ts` - JWT generation with correct claims, expiration, scope format
- Token endpoint - validates JWT, rejects expired/invalid tokens, scope matching

### Integration Test (Manual)

```bash
# 1. Generate pull token via internal API
curl -X POST http://localhost:3000/api/internal/registry/pull-token \
  -H "X-API-Key: $ORBIT_INTERNAL_API_KEY" \
  -d '{"appId": "test-app-id"}'

# 2. Use credentials with docker login
docker login localhost:5050 -u orbit-pull -p <jwt-from-step-1>

# 3. Pull should succeed
docker pull localhost:5050/my-workspace/my-app:latest

# 4. Wrong scope should fail (403)
docker pull localhost:5050/other-workspace/other-app:latest
```

## Out of Scope

- Token revocation (short TTL makes this less critical)
- Audit logging (can add later)
- Deployment target integration (Kubernetes imagePullSecret, etc.) - future phase

## Security Considerations

- JWTs are short-lived (1 hour) to limit exposure
- App-scoped tokens limit blast radius
- Internal API protected by API key
- No user-facing token endpoints
- Build service uses separate credentials for push access
