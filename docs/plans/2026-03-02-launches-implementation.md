# Launches Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the Launches feature — a new primitive for provisioning cloud infrastructure via Pulumi, orchestrated by Temporal workflows, with a multi-step wizard UI.

**Architecture:** Polyglot Temporal workers — Go workflow orchestrates the launch lifecycle, TypeScript workers execute Pulumi programs per cloud provider. Payload CMS stores Launches, Launch Templates, and Cloud Accounts. Frontend uses Connect-ES gRPC clients to trigger workflows and poll progress.

**Tech Stack:** Go 1.21+ (Temporal SDK v1.40.0), TypeScript (Temporal SDK v1.15.0, Pulumi Automation API), Payload 3.0, Next.js 15, React 19, Connect-ES, Protocol Buffers

**Design doc:** `docs/plans/2026-03-02-launches-design.md`

---

## Phase 1: Data Model & Proto Definitions

### Task 1: Create CloudAccounts Payload Collection

**Files:**
- Create: `orbit-www/src/collections/CloudAccounts.ts`
- Modify: `orbit-www/src/payload.config.ts`

**Step 1: Write the collection**

Create `orbit-www/src/collections/CloudAccounts.ts`:

```typescript
import type { CollectionConfig, Where } from 'payload'

export const CloudAccounts: CollectionConfig = {
  slug: 'cloud-accounts',
  admin: {
    useAsTitle: 'name',
    group: 'Infrastructure',
    defaultColumns: ['name', 'provider', 'status', 'updatedAt'],
  },
  access: {
    read: async ({ req: { user } }) => {
      if (!user) return false
      // Platform admins see all
      if (user.role === 'admin') return true
      // Workspace members see accounts linked to their workspaces
      const members = await req.payload.find({
        collection: 'workspace-members',
        where: { user: { equals: user.id }, status: { equals: 'active' } },
        overrideAccess: true,
      })
      const workspaceIds = members.docs.map((m) =>
        typeof m.workspace === 'string' ? m.workspace : m.workspace.id,
      )
      if (workspaceIds.length === 0) return false
      return {
        workspaces: { in: workspaceIds },
      } satisfies Where
    },
    create: async ({ req: { user } }) => {
      return user?.role === 'admin'
    },
    update: async ({ req: { user } }) => {
      return user?.role === 'admin'
    },
    delete: async ({ req: { user } }) => {
      return user?.role === 'admin'
    },
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'provider',
      type: 'select',
      required: true,
      options: [
        { label: 'AWS', value: 'aws' },
        { label: 'Google Cloud', value: 'gcp' },
        { label: 'Azure', value: 'azure' },
        { label: 'DigitalOcean', value: 'digitalocean' },
      ],
    },
    {
      name: 'credentials',
      type: 'json',
      required: true,
      admin: {
        description: 'Provider-specific credentials (encrypted at rest)',
        condition: (data, siblingData, { user }) => user?.role === 'admin',
      },
    },
    {
      name: 'region',
      type: 'text',
      admin: {
        description: 'Default region for this account',
      },
    },
    {
      name: 'workspaces',
      type: 'relationship',
      relationTo: 'workspaces',
      hasMany: true,
      required: true,
      admin: {
        description: 'Workspaces that can use this cloud account',
      },
    },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'disconnected',
      options: [
        { label: 'Connected', value: 'connected' },
        { label: 'Disconnected', value: 'disconnected' },
        { label: 'Error', value: 'error' },
      ],
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'lastValidatedAt',
      type: 'date',
      admin: {
        position: 'sidebar',
        readOnly: true,
      },
    },
    {
      name: 'approvalRequired',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description: 'Require approval before launches using this account',
      },
    },
    {
      name: 'approvers',
      type: 'relationship',
      relationTo: 'users',
      hasMany: true,
      admin: {
        description: 'Users who can approve launches on this account',
        condition: (data) => data?.approvalRequired === true,
      },
    },
    {
      name: 'createdBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        position: 'sidebar',
        readOnly: true,
      },
    },
  ],
  timestamps: true,
}
```

**Step 2: Register in Payload config**

Modify `orbit-www/src/payload.config.ts`:
- Add import: `import { CloudAccounts } from './collections/CloudAccounts'`
- Add `CloudAccounts,` to the `collections` array in the Infrastructure group

**Step 3: Verify**

Run: `cd orbit-www && pnpm build`
Expected: Build succeeds with new collection registered

**Step 4: Commit**

```bash
git add orbit-www/src/collections/CloudAccounts.ts orbit-www/src/payload.config.ts
git commit -m "feat(launches): add CloudAccounts Payload collection"
```

---

### Task 2: Create LaunchTemplates Payload Collection

**Files:**
- Create: `orbit-www/src/collections/LaunchTemplates.ts`
- Modify: `orbit-www/src/payload.config.ts`

**Step 1: Write the collection**

Create `orbit-www/src/collections/LaunchTemplates.ts`:

```typescript
import type { CollectionConfig } from 'payload'

export const LaunchTemplates: CollectionConfig = {
  slug: 'launch-templates',
  admin: {
    useAsTitle: 'name',
    group: 'Infrastructure',
    defaultColumns: ['name', 'type', 'provider', 'category'],
  },
  access: {
    read: () => true,
    create: async ({ req: { user } }) => user?.role === 'admin',
    update: async ({ req: { user } }) => user?.role === 'admin',
    delete: async ({ req: { user } }) => user?.role === 'admin',
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
    },
    {
      name: 'description',
      type: 'textarea',
      required: true,
    },
    {
      name: 'type',
      type: 'select',
      required: true,
      options: [
        { label: 'Solution Bundle', value: 'bundle' },
        { label: 'Individual Resource', value: 'resource' },
      ],
    },
    {
      name: 'provider',
      type: 'select',
      required: true,
      options: [
        { label: 'AWS', value: 'aws' },
        { label: 'Google Cloud', value: 'gcp' },
        { label: 'Azure', value: 'azure' },
        { label: 'DigitalOcean', value: 'digitalocean' },
      ],
    },
    {
      name: 'crossProviderSlugs',
      type: 'json',
      admin: {
        description: 'Array of template slugs for equivalent templates on other providers',
      },
    },
    {
      name: 'category',
      type: 'select',
      required: true,
      options: [
        { label: 'Compute', value: 'compute' },
        { label: 'Storage', value: 'storage' },
        { label: 'Database', value: 'database' },
        { label: 'Networking', value: 'networking' },
        { label: 'Container', value: 'container' },
        { label: 'Serverless', value: 'serverless' },
      ],
    },
    {
      name: 'parameterSchema',
      type: 'json',
      required: true,
      admin: {
        description: 'JSON Schema defining the parameters users must provide',
      },
    },
    {
      name: 'pulumiProjectPath',
      type: 'text',
      required: true,
      admin: {
        description: 'Path to the Pulumi program within the provider worker (e.g., bundles/web-app-backend)',
      },
    },
    {
      name: 'estimatedDuration',
      type: 'text',
      admin: {
        description: 'Estimated provisioning time (e.g., "~5 min")',
      },
    },
    {
      name: 'builtIn',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'icon',
      type: 'text',
      admin: {
        description: 'Icon identifier for the UI (e.g., "database", "server", "globe")',
        position: 'sidebar',
      },
    },
  ],
  timestamps: true,
}
```

**Step 2: Register in Payload config**

Modify `orbit-www/src/payload.config.ts`:
- Add import: `import { LaunchTemplates } from './collections/LaunchTemplates'`
- Add `LaunchTemplates,` to the `collections` array

**Step 3: Verify**

Run: `cd orbit-www && pnpm build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add orbit-www/src/collections/LaunchTemplates.ts orbit-www/src/payload.config.ts
git commit -m "feat(launches): add LaunchTemplates Payload collection"
```

---

### Task 3: Create Launches Payload Collection

**Files:**
- Create: `orbit-www/src/collections/Launches.ts`
- Modify: `orbit-www/src/payload.config.ts`

**Step 1: Write the collection**

Create `orbit-www/src/collections/Launches.ts`:

```typescript
import type { CollectionConfig, Where } from 'payload'

export const Launches: CollectionConfig = {
  slug: 'launches',
  admin: {
    useAsTitle: 'name',
    group: 'Infrastructure',
    defaultColumns: ['name', 'provider', 'status', 'region', 'updatedAt'],
  },
  access: {
    read: async ({ req: { user, payload } }) => {
      if (!user) return false
      const members = await payload.find({
        collection: 'workspace-members',
        where: { user: { equals: user.id }, status: { equals: 'active' } },
        overrideAccess: true,
      })
      const workspaceIds = members.docs.map((m) =>
        typeof m.workspace === 'string' ? m.workspace : m.workspace.id,
      )
      if (workspaceIds.length === 0) return false
      return {
        workspace: { in: workspaceIds },
      } satisfies Where
    },
    create: async ({ req: { user } }) => !!user,
    update: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false
      const launch = await payload.findByID({
        collection: 'launches',
        id,
        overrideAccess: true,
      })
      const workspaceId =
        typeof launch.workspace === 'string' ? launch.workspace : launch.workspace.id
      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: workspaceId } },
            { user: { equals: user.id } },
            { status: { equals: 'active' } },
            { role: { in: ['owner', 'admin', 'member'] } },
          ],
        },
        overrideAccess: true,
      })
      return members.docs.length > 0
    },
    delete: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false
      const launch = await payload.findByID({
        collection: 'launches',
        id,
        overrideAccess: true,
      })
      const workspaceId =
        typeof launch.workspace === 'string' ? launch.workspace : launch.workspace.id
      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: workspaceId } },
            { user: { equals: user.id } },
            { status: { equals: 'active' } },
            { role: { in: ['owner', 'admin'] } },
          ],
        },
        overrideAccess: true,
      })
      return members.docs.length > 0
    },
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
    },
    {
      name: 'app',
      type: 'relationship',
      relationTo: 'apps',
      admin: {
        description: 'Optional — link this launch to an app',
      },
    },
    {
      name: 'cloudAccount',
      type: 'relationship',
      relationTo: 'cloud-accounts',
      required: true,
    },
    {
      name: 'template',
      type: 'relationship',
      relationTo: 'launch-templates',
    },
    {
      name: 'provider',
      type: 'select',
      required: true,
      options: [
        { label: 'AWS', value: 'aws' },
        { label: 'Google Cloud', value: 'gcp' },
        { label: 'Azure', value: 'azure' },
        { label: 'DigitalOcean', value: 'digitalocean' },
      ],
    },
    {
      name: 'region',
      type: 'text',
      required: true,
    },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'pending',
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Awaiting Approval', value: 'awaiting_approval' },
        { label: 'Launching', value: 'launching' },
        { label: 'Active', value: 'active' },
        { label: 'Failed', value: 'failed' },
        { label: 'Deorbiting', value: 'deorbiting' },
        { label: 'Deorbited', value: 'deorbited' },
        { label: 'Aborted', value: 'aborted' },
      ],
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'parameters',
      type: 'json',
      admin: {
        description: 'User-provided template parameters',
      },
    },
    {
      name: 'pulumiStackName',
      type: 'text',
      admin: {
        position: 'sidebar',
        readOnly: true,
      },
    },
    {
      name: 'pulumiOutputs',
      type: 'json',
      admin: {
        readOnly: true,
        description: 'Outputs from the Pulumi stack (URLs, resource IDs, etc.)',
      },
    },
    {
      name: 'workflowId',
      type: 'text',
      admin: {
        position: 'sidebar',
        readOnly: true,
      },
    },
    {
      name: 'approvalConfig',
      type: 'group',
      fields: [
        {
          name: 'required',
          type: 'checkbox',
          defaultValue: false,
        },
        {
          name: 'approvers',
          type: 'relationship',
          relationTo: 'users',
          hasMany: true,
        },
        {
          name: 'timeoutHours',
          type: 'number',
          defaultValue: 24,
          admin: {
            description: 'Hours to wait for approval before auto-aborting',
          },
        },
      ],
    },
    {
      name: 'approvedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        position: 'sidebar',
        readOnly: true,
      },
    },
    {
      name: 'launchError',
      type: 'textarea',
      admin: {
        readOnly: true,
        condition: (data) => data?.status === 'failed',
      },
    },
    {
      name: 'lastLaunchedAt',
      type: 'date',
      admin: {
        position: 'sidebar',
        readOnly: true,
      },
    },
    {
      name: 'lastDeorbitedAt',
      type: 'date',
      admin: {
        position: 'sidebar',
        readOnly: true,
      },
    },
    {
      name: 'launchedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        position: 'sidebar',
        readOnly: true,
      },
    },
  ],
  timestamps: true,
}
```

**Step 2: Register in Payload config**

Modify `orbit-www/src/payload.config.ts`:
- Add import: `import { Launches } from './collections/Launches'`
- Add `Launches,` to the `collections` array

**Step 3: Verify**

Run: `cd orbit-www && pnpm build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add orbit-www/src/collections/Launches.ts orbit-www/src/payload.config.ts
git commit -m "feat(launches): add Launches Payload collection"
```

---

### Task 4: Create Launch Proto Definitions

**Files:**
- Create: `proto/idp/launch/v1/launch.proto`
- Create: `proto/idp/cloudaccount/v1/cloud_account.proto`

**Step 1: Write launch.proto**

Create `proto/idp/launch/v1/launch.proto`:

```protobuf
syntax = "proto3";

package idp.launch.v1;

import "google/protobuf/struct.proto";

option go_package = "github.com/drewpayment/orbit/proto/gen/go/idp/launch/v1;launchv1";

service LaunchService {
  rpc StartLaunch(StartLaunchRequest) returns (StartLaunchResponse);
  rpc GetLaunchProgress(GetLaunchProgressRequest) returns (GetLaunchProgressResponse);
  rpc ApproveLaunch(ApproveLaunchRequest) returns (ApproveLaunchResponse);
  rpc DeorbitLaunch(DeorbitLaunchRequest) returns (DeorbitLaunchResponse);
  rpc AbortLaunch(AbortLaunchRequest) returns (AbortLaunchResponse);
}

message StartLaunchRequest {
  string launch_id = 1;
  string template_slug = 2;
  string cloud_account_id = 3;
  string provider = 4;
  string region = 5;
  google.protobuf.Struct parameters = 6;
  bool approval_required = 7;
}

message StartLaunchResponse {
  bool success = 1;
  string workflow_id = 2;
  string error = 3;
}

message GetLaunchProgressRequest {
  string workflow_id = 1;
}

message GetLaunchProgressResponse {
  string status = 1;
  int32 current_step = 2;
  int32 total_steps = 3;
  string message = 4;
  float percentage = 5;
  repeated string logs = 6;
}

message ApproveLaunchRequest {
  string workflow_id = 1;
  bool approved = 2;
  string approved_by = 3;
  string notes = 4;
}

message ApproveLaunchResponse {
  bool success = 1;
  string error = 2;
}

message DeorbitLaunchRequest {
  string workflow_id = 1;
  string requested_by = 2;
  string reason = 3;
}

message DeorbitLaunchResponse {
  bool success = 1;
  string error = 2;
}

message AbortLaunchRequest {
  string workflow_id = 1;
  string requested_by = 2;
}

message AbortLaunchResponse {
  bool success = 1;
  string error = 2;
}
```

**Step 2: Write cloud_account.proto**

Create `proto/idp/cloudaccount/v1/cloud_account.proto`:

```protobuf
syntax = "proto3";

package idp.cloudaccount.v1;

option go_package = "github.com/drewpayment/orbit/proto/gen/go/idp/cloudaccount/v1;cloudaccountv1";

service CloudAccountService {
  rpc ValidateCredentials(ValidateCredentialsRequest) returns (ValidateCredentialsResponse);
}

message ValidateCredentialsRequest {
  string cloud_account_id = 1;
  string provider = 2;
}

message ValidateCredentialsResponse {
  bool valid = 1;
  string error = 2;
  string account_identifier = 3;
}
```

**Step 3: Generate code**

Run: `make proto-gen`
Expected: Go code generated to `proto/gen/go/idp/launch/v1/` and `proto/gen/go/idp/cloudaccount/v1/`. TypeScript code generated to `orbit-www/src/lib/proto/idp/launch/v1/` and `orbit-www/src/lib/proto/idp/cloudaccount/v1/`.

**Step 4: Verify generated code exists**

Run: `ls proto/gen/go/idp/launch/v1/ && ls orbit-www/src/lib/proto/idp/launch/v1/`
Expected: `.go` and `.ts` files present

**Step 5: Commit**

```bash
git add proto/idp/launch/ proto/idp/cloudaccount/ proto/gen/ orbit-www/src/lib/proto/idp/launch/ orbit-www/src/lib/proto/idp/cloudaccount/
git commit -m "feat(launches): add Launch and CloudAccount proto definitions"
```

---

## Phase 2: Go Backend — Types, Workflow, Activities, gRPC Server

### Task 5: Create Launch Shared Types

**Files:**
- Create: `temporal-workflows/pkg/types/launch_types.go`

**Step 1: Write the types**

Create `temporal-workflows/pkg/types/launch_types.go`:

```go
package types

// LaunchWorkflowInput is the input to the LaunchWorkflow.
type LaunchWorkflowInput struct {
	LaunchID        string                 `json:"launchId"`
	TemplateSlug    string                 `json:"templateSlug"`
	CloudAccountID  string                 `json:"cloudAccountId"`
	Provider        string                 `json:"provider"`
	Region          string                 `json:"region"`
	Parameters      map[string]interface{} `json:"parameters"`
	ApprovalRequired bool                  `json:"approvalRequired"`
	PulumiProjectPath string              `json:"pulumiProjectPath"`
	WorkspaceID     string                 `json:"workspaceId"`
}

// LaunchProgress tracks the current state of a launch workflow.
type LaunchProgress struct {
	Status      string   `json:"status"`
	CurrentStep int      `json:"currentStep"`
	TotalSteps  int      `json:"totalSteps"`
	Message     string   `json:"message"`
	Percentage  float64  `json:"percentage"`
	Logs        []string `json:"logs"`
}

// ApprovalSignalInput is sent via Temporal signal to approve/reject a launch.
type ApprovalSignalInput struct {
	Approved   bool   `json:"approved"`
	ApprovedBy string `json:"approvedBy"`
	Notes      string `json:"notes"`
}

// DeorbitSignalInput is sent via Temporal signal to tear down infrastructure.
type DeorbitSignalInput struct {
	RequestedBy string `json:"requestedBy"`
	Reason      string `json:"reason"`
}

// AbortSignalInput is sent via Temporal signal to cancel a launch in progress.
type AbortSignalInput struct {
	RequestedBy string `json:"requestedBy"`
}

// ProvisionInfraInput is the input to the TypeScript provisioning activity.
type ProvisionInfraInput struct {
	LaunchID          string                 `json:"launchId"`
	StackName         string                 `json:"stackName"`
	TemplatePath      string                 `json:"templatePath"`
	CloudAccountID    string                 `json:"cloudAccountId"`
	Provider          string                 `json:"provider"`
	Region            string                 `json:"region"`
	Parameters        map[string]interface{} `json:"parameters"`
}

// ProvisionInfraResult is the output from the TypeScript provisioning activity.
type ProvisionInfraResult struct {
	Outputs map[string]interface{} `json:"outputs"`
	Summary []string               `json:"summary"`
}

// DestroyInfraInput is the input to the TypeScript destroy activity.
type DestroyInfraInput struct {
	LaunchID       string `json:"launchId"`
	StackName      string `json:"stackName"`
	TemplatePath   string `json:"templatePath"`
	CloudAccountID string `json:"cloudAccountId"`
	Provider       string `json:"provider"`
	Region         string `json:"region"`
}

// UpdateLaunchStatusInput is used to update launch status in Payload.
type UpdateLaunchStatusInput struct {
	LaunchID string `json:"launchId"`
	Status   string `json:"status"`
	Error    string `json:"error,omitempty"`
}

// StoreLaunchOutputsInput saves Pulumi outputs to the launch record.
type StoreLaunchOutputsInput struct {
	LaunchID string                 `json:"launchId"`
	Outputs  map[string]interface{} `json:"outputs"`
}
```

**Step 2: Verify**

Run: `cd temporal-workflows && go build ./...`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add temporal-workflows/pkg/types/launch_types.go
git commit -m "feat(launches): add shared launch types"
```

---

### Task 6: Create Launch Activities

**Files:**
- Create: `temporal-workflows/internal/activities/launch_activities.go`

**Step 1: Write the activities**

Create `temporal-workflows/internal/activities/launch_activities.go`:

```go
package activities

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/drewpayment/orbit/temporal-workflows/pkg/types"
)

// PayloadLaunchClient defines the interface for Payload CMS operations on launches.
type PayloadLaunchClient interface {
	UpdateLaunchStatus(ctx context.Context, launchID string, status string, errMsg string) error
	StoreLaunchOutputs(ctx context.Context, launchID string, outputs map[string]interface{}) error
	GetCloudAccountCredentials(ctx context.Context, cloudAccountID string) (map[string]interface{}, error)
}

// LaunchActivities holds dependencies for launch-related activities.
type LaunchActivities struct {
	payloadClient PayloadLaunchClient
	logger        *slog.Logger
}

// NewLaunchActivities creates a new LaunchActivities instance.
func NewLaunchActivities(payloadClient PayloadLaunchClient, logger *slog.Logger) *LaunchActivities {
	return &LaunchActivities{
		payloadClient: payloadClient,
		logger:        logger,
	}
}

// ValidateLaunchInputs validates the launch workflow input.
func (a *LaunchActivities) ValidateLaunchInputs(ctx context.Context, input types.LaunchWorkflowInput) error {
	if input.LaunchID == "" {
		return fmt.Errorf("launchId is required")
	}
	if input.TemplateSlug == "" {
		return fmt.Errorf("templateSlug is required")
	}
	if input.CloudAccountID == "" {
		return fmt.Errorf("cloudAccountId is required")
	}
	if input.Provider == "" {
		return fmt.Errorf("provider is required")
	}
	if input.Region == "" {
		return fmt.Errorf("region is required")
	}
	if input.PulumiProjectPath == "" {
		return fmt.Errorf("pulumiProjectPath is required")
	}
	a.logger.Info("Launch inputs validated",
		"launchId", input.LaunchID,
		"template", input.TemplateSlug,
		"provider", input.Provider,
		"region", input.Region,
	)
	return nil
}

// UpdateLaunchStatus updates the launch status in Payload CMS.
func (a *LaunchActivities) UpdateLaunchStatus(ctx context.Context, input types.UpdateLaunchStatusInput) error {
	a.logger.Info("Updating launch status",
		"launchId", input.LaunchID,
		"status", input.Status,
	)
	return a.payloadClient.UpdateLaunchStatus(ctx, input.LaunchID, input.Status, input.Error)
}

// StoreLaunchOutputs saves Pulumi stack outputs to the launch record.
func (a *LaunchActivities) StoreLaunchOutputs(ctx context.Context, input types.StoreLaunchOutputsInput) error {
	a.logger.Info("Storing launch outputs",
		"launchId", input.LaunchID,
	)
	return a.payloadClient.StoreLaunchOutputs(ctx, input.LaunchID, input.Outputs)
}
```

**Step 2: Verify**

Run: `cd temporal-workflows && go build ./...`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add temporal-workflows/internal/activities/launch_activities.go
git commit -m "feat(launches): add launch activities"
```

---

### Task 7: Create Launch Workflow

**Files:**
- Create: `temporal-workflows/internal/workflows/launch_workflow.go`

**Step 1: Write the workflow**

Create `temporal-workflows/internal/workflows/launch_workflow.go`:

