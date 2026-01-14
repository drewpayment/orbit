# Registry Quota Management - Phase 2 Design

## Overview

Implement quota management with automatic cleanup before builds exceed workspace limits.

## Key Decisions

- **Cleanup trigger**: Pre-build only (no scheduled jobs for MVP)
- **Size tracking**: Registry API for accurate manifest/layer sizes
- **Warnings**: Build logs + dashboard banner
- **Notifications**: Build logs only (cleanup summary)

## Data Flow

```
1. User triggers build
   ↓
2. Pre-build quota check (Orbit registry only)
   → Query RegistryImages for workspace total
   → If > 80%: run cleanup algorithm
   → Log cleanup actions to build output
   ↓
3. Build & push image
   ↓
4. Post-push image tracking
   → Query Registry API for manifest/size
   → Upsert RegistryImages record
   ↓
5. Build complete
```

## Component Ownership

### Go build-service (handles all registry operations)
- Pre-build quota check
- Cleanup algorithm execution
- Registry API calls (get manifest, delete image)
- Image size calculation
- Returns cleanup summary in build response

### Temporal workflow (orchestration)
- Calls build-service for quota check before build step
- Receives cleanup results
- Includes cleanup info in build status updates

### Payload/Next.js (data & UI only)
- RegistryImages collection (CRUD via internal API)
- Dashboard quota warning component
- Server action to fetch current usage for UI

## API & Protobuf Changes

### New RPC methods in `build.proto`

```protobuf
// Add to BuildService
rpc CheckQuotaAndCleanup(CheckQuotaRequest) returns (CheckQuotaResponse);
rpc TrackImage(TrackImageRequest) returns (TrackImageResponse);

message CheckQuotaRequest {
  string workspace_id = 1;
  int64 incoming_image_size_estimate = 2; // Optional hint
}

message CheckQuotaResponse {
  bool cleanup_performed = 1;
  int64 current_usage_bytes = 2;
  int64 quota_bytes = 3;
  repeated CleanedImage cleaned_images = 4;
}

message CleanedImage {
  string app_name = 1;
  string tag = 2;
  int64 size_bytes = 3;
}

message TrackImageRequest {
  string workspace_id = 1;
  string app_id = 2;
  string tag = 3;
  string digest = 4;
  string registry_url = 5;
}

message TrackImageResponse {
  int64 size_bytes = 1;
  int64 new_total_usage = 2;
}
```

### Payload Internal API endpoints

Called by build-service:
- `GET /api/internal/workspaces/{id}/registry-usage` - returns quota + current usage
- `GET /api/internal/workspaces/{id}/registry-images` - list images for cleanup
- `POST /api/internal/registry-images` - create/update image record
- `DELETE /api/internal/registry-images/{id}` - remove after cleanup

## Cleanup Algorithm

**Thresholds:**
- Warning: 70% usage
- Trigger cleanup: 80% usage
- Target after cleanup: 70% usage

**Algorithm (`internal/registry/cleanup.go`):**

```go
func (c *Cleaner) CleanupIfNeeded(ctx context.Context, workspaceID string) (*CleanupResult, error) {
    // 1. Get current usage from Payload
    usage := c.payloadClient.GetRegistryUsage(workspaceID)

    // 2. Check threshold (80%)
    if usage.CurrentBytes < (usage.QuotaBytes * 80 / 100) {
        return &CleanupResult{CleanupPerformed: false}, nil
    }

    // 3. Get all images sorted by pushedAt ASC (oldest first)
    images := c.payloadClient.GetRegistryImages(workspaceID)

    // 4. Group by app, identify deletion candidates (keep 3 per app)
    candidates := c.identifyCandidates(images, keepCount: 3)

    // 5. Delete until < 70% (target threshold)
    targetBytes := usage.QuotaBytes * 70 / 100

    for _, img := range candidates {
        if usage.CurrentBytes <= targetBytes { break }

        c.registryClient.DeleteManifest(img.Repository, img.Digest)
        c.payloadClient.DeleteRegistryImage(img.ID)
        usage.CurrentBytes -= img.SizeBytes
    }

    // 6. If still over, reduce to 2 per app (more aggressive)
    if usage.CurrentBytes > targetBytes {
        // Second pass with keepCount=2
    }

    return &CleanupResult{CleanupPerformed: true, Deleted: deleted}, nil
}
```

**Protection rules:**
- Never delete if it's the only tag for an app
- Never delete "latest" if it's the sole remaining tag
- Always keep at least 2 tags per app after aggressive cleanup

## Dashboard Quota Warning

**Component:** `orbit-www/src/components/features/workspace/RegistryQuotaWarning.tsx`

```tsx
export async function RegistryQuotaWarning({ workspaceId }: Props) {
  const usage = await getRegistryUsage(workspaceId)

  if (!usage || usage.percentage < 70) return null

  const isNearLimit = usage.percentage >= 90

  return (
    <Alert variant={isNearLimit ? "destructive" : "warning"}>
      <AlertTitle>
        {isNearLimit ? "Registry Almost Full" : "Registry Usage Warning"}
      </AlertTitle>
      <AlertDescription>
        Using {formatBytes(usage.current)} of {formatBytes(usage.quota)}
        ({usage.percentage}%).
      </AlertDescription>
    </Alert>
  )
}
```

**Placement:** Workspace dashboard layout, above main content.

## Workflow Integration

**Build workflow changes:**

```go
func BuildWorkflow(ctx workflow.Context, input BuildInput) (*BuildResult, error) {
    // Pre-build quota check (only for Orbit registry)
    if input.Registry.Type == "orbit" {
        var quotaResult QuotaCheckResult
        workflow.ExecuteActivity(ctx, activities.CheckQuotaAndCleanup,
            QuotaCheckInput{WorkspaceID: input.WorkspaceID},
        ).Get(ctx, &quotaResult)

        if quotaResult.CleanupPerformed {
            updateStatus("Cleaned up old images to free space...")
        }
    }

    // ... existing build steps ...

    // Post-push image tracking (only for Orbit registry)
    if input.Registry.Type == "orbit" && buildResult.Success {
        workflow.ExecuteActivity(ctx, activities.TrackImage, ...)
    }
}
```

## Implementation Phases

1. Add protobuf messages and regenerate
2. Create Payload internal API endpoints
3. Implement registry client (manifest fetch, delete)
4. Implement cleanup algorithm in build-service
5. Add CheckQuotaAndCleanup RPC
6. Add TrackImage RPC
7. Update Temporal activities
8. Update build workflow
9. Create dashboard warning component
10. Integration testing
