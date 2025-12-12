# SOP: Container Image Builds & Temporal Workflows

**Created**: 2025-12-06
**Last Updated**: 2025-12-06
**Trigger**: When working on build service, image builds, or build-related Temporal workflows

## Purpose
This SOP documents the architecture and development workflow for the container image build system, which uses Temporal workflows to orchestrate building and pushing Docker images from source repositories.

## Architecture Overview

### Component Diagram
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Frontend (orbit-www)                            │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────────┐  │
│  │   BuildSection   │───▶│  Server Actions  │───▶│  Internal API        │  │
│  │   (React UI)     │    │  (builds.ts)     │    │  /api/internal/...   │  │
│  └──────────────────┘    └──────────────────┘    └──────────────────────┘  │
│           │                       │                        ▲               │
│           │ polls status          │ starts workflow        │ updates status│
└───────────┼───────────────────────┼────────────────────────┼───────────────┘
            │                       ▼                        │
┌───────────┼─────────────────────────────────────────────────────────────────┐
│           │              Temporal Server                                     │
│           ▼                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                        BuildWorkflow                                  │   │
│  │  ┌────────────────┐  ┌────────────────┐  ┌─────────────────────────┐ │   │
│  │  │UpdateBuildStatus│  │AnalyzeRepository│  │UpdateBuildStatus      │ │   │
│  │  │ (analyzing)     │─▶│   (activity)    │─▶│ (building)            │ │   │
│  │  └────────────────┘  └────────────────┘  └─────────────────────────┘ │   │
│  │                                                       │               │   │
│  │                                                       ▼               │   │
│  │                              ┌─────────────────────────────────────┐  │   │
│  │                              │         BuildAndPushImage           │  │   │
│  │                              │           (activity)                │  │   │
│  │                              └─────────────────────────────────────┘  │   │
│  │                                                       │               │   │
│  │                                                       ▼               │   │
│  │                              ┌─────────────────────────────────────┐  │   │
│  │                              │  UpdateBuildStatus (success/failed) │──┼───┘
│  │                              └─────────────────────────────────────┘  │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                          │                                   │
└──────────────────────────────────────────┼───────────────────────────────────┘
                                           │ gRPC calls
                                           ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                            Build Service (Go gRPC)                            │
│  ┌─────────────────────┐    ┌─────────────────────┐    ┌──────────────────┐  │
│  │  AnalyzeRepository  │    │     BuildImage      │    │    Builder       │  │
│  │     (gRPC)          │    │       (gRPC)        │───▶│  (Docker/Railpack)│  │
│  └─────────────────────┘    └─────────────────────┘    └──────────────────┘  │
│           │                          │                          │            │
│           ▼                          ▼                          ▼            │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                        Docker Daemon (builds images)                     │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| **BuildSection** | `orbit-www/src/components/features/apps/BuildSection.tsx` | React UI component showing build status, triggers builds |
| **Server Actions** | `orbit-www/src/app/actions/builds.ts` | Next.js server actions: `startBuild`, `getBuildStatus`, `cancelBuild` |
| **Internal API** | `orbit-www/src/app/api/internal/apps/[id]/build-status/route.ts` | HTTP endpoint for Temporal to update build status |
| **BuildWorkflow** | `temporal-workflows/internal/workflows/build_workflow.go` | Temporal workflow orchestrating the build process |
| **Build Activities** | `temporal-workflows/internal/activities/build_activities.go` | Temporal activities: `AnalyzeRepository`, `BuildAndPushImage`, `UpdateBuildStatus` |
| **PayloadBuildClient** | `temporal-workflows/internal/services/payload_build_client.go` | HTTP client calling internal API to update status |
| **Build Service** | `services/build-service/internal/grpc/build/server.go` | gRPC service handling repository analysis and image building |
| **Builder** | `services/build-service/internal/builder/builder.go` | Core build logic (Docker/Railpack execution) |

### Data Flow

**1. User triggers build:**
```
User clicks "Build Now"
  → BuildSection calls startBuild() server action
  → Server action validates, gets GitHub token & registry config
  → Server action starts Temporal workflow via Connect-ES client
  → Returns workflowId to frontend
```