```go
package workflows

import (
	"errors"
	"fmt"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"

	"github.com/drewpayment/orbit/temporal-workflows/pkg/types"
)

const (
	// Signal names
	SignalApproval = "ApprovalSignal"
	SignalDeorbit  = "DeorbitSignal"
	SignalAbort    = "AbortSignal"

	// Query names
	QueryLaunchProgress = "GetLaunchProgress"

	// Activity names
	ActivityValidateLaunchInputs = "ValidateLaunchInputs"
	ActivityUpdateLaunchStatus   = "UpdateLaunchStatus"
	ActivityStoreLaunchOutputs   = "StoreLaunchOutputs"

	// Cross-language activity names (executed on TypeScript worker)
	ActivityProvisionInfra = "provisionInfra"
	ActivityDestroyInfra   = "destroyInfra"
)

// taskQueueForProvider returns the Temporal task queue name for a given cloud provider.
func taskQueueForProvider(provider string) string {
	return fmt.Sprintf("launches_%s", provider)
}

// LaunchWorkflow orchestrates the full lifecycle of a Launch.
// It follows the Entity Workflow pattern — staying open while infrastructure is active.
func LaunchWorkflow(ctx workflow.Context, input types.LaunchWorkflowInput) error {
	logger := workflow.GetLogger(ctx)
	logger.Info("LaunchWorkflow started", "launchId", input.LaunchID, "provider", input.Provider)

	// Progress state for query handler
	progress := types.LaunchProgress{
		Status:      "pending",
		CurrentStep: 0,
		TotalSteps:  4,
		Message:     "Initializing launch...",
		Percentage:  0,
	}

	// Register query handler
	err := workflow.SetQueryHandler(ctx, QueryLaunchProgress, func() (types.LaunchProgress, error) {
		return progress, nil
	})
	if err != nil {
		return fmt.Errorf("failed to set query handler: %w", err)
	}

	// Activity options for local Go activities
	localActivityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
		},
	}
	localCtx := workflow.WithActivityOptions(ctx, localActivityOptions)

	// Activity options for Payload CMS updates
	updateActivityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 15 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 5,
		},
	}
	updateCtx := workflow.WithActivityOptions(ctx, updateActivityOptions)

	// Activity options for provisioning (long-running, on provider task queue)
	provisionActivityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 60 * time.Minute,
		HeartbeatTimeout:    30 * time.Second,
		TaskQueue:           taskQueueForProvider(input.Provider),
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 2,
		},
	}
	provisionCtx := workflow.WithActivityOptions(ctx, provisionActivityOptions)

	// Helper to update status on failure
	updateStatusOnFailure := func(errMsg string) {
		_ = workflow.ExecuteActivity(updateCtx, ActivityUpdateLaunchStatus, types.UpdateLaunchStatusInput{
			LaunchID: input.LaunchID,
			Status:   "failed",
			Error:    errMsg,
		}).Get(ctx, nil)
	}

	// Cleanup on cancellation — destroy any provisioned resources
	defer func() {
		if !errors.Is(ctx.Err(), workflow.ErrCanceled) {
			return
		}
		logger.Info("LaunchWorkflow cancelled, cleaning up", "launchId", input.LaunchID)
		newCtx, _ := workflow.NewDisconnectedContext(ctx)
		cleanupCtx := workflow.WithActivityOptions(newCtx, provisionActivityOptions)
		_ = workflow.ExecuteActivity(cleanupCtx, ActivityDestroyInfra, types.DestroyInfraInput{
			LaunchID:       input.LaunchID,
			StackName:      fmt.Sprintf("orbit-%s-%s", input.WorkspaceID, input.LaunchID),
			TemplatePath:   input.PulumiProjectPath,
			CloudAccountID: input.CloudAccountID,
			Provider:       input.Provider,
			Region:         input.Region,
		}).Get(newCtx, nil)
		_ = workflow.ExecuteActivity(
			workflow.WithActivityOptions(newCtx, updateActivityOptions),
			ActivityUpdateLaunchStatus,
			types.UpdateLaunchStatusInput{LaunchID: input.LaunchID, Status: "aborted"},
		).Get(newCtx, nil)
	}()

	// --- Step 1: Validate inputs ---
	progress.CurrentStep = 1
	progress.Message = "Validating inputs..."
	progress.Percentage = 10

	err = workflow.ExecuteActivity(localCtx, ActivityValidateLaunchInputs, input).Get(ctx, nil)
	if err != nil {
		updateStatusOnFailure(fmt.Sprintf("Input validation failed: %v", err))
		return err
	}

	// --- Step 2: Approval gate (if required) ---
	if input.ApprovalRequired {
		progress.CurrentStep = 2
		progress.Message = "Awaiting approval..."
		progress.Percentage = 20

		_ = workflow.ExecuteActivity(updateCtx, ActivityUpdateLaunchStatus, types.UpdateLaunchStatusInput{
			LaunchID: input.LaunchID,
			Status:   "awaiting_approval",
		}).Get(ctx, nil)

		approvalChan := workflow.GetSignalChannel(ctx, SignalApproval)
		var approval types.ApprovalSignalInput

		// Wait for approval with timeout (default 24h)
		timeoutDuration := 24 * time.Hour
		timerCtx, cancelTimer := workflow.WithCancel(ctx)

		// Use selector to wait for signal or timeout
		selector := workflow.NewSelector(ctx)
		var timedOut bool

		selector.AddReceive(approvalChan, func(c workflow.ReceiveChannel, more bool) {
			c.Receive(ctx, &approval)
			cancelTimer()
		})

		timerFuture := workflow.NewTimer(timerCtx, timeoutDuration)
		selector.AddFuture(timerFuture, func(f workflow.Future) {
			timedOut = true
		})

		selector.Select(ctx)

		if timedOut || !approval.Approved {
			status := "aborted"
			errMsg := "Launch rejected or approval timed out"
			if !timedOut && !approval.Approved {
				errMsg = fmt.Sprintf("Launch rejected by %s: %s", approval.ApprovedBy, approval.Notes)
			}
			_ = workflow.ExecuteActivity(updateCtx, ActivityUpdateLaunchStatus, types.UpdateLaunchStatusInput{
				LaunchID: input.LaunchID,
				Status:   status,
				Error:    errMsg,
			}).Get(ctx, nil)
			return nil
		}

		logger.Info("Launch approved", "launchId", input.LaunchID, "approvedBy", approval.ApprovedBy)
	}

	// --- Step 3: Provision infrastructure ---
	progress.CurrentStep = 3
	progress.Message = "Launching infrastructure..."
	progress.Percentage = 40
	progress.Status = "launching"

	_ = workflow.ExecuteActivity(updateCtx, ActivityUpdateLaunchStatus, types.UpdateLaunchStatusInput{
		LaunchID: input.LaunchID,
		Status:   "launching",
	}).Get(ctx, nil)

	stackName := fmt.Sprintf("orbit-%s-%s", input.WorkspaceID, input.LaunchID)

	var provisionResult types.ProvisionInfraResult
	err = workflow.ExecuteActivity(provisionCtx, ActivityProvisionInfra, types.ProvisionInfraInput{
		LaunchID:       input.LaunchID,
		StackName:      stackName,
		TemplatePath:   input.PulumiProjectPath,
		CloudAccountID: input.CloudAccountID,
		Provider:       input.Provider,
		Region:         input.Region,
		Parameters:     input.Parameters,
	}).Get(ctx, &provisionResult)
	if err != nil {
		updateStatusOnFailure(fmt.Sprintf("Provisioning failed: %v", err))
		return err
	}

	// --- Step 4: Store outputs and go active ---
	progress.CurrentStep = 4
	progress.Message = "Storing outputs..."
	progress.Percentage = 90

	_ = workflow.ExecuteActivity(updateCtx, ActivityStoreLaunchOutputs, types.StoreLaunchOutputsInput{
		LaunchID: input.LaunchID,
		Outputs:  provisionResult.Outputs,
	}).Get(ctx, nil)

	_ = workflow.ExecuteActivity(updateCtx, ActivityUpdateLaunchStatus, types.UpdateLaunchStatusInput{
		LaunchID: input.LaunchID,
		Status:   "active",
	}).Get(ctx, nil)

	progress.Status = "active"
	progress.Message = "Infrastructure is active"
	progress.Percentage = 100
	logger.Info("Launch is now active", "launchId", input.LaunchID)

	// --- Entity phase: Wait for lifecycle signals ---
	deorbitChan := workflow.GetSignalChannel(ctx, SignalDeorbit)
	abortChan := workflow.GetSignalChannel(ctx, SignalAbort)

	selector := workflow.NewSelector(ctx)
	var deorbitInput types.DeorbitSignalInput
	var shouldDeorbit bool

	selector.AddReceive(deorbitChan, func(c workflow.ReceiveChannel, more bool) {
		c.Receive(ctx, &deorbitInput)
		shouldDeorbit = true
	})

	selector.AddReceive(abortChan, func(c workflow.ReceiveChannel, more bool) {
		var abortInput types.AbortSignalInput
		c.Receive(ctx, &abortInput)
		logger.Info("Abort signal received for active launch, treating as deorbit",
			"launchId", input.LaunchID, "requestedBy", abortInput.RequestedBy)
		deorbitInput = types.DeorbitSignalInput{
			RequestedBy: abortInput.RequestedBy,
			Reason:      "Aborted by user",
		}
		shouldDeorbit = true
	})

	selector.Select(ctx)

	if shouldDeorbit {
		// --- Deorbit flow ---
		progress.Status = "deorbiting"
		progress.Message = "Deorbiting infrastructure..."
		progress.Percentage = 50

		_ = workflow.ExecuteActivity(updateCtx, ActivityUpdateLaunchStatus, types.UpdateLaunchStatusInput{
			LaunchID: input.LaunchID,
			Status:   "deorbiting",
		}).Get(ctx, nil)

		err = workflow.ExecuteActivity(provisionCtx, ActivityDestroyInfra, types.DestroyInfraInput{
			LaunchID:       input.LaunchID,
			StackName:      stackName,
			TemplatePath:   input.PulumiProjectPath,
			CloudAccountID: input.CloudAccountID,
			Provider:       input.Provider,
			Region:         input.Region,
		}).Get(ctx, nil)
		if err != nil {
			updateStatusOnFailure(fmt.Sprintf("Deorbit failed: %v", err))
			return err
		}

		_ = workflow.ExecuteActivity(updateCtx, ActivityUpdateLaunchStatus, types.UpdateLaunchStatusInput{
			LaunchID: input.LaunchID,
			Status:   "deorbited",
		}).Get(ctx, nil)

		progress.Status = "deorbited"
		progress.Message = "Infrastructure has been deorbited"
		progress.Percentage = 100
		logger.Info("Launch deorbited", "launchId", input.LaunchID)
	}

	return nil
}
```

**Step 2: Verify**

Run: `cd temporal-workflows && go build ./...`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add temporal-workflows/internal/workflows/launch_workflow.go
git commit -m "feat(launches): add LaunchWorkflow with entity pattern, approval gate, deorbit"
```

---

### Task 8: Register Launch Workflow and Activities in Worker

**Files:**
- Modify: `temporal-workflows/cmd/worker/main.go`

**Step 1: Add registrations**

In `temporal-workflows/cmd/worker/main.go`, add:

- Import the launch types if needed
- After existing activity/workflow registrations, add:

```go
// Launch workflow
w.RegisterWorkflow(workflows.LaunchWorkflow)

// Launch activities
launchActivities := activities.NewLaunchActivities(nil, logger) // TODO: wire real PayloadLaunchClient
w.RegisterActivity(launchActivities.ValidateLaunchInputs)
w.RegisterActivity(launchActivities.UpdateLaunchStatus)
w.RegisterActivity(launchActivities.StoreLaunchOutputs)
```

Note: The `nil` PayloadLaunchClient is a placeholder. A real implementation will be wired in a later task when the Payload REST client adapter is built.

**Step 2: Verify**

Run: `cd temporal-workflows && go build ./...`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add temporal-workflows/cmd/worker/main.go
git commit -m "feat(launches): register LaunchWorkflow and activities in worker"
```

---

### Task 9: Create Launch gRPC Server

**Files:**
- Create: `services/repository/internal/grpc/launch_server.go`
- Modify: `services/repository/cmd/server/main.go`

**Step 1: Write the gRPC server**

