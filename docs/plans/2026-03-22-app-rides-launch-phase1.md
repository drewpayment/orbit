# App Rides Launch — Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable deploying an Application's built assets to infrastructure provisioned by a Launch (GCS Static Site for MVP).

**Architecture:** Add a `launch` relationship + `deployStrategy` + `launchOutputs` fields to Deployments. Extend the Add Deployment modal to select a Launch and auto-detect the strategy. Add a `DeployToLaunch` gRPC method that starts a `DeployToLaunchWorkflow` on the `launches_gcp` task queue. The workflow clones the repo, builds it, and uploads static assets to the GCS bucket from the Launch's outputs.

**Tech Stack:** Payload CMS (MongoDB), Next.js 15, React 19, Temporal, Connect/gRPC (Go + TypeScript), @google-cloud/storage, Pulumi (existing), Protocol Buffers.

**Design doc:** `docs/plans/2026-03-22-app-rides-launch-design.md`

---

### Task 1: Data Model — Add 3 new fields to Deployments collection

**Files:**
- Modify: `orbit-www/src/collections/Deployments.ts`

**Step 1: Add fields after the existing `generator` field (line ~153)**

Add these 3 fields to the `fields` array, after `generatorSlug`:

```typescript
{
  name: 'launch',
  type: 'relationship',
  relationTo: 'launches',
  admin: {
    description: 'Launch infrastructure this deployment targets',
  },
},
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
    description: 'Deployment strategy — auto-detected from Launch template when applicable',
  },
},
{
  name: 'launchOutputs',
  type: 'json',
  admin: {
    description: 'Snapshot of Launch infrastructure outputs at deploy time',
    readOnly: true,
  },
},
```