**2. Temporal executes workflow:**
```
BuildWorkflow starts
  → UpdateBuildStatus("analyzing") → Payload API
  → AnalyzeRepository → build-service gRPC → detects language/framework
  → UpdateBuildStatus("building") → Payload API
  → BuildAndPushImage → build-service gRPC → Docker build & push
  → UpdateBuildStatus("success" or "failed") → Payload API
```

**3. Frontend polls for updates:**
```
BuildSection polls getBuildStatus() every 3s
  → Server action reads app.latestBuild from Payload
  → Returns status, error, imageUrl, buildConfig
  → UI updates accordingly
```

## Key Files Reference

### Frontend (orbit-www)

| File | Purpose |
|------|---------|
| `src/components/features/apps/BuildSection.tsx` | Main UI component |
| `src/app/actions/builds.ts` | Server actions for build operations |
| `src/app/api/internal/apps/[id]/build-status/route.ts` | Internal API for status updates |
| `src/lib/clients/build-client.ts` | Connect-ES client for Temporal |
| `src/collections/Apps.ts` | Payload schema (latestBuild, buildConfig fields) |

### Temporal Workflows (temporal-workflows)

| File | Purpose |
|------|---------|
| `internal/workflows/build_workflow.go` | Main workflow definition |
| `internal/activities/build_activities.go` | Activity implementations |
| `internal/services/payload_build_client.go` | HTTP client for Payload |
| `cmd/worker/main.go` | Worker registration and wiring |
| `pkg/types/build_types.go` | Shared type definitions |

### Build Service (services/build-service)

| File | Purpose |
|------|---------|
| `internal/grpc/build/server.go` | gRPC handlers |
| `internal/builder/builder.go` | Docker/Railpack build logic |
| `cmd/server/main.go` | Service entry point |

### Proto Definitions

| File | Purpose |
|------|---------|
| `proto/idp/build/v1/build.proto` | gRPC service definition |
| `proto/gen/go/idp/build/v1/build.pb.go` | Generated Go code |
| `orbit-www/src/lib/proto/idp/build/v1/build_pb.ts` | Generated TypeScript |

## Development Workflow

### Adding New Build Features

1. **Update Proto** (if changing gRPC interface):
   ```bash
   # Edit proto/idp/build/v1/build.proto
   make proto-gen
   ```

2. **Update Build Service** (if changing build logic):
   ```bash
   # Edit services/build-service/...
   docker compose build --no-cache build-service
   docker compose up -d build-service
   ```

3. **Update Temporal Workflow/Activities**:
   ```bash
   # Edit temporal-workflows/...
   docker compose build --no-cache temporal-worker
   docker compose up -d temporal-worker
   ```

4. **Update Frontend**:
   ```bash
   # Edit orbit-www/...
   # HMR should pick up changes automatically
   # Hard refresh browser if needed (Cmd+Shift+R)
   ```

### Debugging Build Issues

#### Check Temporal UI
```
http://localhost:8080/namespaces/default/workflows
```
- Find workflow by ID
- Inspect Input/Result JSON
- View Event History for activity failures
- Check activity error messages

#### Check Service Logs
```bash
# Build service logs
docker compose logs build-service --tail=100 -f

# Temporal worker logs
docker compose logs temporal-worker --tail=100 -f

# All logs
docker compose logs -f
```

#### Common Issues

| Symptom | Likely Cause | Solution |
|---------|--------------|----------|
| `hasToken: false` in logs | Token not being passed | Check `startBuild` action passes token correctly |
| `could not read Username` | Git clone auth failed | Ensure token embedded in URL: `https://x-access-token:TOKEN@github.com/...` |
| `Lockfile not found` | Repo missing lockfile | Add yarn.lock/package-lock.json to repo |
| Status not updating | PayloadBuildClient is nil | Check `main.go` wires up real client |
| `unauthorized` on push | Registry auth failed | Verify registry token and permissions |

#### Verify Token Flow
```bash
# Check workflow input in Temporal UI
# Should see registry.token populated

# Check build-service logs for hasToken
docker compose logs build-service | grep hasToken
```

### Rebuilding After Changes

**Critical: Code changes require container rebuilds!**

