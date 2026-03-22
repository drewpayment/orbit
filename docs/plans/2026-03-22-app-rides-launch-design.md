# App Rides Launch — Design Document

## Overview

Enable Orbit Applications to be deployed to infrastructure provisioned by Launches. An Application "rides a Launch" by linking a Deployment to a Launch's provisioned resources and deploying to them automatically.

## Current State

- **Launches** provision cloud infrastructure via Pulumi (GCS buckets, Cloud Run services, VPCs) and store outputs (bucket names, service URLs)
- **Applications** build container images via Railpack and have deployment configurations
- **Deployments** generate config files (Docker Compose, Helm) for committing to repos
- **Gap**: No way to connect an Application to a Launch's infrastructure for actual cloud deployment

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Strategy detection | Auto-detect with override | Happy path is simple; user can customize |
| Link location | On the Deployment | One App can have staging + production Launches |
| Static site build | MVP: separate simple pipeline | Clone → build → upload. Faster to ship than extending Railpack |
| Workflow execution | Launches worker, separate workflow | Reuses credential infrastructure; clean separation from provisioning |

## Data Model Changes

### Deployments Collection — 3 new fields

```typescript
// launch — optional relationship to launches
{
  name: 'launch',
  type: 'relationship',
  relationTo: 'launches',
  admin: {
    description: 'Launch infrastructure this deployment targets',
    condition: (data) => !!data?.launch,
  },
}

// deployStrategy — extends beyond generator for Launch-based deploys
{
  name: 'deployStrategy',
  type: 'select',
  options: [
    { label: 'Docker Compose', value: 'docker-compose' },
    { label: 'Helm', value: 'helm' },
    { label: 'Custom', value: 'custom' },
    { label: 'GCS Static Site', value: 'gcs-static-site' },
    { label: 'Cloud Run', value: 'cloud-run' },
  ],
  admin: {
    description: 'How this deployment reaches its target infrastructure',
  },
}

// launchOutputs — snapshot of Launch pulumiOutputs at deploy time
{
  name: 'launchOutputs',
  type: 'json',
  admin: {
    description: 'Snapshot of Launch infrastructure outputs used for this deployment',
    readOnly: true,
  },
}
```

### Strategy Auto-Detection Mapping

| Template Category | Template Type | Detected Strategy |
|---|---|---|
| `storage` | `bundle` | `gcs-static-site` |
| `container` | `bundle` | `cloud-run` |
| `compute` | `bundle` | `cloud-run` |
| `storage` | `resource` | `gcs-static-site` |
| `container` | `resource` | `cloud-run` |

### No changes to

- Apps collection
- Launches collection (existing `app` field stays as optional reverse-reference)
- LaunchTemplates collection

## UI Changes

### Add Deployment Modal

1. New **"Deploy to Launch"** section at top shows active Launches in the same workspace
2. When a Launch is selected, **Deployment Method** auto-selects detected strategy (editable)
3. Strategy-specific form fields:
   - **GCS Static Site**: `Build Command` (default: `npm run build`), `Output Directory` (default: `out`), read-only target bucket from Launch outputs
   - **Cloud Run**: `Port` field, read-only Cloud Run service from Launch outputs
4. Without a Launch selected, modal behaves exactly as today

### App Detail Page

- Launch-backed deployments show Launch name + provider icon instead of "Docker Compose"/"Helm"

### Launch Detail Page (Phase 2)

- "Linked Deployments" section showing deployments targeting this Launch

## Deployment Pipeline

### New Temporal Workflow: `DeployToLaunchWorkflow`

Runs on `launches_{provider}` task queue.

```
1. ValidateDeployInputs
   - Confirm Launch is `active`
   - Verify cloud account credentials
   - Validate strategy matches Launch outputs

2. UpdateDeploymentStatus → "deploying"

3. Strategy-specific activity:

   DeployStaticSite (gcs-static-site):
   ├── Clone repo at specified branch
   ├── npm install && npm run build (or custom command)
   ├── Upload output directory to GCS bucket
   └── Uses @google-cloud/storage SDK

   DeployCloudRun (cloud-run) [Phase 2]:
   ├── Take container image from app's latest build
   ├── Deploy to Cloud Run service
   └── Wait for revision healthy

4. StoreLaunchDeployResult
   - Timestamp, deployed commit, output URLs

5. UpdateDeploymentStatus → "deployed"
```

### Credential Flow

Workflow runs on launches worker which has `GOOGLE_APPLICATION_CREDENTIALS` mounted. No additional credential plumbing.

### Error Handling

Any step failure sets deployment status to `failed` with error message, same as `LaunchWorkflow`.

## API Changes

### New Internal API Route

`PATCH /api/internal/deployments/[id]/status` — Temporal worker updates deployment status.

### Modified Server Actions

- `createDeployment` — accepts optional `launchId`, auto-detects strategy, snapshots `pulumiOutputs`
- `startDeployment` — new code path for Launch-backed deployments calls `startDeployToLaunchWorkflow`

### New Proto Method

```protobuf
// Added to LaunchService
rpc DeployToLaunch(DeployToLaunchRequest) returns (DeployToLaunchResponse);

message DeployToLaunchRequest {
  string deployment_id = 1;
  string launch_id = 2;
  string strategy = 3;
  string cloud_account_id = 4;
  string provider = 5;
  string repo_url = 6;
  string branch = 7;
  string build_command = 8;
  string output_directory = 9;
  google.protobuf.Struct launch_outputs = 10;
}

message DeployToLaunchResponse {
  bool success = 1;
  string workflow_id = 2;
  string error = 3;
}
```

## Implementation Phases

### Phase 1 (MVP)

- Data model: 3 new fields on Deployments
- UI: Add Deployment modal with Launch selection, GCS Static Site strategy
- `DeployToLaunchWorkflow` + `DeployStaticSite` activity
- Proto + gRPC: `DeployToLaunch` method
- Internal API: deployment status updates
- End-to-end: cfp-stats → GCS bucket

### Phase 2 (Follow-up)

- `DeployCloudRun` activity
- AWS/Azure deploy strategies
- Launch Detail "Linked Deployments" section
- Auto-redeploy on new build
- Deployment history/rollback

## File Changes (Phase 1)

### New Files
- `orbit-www/src/app/api/internal/deployments/[id]/status/route.ts`
- `launches-worker-gcp/src/activities/deploy-static-site.ts`
- `launches-worker-gcp/src/workflows/deploy-to-launch.ts`

### Modified Files
- `orbit-www/src/collections/Deployments.ts` — 3 new fields
- `orbit-www/src/components/features/apps/AddDeploymentModal.tsx` — Launch selection UI
- `orbit-www/src/app/actions/deployments.ts` — `createDeployment` + `startDeployment` extensions
- `proto/idp/launch/v1/launch.proto` — `DeployToLaunch` RPC
- `services/repository/internal/grpc/launch_server.go` — handle new RPC
- `services/repository/cmd/server/main.go` — wire up workflow
- `launches-worker-gcp/src/worker.ts` — register new workflow + activities
- `temporal-workflows/pkg/types/launch_types.go` — new input/output types