**Step 2: Make `generator` field not required** (since Launch-based deploys don't use generators)

Change line ~144 from `required: true` to:
```typescript
required: false,
```

**Step 3: Verify**

Run: `cd orbit-www && bun run dev` — confirm no TypeScript errors, check admin panel at `/admin/collections/deployments` shows new fields.

**Step 4: Commit**
```
feat(deployments): add launch, deployStrategy, launchOutputs fields
```

---

### Task 2: Internal API — Deployment status update route

**Files:**
- Create: `orbit-www/src/app/api/internal/deployments/[id]/status/route.ts`

**Step 1: Create the route**

Follow the exact pattern from `orbit-www/src/app/api/internal/launches/[id]/status/route.ts`.

```typescript
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

const INTERNAL_API_KEY = process.env.ORBIT_INTERNAL_API_KEY

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const apiKey = request.headers.get('X-API-Key')
  if (!INTERNAL_API_KEY || apiKey !== INTERNAL_API_KEY) {
    return NextResponse.json(
      { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      { status: 401 }
    )
  }

  try {
    const { id } = await params
    const body = await request.json()
    const { status, error: deployError, url, lastDeployedAt } = body

    if (!status) {
      return NextResponse.json(
        { error: 'status required', code: 'BAD_REQUEST' },
        { status: 400 }
      )
    }

    const validStatuses = ['pending', 'deploying', 'generated', 'deployed', 'failed']
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`, code: 'BAD_REQUEST' },
        { status: 400 }
      )
    }

    const payload = await getPayload({ config: configPromise })

    const data: Record<string, unknown> = { status }
    if (deployError !== undefined) data.deploymentError = deployError || null
    if (url) data.target = { type: 'launch', url }
    if (lastDeployedAt) data.lastDeployedAt = lastDeployedAt

    const updated = await payload.update({
      collection: 'deployments',
      id,
      data,
      overrideAccess: true,
    })

    return NextResponse.json({
      success: true,
      deployment: { id: updated.id, status: updated.status },
    })
  } catch (error) {
    console.error('[Internal API] Deployment status update error:', error)

    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json(
        { error: 'Deployment not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
```

**Step 2: Test manually**

```bash
curl -s http://localhost:3000/api/internal/deployments/nonexistent/status \
  -X PATCH -H "Content-Type: application/json" -H "X-API-Key: orbit-internal-dev-key" \
  -d '{"status":"deployed"}'
```
Expected: 404 (deployment not found)

**Step 3: Commit**
```
feat(api): add internal deployment status update route
```

---

### Task 3: Proto + Code Generation — DeployToLaunch RPC

**Files:**
- Modify: `proto/idp/launch/v1/launch.proto`

**Step 1: Add new RPC method and messages to the proto file**

Add to the `LaunchService` service block:
```protobuf
rpc DeployToLaunch(DeployToLaunchRequest) returns (DeployToLaunchResponse);
```

Add new messages after `AbortLaunchResponse`:
```protobuf
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

**Step 2: Generate code**

Run: `make proto-gen`

This generates both Go (`proto/gen/go/`) and TypeScript (`orbit-www/src/lib/proto/`) code.

**Step 3: Commit**
```
feat(proto): add DeployToLaunch RPC method
```

---

### Task 4: Go gRPC Server — Handle DeployToLaunch

**Files:**
- Modify: `services/repository/internal/grpc/launch_server.go`
- Modify: `services/repository/cmd/server/main.go`
- Modify: `temporal-workflows/pkg/types/launch_types.go`

**Step 1: Add DeployToLaunchInput struct and interface method to launch_server.go**

Add to `LaunchClientInterface`:
```go
StartDeployToLaunchWorkflow(ctx context.Context, input *DeployToLaunchInput) (string, error)
```

Add new struct:
```go
type DeployToLaunchInput struct {
	DeploymentID    string
	LaunchID        string
	Strategy        string
	CloudAccountID  string
	Provider        string
	RepoURL         string
	Branch          string
	BuildCommand    string
	OutputDirectory string
	LaunchOutputs   map[string]interface{}
}
```

Add handler method to `LaunchServer`:
```go
func (s *LaunchServer) DeployToLaunch(ctx context.Context, req *connect.Request[launchv1.DeployToLaunchRequest]) (*connect.Response[launchv1.DeployToLaunchResponse], error) {
	msg := req.Msg

	if msg.DeploymentId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("deployment_id is required"))
	}
	if msg.LaunchId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("launch_id is required"))
	}
	if msg.Strategy == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("strategy is required"))
	}

	var launchOutputs map[string]interface{}
	if msg.LaunchOutputs != nil {
		launchOutputs = msg.LaunchOutputs.AsMap()
	}

	input := &DeployToLaunchInput{
		DeploymentID:    msg.DeploymentId,
		LaunchID:        msg.LaunchId,
		Strategy:        msg.Strategy,
		CloudAccountID:  msg.CloudAccountId,
		Provider:        msg.Provider,
		RepoURL:         msg.RepoUrl,
		Branch:          msg.Branch,
		BuildCommand:    msg.BuildCommand,
		OutputDirectory: msg.OutputDirectory,
		LaunchOutputs:   launchOutputs,
	}

	workflowID, err := s.temporalClient.StartDeployToLaunchWorkflow(ctx, input)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to start deploy-to-launch workflow: %w", err))
	}

	return connect.NewResponse(&launchv1.DeployToLaunchResponse{
		WorkflowId: workflowID,
		Success:    true,
	}), nil
}
```

**Step 2: Add Go types for the workflow input**

In `temporal-workflows/pkg/types/launch_types.go`, add:
```go
// DeployToLaunchInput contains parameters for deploying an app to Launch infrastructure
type DeployToLaunchInput struct {
	DeploymentID    string                 `json:"deploymentId"`
	LaunchID        string                 `json:"launchId"`
	Strategy        string                 `json:"strategy"`
	CloudAccountID  string                 `json:"cloudAccountId"`
	Provider        string                 `json:"provider"`
	RepoURL         string                 `json:"repoUrl"`
	Branch          string                 `json:"branch"`
	BuildCommand    string                 `json:"buildCommand"`
	OutputDirectory string                 `json:"outputDirectory"`
	LaunchOutputs   map[string]interface{} `json:"launchOutputs"`
}

// DeployToLaunchResult contains the result of a deploy-to-launch operation
type DeployToLaunchResult struct {
	DeployedURL string   `json:"deployedUrl"`
	FilesCount  int      `json:"filesCount"`
	Summary     []string `json:"summary"`
}

// UpdateDeploymentStatusInput contains data for updating a deployment's status
type UpdateDeploymentStatusInput struct {
	DeploymentID string `json:"deploymentId"`
	Status       string `json:"status"`
	Error        string `json:"error,omitempty"`
	URL          string `json:"url,omitempty"`
}
```

**Step 3: Add TemporalClient implementation in main.go**

In `services/repository/cmd/server/main.go`, add the `StartDeployToLaunchWorkflow` method:
```go
func (tc *TemporalClient) StartDeployToLaunchWorkflow(ctx context.Context, input *grpcserver.DeployToLaunchInput) (string, error) {
	workflowID := fmt.Sprintf("deploy-to-launch-%s-%d", input.DeploymentID, time.Now().Unix())

	taskQueue := fmt.Sprintf("launches_%s", input.Provider)

	workflowInput := types.DeployToLaunchInput{
		DeploymentID:    input.DeploymentID,
		LaunchID:        input.LaunchID,
		Strategy:        input.Strategy,
		CloudAccountID:  input.CloudAccountID,
		Provider:        input.Provider,
		RepoURL:         input.RepoURL,
		Branch:          input.Branch,
		BuildCommand:    input.BuildCommand,
		OutputDirectory: input.OutputDirectory,
		LaunchOutputs:   input.LaunchOutputs,
	}

	we, err := tc.client.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		ID:        workflowID,
		TaskQueue: taskQueue,
	}, "DeployToLaunchWorkflow", workflowInput)

	if err != nil {
		return "", fmt.Errorf("failed to start deploy-to-launch workflow: %w", err)
	}

	return we.GetID(), nil
}
```

**Step 4: Verify Go builds**

Run:
```bash
cd services/repository && go build ./cmd/server
cd temporal-workflows && go build ./cmd/worker
```

**Step 5: Commit**
```
feat(grpc): add DeployToLaunch handler and workflow types
```

---

### Task 5: TypeScript gRPC Client — deployToLaunch function

**Files:**
- Modify: `orbit-www/src/lib/clients/launch-client.ts`

**Step 1: Add the client function**

After the existing imports, add the new schema imports (these will exist after `make proto-gen`):
```typescript
import {
  // ... existing imports ...
  DeployToLaunchRequestSchema,
  type DeployToLaunchResponse,
} from '@/lib/proto/idp/launch/v1/launch_pb'
```

Add the function:
```typescript
export async function deployToLaunch(
  deploymentId: string,
  launchId: string,
  strategy: string,
  cloudAccountId: string,
  provider: string,
  repoUrl: string,
  branch: string,
  buildCommand: string,
  outputDirectory: string,
  launchOutputs: JsonObject,
): Promise<DeployToLaunchResponse> {
  try {
    const request = create(DeployToLaunchRequestSchema, {
      deploymentId,
      launchId,
      strategy,
      cloudAccountId,
      provider,
      repoUrl,
      branch,
      buildCommand,
      outputDirectory,
      launchOutputs,
    })

    return await launchClient.deployToLaunch(request)
  } catch (error) {
    console.error('Failed to start deploy-to-launch workflow:', error)
    throw error
  }
}
```

**Step 2: Commit**
```
feat(client): add deployToLaunch gRPC client function
```

---

### Task 6: Server Actions — createDeployment + startDeployToLaunch

**Files:**
- Modify: `orbit-www/src/app/actions/deployments.ts`

**Step 1: Extend CreateDeploymentInput**

Add optional launch fields:
```typescript
interface CreateDeploymentInput {
  appId: string
  name: string
  generator: 'docker-compose' | 'helm' | 'custom'
  generatorSlug?: string
  config: Record<string, unknown>
  target: {
    type: string
    region?: string
    cluster?: string
    hostUrl?: string
  }
  // New: Launch-based deployment
  launchId?: string
  deployStrategy?: string
}
```

**Step 2: Modify createDeployment to handle Launch-based deployments**

After the workspace membership check, before the `try` block, add Launch resolution:

```typescript
// Resolve Launch if provided
let launchData: { launch: string; deployStrategy: string; launchOutputs: Record<string, unknown> } | null = null
if (input.launchId) {
  const launch = await payload.findByID({
    collection: 'launches',
    id: input.launchId,
    depth: 1,
    overrideAccess: true,
  })

  if (!launch || launch.status !== 'active') {
    return { success: false, error: 'Launch not found or not active' }
  }

  // Auto-detect strategy from template if not provided
  let strategy = input.deployStrategy
  if (!strategy) {
    const template = typeof launch.template === 'string'
      ? await payload.findByID({ collection: 'launch-templates', id: launch.template, depth: 0, overrideAccess: true })
      : launch.template
    if (template) {
      const category = (template as any).category
      strategy = category === 'storage' ? 'gcs-static-site' : 'cloud-run'
    }
  }

  launchData = {
    launch: input.launchId,
    deployStrategy: strategy || 'gcs-static-site',
    launchOutputs: (launch.pulumiOutputs as Record<string, unknown>) || {},
  }
}
```

Then in the `payload.create` call, merge the launch fields:
```typescript
const deployment = await payload.create({
  collection: 'deployments',
  data: {
    name: input.name,
    app: input.appId,
    generator: launchData ? undefined : input.generator,
    generatorSlug: launchData ? undefined : input.generatorSlug,
    config: launchData ? input.config : input.config,
    target: {
      type: launchData ? 'launch' : input.target.type,
      region: input.target.region || '',
      cluster: input.target.cluster || '',
      url: '',
    },
    status: 'pending',
    healthStatus: 'unknown',
    ...(launchData ? {
      launch: launchData.launch,
      deployStrategy: launchData.deployStrategy,
      launchOutputs: launchData.launchOutputs,
    } : {}),
  },
  user: payloadUser,
  overrideAccess: false,
})
```

**Step 3: Add startDeployToLaunch server action**

```typescript
export async function startDeployToLaunch(deploymentId: string) {
  const payloadUser = await getPayloadUserFromSession()
  if (!payloadUser) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  const deployment = await payload.findByID({
    collection: 'deployments',
    id: deploymentId,
    depth: 2,
    overrideAccess: true,
  })

  if (!deployment) {
    return { success: false, error: 'Deployment not found' }
  }

  if (!deployment.launch) {
    return { success: false, error: 'Deployment is not linked to a Launch' }
  }

  const launch = typeof deployment.launch === 'string'
    ? await payload.findByID({ collection: 'launches', id: deployment.launch, depth: 1, overrideAccess: true })
    : deployment.launch

  if (!launch || launch.status !== 'active') {
    return { success: false, error: 'Launch is not active' }
  }

  const app = typeof deployment.app === 'string'
    ? await payload.findByID({ collection: 'apps', id: deployment.app, depth: 0, overrideAccess: true })
    : deployment.app

  if (!app) {
    return { success: false, error: 'App not found' }
  }

  const cloudAccountId = typeof launch.cloudAccount === 'string' ? launch.cloudAccount : launch.cloudAccount.id

  try {
    const { deployToLaunch } = await import('@/lib/clients/launch-client')

    const response = await deployToLaunch(
      deploymentId,
      typeof deployment.launch === 'string' ? deployment.launch : deployment.launch.id,
      deployment.deployStrategy || 'gcs-static-site',
      cloudAccountId,
      launch.provider,
      app.repository?.url || '',
      app.repository?.branch || 'main',
      (deployment.config as any)?.buildCommand || 'npm run build',
      (deployment.config as any)?.outputDirectory || 'out',
      (deployment.launchOutputs || launch.pulumiOutputs || {}) as JsonObject,
    )

    if (!response.success) {
      return { success: false, error: response.error || 'Failed to start deploy workflow' }
    }

    await payload.update({
      collection: 'deployments',
      id: deploymentId,
      data: {
        workflowId: response.workflowId,
        status: 'deploying',
        lastDeployedAt: new Date().toISOString(),
      },
      overrideAccess: true,
    })

    return { success: true, workflowId: response.workflowId }
  } catch (error) {
    console.error('Failed to start deploy-to-launch:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to start deployment'

    await payload.update({
      collection: 'deployments',
      id: deploymentId,
      data: { status: 'failed', deploymentError: errorMessage },
      overrideAccess: true,
    })

    return { success: false, error: errorMessage }
  }
}
```

**Step 4: Add import for JsonObject at top of file** (if not already imported)

**Step 5: Commit**
```
feat(actions): extend createDeployment for Launches, add startDeployToLaunch
```

---

### Task 7: UI — Add Deployment Modal with Launch selection

**Files:**
- Modify: `orbit-www/src/components/features/apps/AddDeploymentModal.tsx`
- Modify: `orbit-www/src/app/actions/deployments.ts` (add `getActiveLaunches` action)

**Step 1: Add server action to fetch active launches for a workspace**

In `deployments.ts`, add:
```typescript
export async function getActiveLaunchesForWorkspace(workspaceId: string) {
  const payloadUser = await getPayloadUserFromSession()
  if (!payloadUser) return { success: false, launches: [] }

  const payload = await getPayload({ config })

  const launches = await payload.find({
    collection: 'launches',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { status: { equals: 'active' } },
      ],
    },
    depth: 1,
    overrideAccess: true,
    limit: 50,
  })

  return {
    success: true,
    launches: launches.docs.map(l => ({
      id: l.id,
      name: l.name,
      provider: l.provider,
      region: l.region,
      pulumiOutputs: l.pulumiOutputs,
      templateCategory: typeof l.template === 'object' ? (l.template as any)?.category : null,
      templateType: typeof l.template === 'object' ? (l.template as any)?.type : null,
      templateName: typeof l.template === 'object' ? (l.template as any)?.name : null,
    })),
  }
}
```

**Step 2: Update AddDeploymentModal props to accept workspaceId**

```typescript
interface AddDeploymentModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  appId: string
  appName: string
  workspaceId: string  // NEW
}
```

**Step 3: Add Launch selection state and fetching**

Add state:
```typescript
const [launches, setLaunches] = useState<Array<{
  id: string; name: string; provider: string; region: string;
  pulumiOutputs: Record<string, unknown> | null;
  templateCategory: string | null; templateType: string | null; templateName: string | null;
}>>([])
const [selectedLaunchId, setSelectedLaunchId] = useState<string>('')
const [loadingLaunches, setLoadingLaunches] = useState(true)
```

Fetch launches in the existing `useEffect`:
```typescript
getActiveLaunchesForWorkspace(workspaceId).then((result) => {
  if (result.success) setLaunches(result.launches)
  setLoadingLaunches(false)
})
```

**Step 4: Add Launch selection UI before the Deployment Method field**

```tsx
{launches.length > 0 && (
  <FormItem>
    <FormLabel>Deploy to Launch (optional)</FormLabel>
    <Select value={selectedLaunchId} onValueChange={(v) => {
      setSelectedLaunchId(v)
      if (v) {
        const launch = launches.find(l => l.id === v)
        const strategy = launch?.templateCategory === 'storage' ? 'gcs-static-site' : 'cloud-run'
        form.setValue('generator', strategy as any)
      } else {
        form.setValue('generator', 'docker-compose')
      }
    }}>
      <SelectTrigger>
        <SelectValue placeholder="Select a Launch (or skip for config-file deploy)" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="">None (generate config files)</SelectItem>
        {launches.map(l => (
          <SelectItem key={l.id} value={l.id}>
            {l.name} — {l.provider.toUpperCase()} ({l.templateName || 'unknown'})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </FormItem>
)}
```

**Step 5: Add GCS Static Site form fields when strategy is selected**

```tsx
{selectedLaunchId && form.watch('generator') === 'gcs-static-site' && (() => {
  const launch = launches.find(l => l.id === selectedLaunchId)
  const bucketName = launch?.pulumiOutputs?.bucketName as string
  return (
    <>
      <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
        Deploy static assets to GCS bucket <code className="font-mono text-xs">{bucketName}</code>
      </div>
      <FormField control={form.control} name="buildCommand" render={({ field }) => (
        <FormItem>
          <FormLabel>Build Command</FormLabel>
          <FormControl><Input placeholder="npm run build" {...field} /></FormControl>
        </FormItem>
      )} />
      <FormField control={form.control} name="outputDirectory" render={({ field }) => (
        <FormItem>
          <FormLabel>Output Directory</FormLabel>
          <FormControl><Input placeholder="out" {...field} /></FormControl>
          <FormDescription>Directory containing built static files</FormDescription>
        </FormItem>
      )} />
    </>
  )
})()}
```

**Step 6: Update form schema** to include the new fields:
```typescript
buildCommand: z.string().optional(),
outputDirectory: z.string().optional(),
```

And default values:
```typescript
buildCommand: 'npm run build',
outputDirectory: 'out',
```

**Step 7: Update onSubmit** to handle Launch-based deployments:

When `selectedLaunchId` is set, call `createDeployment` with `launchId` and `deployStrategy`, then immediately call `startDeployToLaunch` with the returned deployment ID.

**Step 8: Update parent component** to pass `workspaceId` prop (find where `AddDeploymentModal` is rendered and add the prop).

**Step 9: Commit**
```
feat(ui): add Launch selection to Add Deployment modal
```

---

### Task 8: GCP Worker — DeployStaticSite activity

**Files:**
- Create: `launches-worker-gcp/src/activities/deploy-static-site.ts`
- Modify: `launches-worker-gcp/src/activities/index.ts`
- Modify: `launches-worker-gcp/src/types.ts`

**Step 1: Add types**

In `launches-worker-gcp/src/types.ts`:
```typescript
export interface DeployToLaunchInput {
  deploymentId: string;
  launchId: string;
  strategy: string;
  cloudAccountId: string;
  provider: string;
  repoUrl: string;
  branch: string;
  buildCommand: string;
  outputDirectory: string;
  launchOutputs: Record<string, unknown>;
}

export interface DeployToLaunchResult {
  deployedUrl: string;
  filesCount: number;
  summary: string[];
}

export interface UpdateDeploymentStatusInput {
  deploymentId: string;
  status: string;
  error?: string;
  url?: string;
}
```

**Step 2: Install @google-cloud/storage**

Run: `cd launches-worker-gcp && npm install @google-cloud/storage`

**Step 3: Create deploy-static-site.ts**

```typescript
import { Context } from "@temporalio/activity";
import { Storage } from "@google-cloud/storage";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { DeployToLaunchInput, DeployToLaunchResult } from "../types";

export async function deployStaticSite(
  input: DeployToLaunchInput
): Promise<DeployToLaunchResult> {
  const ctx = Context.current();
  const logger = ctx.log;
  const bucketName = input.launchOutputs.bucketName as string;

  if (!bucketName) {
    throw new Error("Launch outputs missing bucketName");
  }

  logger.info("Starting static site deployment", {
    deploymentId: input.deploymentId,
    repoUrl: input.repoUrl,
    bucket: bucketName,
  });

  const heartbeatInterval = setInterval(() => {
    ctx.heartbeat("deploying static site");
  }, 5000);

  const workDir = path.join(os.tmpdir(), `deploy-${input.deploymentId}`);

  try {
    // Clone repo
    logger.info(`Cloning ${input.repoUrl} (branch: ${input.branch})`);
    execSync(
      `git clone --depth 1 --branch ${input.branch} ${input.repoUrl} ${workDir}`,
      { stdio: "pipe", timeout: 120000 }
    );

    // Install dependencies
    logger.info("Installing dependencies");
    const hasYarnLock = fs.existsSync(path.join(workDir, "yarn.lock"));
    const hasPnpmLock = fs.existsSync(path.join(workDir, "pnpm-lock.yaml"));
    const hasBunLock = fs.existsSync(path.join(workDir, "bun.lockb"));

    let installCmd = "npm ci";
    if (hasBunLock) installCmd = "bun install --frozen-lockfile";
    else if (hasPnpmLock) installCmd = "npx pnpm install --frozen-lockfile";
    else if (hasYarnLock) installCmd = "yarn install --frozen-lockfile";

    execSync(installCmd, { cwd: workDir, stdio: "pipe", timeout: 300000 });

    // Build
    logger.info(`Running build: ${input.buildCommand}`);
    execSync(input.buildCommand, {
      cwd: workDir,
      stdio: "pipe",
      timeout: 600000,
      env: { ...process.env, NODE_ENV: "production" },
    });

    // Find output directory
    const outputDir = path.join(workDir, input.outputDirectory);
    if (!fs.existsSync(outputDir)) {
      throw new Error(
        `Output directory '${input.outputDirectory}' not found after build. ` +
        `Available directories: ${fs.readdirSync(workDir).filter(f => fs.statSync(path.join(workDir, f)).isDirectory()).join(", ")}`
      );
    }

    // Upload to GCS
    logger.info(`Uploading to gs://${bucketName}`);
    const storage = new Storage();
    const bucket = storage.bucket(bucketName);

    let filesCount = 0;
    const uploadDir = async (dir: string, prefix: string = "") => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const destination = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await uploadDir(fullPath, destination);
        } else {
          await bucket.upload(fullPath, {
            destination,
            metadata: {
              cacheControl: entry.name.match(/\.(js|css|woff2?|png|jpg|svg|ico)$/)
                ? "public, max-age=31536000, immutable"
                : "public, max-age=60",
            },
          });
          filesCount++;
        }
      }
    };

    await uploadDir(outputDir);

    const websiteUrl =
      (input.launchOutputs.websiteUrl as string) ||
      `https://storage.googleapis.com/${bucketName}/index.html`;

    logger.info(`Deployment complete: ${filesCount} files uploaded to ${websiteUrl}`);

    return {
      deployedUrl: websiteUrl,
      filesCount,
      summary: [`Uploaded ${filesCount} files to gs://${bucketName}`, `URL: ${websiteUrl}`],
    };
  } finally {
    clearInterval(heartbeatInterval);
    // Cleanup
    if (fs.existsSync(workDir)) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
}
```

**Step 4: Add updateDeploymentStatus activity**

Create `launches-worker-gcp/src/activities/update-deployment-status.ts`:
```typescript
import type { UpdateDeploymentStatusInput } from "../types";