```bash
# After changing build-service
docker compose build --no-cache build-service
docker compose up -d build-service

# After changing temporal-workflows
docker compose build --no-cache temporal-worker
docker compose up -d temporal-worker

# Verify containers restarted with new code
docker compose ps
docker compose logs temporal-worker --tail=10
```

## Error Handling

### Error Flow
```
Build Service error
  → Returned in gRPC response.error
  → Activity returns error in BuildAndPushResult
  → Workflow calls UpdateBuildStatus with error
  → PayloadBuildClient HTTP PATCH to internal API
  → App.latestBuild.error updated in Payload
  → Frontend polls and displays in BuildErrorDisplay
```

### Error Message Extraction
The `extractBuildErrorSummary()` function in `builder.go` parses Docker output to find user-friendly error messages:
- Looks for "Lockfile not found", "npm ERR!", "COPY failed", etc.
- Returns meaningful summary instead of raw output

### Frontend Error Display
`BuildErrorDisplay` component in `BuildSection.tsx`:
- Parses error with `parseBuildError()`
- Shows summary, details, actionable suggestions
- Links to Temporal UI for debugging

## Testing

### Manual Testing Flow
1. Navigate to an App detail page
2. Ensure repository and registry configured
3. Click "Build Now"
4. Watch status change: analyzing → building → success/failed
5. Check Temporal UI for workflow details
6. Verify image pushed to registry (if successful)

### Triggering Test Builds
```bash
# Via curl (requires auth)
curl -X POST http://localhost:3000/api/...

# Or use frontend directly
```

### Verifying Registry Push
```bash
# For GHCR
docker pull ghcr.io/<owner>/<repo>:latest
```

## Environment Variables

### temporal-worker
| Variable | Default | Purpose |
|----------|---------|---------|
| `TEMPORAL_ADDRESS` | `localhost:7233` | Temporal server address |
| `TEMPORAL_NAMESPACE` | `default` | Temporal namespace |
| `ORBIT_API_URL` | `http://localhost:3000` | Orbit frontend URL |
| `ORBIT_INTERNAL_API_KEY` | (required) | API key for internal endpoints |
| `BUILD_SERVICE_ADDRESS` | `build-service:50054` | Build service gRPC address |

### build-service
| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `50054` | gRPC server port |
| `BUILD_WORKDIR` | `/tmp/orbit-builds` | Directory for build artifacts |

## Related Documentation
- See: [adding-grpc-services.md](adding-grpc-services.md) for gRPC patterns
- See: [error-handling.md](error-handling.md) for error handling patterns
- See: `docs/plans/2025-12-04-railpack-build-service.md` for original implementation plan

## Appendix: Workflow Input/Output Schemas

### BuildWorkflowInput
```go
type BuildWorkflowInput struct {
    RequestID   string                  `json:"requestId"`
    AppID       string                  `json:"appId"`
    WorkspaceID string                  `json:"workspaceId"`
    UserID      string                  `json:"userId"`
    RepoURL     string                  `json:"repoUrl"`
    Ref         string                  `json:"ref"`
    Registry    BuildWorkflowRegistry   `json:"registry"`
    ImageTag    string                  `json:"imageTag"`
}

type BuildWorkflowRegistry struct {
    Type       string `json:"type"`       // "ghcr" or "acr"
    URL        string `json:"url"`        // e.g., "ghcr.io"
    Repository string `json:"repository"` // e.g., "owner/repo"
    Token      string `json:"token"`      // Auth token
}
```

### BuildWorkflowResult
```go
type BuildWorkflowResult struct {
    Status      string `json:"status"`      // "success" or "failed"
    ImageURL    string `json:"imageUrl"`    // e.g., "ghcr.io/owner/repo:tag"
    ImageDigest string `json:"imageDigest"` // e.g., "sha256:abc..."
    Error       string `json:"error"`       // Error message if failed
}
```

### App.latestBuild Schema (Payload)
```typescript
latestBuild: {
    status: 'none' | 'analyzing' | 'building' | 'success' | 'failed'
    imageUrl?: string
    imageDigest?: string
    imageTag?: string
    builtAt?: string
    workflowId?: string
    error?: string
}
```
