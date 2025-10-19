# Q2: Plugin API Contract Discovery

## Date: 2025-10-19

## API Endpoint Pattern Discovery

### Standard Backstage API Pattern

All Backstage plugins follow this URL pattern:
```
/api/{plugin-id}/{endpoint}
```

### Catalog Plugin (@backstage/plugin-catalog-backend)

**Base Path:** `/api/catalog`

**Core Endpoints:**
```
GET  /api/catalog/entities
GET  /api/catalog/entities/by-uid/:uid
GET  /api/catalog/entities/by-name/:kind/:namespace/:name
POST /api/catalog/entities
DELETE /api/catalog/entities/by-uid/:uid
GET  /api/catalog/entity-facets
POST /api/catalog/refresh
GET  /api/catalog/locations
POST /api/catalog/locations
DELETE /api/catalog/locations/:id
```

**Authentication:** Required (Backstage auth layer)

**Example Request/Response** (based on Backstage docs):
```bash
curl -H "Authorization: Bearer TOKEN" \
  http://localhost:7007/api/catalog/entities?filter=kind=Component

# Response:
{
  "items": [
    {
      "apiVersion": "backstage.io/v1alpha1",
      "kind": "Component",
      "metadata": {
        "name": "my-service",
        "namespace": "default",
        "uid": "abc-123",
        "annotations": {}
      },
      "spec": {
        "type": "service",
        "lifecycle": "production",
        "owner": "team-a"
      }
    }
  ]
}
```

### ArgoCD Plugin (@roadiehq/backstage-plugin-argo-cd-backend)

**Base Path:** `/api/argocd`

**Core Endpoints** (based on Roadie documentation):
```
GET /api/argocd/argoInstance/:argoInstanceName/applications/:argoAppName
GET /api/argocd/argoInstance/:argoInstanceName/applications/:argoAppName/revisions/:argoAppRevision/metadata
GET /api/argocd/find/name/:argoAppName
POST /api/argocd/argoInstance/:argoInstanceName/applications/:argoAppName/sync
POST /api/argocd/argoInstance/:argoInstanceName/applications/:argoAppName/terminate
```

**Configuration Required:**
```yaml
argocd:
  appLocatorMethods:
    - type: 'config'
      instances:
        - name: 'main'
          url: 'https://argocd.example.com'
          token: ${ARGOCD_TOKEN}
```

**Example Response:**
```json
{
  "metadata": {
    "name": "my-app",
    "namespace": "argocd"
  },
  "spec": {
    "source": {
      "repoURL": "https://github.com/org/repo",
      "path": "k8s",
      "targetRevision": "main"
    },
    "destination": {
      "server": "https://kubernetes.default.svc",
      "namespace": "production"
    }
  },
  "status": {
    "sync": {
      "status": "Synced"
    },
    "health": {
      "status": "Healthy"
    }
  }
}
```

## API Contract Stability

### Versioning Strategy

Backstage uses **semantic versioning** for plugins:
- Major version bump = breaking changes
- Minor version bump = new features (backward compatible)
- Patch version bump = bug fixes

**Example:**
- v1.2.3 → v1.3.0 = safe upgrade (no breaking changes)
- v1.2.3 → v2.0.0 = breaking changes (requires migration)

### Catalog API Stability

**Assessment:** STABLE

- Core Backstage API
- Well-documented
- Used by all plugins
- Unlikely to break

**Risk:** LOW

### ArgoCD Plugin API Stability

**Assessment:** MODERATE

- Third-party plugin (Roadie maintained)
- Follows Backstage patterns
- Breaking changes possible with major updates

**Risk:** MEDIUM

**Mitigation:**
- Pin exact version in package.json
- Test before upgrading
- Monitor Roadie changelog

## Workspace Filtering Challenges

### Problem: No Built-in Workspace Scoping

Since Backstage has no workspace concept, we cannot filter entities by workspace at the API level.

**Current Catalog API:**
```
GET /api/catalog/entities
→ Returns ALL entities (no workspace filter)
```

**What Orbit Needs:**
```
GET /api/catalog/entities?workspace_id=ws-123
→ Should return ONLY entities for workspace ws-123
```

### Solutions (Given Multi-Instance Architecture)

**With Separate Backstage Instances (Recommended):**
```
Workspace ws-123 → Backstage Instance A
Workspace ws-456 → Backstage Instance B

GET /api/catalog/entities on Instance A
→ Only has entities for ws-123 (isolated database)
```

No filtering needed! Each instance only knows about its own workspace.

