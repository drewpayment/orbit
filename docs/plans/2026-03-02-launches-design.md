# Launches — Cloud Infrastructure Provisioning

**Status:** Approved design
**Date:** 2026-03-02
**Primitive:** Launch

## Overview

Launches is a new first-class primitive in Orbit for provisioning and managing live cloud infrastructure. Users select what they want to deploy through the UI, and Orbit provisions it on their chosen cloud provider using Pulumi, orchestrated by Temporal workflows.

A **Launch** represents a managed unit of cloud infrastructure (a Pulumi stack). It can be standalone (shared/platform infrastructure like a VPC or database cluster) or bound to an existing App.

### Vocabulary

| Term | Meaning |
|------|---------|
| **Launch** (noun) | A managed collection of cloud resources provisioned as a unit |
| **Launch** (verb) | Provision infrastructure |
| **Deorbit** | Tear down / destroy infrastructure |
| **Abort** | Cancel a launch in progress |

### Relationship to Existing Primitives

Launches **complement** the existing Deployment system as a separate primitive:

- **Launch** = infrastructure (provisions cloud resources: VPCs, databases, clusters, load balancers)
- **Deployment** = application release (pushes app code/containers onto existing infrastructure)

The existing Deployment primitive will be refined/renamed in a future effort. See `docs/plans/2026-03-02-deployment-primitive-rethink.md`.

### Phased Approach

1. **Phase 1 (this design):** Pre-built Launch Templates with UI-driven provisioning on AWS
2. **Phase 2 (future):** Custom Pulumi programs — users bring their own TypeScript/Go/Python programs
3. **Phase 3 (future):** Pulumi as durable executor for Terraform — leverage Pulumi's Terraform provider to bring Temporal durability to existing Terraform workflows

---

## Architecture

### Approach: Polyglot Task Queue Workers