Create `services/repository/internal/grpc/launch_server.go`:

```go
package grpc

import (
	"context"
	"fmt"

	"connectrpc.com/connect"

	launchv1 "github.com/drewpayment/orbit/proto/gen/go/idp/launch/v1"
	"github.com/drewpayment/orbit/proto/gen/go/idp/launch/v1/launchv1connect"
)

// LaunchClientInterface defines the Temporal client operations for launches.
type LaunchClientInterface interface {
	StartLaunchWorkflow(ctx context.Context, input StartLaunchInput) (string, error)
	QueryLaunchProgress(ctx context.Context, workflowID string) (*LaunchProgressResult, error)
	SignalLaunchApproval(ctx context.Context, workflowID string, approved bool, approvedBy string, notes string) error
	SignalLaunchDeorbit(ctx context.Context, workflowID string, requestedBy string, reason string) error
	SignalLaunchAbort(ctx context.Context, workflowID string, requestedBy string) error
}

// StartLaunchInput holds the data needed to start a launch workflow.
type StartLaunchInput struct {
	LaunchID          string
	TemplateSlug      string
	CloudAccountID    string
	Provider          string
	Region            string
	Parameters        map[string]interface{}
	ApprovalRequired  bool
	PulumiProjectPath string
	WorkspaceID       string
}

// LaunchProgressResult holds the progress data from a launch workflow query.
type LaunchProgressResult struct {
	Status      string
	CurrentStep int32
	TotalSteps  int32
	Message     string
	Percentage  float32
	Logs        []string
}

// LaunchServer implements the LaunchService Connect handler.
type LaunchServer struct {
	launchv1connect.UnimplementedLaunchServiceHandler
	temporalClient LaunchClientInterface
}

// NewLaunchServer creates a new LaunchServer.
func NewLaunchServer(temporalClient LaunchClientInterface) *LaunchServer {
	return &LaunchServer{
		temporalClient: temporalClient,
	}
}

func (s *LaunchServer) StartLaunch(
	ctx context.Context,
	req *connect.Request[launchv1.StartLaunchRequest],
) (*connect.Response[launchv1.StartLaunchResponse], error) {
	msg := req.Msg

	if msg.LaunchId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("launch_id is required"))
	}
	if msg.TemplateSlug == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("template_slug is required"))
	}
	if msg.CloudAccountId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("cloud_account_id is required"))
	}
	if msg.Provider == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("provider is required"))
	}
	if msg.Region == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("region is required"))
	}

	params := make(map[string]interface{})
	if msg.Parameters != nil {
		params = msg.Parameters.AsMap()
	}

	workflowID, err := s.temporalClient.StartLaunchWorkflow(ctx, StartLaunchInput{
		LaunchID:         msg.LaunchId,
		TemplateSlug:     msg.TemplateSlug,
		CloudAccountID:   msg.CloudAccountId,
		Provider:         msg.Provider,
		Region:           msg.Region,
		Parameters:       params,
		ApprovalRequired: msg.ApprovalRequired,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to start launch workflow: %w", err))
	}

	return connect.NewResponse(&launchv1.StartLaunchResponse{
		Success:    true,
		WorkflowId: workflowID,
	}), nil
}

func (s *LaunchServer) GetLaunchProgress(
	ctx context.Context,
	req *connect.Request[launchv1.GetLaunchProgressRequest],
) (*connect.Response[launchv1.GetLaunchProgressResponse], error) {
	if req.Msg.WorkflowId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("workflow_id is required"))
	}

	result, err := s.temporalClient.QueryLaunchProgress(ctx, req.Msg.WorkflowId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to query launch progress: %w", err))
	}

	return connect.NewResponse(&launchv1.GetLaunchProgressResponse{
		Status:      result.Status,
		CurrentStep: result.CurrentStep,
		TotalSteps:  result.TotalSteps,
		Message:     result.Message,
		Percentage:  result.Percentage,
		Logs:        result.Logs,
	}), nil
}

func (s *LaunchServer) ApproveLaunch(
	ctx context.Context,
	req *connect.Request[launchv1.ApproveLaunchRequest],
) (*connect.Response[launchv1.ApproveLaunchResponse], error) {
	if req.Msg.WorkflowId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("workflow_id is required"))
	}

	err := s.temporalClient.SignalLaunchApproval(ctx, req.Msg.WorkflowId, req.Msg.Approved, req.Msg.ApprovedBy, req.Msg.Notes)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to send approval signal: %w", err))
	}

	return connect.NewResponse(&launchv1.ApproveLaunchResponse{
		Success: true,
	}), nil
}

func (s *LaunchServer) DeorbitLaunch(
	ctx context.Context,
	req *connect.Request[launchv1.DeorbitLaunchRequest],
) (*connect.Response[launchv1.DeorbitLaunchResponse], error) {
	if req.Msg.WorkflowId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("workflow_id is required"))
	}

	err := s.temporalClient.SignalLaunchDeorbit(ctx, req.Msg.WorkflowId, req.Msg.RequestedBy, req.Msg.Reason)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to send deorbit signal: %w", err))
	}

	return connect.NewResponse(&launchv1.DeorbitLaunchResponse{
		Success: true,
	}), nil
}

func (s *LaunchServer) AbortLaunch(
	ctx context.Context,
	req *connect.Request[launchv1.AbortLaunchRequest],
) (*connect.Response[launchv1.AbortLaunchResponse], error) {
	if req.Msg.WorkflowId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("workflow_id is required"))
	}

	err := s.temporalClient.SignalLaunchAbort(ctx, req.Msg.WorkflowId, req.Msg.RequestedBy)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to send abort signal: %w", err))
	}

	return connect.NewResponse(&launchv1.AbortLaunchResponse{
		Success: true,
	}), nil
}
```

**Step 2: Register in service main.go**

Modify `services/repository/cmd/server/main.go`:
- Add import for `launchv1connect`
- Create `LaunchServer` instance: `launchServer := grpcserver.NewLaunchServer(launchTemporal)`
- Register handler: `launchPath, launchHandler := launchv1connect.NewLaunchServiceHandler(launchServer)`
- Add to mux: `mux.Handle(launchPath, launchHandler)`

Note: The `launchTemporal` client needs to be created similarly to how `deploymentTemporal` is created, implementing `LaunchClientInterface`. This will require adding a Temporal client adapter for launches — follow the same pattern as the existing `TemporalClient` in `main.go`.

**Step 3: Verify**