## Plugin Data Transformation Needs

### Minimal Transformation Required

With multi-instance architecture:
- ✅ No workspace filtering needed (database isolation)
- ✅ No data transformation needed (each instance serves one workspace)
- ✅ Simple proxy: forward request → get response → return

**Orbit Plugins Service (Go):**
```go
func (s *Server) ProxyPluginRequest(ctx context.Context, req *pb.ProxyPluginRequest) {
  // 1. Get Backstage instance for workspace
  instanceURL := s.getInstanceURL(req.WorkspaceId)

  // 2. Forward request as-is
  resp, _ := http.Get(instanceURL + req.EndpointPath)

  // 3. Return response (no transformation)
  return &pb.ProxyPluginResponse{
    StatusCode: resp.StatusCode,
    Body: resp.Body,
    Headers: resp.Headers,
  }
}
```

### Only Required Transformation: JWT Propagation

```go
// Add Orbit JWT as Backstage auth header
backstageReq.Header.Set("Authorization", "Bearer " + orbitJWT)
```

## Error Handling Patterns

### Common HTTP Status Codes

| Code | Meaning | Example |
|------|---------|---------|
| 200 | Success | Entity found and returned |
| 201 | Created | Entity successfully created |
| 400 | Bad Request | Invalid entity format |
| 401 | Unauthorized | Missing/invalid auth token |
| 403 | Forbidden | Permission denied |
| 404 | Not Found | Entity doesn't exist |
| 409 | Conflict | Entity already exists |
| 500 | Server Error | Backstage internal error |

### Error Response Format

```json
{
  "error": {
    "name": "NotFoundError",
    "message": "Entity not found: component:default/my-service",
    "stack": "..."
  },
  "request": {
    "method": "GET",
    "url": "/entities/by-name/component/default/my-service"
  },
  "response": {
    "statusCode": 404
  }
}
```

### Recommended Error Handling in Orbit

```go
switch resp.StatusCode {
case 200, 201:
  // Success - return response
  return &pb.ProxyPluginResponse{Body: resp.Body}

case 401, 403:
  // Auth error - likely Orbit JWT invalid
  return nil, status.Error(codes.Unauthenticated, "Backstage auth failed")

case 404:
  // Not found - pass through to client
  return &pb.ProxyPluginResponse{StatusCode: 404}

case 500, 502, 503, 504:
  // Backstage error - trigger circuit breaker
  return nil, status.Error(codes.Unavailable, "Backstage unavailable")
}
```

## Rate Limiting

### Backstage Default: No Rate Limiting

Backstage does not implement rate limiting by default.

**Implication:**
- Orbit must implement rate limiting in Go proxy layer
- Prevent abuse from malicious workspaces
- Protect Backstage instances from overload

**Recommendation:**
```go
// Rate limit per workspace
limiter := rate.NewLimiter(100, 1000) // 100 req/sec, burst 1000

if !limiter.Allow() {
  return nil, status.Error(codes.ResourceExhausted, "Rate limit exceeded")
}
```

## API Documentation

### Catalog API Documentation

**Official Docs:**
- https://backstage.io/docs/features/software-catalog/software-catalog-api

**OpenAPI Spec:**
- Available at `/api/catalog/openapi.json`

### ArgoCD Plugin Documentation

**Roadie Docs:**
- https://roadie.io/backstage/plugins/argo-cd/

**GitHub:**
- https://github.com/RoadieHQ/roadie-backstage-plugins/tree/main/plugins/backend/backstage-plugin-argo-cd-backend

## Conclusion

### API Contract Findings

✅ **Stable and Well-Documented**
- Backstage core APIs are mature and stable
- Community plugins follow consistent patterns
- Good error handling and status codes

⚠️ **No Workspace Scoping**
- APIs have no built-in workspace/tenant filtering
- Confirms need for multi-instance architecture

✅ **Minimal Transformation Needed**
- With multi-instance setup, simple proxying works
- No complex data filtering required

### Recommendations for Orbit

1. **Use Multi-Instance Architecture**
   - Eliminates need for workspace filtering
   - Simple proxy implementation
   - Lower data leakage risk

2. **Implement Rate Limiting in Go Layer**
   - Backstage has no built-in limits
   - Protect from workspace abuse

3. **Add Circuit Breaker**
   - Handle Backstage downtime gracefully
   - Return cached data when possible

4. **Pin Plugin Versions**
   - Use exact versions (no `^` or `~`)
   - Test upgrades in staging first

**Confidence Level:** HIGH - Based on official documentation and source code review.