Mirrors the pattern from [temporalio/temporal-demo-infra](https://github.com/temporalio/temporal-demo-infra):

- **Go workflow** orchestrates the Launch lifecycle (validate → approve → provision → monitor → deorbit)
- **Per-provider TypeScript workers** run Pulumi programs via Automation API, each on their own Temporal task queue
- Go workflow dispatches provisioning activities to the correct task queue based on the selected Cloud Account's provider

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Orbit UI    │────▶│  Launch gRPC     │────▶│  Temporal Server │
│  (Next.js)   │     │  Service (Go)    │     │  (port 7233)     │
└──────────────┘     └──────────────────┘     └────────┬────────┘
                                                       │
                                              ┌────────┴────────┐
                                              │                 │
                                    ┌─────────▼──────┐  ┌──────▼──────────┐
                                    │  Go Worker     │  │  TS Worker      │
                                    │  "launches"    │  │  "launches_aws" │
                                    │  (orchestration)│  │  (Pulumi exec)  │
                                    └────────────────┘  └─────────────────┘
```

### Why Polyglot

- Pulumi's TypeScript SDK is the most mature and has the best ecosystem
- Independent scaling per provider (add workers as needed)
- Natural extension point: add `launches_gcp`, `launches_azure` workers later
- Proven pattern validated by Temporal's own demo repo

### SDK Versions

- **Temporal Go SDK:** v1.40.0
- **Temporal TypeScript SDK:** v1.15.0
- **Pulumi:** Latest stable

### Temporal Pattern Validation (as of 2026)

All patterns verified against current Temporal documentation:

| Pattern | Status | Notes |
|---------|--------|-------|
| Polyglot task queues | Unchanged | Same-namespace, different task queues |
| Signals for approval | Recommended | Temporal cookbook uses this for human-in-the-loop |
| Queries for state | Current | No replacement introduced |
| `AwaitWithTimeout` | Active | Bug fix in v1.40.0 confirms active maintenance |
| Heartbeats | Unchanged | SDK handles throttling automatically |
| `NewDisconnectedContext` | Documented | Standard cleanup-after-cancel pattern |
| Entity Workflows | Recommended | For long-lived entities like Launches |
| Nexus | Not needed | For cross-namespace; our workers share a namespace |

### Future Considerations

- **Worker Deployment Versioning** (GA in v1.40.0) — Use for safe rollouts of workflow code changes
- **Activity Operations Commands** (public preview) — Pause/unpause/reset long-running provisioning activities
- **Temporal Updates** — Potential use for synchronous parameter validation in the future

---

## Data Model

### Cloud Accounts (Payload Collection)

A first-class entity representing a connected cloud provider account. Admin-managed with workspace-scoped access.

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name (e.g., "Production AWS") |
| `provider` | select | `aws`, `gcp`, `azure`, `digitalocean` |
| `credentials` | JSON (encrypted) | Provider-specific credentials |
| `region` | string | Default region |
| `workspaces` | relationship[] | Which workspaces can use this account |
| `status` | select | `connected`, `disconnected`, `error` |
| `lastValidatedAt` | date | Last successful credential validation |
| `createdBy` | relationship(User) | Admin who created it |

**Access control:**
- Only org admins can create/edit Cloud Accounts
- Workspace members can read accounts linked to their workspace
- Credentials are never exposed to non-admin users

### Launches (Payload Collection)

The core primitive — a managed unit of cloud infrastructure.

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | User-defined name (e.g., "API Backend - Production") |
| `app` | relationship(App) | Optional — linked app |
| `workspace` | relationship | Owning workspace |
| `cloudAccount` | relationship(CloudAccount) | Target cloud account |
| `template` | relationship(LaunchTemplate) | Template used (null for custom programs) |
| `provider` | select | `aws`, `gcp`, `azure`, `digitalocean` |
| `region` | string | Target region |
| `status` | select | `pending`, `awaiting_approval`, `launching`, `active`, `failed`, `deorbiting`, `deorbited`, `aborted` |
| `parameters` | JSON | User-provided template parameters |
| `pulumiStackName` | string | Pulumi stack identifier |
| `pulumiOutputs` | JSON | Outputs from the Pulumi stack (URLs, IDs, etc.) |
| `workflowId` | string | Temporal workflow ID |
| `approvalConfig` | group | Approval requirements (required, approvers) |
| `approvedBy` | relationship(User) | Who approved |
| `launchError` | text | Error details on failure |
| `lastLaunchedAt` | date | |
| `lastDeorbitedAt` | date | |

**Status lifecycle:**
```
pending → awaiting_approval → launching → active → deorbiting → deorbited
                │                  │                     │
                ▼                  ▼                     ▼
             aborted            failed                failed
```

### Launch Templates (Payload Collection)

Pre-built infrastructure templates.

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name (e.g., "Web App Backend") |
| `slug` | string | Unique identifier |
| `description` | text | What this template provisions |
| `type` | select | `bundle` (solution bundle) or `resource` (individual resource) |
| `provider` | select | Target cloud provider |
| `crossProviderSlugs` | string[] | Equivalent templates on other providers (for badges) |
| `category` | select | `compute`, `storage`, `database`, `networking`, `container`, `serverless` |
| `parameterSchema` | JSON Schema | Defines required user parameters |
| `pulumiProjectPath` | string | Path to the Pulumi program within the template worker |
| `estimatedDuration` | string | "~5 min", "~15 min" |
| `builtIn` | boolean | System-provided vs. workspace-created |
| `icon` | string | Icon identifier for the UI |

---

## Workflow Architecture

### Entity Workflow Pattern

Each Launch is represented by a **long-lived Entity Workflow** that stays open while infrastructure is `active`. This is Temporal's recommended pattern for entities with ongoing lifecycle management.

```
Launch created → launching → active (workflow open, listening for signals) → deorbit → deorbited (workflow completes)
```

For very long-lived Launches, `Continue-As-New` resets the event history while preserving state.

### LaunchWorkflow (Go)

Runs on the `launches` task queue.

**Workflow steps:**

1. **ValidateInputs** (local activity) — Verify template exists, parameters match schema, cloud account is accessible
2. **ValidateCloudAccount** (activity) — Test credentials against the provider API (e.g., AWS STS `GetCallerIdentity`)
3. **ApprovalGate** (conditional) — If approval is required for this Cloud Account:
   - Update status to `awaiting_approval`
   - Notify designated approvers
   - `AwaitWithTimeout` on `ApprovalSignal` (configurable timeout, default 24h)
   - On rejection or timeout → status `aborted`, workflow completes
4. **ProvisionInfra** (activity on provider task queue) — Dispatched to `launches_aws` / `launches_gcp` / `launches_azure`. Runs Pulumi `stack.up()` with heartbeats.
5. **StoreOutputs** (activity) — Save Pulumi stack outputs to the Launch record in Payload
6. **UpdateStatus** (activity) — Set status to `active`
7. **WaitForLifecycleSignals** — Workflow stays open, listening for:
   - `DeorbitSignal` → triggers teardown
   - `AbortSignal` → triggers cancellation (with cleanup)

### Deorbit Flow

When `DeorbitSignal` is received:

1. Update status to `deorbiting`
2. Dispatch `DestroyInfra` activity to the same provider task queue
3. Runs Pulumi `stack.destroy()` via Automation API with heartbeats
4. On success → status `deorbited`, workflow completes
5. On failure → status `failed` with error details

### Cleanup on Abort

If a Launch is aborted after partial provisioning:

```go
defer func() {
    if !errors.Is(ctx.Err(), workflow.ErrCanceled) {
        return
    }
    newCtx, _ := workflow.NewDisconnectedContext(ctx)
    workflow.ExecuteActivity(newCtx, destroyInfraActivity, input)
}()
```

Uses a disconnected context to ensure cleanup runs even after cancellation.

### Signal & Query Handlers

**Signals:**
- `ApprovalSignal` — `{ approved: bool, approvedBy: string, notes: string }`
- `DeorbitSignal` — `{ requestedBy: string, reason: string }`
- `AbortSignal` — `{ requestedBy: string }`

**Queries:**
- `GetLaunchProgress` — Returns current step, percentage, status, log tail

### TypeScript Provider Workers

Each cloud provider gets a dedicated worker process:

```
launches-worker-aws/
  package.json
  tsconfig.json
  src/
    worker.ts                   # Temporal worker setup, listens on "launches_aws"
    activities/
      provision.ts              # Pulumi stack.up() with heartbeats
      destroy.ts                # Pulumi stack.destroy() with heartbeats
      validate-credentials.ts   # AWS STS GetCallerIdentity
    templates/
      bundles/
        web-app-backend/        # Pulumi program: VPC + ECS + ALB + RDS
        static-site/            # Pulumi program: S3 + CloudFront
      resources/
        s3-bucket/
        rds-postgres/
        ecs-cluster/
        vpc/
```

**Activity pattern:**

```typescript
export async function provisionInfra(input: ProvisionRequest): Promise<ProvisionResponse> {
    const ctx = Context.current();

    // Background heartbeat
    const interval = setInterval(() => ctx.heartbeat(), 5000);

    // Create or select Pulumi stack
    const stack = await LocalWorkspace.createOrSelectStack({
        stackName: input.stackName,
        workDir: path.join(__dirname, "../templates", input.templatePath),
    });

    // Inject cloud credentials + user parameters
    await stack.setAllConfig(buildConfig(input));

    // Deploy
    const result = await stack.up({ onOutput: console.log });
    clearInterval(interval);

    return { outputs: result.outputs, summary: result.summary };
}
```

### Credential Security

Cloud Account credentials are **never sent through Temporal** (they would appear in event history):

- Credentials stored encrypted in Payload CMS (MongoDB)
- Temporal activity input contains only a `cloudAccountId`
- TypeScript worker resolves credentials at runtime by fetching from Payload or a secrets manager
- Credentials injected into Pulumi via environment variables or provider config

### Pulumi State Management

- Each Launch gets its own Pulumi stack: `orbit-{workspaceId}-{launchId}`
- Pulumi state backend: MinIO/S3 (already running in the infrastructure)
- Stack state enables drift detection and incremental updates in the future

---

## gRPC Service Definition

### New Proto: `proto/idp/launch/v1/launch.proto`

```protobuf
service LaunchService {
    rpc StartLaunch(StartLaunchRequest) returns (StartLaunchResponse);
    rpc GetLaunchProgress(GetLaunchProgressRequest) returns (GetLaunchProgressResponse);
    rpc ApproveLaunch(ApproveLaunchRequest) returns (ApproveLaunchResponse);
    rpc DeorbitLaunch(DeorbitLaunchRequest) returns (DeorbitLaunchResponse);
    rpc AbortLaunch(AbortLaunchRequest) returns (AbortLaunchResponse);
}
```

### New Proto: `proto/idp/cloudaccount/v1/cloud_account.proto`

```protobuf
service CloudAccountService {
    rpc ValidateCredentials(ValidateCredentialsRequest) returns (ValidateCredentialsResponse);
}
```

Implemented in the Repository Service (or a new dedicated service) on an existing or new port.

---

## UI Design

### Navigation

```
Orbit Sidebar
├── Dashboard
├── Apps
├── Deployments
├── Launches              ← new
│   ├── All Launches
│   └── Templates
├── Cloud Accounts        ← new (admin-only, under Settings)
└── Settings
```

### Launches List Page (`/launches`)

Table view of all Launches in the workspace:

| Column | Content |
|--------|---------|
| Name | Launch name with status badge |
| Provider | Cloud provider icon |
| Template | Template name or "Custom" |
| Region | Target region |
| App | Linked app name or "—" |
| Status | Colored badge |
| Last Activity | Relative timestamp |

Actions: "New Launch" button, row actions for Deorbit/Abort.

### New Launch Wizard (`/launches/new`)

**Step 1 — Select Provider**
- Grid of cloud provider cards (AWS, GCP, Azure, DigitalOcean)
- Each card shows icon, name, count of available templates
- Selecting a provider filters templates in step 2

**Step 2 — Select Template**
- Two tabs: **Bundles** (default) | **Individual Resources**
- Card grid: icon, name, description, estimated duration
- Cross-provider badges (e.g., "Also on GCP, Azure")
- Search/filter by category (compute, storage, database, networking, container, serverless)

**Step 3 — Configure**
- Dynamic form generated from the template's `parameterSchema` (JSON Schema → form fields)
- Select Cloud Account (filtered to workspace-accessible accounts for the chosen provider)
- Select region
- Optional: link to an App
- Name the Launch

**Step 4 — Review & Launch**
- Summary of all selections
- Approval notice if required: "This launch requires approval from [approvers]"
- "Launch" button starts the Temporal workflow

### Launch Detail Page (`/launches/[id]`)

**Header:** Launch name, status badge, provider icon, region, linked app

**Tabs:**
- **Overview** — Pulumi outputs (URLs, resource IDs, connection strings), Cloud Account, template, timestamps
- **Progress** — Real-time workflow progress (extends existing `WorkflowProgress` component). Current step, percentage bar, step-by-step status icons, live log output
- **Resources** — Provisioned cloud resources with types and IDs (from Pulumi outputs)
- **History** — Audit trail: who launched, who approved, status changes

**Header actions:**
- **Deorbit** — Confirmation modal requiring user to type the launch name
- **Abort** — Visible only during `launching` or `awaiting_approval`

### Approval Experience

When a Launch requires approval:
- Approvers see a notification/banner on their dashboard
- Approval page shows: requester, template, Cloud Account, parameters
- **Approve** / **Reject** buttons with optional notes field
- Sends `ApprovalSignal` to the Temporal workflow

### Cloud Accounts Admin Page (`/settings/cloud-accounts`)

Admin-only:
- List of connected cloud accounts with provider, name, status, workspace assignments
- "Add Cloud Account" flow:
  - Select provider
  - Provider-specific credential form (AWS: access key + secret or assume role ARN; GCP: service account JSON; Azure: service principal)
  - "Test Connection" validates credentials
  - Assign to workspaces (multi-select)
- Edit/delete existing accounts

---

## Service Structure (New Files)

### TypeScript Worker

```
launches-worker-aws/
  package.json              # @temporalio/worker, @pulumi/pulumi, @pulumi/aws
  tsconfig.json
  src/
    worker.ts
    activities/
      provision.ts
      destroy.ts
      validate-credentials.ts
    templates/
      bundles/
        web-app-backend/    # index.ts + Pulumi.yaml
        static-site/        # index.ts + Pulumi.yaml
      resources/
        s3-bucket/
        rds-postgres/
        ecs-cluster/
        vpc/
```

### Go Changes

```
temporal-workflows/
  internal/
    workflows/
      launch_workflow.go        # NEW — LaunchWorkflow (entity pattern)
    activities/
      launch_activities.go      # NEW — validate, update status, notify
  pkg/types/
    launch_types.go             # NEW — LaunchWorkflowInput, LaunchProgress, etc.

services/repository/
  internal/
    grpc/
      launch_server.go          # NEW — LaunchService gRPC implementation

proto/
  idp/launch/v1/
    launch.proto                # NEW — LaunchService definition
  idp/cloudaccount/v1/
    cloud_account.proto         # NEW — CloudAccountService definition
```

### Frontend Changes

```
orbit-www/src/
  collections/
    Launches.ts                 # NEW
    LaunchTemplates.ts          # NEW
    CloudAccounts.ts            # NEW
  app/
    (app)/launches/
      page.tsx                  # NEW — Launches list
      new/page.tsx              # NEW — New Launch wizard
      [id]/page.tsx             # NEW — Launch detail
    (app)/settings/
      cloud-accounts/
        page.tsx                # NEW — Cloud Accounts admin
    actions/
      launches.ts               # NEW — Server actions
      cloud-accounts.ts         # NEW — Server actions
  lib/clients/
    launch-client.ts            # NEW — gRPC client
  components/features/launches/
    LaunchWizard.tsx             # NEW
    LaunchDetail.tsx             # NEW
    LaunchProgress.tsx           # NEW
    ProviderSelector.tsx         # NEW
    TemplateSelector.tsx         # NEW
    ParameterForm.tsx            # NEW
    ApprovalBanner.tsx           # NEW
    DeorbitConfirmation.tsx      # NEW
```

---

## Initial Template Set (MVP — AWS Only)

### Bundles

| Name | Resources | Category |
|------|-----------|----------|
| Web App Backend | VPC + ECS Fargate + ALB + RDS PostgreSQL | compute |
| Static Site | S3 + CloudFront distribution | storage |

### Individual Resources

| Name | Resource | Category |
|------|----------|----------|
| S3 Bucket | S3 Bucket with configurable settings | storage |
| RDS PostgreSQL | RDS PostgreSQL instance | database |
| ECS Fargate Cluster | ECS cluster with Fargate capacity | container |
| VPC | VPC with public/private subnets | networking |

---

## Governance

### Configurable Approval Workflows

Admins can configure approval requirements per Cloud Account:
- **No approval** — Any workspace member with the right role can launch immediately
- **Require approval** — Designated approvers must approve before provisioning begins

Approval uses Temporal Signals:
- Workflow blocks with `AwaitWithTimeout` (configurable timeout, default 24h)
- Approver sends `ApprovalSignal` via the UI
- On timeout → Launch is automatically aborted

---

## Related Documents

- `docs/plans/2026-03-02-deployment-primitive-rethink.md` — Future work to refine/rename the Deployment primitive
- [temporalio/temporal-demo-infra](https://github.com/temporalio/temporal-demo-infra) — Reference architecture for Temporal + Pulumi