const ORBIT_API_URL = process.env.ORBIT_API_URL || "http://host.docker.internal:3000";
const ORBIT_INTERNAL_API_KEY = process.env.ORBIT_INTERNAL_API_KEY || "orbit-internal-dev-key";

export async function updateDeploymentStatus(
  input: UpdateDeploymentStatusInput
): Promise<void> {
  const body: Record<string, unknown> = { status: input.status };
  if (input.error) body.error = input.error;
  if (input.url) body.url = input.url;
  if (input.status === "deployed") body.lastDeployedAt = new Date().toISOString();

  const response = await fetch(
    `${ORBIT_API_URL}/api/internal/deployments/${input.deploymentId}/status`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": ORBIT_INTERNAL_API_KEY,
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to update deployment status: ${response.status}`);
  }
}
```

**Step 5: Export new activities**

In `launches-worker-gcp/src/activities/index.ts`, add:
```typescript
export { deployStaticSite } from './deploy-static-site'
export { updateDeploymentStatus } from './update-deployment-status'
```

**Step 6: Add ORBIT_API_URL and ORBIT_INTERNAL_API_KEY to docker-compose.yml** for the GCP launches worker:
```yaml
- ORBIT_API_URL=http://host.docker.internal:3000
- ORBIT_INTERNAL_API_KEY=${ORBIT_INTERNAL_API_KEY:-orbit-internal-dev-key}
```

**Step 7: Add git to the Dockerfile** (needed for `git clone`):

In `launches-worker-gcp/Dockerfile`, add after the Pulumi install:
```dockerfile
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
```

(Combine with existing apt-get if possible)

**Step 8: Commit**
```
feat(worker): add deployStaticSite and updateDeploymentStatus activities
```

---

### Task 9: GCP Worker — DeployToLaunchWorkflow (Temporal)

**Files:**
- Modify: `temporal-workflows/internal/workflows/launch_workflow.go` (or create new file)

The `DeployToLaunchWorkflow` is dispatched to the `launches_gcp` task queue. However, unlike `LaunchWorkflow` which is defined in Go and dispatches `provisionInfra` to the TS worker, here the **entire workflow runs in TypeScript** on the launches worker since all activities are TypeScript.

**Step 1: Create the workflow in the GCP worker**

Create `launches-worker-gcp/src/workflows/deploy-to-launch.ts`:
```typescript
import {
  proxyActivities,
  defineQuery,
  setHandler,
  sleep,
} from "@temporalio/workflow";
import type { DeployToLaunchInput, DeployToLaunchResult, UpdateDeploymentStatusInput } from "../types";

const { deployStaticSite, updateDeploymentStatus } = proxyActivities<{
  deployStaticSite: (input: DeployToLaunchInput) => Promise<DeployToLaunchResult>;
  updateDeploymentStatus: (input: UpdateDeploymentStatusInput) => Promise<void>;
}>({
  startToCloseTimeout: "30 minutes",
  heartbeatTimeout: "30 seconds",
  retry: { maximumAttempts: 2 },
});

const statusUpdate = proxyActivities<{
  updateDeploymentStatus: (input: UpdateDeploymentStatusInput) => Promise<void>;
}>({
  startToCloseTimeout: "15 seconds",
  retry: { maximumAttempts: 5 },
});

interface DeployProgress {
  status: string;
  message: string;
  percentage: number;
}

export const getDeployProgress = defineQuery<DeployProgress>("GetDeployProgress");

export async function DeployToLaunchWorkflow(
  input: DeployToLaunchInput
): Promise<void> {
  let progress: DeployProgress = {
    status: "initializing",
    message: "Starting deployment",
    percentage: 0,
  };

  setHandler(getDeployProgress, () => progress);

  // Step 1: Update status to deploying
  progress = { status: "deploying", message: "Preparing deployment", percentage: 10 };
  await statusUpdate.updateDeploymentStatus({
    deploymentId: input.deploymentId,
    status: "deploying",
  });

  // Step 2: Run strategy-specific deployment
  progress = { status: "deploying", message: "Building and deploying", percentage: 30 };

  try {
    let result: DeployToLaunchResult;

    if (input.strategy === "gcs-static-site") {
      result = await deployStaticSite(input);
    } else {
      throw new Error(`Unsupported strategy: ${input.strategy}`);
    }

    // Step 3: Mark as deployed
    progress = { status: "deployed", message: `Deployed: ${result.deployedUrl}`, percentage: 100 };
    await statusUpdate.updateDeploymentStatus({
      deploymentId: input.deploymentId,
      status: "deployed",
      url: result.deployedUrl,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    progress = { status: "failed", message: errorMessage, percentage: 0 };
    await statusUpdate.updateDeploymentStatus({
      deploymentId: input.deploymentId,
      status: "failed",
      error: errorMessage,
    });
    throw error;
  }
}
```

**Step 2: Register the workflow in the worker**

Modify `launches-worker-gcp/src/worker.ts`:
```typescript
import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities";
import * as path from "path";

async function run() {
  const temporalAddress = process.env.TEMPORAL_ADDRESS || "localhost:7233";
  const namespace = process.env.TEMPORAL_NAMESPACE || "default";
  const taskQueue = process.env.TASK_QUEUE || "launches_gcp";

  console.log(`Connecting to Temporal at ${temporalAddress}`);

  const connection = await NativeConnection.connect({
    address: temporalAddress,
  });

  const worker = await Worker.create({
    connection,
    namespace,
    activities,
    taskQueue,
    workflowsPath: path.resolve(__dirname, "workflows"),
  });

  console.log(`GCP worker started, listening on task queue: ${taskQueue}`);
  await worker.run();
}

run().catch((err) => {
  console.error("GCP worker failed:", err);
  process.exit(1);
});
```

Key change: added `workflowsPath` pointing to the workflows directory so Temporal can discover and run `DeployToLaunchWorkflow`.

**Step 3: Create workflows index**

Create `launches-worker-gcp/src/workflows/index.ts`:
```typescript
export { DeployToLaunchWorkflow } from './deploy-to-launch'
```

**Step 4: Rebuild and test**

```bash
docker compose -f docker-compose.yml up -d --build launches-worker-gcp
docker logs orbit-launches-worker-gcp --tail 5
```

Expected: Worker starts without errors, logs show workflow registration.

**Step 5: Commit**
```
feat(workflow): add DeployToLaunchWorkflow for GCS static site deployment
```

---

### Task 10: End-to-End Test — Deploy cfp-stats to GCS

**Preconditions:**
- Active Launch with GCS bucket (already exists from previous work)
- cfp-stats Application in Orbit (already exists)
- All services running

**Step 1: Rebuild all changed containers**

```bash
docker compose -f docker-compose.yml up -d --build repository-service temporal-worker launches-worker-gcp
```

**Step 2: Test via UI**

1. Navigate to the cfp-stats Application page
2. Click "Add Deployment"
3. Select the active Launch from the dropdown
4. Verify strategy auto-detects to "GCS Static Site"
5. Set build command and output directory
6. Click "Create Deployment"
7. Watch deployment progress

**Step 3: Verify in GCP**

Check that files were uploaded to the GCS bucket:
```bash
gsutil ls gs://cfb-stats-69bf6112/
```

Or visit the website URL from the Launch outputs.

**Step 4: Commit all remaining changes**
```
feat: app rides launch — Phase 1 complete
```

---

## Summary of All Files

### New Files (6)
- `orbit-www/src/app/api/internal/deployments/[id]/status/route.ts`
- `launches-worker-gcp/src/activities/deploy-static-site.ts`
- `launches-worker-gcp/src/activities/update-deployment-status.ts`
- `launches-worker-gcp/src/workflows/deploy-to-launch.ts`
- `launches-worker-gcp/src/workflows/index.ts`

### Modified Files (10)
- `proto/idp/launch/v1/launch.proto`
- `orbit-www/src/collections/Deployments.ts`
- `orbit-www/src/lib/clients/launch-client.ts`
- `orbit-www/src/app/actions/deployments.ts`
- `orbit-www/src/components/features/apps/AddDeploymentModal.tsx`
- `services/repository/internal/grpc/launch_server.go`
- `services/repository/cmd/server/main.go`
- `temporal-workflows/pkg/types/launch_types.go`
- `launches-worker-gcp/src/worker.ts`
- `launches-worker-gcp/src/types.ts`
- `docker-compose.yml`
- `launches-worker-gcp/Dockerfile`
- `launches-worker-gcp/package.json`