Run: `cd services/repository && go build ./...`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add services/repository/internal/grpc/launch_server.go services/repository/cmd/server/main.go
git commit -m "feat(launches): add LaunchService gRPC server and register in repository service"
```

---

## Phase 3: TypeScript Pulumi Worker

### Task 10: Scaffold launches-worker-aws Package

**Files:**
- Create: `launches-worker-aws/package.json`
- Create: `launches-worker-aws/tsconfig.json`
- Create: `launches-worker-aws/.gitignore`

**Step 1: Create package.json**

```json
{
  "name": "@orbit/launches-worker-aws",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "tsc",
    "start": "ts-node src/worker.ts",
    "dev": "ts-node-dev --respawn src/worker.ts"
  },
  "dependencies": {
    "@temporalio/activity": "^1.15.0",
    "@temporalio/client": "^1.15.0",
    "@temporalio/worker": "^1.15.0",
    "@pulumi/pulumi": "^3",
    "@pulumi/aws": "^6",
    "@aws-sdk/client-sts": "^3"
  },
  "devDependencies": {
    "typescript": "^5",
    "ts-node": "^10",
    "ts-node-dev": "^2",
    "@types/node": "^20"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create .gitignore**

```
node_modules/
dist/
.pulumi/
```

**Step 4: Install dependencies**

Run: `cd launches-worker-aws && npm install`
Expected: Dependencies installed

**Step 5: Commit**

```bash
git add launches-worker-aws/package.json launches-worker-aws/tsconfig.json launches-worker-aws/.gitignore launches-worker-aws/package-lock.json
git commit -m "feat(launches): scaffold launches-worker-aws package"
```

---

### Task 11: Create TypeScript Worker and Activities

**Files:**
- Create: `launches-worker-aws/src/worker.ts`
- Create: `launches-worker-aws/src/activities/provision.ts`
- Create: `launches-worker-aws/src/activities/destroy.ts`
- Create: `launches-worker-aws/src/activities/validate-credentials.ts`
- Create: `launches-worker-aws/src/activities/index.ts`
- Create: `launches-worker-aws/src/types.ts`

**Step 1: Create types**

Create `launches-worker-aws/src/types.ts`:

```typescript
export interface ProvisionInfraInput {
  launchId: string;
  stackName: string;
  templatePath: string;
  cloudAccountId: string;
  provider: string;
  region: string;
  parameters: Record<string, unknown>;
}

export interface ProvisionInfraResult {
  outputs: Record<string, unknown>;
  summary: string[];
}

export interface DestroyInfraInput {
  launchId: string;
  stackName: string;
  templatePath: string;
  cloudAccountId: string;
  provider: string;
  region: string;
}

export interface ValidateCredentialsInput {
  cloudAccountId: string;
  provider: string;
}

export interface ValidateCredentialsResult {
  valid: boolean;
  error?: string;
  accountIdentifier?: string;
}
```

**Step 2: Create provision activity**

Create `launches-worker-aws/src/activities/provision.ts`:

```typescript
import { Context } from "@temporalio/activity";
import { LocalWorkspace } from "@pulumi/pulumi/automation";
import * as path from "path";
import type { ProvisionInfraInput, ProvisionInfraResult } from "../types";

export async function provisionInfra(
  input: ProvisionInfraInput
): Promise<ProvisionInfraResult> {
  const ctx = Context.current();
  const logger = ctx.log;

  logger.info("Starting infrastructure provisioning", {
    launchId: input.launchId,
    stackName: input.stackName,
    templatePath: input.templatePath,
    region: input.region,
  });

  // Heartbeat in background
  const heartbeatInterval = setInterval(() => {
    ctx.heartbeat("provisioning in progress");
  }, 5000);

  try {
    const workDir = path.resolve(
      __dirname,
      "..",
      "templates",
      input.templatePath
    );

    const stack = await LocalWorkspace.createOrSelectStack({
      stackName: input.stackName,
      workDir,
    });

    // Configure provider
    await stack.setConfig("aws:region", { value: input.region });

    // Set user parameters
    for (const [key, value] of Object.entries(input.parameters)) {
      await stack.setConfig(key, {
        value: typeof value === "string" ? value : JSON.stringify(value),
      });
    }

    // Refresh for idempotency
    await stack.refresh({ onOutput: logger.info });

    // Deploy
    const outputLines: string[] = [];
    const upResult = await stack.up({
      onOutput: (line: string) => {
        outputLines.push(line);
        logger.info(line);
      },
    });

    const outputs: Record<string, unknown> = {};
    for (const [key, output] of Object.entries(upResult.outputs)) {
      outputs[key] = output.value;
    }

    return {
      outputs,
      summary: outputLines.slice(-20), // last 20 lines
    };
  } finally {
    clearInterval(heartbeatInterval);
  }
}
```

**Step 3: Create destroy activity**

Create `launches-worker-aws/src/activities/destroy.ts`:

```typescript
import { Context } from "@temporalio/activity";
import { LocalWorkspace } from "@pulumi/pulumi/automation";
import * as path from "path";
import type { DestroyInfraInput } from "../types";

export async function destroyInfra(input: DestroyInfraInput): Promise<void> {
  const ctx = Context.current();
  const logger = ctx.log;

  logger.info("Starting infrastructure destruction (deorbit)", {
    launchId: input.launchId,
    stackName: input.stackName,
  });

  const heartbeatInterval = setInterval(() => {
    ctx.heartbeat("deorbiting in progress");
  }, 5000);

  try {
    const workDir = path.resolve(
      __dirname,
      "..",
      "templates",
      input.templatePath
    );

    const stack = await LocalWorkspace.selectStack({
      stackName: input.stackName,
      workDir,
    });

    await stack.destroy({
      onOutput: (line: string) => {
        logger.info(line);
      },
    });

    // Remove the stack after successful destroy
    await stack.workspace.removeStack(input.stackName);

    logger.info("Infrastructure deorbited successfully", {
      launchId: input.launchId,
    });
  } finally {
    clearInterval(heartbeatInterval);
  }
}
```

**Step 4: Create validate-credentials activity**

Create `launches-worker-aws/src/activities/validate-credentials.ts`:

```typescript
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import type {
  ValidateCredentialsInput,
  ValidateCredentialsResult,
} from "../types";

export async function validateCredentials(
  input: ValidateCredentialsInput
): Promise<ValidateCredentialsResult> {
  // TODO: Fetch credentials from Payload using cloudAccountId
  // For now, validate using the ambient AWS credentials
  try {
    const sts = new STSClient({});
    const identity = await sts.send(new GetCallerIdentityCommand({}));

    return {
      valid: true,
      accountIdentifier: identity.Account,
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
```

**Step 5: Create activity index**

Create `launches-worker-aws/src/activities/index.ts`:

```typescript
export { provisionInfra } from "./provision";
export { destroyInfra } from "./destroy";
export { validateCredentials } from "./validate-credentials";
```

**Step 6: Create worker**

Create `launches-worker-aws/src/worker.ts`:

```typescript
import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities";

async function run() {
  const temporalAddress =
    process.env.TEMPORAL_ADDRESS || "localhost:7233";
  const namespace = process.env.TEMPORAL_NAMESPACE || "default";
  const taskQueue = process.env.TASK_QUEUE || "launches_aws";

  console.log(`Connecting to Temporal at ${temporalAddress}`);

  const connection = await NativeConnection.connect({
    address: temporalAddress,
  });

  const worker = await Worker.create({
    connection,
    namespace,
    activities,
    taskQueue,
  });

  console.log(`Worker started, listening on task queue: ${taskQueue}`);
  await worker.run();
}

run().catch((err) => {
  console.error("Worker failed:", err);
  process.exit(1);
});
```

**Step 7: Verify**

Run: `cd launches-worker-aws && npx tsc --noEmit`
Expected: No type errors (may have warnings about unresolved Pulumi types until templates exist)

**Step 8: Commit**

```bash
git add launches-worker-aws/src/
git commit -m "feat(launches): add TypeScript Temporal worker with Pulumi provision/destroy activities"
```

---

### Task 12: Create First Pulumi Template — S3 Bucket

**Files:**
- Create: `launches-worker-aws/src/templates/resources/s3-bucket/index.ts`
- Create: `launches-worker-aws/src/templates/resources/s3-bucket/Pulumi.yaml`

**Step 1: Create Pulumi.yaml**

Create `launches-worker-aws/src/templates/resources/s3-bucket/Pulumi.yaml`:

```yaml
name: orbit-s3-bucket
runtime: nodejs
description: Provisions an S3 bucket with configurable settings
```

**Step 2: Create the Pulumi program**

Create `launches-worker-aws/src/templates/resources/s3-bucket/index.ts`:

```typescript
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

const config = new pulumi.Config();
const bucketName = config.get("bucketName") || pulumi.getStack();
const versioning = config.getBoolean("versioning") ?? false;
const publicAccess = config.getBoolean("publicAccess") ?? false;

const bucket = new aws.s3.BucketV2("orbit-bucket", {
  bucket: bucketName,
  tags: {
    ManagedBy: "orbit",
    Stack: pulumi.getStack(),
  },
});

if (versioning) {
  new aws.s3.BucketVersioningV2("orbit-bucket-versioning", {
    bucket: bucket.id,
    versioningConfiguration: {
      status: "Enabled",
    },
  });
}

if (!publicAccess) {
  new aws.s3.BucketPublicAccessBlock("orbit-bucket-public-access", {
    bucket: bucket.id,
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
  });
}

export const bucketId = bucket.id;
export const bucketArn = bucket.arn;
export const bucketDomainName = bucket.bucketDomainName;
```

**Step 3: Commit**

```bash
git add launches-worker-aws/src/templates/resources/s3-bucket/
git commit -m "feat(launches): add S3 bucket Pulumi template"
```

---

## Phase 4: Frontend — Server Actions & gRPC Client

### Task 13: Create Launch gRPC Client

**Files:**
- Create: `orbit-www/src/lib/clients/launch-client.ts`

**Step 1: Write the client**

Create `orbit-www/src/lib/clients/launch-client.ts`:

```typescript
// NOTE: Using connect-web (not connect-node) for compatibility.
// See deployment-client.ts for the rationale.

import { create } from '@bufbuild/protobuf'
import { createClient } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import { LaunchService } from '@/lib/proto/idp/launch/v1/launch_connect'
import {
  StartLaunchRequestSchema,
  GetLaunchProgressRequestSchema,
  ApproveLaunchRequestSchema,
  DeorbitLaunchRequestSchema,
  AbortLaunchRequestSchema,
} from '@/lib/proto/idp/launch/v1/launch_pb'

const transport = createConnectTransport({
  baseUrl: process.env.REPOSITORY_SERVICE_URL || 'http://localhost:50051',
})

export const launchClient = createClient(LaunchService, transport)

export async function startLaunchWorkflow(
  launchId: string,
  templateSlug: string,
  cloudAccountId: string,
  provider: string,
  region: string,
  parameters: Record<string, unknown>,
  approvalRequired: boolean,
) {
  const request = create(StartLaunchRequestSchema, {
    launchId,
    templateSlug,
    cloudAccountId,
    provider,
    region,
    approvalRequired,
  })

  return await launchClient.startLaunch(request)
}

export async function getLaunchProgress(workflowId: string) {
  const request = create(GetLaunchProgressRequestSchema, {
    workflowId,
  })

  return await launchClient.getLaunchProgress(request)
}

export async function approveLaunch(
  workflowId: string,
  approved: boolean,
  approvedBy: string,
  notes: string,
) {
  const request = create(ApproveLaunchRequestSchema, {
    workflowId,
    approved,
    approvedBy,
    notes,
  })

  return await launchClient.approveLaunch(request)
}

export async function deorbitLaunch(
  workflowId: string,
  requestedBy: string,
  reason: string,
) {
  const request = create(DeorbitLaunchRequestSchema, {
    workflowId,
    requestedBy,
    reason,
  })

  return await launchClient.deorbitLaunch(request)
}

export async function abortLaunch(workflowId: string, requestedBy: string) {
  const request = create(AbortLaunchRequestSchema, {
    workflowId,
    requestedBy,
  })

  return await launchClient.abortLaunch(request)
}
```

Note: The exact import paths for generated proto types (`launch_connect`, `launch_pb`) will depend on what `make proto-gen` outputs. Adjust after running proto generation in Task 4.

**Step 2: Verify**

Run: `cd orbit-www && pnpm build`
Expected: Build succeeds (after proto generation from Task 4)

**Step 3: Commit**

```bash
git add orbit-www/src/lib/clients/launch-client.ts
git commit -m "feat(launches): add Launch gRPC client"
```

---

### Task 14: Create Launch Server Actions

**Files:**
- Create: `orbit-www/src/app/actions/launches.ts`

**Step 1: Write the server actions**

Create `orbit-www/src/app/actions/launches.ts`:

```typescript
'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import {
  startLaunchWorkflow,
  getLaunchProgress as getLaunchProgressGrpc,
  approveLaunch as approveLaunchGrpc,
  deorbitLaunch as deorbitLaunchGrpc,
  abortLaunch as abortLaunchGrpc,
} from '@/lib/clients/launch-client'

export async function createLaunch(data: {
  name: string
  workspaceId: string
  cloudAccountId: string
  templateSlug: string
  provider: string
  region: string
  parameters: Record<string, unknown>
  appId?: string
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  // Verify workspace membership
  const members = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: data.workspaceId } },
        { user: { equals: session.user.id } },
        { status: { equals: 'active' } },
      ],
    },
    overrideAccess: true,
  })
  if (members.docs.length === 0) {
    return { success: false, error: 'Not a member of this workspace' }
  }

  try {
    // Get cloud account to check approval settings
    const cloudAccount = await payload.findByID({
      collection: 'cloud-accounts',
      id: data.cloudAccountId,
      overrideAccess: true,
    })

    // Get template for pulumiProjectPath
    const templates = await payload.find({
      collection: 'launch-templates',
      where: { slug: { equals: data.templateSlug } },
      overrideAccess: true,
    })
    if (templates.docs.length === 0) {
      return { success: false, error: 'Template not found' }
    }
    const template = templates.docs[0]

    // Create the launch record in Payload
    const launch = await payload.create({
      collection: 'launches',
      data: {
        name: data.name,
        workspace: data.workspaceId,
        cloudAccount: data.cloudAccountId,
        template: template.id,
        provider: data.provider,
        region: data.region,
        parameters: data.parameters,
        status: 'pending',
        launchedBy: session.user.id,
        lastLaunchedAt: new Date().toISOString(),
        approvalConfig: {
          required: cloudAccount.approvalRequired || false,
          approvers: cloudAccount.approvers || [],
          timeoutHours: 24,
        },
        ...(data.appId ? { app: data.appId } : {}),
      },
      overrideAccess: true,
    })

    return { success: true, launchId: launch.id }
  } catch (error) {
    console.error('Failed to create launch:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to create launch'
    return { success: false, error: errorMessage }
  }
}

export async function startLaunch(launchId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  try {
    const launch = await payload.findByID({
      collection: 'launches',
      id: launchId,
      overrideAccess: true,
      depth: 2,
    })

    const template = typeof launch.template === 'string'
      ? await payload.findByID({ collection: 'launch-templates', id: launch.template, overrideAccess: true })
      : launch.template

    const cloudAccount = typeof launch.cloudAccount === 'string'
      ? await payload.findByID({ collection: 'cloud-accounts', id: launch.cloudAccount, overrideAccess: true })
      : launch.cloudAccount

    const response = await startLaunchWorkflow(
      launchId,
      template.slug,
      cloudAccount.id,
      launch.provider,
      launch.region,
      (launch.parameters as Record<string, unknown>) || {},
      launch.approvalConfig?.required || false,
    )

    if (response.success) {
      await payload.update({
        collection: 'launches',
        id: launchId,
        data: {
          workflowId: response.workflowId,
          status: 'launching',
        },
        overrideAccess: true,
      })
    }

    return {
      success: response.success,
      workflowId: response.workflowId,
      error: response.error,
    }
  } catch (error) {
    console.error('Failed to start launch:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to start launch'
    return { success: false, error: errorMessage }
  }
}

export async function getLaunchStatus(launchId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return null
  }

  const payload = await getPayload({ config })

  try {
    const launch = await payload.findByID({
      collection: 'launches',
      id: launchId,
      depth: 2,
    })
    return launch
  } catch {
    return null
  }
}

export async function getLaunchWorkflowProgress(workflowId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return null
  }

  try {
    const response = await getLaunchProgressGrpc(workflowId)
    return {
      status: response.status,
      currentStep: response.currentStep,
      totalSteps: response.totalSteps,
      message: response.message,
      percentage: response.percentage,
      logs: response.logs,
    }
  } catch {
    return null
  }
}

export async function approveLaunchAction(
  workflowId: string,
  approved: boolean,
  notes: string,
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  try {
    const response = await approveLaunchGrpc(
      workflowId,
      approved,
      session.user.id,
      notes,
    )
    return { success: response.success, error: response.error }
  } catch (error) {
    console.error('Failed to approve launch:', error)
    return { success: false, error: 'Failed to send approval' }
  }
}

export async function deorbitLaunchAction(workflowId: string, reason: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  try {
    const response = await deorbitLaunchGrpc(
      workflowId,
      session.user.id,
      reason,
    )
    return { success: response.success, error: response.error }
  } catch (error) {
    console.error('Failed to deorbit launch:', error)
    return { success: false, error: 'Failed to start deorbit' }
  }
}

export async function abortLaunchAction(workflowId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  try {
    const response = await abortLaunchGrpc(workflowId, session.user.id)
    return { success: response.success, error: response.error }
  } catch (error) {
    console.error('Failed to abort launch:', error)
    return { success: false, error: 'Failed to abort launch' }
  }
}

export async function getLaunchTemplates(provider?: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return []
  }

  const payload = await getPayload({ config })

  const where: Record<string, unknown> = {}
  if (provider) {
    where.provider = { equals: provider }
  }

  const templates = await payload.find({
    collection: 'launch-templates',
    where,
    sort: 'name',
    limit: 100,
  })

  return templates.docs
}

export async function getCloudAccounts(workspaceId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return []
  }

  const payload = await getPayload({ config })

  const accounts = await payload.find({
    collection: 'cloud-accounts',
    where: {
      and: [
        { workspaces: { contains: workspaceId } },
        { status: { equals: 'connected' } },
      ],
    },
    sort: 'name',
    limit: 100,
  })

  return accounts.docs
}
```

**Step 2: Verify**

Run: `cd orbit-www && pnpm build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add orbit-www/src/app/actions/launches.ts
git commit -m "feat(launches): add launch server actions"
```

---

## Phase 5: Frontend — UI Components & Pages

### Task 15: Create Launches List Page

**Files:**
- Create: `orbit-www/src/app/(frontend)/launches/page.tsx`

This task creates the main launches list page. Follow the existing pattern from apps or templates list pages. The page should:

- Fetch launches for the current workspace using a server action
- Display them in a table with columns: Name, Provider, Template, Region, Status, Last Activity
- Status badges colored by state (green=active, blue+pulse=launching, amber=awaiting_approval, red=failed, gray=deorbited)
- "New Launch" button linking to `/launches/new`
- Row actions: Deorbit (for active), Abort (for launching/awaiting_approval)

Use existing shadcn/ui components (`Table`, `Badge`, `Button`, `Card`) and the project's existing patterns.

**Verify:** `cd orbit-www && pnpm build`

**Commit:** `git commit -m "feat(launches): add launches list page"`

---

### Task 16: Create New Launch Wizard

**Files:**
- Create: `orbit-www/src/app/(frontend)/launches/new/page.tsx`
- Create: `orbit-www/src/components/features/launches/LaunchWizard.tsx`
- Create: `orbit-www/src/components/features/launches/ProviderSelector.tsx`
- Create: `orbit-www/src/components/features/launches/TemplateSelector.tsx`
- Create: `orbit-www/src/components/features/launches/ParameterForm.tsx`

This task creates the multi-step wizard. The wizard has 4 steps:

1. **ProviderSelector** — Grid of cloud provider cards (AWS, GCP, Azure, DigitalOcean). Each card has icon, name, template count. Only AWS will have templates initially.
2. **TemplateSelector** — Two tabs (Bundles | Individual Resources). Card grid with icon, name, description, estimated duration. Cross-provider badges.
3. **ParameterForm** — Dynamic form generated from `parameterSchema` JSON Schema. Cloud Account selector, region dropdown, optional app link, launch name input.
4. **Review & Launch** — Summary of selections. Approval notice if required. "Launch" button.

The wizard uses React state to track the current step and selections. On "Launch", it calls `createLaunch` then `startLaunch` server actions, then navigates to `/launches/[id]`.

**Verify:** `cd orbit-www && pnpm build`

**Commit:** `git commit -m "feat(launches): add new launch wizard with provider, template, and parameter steps"`

---

### Task 17: Create Launch Detail Page

**Files:**
- Create: `orbit-www/src/app/(frontend)/launches/[id]/page.tsx`
- Create: `orbit-www/src/components/features/launches/LaunchDetail.tsx`
- Create: `orbit-www/src/components/features/launches/LaunchProgress.tsx`
- Create: `orbit-www/src/components/features/launches/DeorbitConfirmation.tsx`

This task creates the launch detail page with:

- **Header:** Launch name, status badge, provider icon, region
- **Progress tab** (default for in-progress): Real-time polling every 2 seconds using `getLaunchWorkflowProgress`. Progress bar, step list with icons, log output. Follows the `WorkflowProgress.tsx` pattern from templates.
- **Overview tab** (default for active): Pulumi outputs displayed as key-value pairs. Cloud Account, template, timestamps.
- **DeorbitConfirmation:** Modal requiring user to type the launch name to confirm. Calls `deorbitLaunchAction`.
- **Abort button:** Visible only during `launching` or `awaiting_approval`. Calls `abortLaunchAction`.

**Verify:** `cd orbit-www && pnpm build`

**Commit:** `git commit -m "feat(launches): add launch detail page with progress tracking and deorbit"`

---

### Task 18: Create Cloud Accounts Admin Page

**Files:**
- Create: `orbit-www/src/app/(frontend)/settings/cloud-accounts/page.tsx`
- Create: `orbit-www/src/app/actions/cloud-accounts.ts`

This task creates the admin page for managing Cloud Accounts:

- List of cloud accounts with provider icon, name, status badge, workspace assignments
- "Add Cloud Account" button opens a form:
  - Select provider
  - Provider-specific credential fields (AWS: Access Key ID + Secret Access Key; GCP: Service Account JSON; Azure: Tenant ID + Client ID + Client Secret)
  - "Test Connection" button (calls ValidateCredentials — initially a stub that just checks non-empty)
  - Assign to workspaces (multi-select)
- Edit/delete existing accounts
- Admin-only access check (redirect non-admins)

Server actions in `cloud-accounts.ts`:
- `createCloudAccount(data)` — creates Payload record
- `updateCloudAccount(id, data)` — updates record
- `deleteCloudAccount(id)` — deletes record
- `testCloudAccountConnection(id)` — validates credentials (stub for now)

**Verify:** `cd orbit-www && pnpm build`

**Commit:** `git commit -m "feat(launches): add Cloud Accounts admin page"`

---

### Task 19: Add Navigation Links

**Files:**
- Modify: sidebar/navigation component (find the existing navigation component via grep for "Apps" or "Deployments" in the sidebar)

Add "Launches" link to the main sidebar navigation, positioned after Deployments. Add "Cloud Accounts" under Settings (admin-only).

**Verify:** `cd orbit-www && pnpm build`

**Commit:** `git commit -m "feat(launches): add Launches and Cloud Accounts navigation links"`

---

## Phase 6: Seed Data & Integration Testing

### Task 20: Seed Launch Templates

**Files:**
- Create: `orbit-www/src/seed/launch-templates.ts` (or add to existing seed script)

Create a seed script or migration that populates the initial launch templates:

**Bundles:**
1. Web App Backend (aws, compute, `bundles/web-app-backend`)
2. Static Site (aws, storage, `bundles/static-site`)

**Resources:**
1. S3 Bucket (aws, storage, `resources/s3-bucket`) — parameterSchema: `{ bucketName: string, versioning: boolean, publicAccess: boolean }`
2. RDS PostgreSQL (aws, database, `resources/rds-postgres`)
3. ECS Fargate Cluster (aws, container, `resources/ecs-cluster`)
4. VPC (aws, networking, `resources/vpc`)

Note: Only S3 Bucket has a real Pulumi template (Task 12). Other templates will need their Pulumi programs created in future tasks.

**Verify:** Run the seed script and verify templates appear in Payload admin

**Commit:** `git commit -m "feat(launches): seed initial AWS launch templates"`

---

### Task 21: Docker Compose Integration

**Files:**
- Modify: `docker-compose.yml` (or `docker-compose.dev.yml`)

Add the `launches-worker-aws` service to Docker Compose:

```yaml
launches-worker-aws:
  build:
    context: ./launches-worker-aws
    dockerfile: Dockerfile
  environment:
    - TEMPORAL_ADDRESS=temporal:7233
    - TEMPORAL_NAMESPACE=default
    - TASK_QUEUE=launches_aws
    - PULUMI_BACKEND_URL=s3://pulumi-state?endpoint=minio:9000&s3ForcePathStyle=true
    - AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
    - AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
  depends_on:
    - temporal
    - minio
  restart: unless-stopped
```

Also create `launches-worker-aws/Dockerfile`:

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
CMD ["node", "dist/worker.js"]
```

**Verify:** `docker compose config` passes validation

**Commit:** `git commit -m "feat(launches): add launches-worker-aws to Docker Compose"`

---

## Phase 7: Testing

### Task 22: Write Go Workflow Tests

**Files:**
- Create: `temporal-workflows/internal/workflows/launch_workflow_test.go`

Write tests for the LaunchWorkflow using Temporal's test framework (`go.temporal.io/sdk/testsuite`):

1. **TestLaunchWorkflow_Success** — Happy path: validate → provision → store outputs → active
2. **TestLaunchWorkflow_WithApproval** — Approval required, signal sent → proceeds to provision
3. **TestLaunchWorkflow_ApprovalRejected** — Approval rejected → status aborted
4. **TestLaunchWorkflow_ApprovalTimeout** — No approval signal → timeout → status aborted
5. **TestLaunchWorkflow_ProvisionFailed** — Provision activity fails → status failed
6. **TestLaunchWorkflow_Deorbit** — Active launch receives deorbit signal → destroy → deorbited

Run: `cd temporal-workflows && go test -v -race -run TestLaunchWorkflow ./internal/workflows/`
Expected: All tests pass

**Commit:** `git commit -m "test(launches): add LaunchWorkflow tests"`

---

### Task 23: Write Go Activity Tests

**Files:**
- Create: `temporal-workflows/internal/activities/launch_activities_test.go`

Write tests for launch activities:

1. **TestValidateLaunchInputs_Success** — All fields provided
2. **TestValidateLaunchInputs_MissingFields** — Each required field missing returns error
3. **TestUpdateLaunchStatus_Success** — Calls PayloadLaunchClient correctly
4. **TestStoreLaunchOutputs_Success** — Calls PayloadLaunchClient correctly

Use mock implementations of `PayloadLaunchClient`.

Run: `cd temporal-workflows && go test -v -race -run TestLaunchActivit ./internal/activities/`
Expected: All tests pass

**Commit:** `git commit -m "test(launches): add launch activity tests"`

---

### Task 24: Write Go gRPC Server Tests

**Files:**
- Create: `services/repository/internal/grpc/launch_server_test.go`

Write tests for the LaunchServer:

1. **TestStartLaunch_Success** — Valid request → starts workflow
2. **TestStartLaunch_MissingFields** — Each required field missing → InvalidArgument error
3. **TestGetLaunchProgress_Success** — Valid workflow ID → returns progress
4. **TestApproveLaunch_Success** — Valid request → sends signal
5. **TestDeorbitLaunch_Success** — Valid request → sends signal
6. **TestAbortLaunch_Success** — Valid request → sends signal

Use mock implementation of `LaunchClientInterface`.

Run: `cd services/repository && go test -v -race -run TestLaunch ./internal/grpc/`
Expected: All tests pass

**Commit:** `git commit -m "test(launches): add LaunchService gRPC server tests"`

---

### Task 25: Write Frontend Tests

**Files:**
- Create: `orbit-www/src/app/actions/__tests__/launches.test.ts`

Write Vitest tests for key server actions:

1. Test `createLaunch` validates auth
2. Test `createLaunch` validates workspace membership
3. Test `startLaunch` calls gRPC client
4. Test `getLaunchTemplates` filters by provider

Run: `cd orbit-www && pnpm exec vitest run src/app/actions/__tests__/launches.test.ts`
Expected: All tests pass

**Commit:** `git commit -m "test(launches): add server action tests"`

---

## Summary

| Phase | Tasks | What it delivers |
|-------|-------|-----------------|
| 1: Data Model | 1-4 | Payload collections + proto definitions |
| 2: Go Backend | 5-9 | Types, workflow, activities, gRPC server |
| 3: TS Worker | 10-12 | Pulumi worker + S3 template |
| 4: Frontend Backend | 13-14 | gRPC client + server actions |
| 5: Frontend UI | 15-19 | List page, wizard, detail page, admin page, nav |
| 6: Integration | 20-21 | Seed data, Docker Compose |
| 7: Testing | 22-25 | Workflow, activity, gRPC, and frontend tests |

Total: 25 tasks across 7 phases.
