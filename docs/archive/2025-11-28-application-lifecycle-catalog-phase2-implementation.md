# Application Lifecycle Catalog Phase 2 - Deployment Workflows

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build deployment workflow infrastructure with Temporal, starting with Docker Compose generator, enabling users to deploy apps directly from the catalog.

**Architecture:** DeploymentWorkflow orchestrates pluggable generators (starting with Docker Compose). Workflow creates deployment record, executes generator, updates status, and optionally starts health monitoring. Frontend provides add/deploy modal with progress tracking.

**Tech Stack:** Temporal (Go), Payload CMS, Next.js 15, React 19, gRPC (proto), Tailwind CSS

**Phase 1 Completed:** App/Deployment collections, catalog UI, import flow, navigation

---

## Task 1: Create DeploymentGenerator Collection

**Files:**
- Create: `orbit-www/src/collections/DeploymentGenerators.ts`
- Modify: `orbit-www/src/payload.config.ts`

**Step 1: Create the DeploymentGenerator collection**

```typescript
// orbit-www/src/collections/DeploymentGenerators.ts
import type { CollectionConfig } from 'payload'

export const DeploymentGenerators: CollectionConfig = {
  slug: 'deployment-generators',
  admin: {
    useAsTitle: 'name',
    group: 'Catalog',
    defaultColumns: ['name', 'type', 'isBuiltIn', 'updatedAt'],
  },
  access: {
    // Read: Anyone authenticated can read generators
    read: ({ req: { user } }) => !!user,
    // Create: Only for custom generators, workspace admins
    create: async ({ req: { user, payload }, data }) => {
      if (!user) return false
      // Built-in generators can't be created via API
      if (data?.isBuiltIn) return false
      if (!data?.workspace) return false

      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: data.workspace } },
            { user: { equals: user.id } },
            { role: { in: ['owner', 'admin'] } },
            { status: { equals: 'active' } },
          ],
        },
        overrideAccess: true,
      })
      return members.docs.length > 0
    },
    // Update: Built-in = admin only, custom = workspace admins
    update: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false

      const generator = await payload.findByID({
        collection: 'deployment-generators',
        id,
        overrideAccess: true,
      })

      // Built-in generators cannot be modified
      if (generator.isBuiltIn) return false

      if (!generator.workspace) return false

      const workspaceId = typeof generator.workspace === 'string'
        ? generator.workspace
        : generator.workspace.id

      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: workspaceId } },
            { user: { equals: user.id } },
            { role: { in: ['owner', 'admin'] } },
            { status: { equals: 'active' } },
          ],
        },
        overrideAccess: true,
      })
      return members.docs.length > 0
    },
    // Delete: Only custom generators, workspace owners only
    delete: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false

      const generator = await payload.findByID({
        collection: 'deployment-generators',
        id,
        overrideAccess: true,
      })

      // Built-in generators cannot be deleted
      if (generator.isBuiltIn) return false

      if (!generator.workspace) return false

      const workspaceId = typeof generator.workspace === 'string'
        ? generator.workspace
        : generator.workspace.id

      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: workspaceId } },
            { user: { equals: user.id } },
            { role: { equals: 'owner' } },
            { status: { equals: 'active' } },
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
      admin: {
        description: 'Display name for this generator',
      },
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        description: 'Unique identifier (e.g., docker-compose-basic)',
      },
    },
    {
      name: 'description',
      type: 'textarea',
    },
    {
      name: 'type',
      type: 'select',
      required: true,
      options: [
        { label: 'Docker Compose', value: 'docker-compose' },
        { label: 'Terraform', value: 'terraform' },
        { label: 'Helm', value: 'helm' },
        { label: 'Custom', value: 'custom' },
      ],
    },
    {
      name: 'configSchema',
      type: 'json',
      admin: {
        description: 'JSON Schema for validating generator config',
      },
    },
    {
      name: 'templateFiles',
      type: 'array',
      admin: {
        description: 'IaC template files for this generator',
      },
      fields: [
        {
          name: 'path',
          type: 'text',
          required: true,
          admin: {
            description: 'File path (e.g., docker-compose.yml)',
          },
        },
        {
          name: 'content',
          type: 'code',
          required: true,
          admin: {
            language: 'yaml',
            description: 'Template content with variable placeholders',
          },
        },
      ],
    },
    {
      name: 'isBuiltIn',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        position: 'sidebar',
        readOnly: true,
        description: 'Built-in generators cannot be modified',
      },
    },
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      admin: {
        position: 'sidebar',
        condition: (data) => !data?.isBuiltIn,
        description: 'Workspace for custom generators (null = global)',
      },
    },
  ],
  timestamps: true,
}
```

**Step 2: Register collection in payload.config.ts**

Add to imports:
```typescript
import { DeploymentGenerators } from './collections/DeploymentGenerators'
```

Add to collections array after Deployments:
```typescript
collections: [
  // ... existing collections
  Deployments,
  DeploymentGenerators,
  // ...
],
```

**Step 3: Verify server starts**

Run: `cd orbit-www && bun run dev`
Expected: Server starts, DeploymentGenerators collection visible in admin under "Catalog"

**Step 4: Commit**

```bash
git add orbit-www/src/collections/DeploymentGenerators.ts orbit-www/src/payload.config.ts
git commit -m "feat(catalog): add DeploymentGenerator collection schema"
```

---

## Task 2: Seed Built-in Docker Compose Generator

**Files:**
- Create: `orbit-www/src/lib/seeds/deployment-generators.ts`
- Modify: `orbit-www/src/app/actions/apps.ts` (add seeding utility)

**Step 1: Create generator seed data**

```typescript
// orbit-www/src/lib/seeds/deployment-generators.ts
export const builtInGenerators = [
  {
    name: 'Docker Compose (Basic)',
    slug: 'docker-compose-basic',
    description: 'Deploy to a Docker host using docker-compose',
    type: 'docker-compose' as const,
    isBuiltIn: true,
    configSchema: {
      type: 'object',
      required: ['hostUrl', 'serviceName'],
      properties: {
        hostUrl: {
          type: 'string',
          description: 'Docker host URL (e.g., ssh://user@host or unix:///var/run/docker.sock)',
        },
        serviceName: {
          type: 'string',
          description: 'Service name for the deployment',
        },
        imageTag: {
          type: 'string',
          description: 'Docker image tag to deploy',
          default: 'latest',
        },
        port: {
          type: 'number',
          description: 'Port to expose',
          default: 3000,
        },
        envVars: {
          type: 'object',
          description: 'Environment variables',
          additionalProperties: { type: 'string' },
        },
      },
    },
    templateFiles: [
      {
        path: 'docker-compose.yml',
        content: `version: '3.8'

services:
  {{serviceName}}:
    image: {{imageRepository}}:{{imageTag}}
    ports:
      - "{{port}}:{{port}}"
    environment:
{{#each envVars}}
      {{@key}}: "{{this}}"
{{/each}}
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:{{port}}/health"]
      interval: 30s
      timeout: 10s
      retries: 3
`,
      },
    ],
  },
]
```

**Step 2: Add seeding server action**

Add to `orbit-www/src/app/actions/apps.ts`:

```typescript
import { builtInGenerators } from '@/lib/seeds/deployment-generators'

export async function seedBuiltInGenerators() {
  const payload = await getPayload({ config })

  for (const generator of builtInGenerators) {
    // Check if already exists
    const existing = await payload.find({
      collection: 'deployment-generators',
      where: { slug: { equals: generator.slug } },
      limit: 1,
    })

    if (existing.docs.length === 0) {
      await payload.create({
        collection: 'deployment-generators',
        data: generator,
      })
      console.log(`Created built-in generator: ${generator.name}`)
    }
  }

  return { success: true }
}
```

**Step 3: Commit**

```bash
git add orbit-www/src/lib/seeds/deployment-generators.ts orbit-www/src/app/actions/apps.ts
git commit -m "feat(catalog): add built-in Docker Compose generator seed"
```

---

## Task 3: Add Deployment Proto Definitions

**Files:**
- Modify: `proto/temporal.proto` (add deployment messages)

**Step 1: Add deployment workflow messages to temporal.proto**

Add after existing workflow messages:

```protobuf
// Deployment Workflow
message DeploymentWorkflowRequest {
  string request_id = 1;
  string deployment_id = 2;
  string app_id = 3;
  string workspace_id = 4;
  string user_id = 5;
  string generator_type = 6;  // docker-compose, terraform, helm
  string generator_slug = 7;  // specific generator (e.g., docker-compose-basic)
  bytes config = 8;           // JSON-encoded generator config
  DeploymentTarget target = 9;
}

message DeploymentTarget {
  string type = 1;     // kubernetes, aws-ecs, docker-host
  string region = 2;
  string cluster = 3;
  string host_url = 4; // For docker-compose: ssh://user@host
}

message DeploymentWorkflowResponse {
  string request_id = 1;
  string deployment_id = 2;
  WorkflowStatus status = 3;
  string deployment_url = 4;
  repeated WorkflowStep steps = 5;
  optional string error_message = 6;
  google.protobuf.Timestamp completed_at = 7;
}

// Deployment Activities
message ValidateDeploymentConfigActivityRequest {
  string generator_type = 1;
  bytes config = 2;
  bytes config_schema = 3;
}

message ValidateDeploymentConfigActivityResponse {
  bool valid = 1;
  repeated string validation_errors = 2;
}

message PrepareGeneratorContextActivityRequest {
  string deployment_id = 1;
  string app_id = 2;
  string generator_slug = 3;
  bytes config = 4;
}

message PrepareGeneratorContextActivityResponse {
  string work_dir = 1;
  bool success = 2;
  optional string error_message = 3;
}

message ExecuteGeneratorActivityRequest {
  string deployment_id = 1;
  string generator_type = 2;
  string work_dir = 3;
  DeploymentTarget target = 4;
}

message ExecuteGeneratorActivityResponse {
  bool success = 1;
  string deployment_url = 2;
  map<string, string> outputs = 3;
  optional string error_message = 4;
}

message UpdateDeploymentStatusActivityRequest {
  string deployment_id = 1;
  string status = 2;  // pending, deploying, deployed, failed
  optional string deployment_url = 3;
  optional string error_message = 4;
}

message UpdateDeploymentStatusActivityResponse {
  bool success = 1;
}
```

**Step 2: Add to WorkflowService**

Add to the WorkflowService definition:

```protobuf
// Start deployment workflow
rpc StartDeployment(DeploymentWorkflowRequest) returns (WorkflowExecutionResponse);
```

**Step 3: Generate proto code**

Run: `make proto-gen`
Expected: Go and TypeScript code generated without errors

**Step 4: Commit**

```bash
git add proto/temporal.proto
git commit -m "feat(catalog): add deployment workflow proto definitions"
```

---

## Task 4: Create Deployment Workflow in Temporal

**Files:**
- Create: `temporal-workflows/internal/workflows/deployment_workflow.go`
- Create: `temporal-workflows/internal/workflows/deployment_workflow_test.go`

**Step 1: Write the failing test**

```go
// temporal-workflows/internal/workflows/deployment_workflow_test.go
package workflows

import (
	"testing"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/testsuite"
)

func TestDeploymentWorkflow_Success(t *testing.T) {
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestWorkflowEnvironment()

	input := DeploymentWorkflowInput{
		DeploymentID:   "deploy-123",
		AppID:          "app-456",
		WorkspaceID:    "ws-789",
		UserID:         "user-001",
		GeneratorType:  "docker-compose",
		GeneratorSlug:  "docker-compose-basic",
		Config:         []byte(`{"hostUrl":"unix:///var/run/docker.sock","serviceName":"my-app","port":3000}`),
		Target: DeploymentTargetInput{
			Type:    "docker-host",
			HostURL: "unix:///var/run/docker.sock",
		},
	}

	// Mock activities
	env.OnActivity(ActivityValidateDeploymentConfig, mock.Anything, mock.Anything).Return(nil)
	env.OnActivity(ActivityPrepareGeneratorContext, mock.Anything, mock.Anything).Return("/tmp/deploy-123", nil)
	env.OnActivity(ActivityExecuteGenerator, mock.Anything, mock.Anything).Return(&ExecuteGeneratorResult{
		Success:       true,
		DeploymentURL: "http://localhost:3000",
	}, nil)
	env.OnActivity(ActivityUpdateDeploymentStatus, mock.Anything, mock.Anything).Return(nil)
	env.OnActivity(ActivityCleanupWorkDir, mock.Anything, mock.Anything).Return(nil)

	env.ExecuteWorkflow(DeploymentWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var result DeploymentWorkflowResult
	require.NoError(t, env.GetWorkflowResult(&result))
	require.Equal(t, "completed", result.Status)
	require.Equal(t, "http://localhost:3000", result.DeploymentURL)
}

func TestDeploymentWorkflow_ValidationFailure(t *testing.T) {
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestWorkflowEnvironment()

	input := DeploymentWorkflowInput{
		DeploymentID:  "deploy-123",
		AppID:         "app-456",
		WorkspaceID:   "ws-789",
		UserID:        "user-001",
		GeneratorType: "docker-compose",
		GeneratorSlug: "docker-compose-basic",
		Config:        []byte(`{}`), // Missing required fields
		Target: DeploymentTargetInput{
			Type: "docker-host",
		},
	}

	// Mock validation failure
	env.OnActivity(ActivityValidateDeploymentConfig, mock.Anything, mock.Anything).
		Return(fmt.Errorf("validation failed: missing required field 'hostUrl'"))
	env.OnActivity(ActivityUpdateDeploymentStatus, mock.Anything, mock.Anything).Return(nil)

	env.ExecuteWorkflow(DeploymentWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())

	var result DeploymentWorkflowResult
	require.NoError(t, env.GetWorkflowResult(&result))
	require.Equal(t, "failed", result.Status)
	require.Contains(t, result.Error, "validation failed")
}
```

**Step 2: Run test to verify it fails**

Run: `cd temporal-workflows && go test -v -run TestDeploymentWorkflow ./internal/workflows/`
Expected: FAIL (types not defined)

**Step 3: Write the workflow implementation**

```go
// temporal-workflows/internal/workflows/deployment_workflow.go
package workflows

import (
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// DeploymentWorkflowInput contains all parameters for deployment
type DeploymentWorkflowInput struct {
	DeploymentID  string                `json:"deploymentId"`
	AppID         string                `json:"appId"`
	WorkspaceID   string                `json:"workspaceId"`
	UserID        string                `json:"userId"`
	GeneratorType string                `json:"generatorType"`
	GeneratorSlug string                `json:"generatorSlug"`
	Config        []byte                `json:"config"`
	Target        DeploymentTargetInput `json:"target"`
}

// DeploymentTargetInput contains deployment target information
type DeploymentTargetInput struct {
	Type    string `json:"type"`
	Region  string `json:"region,omitempty"`
	Cluster string `json:"cluster,omitempty"`
	HostURL string `json:"hostUrl,omitempty"`
}

// DeploymentWorkflowResult contains the workflow result
type DeploymentWorkflowResult struct {
	Status        string `json:"status"` // completed, failed
	DeploymentURL string `json:"deploymentUrl,omitempty"`
	Error         string `json:"error,omitempty"`
}

// DeploymentProgress tracks workflow progress
type DeploymentProgress struct {
	CurrentStep  string `json:"currentStep"`
	StepsTotal   int    `json:"stepsTotal"`
	StepsCurrent int    `json:"stepsCurrent"`
	Message      string `json:"message"`
}

// ExecuteGeneratorResult contains generator execution result
type ExecuteGeneratorResult struct {
	Success       bool              `json:"success"`
	DeploymentURL string            `json:"deploymentUrl"`
	Outputs       map[string]string `json:"outputs"`
	Error         string            `json:"error,omitempty"`
}

// Activity names
const (
	ActivityValidateDeploymentConfig = "ValidateDeploymentConfig"
	ActivityPrepareGeneratorContext  = "PrepareGeneratorContext"
	ActivityExecuteGenerator         = "ExecuteGenerator"
	ActivityUpdateDeploymentStatus   = "UpdateDeploymentStatus"
)

// DeploymentWorkflow orchestrates application deployment
func DeploymentWorkflow(ctx workflow.Context, input DeploymentWorkflowInput) (*DeploymentWorkflowResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting deployment workflow",
		"deploymentID", input.DeploymentID,
		"generatorType", input.GeneratorType)

	// Progress tracking
	progress := DeploymentProgress{
		CurrentStep:  "initializing",
		StepsTotal:   5,
		StepsCurrent: 0,
		Message:      "Starting deployment",
	}

	// Set up query handler
	err := workflow.SetQueryHandler(ctx, "progress", func() (DeploymentProgress, error) {
		return progress, nil
	})
	if err != nil {
		return &DeploymentWorkflowResult{
			Status: "failed",
			Error:  "failed to set up progress tracking: " + err.Error(),
		}, err
	}

	// Activity options
	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 15 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	// Helper to update status on failure
	updateStatusOnFailure := func(errMsg string) {
		statusInput := UpdateDeploymentStatusInput{
			DeploymentID: input.DeploymentID,
			Status:       "failed",
			ErrorMessage: errMsg,
		}
		_ = workflow.ExecuteActivity(ctx, ActivityUpdateDeploymentStatus, statusInput).Get(ctx, nil)
	}

	// Step 1: Update status to deploying
	progress.CurrentStep = "updating status"
	progress.StepsCurrent = 1
	progress.Message = "Initializing deployment"

	statusInput := UpdateDeploymentStatusInput{
		DeploymentID: input.DeploymentID,
		Status:       "deploying",
	}
	err = workflow.ExecuteActivity(ctx, ActivityUpdateDeploymentStatus, statusInput).Get(ctx, nil)
	if err != nil {
		logger.Error("Failed to update deployment status", "error", err)
		return &DeploymentWorkflowResult{
			Status: "failed",
			Error:  "failed to update status: " + err.Error(),
		}, err
	}

	// Step 2: Validate configuration
	progress.CurrentStep = "validating"
	progress.StepsCurrent = 2
	progress.Message = "Validating deployment configuration"

	validateInput := ValidateDeploymentConfigInput{
		GeneratorType: input.GeneratorType,
		Config:        input.Config,
	}
	err = workflow.ExecuteActivity(ctx, ActivityValidateDeploymentConfig, validateInput).Get(ctx, nil)
	if err != nil {
		logger.Error("Validation failed", "error", err)
		updateStatusOnFailure("validation failed: " + err.Error())
		return &DeploymentWorkflowResult{
			Status: "failed",
			Error:  "validation failed: " + err.Error(),
		}, nil
	}

	// Step 3: Prepare generator context
	progress.CurrentStep = "preparing"
	progress.StepsCurrent = 3
	progress.Message = "Preparing deployment files"

	prepareInput := PrepareGeneratorContextInput{
		DeploymentID:  input.DeploymentID,
		AppID:         input.AppID,
		GeneratorSlug: input.GeneratorSlug,
		Config:        input.Config,
	}
	var workDir string
	err = workflow.ExecuteActivity(ctx, ActivityPrepareGeneratorContext, prepareInput).Get(ctx, &workDir)
	if err != nil {
		logger.Error("Failed to prepare context", "error", err)
		updateStatusOnFailure("failed to prepare deployment: " + err.Error())
		return &DeploymentWorkflowResult{
			Status: "failed",
			Error:  "failed to prepare deployment: " + err.Error(),
		}, nil
	}

	// Step 4: Execute generator
	progress.CurrentStep = "deploying"
	progress.StepsCurrent = 4
	progress.Message = "Executing deployment"

	executeInput := ExecuteGeneratorInput{
		DeploymentID:  input.DeploymentID,
		GeneratorType: input.GeneratorType,
		WorkDir:       workDir,
		Target:        input.Target,
	}
	var executeResult ExecuteGeneratorResult
	err = workflow.ExecuteActivity(ctx, ActivityExecuteGenerator, executeInput).Get(ctx, &executeResult)

	// Cleanup work dir regardless of result
	_ = workflow.ExecuteActivity(ctx, ActivityCleanupWorkDir, workDir).Get(ctx, nil)

	if err != nil || !executeResult.Success {
		errMsg := "deployment execution failed"
		if err != nil {
			errMsg = err.Error()
		} else if executeResult.Error != "" {
			errMsg = executeResult.Error
		}
		logger.Error("Deployment failed", "error", errMsg)
		updateStatusOnFailure(errMsg)
		return &DeploymentWorkflowResult{
			Status: "failed",
			Error:  errMsg,
		}, nil
	}

	// Step 5: Update status to deployed
	progress.CurrentStep = "finalizing"
	progress.StepsCurrent = 5
	progress.Message = "Finalizing deployment"

	statusInput = UpdateDeploymentStatusInput{
		DeploymentID:  input.DeploymentID,
		Status:        "deployed",
		DeploymentURL: executeResult.DeploymentURL,
	}
	err = workflow.ExecuteActivity(ctx, ActivityUpdateDeploymentStatus, statusInput).Get(ctx, nil)
	if err != nil {
		logger.Error("Failed to update final status", "error", err)
	}

	progress.CurrentStep = "completed"
	progress.Message = "Deployment completed successfully"

	logger.Info("Deployment workflow completed",
		"deploymentID", input.DeploymentID,
		"url", executeResult.DeploymentURL)

	return &DeploymentWorkflowResult{
		Status:        "completed",
		DeploymentURL: executeResult.DeploymentURL,
	}, nil
}

// Activity input types
type ValidateDeploymentConfigInput struct {
	GeneratorType string `json:"generatorType"`
	Config        []byte `json:"config"`
}

type PrepareGeneratorContextInput struct {
	DeploymentID  string `json:"deploymentId"`
	AppID         string `json:"appId"`
	GeneratorSlug string `json:"generatorSlug"`
	Config        []byte `json:"config"`
}

type ExecuteGeneratorInput struct {
	DeploymentID  string                `json:"deploymentId"`
	GeneratorType string                `json:"generatorType"`
	WorkDir       string                `json:"workDir"`
	Target        DeploymentTargetInput `json:"target"`
}

type UpdateDeploymentStatusInput struct {
	DeploymentID  string `json:"deploymentId"`
	Status        string `json:"status"`
	DeploymentURL string `json:"deploymentUrl,omitempty"`
	ErrorMessage  string `json:"errorMessage,omitempty"`
}
```

**Step 4: Run test to verify it passes**

Run: `cd temporal-workflows && go test -v -run TestDeploymentWorkflow ./internal/workflows/`
Expected: PASS

**Step 5: Commit**

```bash
git add temporal-workflows/internal/workflows/deployment_workflow.go temporal-workflows/internal/workflows/deployment_workflow_test.go
git commit -m "feat(catalog): add DeploymentWorkflow for app deployments"
```

---

## Task 5: Create Deployment Activities

**Files:**
- Create: `temporal-workflows/internal/activities/deployment_activities.go`
- Create: `temporal-workflows/internal/activities/deployment_activities_test.go`

**Step 1: Write the failing test**

```go
// temporal-workflows/internal/activities/deployment_activities_test.go
package activities

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
	"log/slog"
)

func TestValidateDeploymentConfig_DockerCompose_Valid(t *testing.T) {
	activities := NewDeploymentActivities("/tmp/test", nil, slog.Default())

	config := map[string]interface{}{
		"hostUrl":     "unix:///var/run/docker.sock",
		"serviceName": "my-app",
		"port":        3000,
	}
	configBytes, _ := json.Marshal(config)

	input := ValidateDeploymentConfigInput{
		GeneratorType: "docker-compose",
		Config:        configBytes,
	}

	err := activities.ValidateDeploymentConfig(context.Background(), input)
	require.NoError(t, err)
}

func TestValidateDeploymentConfig_DockerCompose_MissingRequired(t *testing.T) {
	activities := NewDeploymentActivities("/tmp/test", nil, slog.Default())

	config := map[string]interface{}{
		"port": 3000,
		// Missing hostUrl and serviceName
	}
	configBytes, _ := json.Marshal(config)

	input := ValidateDeploymentConfigInput{
		GeneratorType: "docker-compose",
		Config:        configBytes,
	}

	err := activities.ValidateDeploymentConfig(context.Background(), input)
	require.Error(t, err)
	require.Contains(t, err.Error(), "hostUrl")
}
```

**Step 2: Run test to verify it fails**

Run: `cd temporal-workflows && go test -v -run TestValidateDeploymentConfig ./internal/activities/`
Expected: FAIL (types not defined)

**Step 3: Write the activities implementation**

```go
// temporal-workflows/internal/activities/deployment_activities.go
package activities

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"text/template"

	"github.com/drewpayment/orbit/temporal-workflows/internal/workflows"
)

// PayloadDeploymentClient defines interface for Payload CMS operations
type PayloadDeploymentClient interface {
	GetGeneratorBySlug(ctx context.Context, slug string) (*GeneratorData, error)
	UpdateDeploymentStatus(ctx context.Context, deploymentID, status, url, errorMsg string) error
}

// GeneratorData represents a deployment generator from Payload
type GeneratorData struct {
	Name          string                   `json:"name"`
	Slug          string                   `json:"slug"`
	Type          string                   `json:"type"`
	ConfigSchema  json.RawMessage          `json:"configSchema"`
	TemplateFiles []GeneratorTemplateFile  `json:"templateFiles"`
}

// GeneratorTemplateFile represents a template file in a generator
type GeneratorTemplateFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

// DeploymentActivities holds dependencies for deployment activities
type DeploymentActivities struct {
	workDir       string
	payloadClient PayloadDeploymentClient
	logger        *slog.Logger
}

// NewDeploymentActivities creates a new instance
func NewDeploymentActivities(workDir string, payloadClient PayloadDeploymentClient, logger *slog.Logger) *DeploymentActivities {
	if logger == nil {
		logger = slog.Default()
	}
	return &DeploymentActivities{
		workDir:       workDir,
		payloadClient: payloadClient,
		logger:        logger,
	}
}

// ValidateDeploymentConfigInput contains validation parameters
type ValidateDeploymentConfigInput struct {
	GeneratorType string `json:"generatorType"`
	Config        []byte `json:"config"`
}

// ValidateDeploymentConfig validates the deployment configuration
func (a *DeploymentActivities) ValidateDeploymentConfig(ctx context.Context, input ValidateDeploymentConfigInput) error {
	a.logger.Info("Validating deployment config", "generatorType", input.GeneratorType)

	var config map[string]interface{}
	if err := json.Unmarshal(input.Config, &config); err != nil {
		return fmt.Errorf("invalid JSON config: %w", err)
	}

	// Type-specific validation
	switch input.GeneratorType {
	case "docker-compose":
		return a.validateDockerComposeConfig(config)
	case "terraform":
		return a.validateTerraformConfig(config)
	case "helm":
		return a.validateHelmConfig(config)
	default:
		return fmt.Errorf("unsupported generator type: %s", input.GeneratorType)
	}
}

func (a *DeploymentActivities) validateDockerComposeConfig(config map[string]interface{}) error {
	required := []string{"hostUrl", "serviceName"}
	var missing []string

	for _, field := range required {
		if _, ok := config[field]; !ok {
			missing = append(missing, field)
		}
	}

	if len(missing) > 0 {
		return fmt.Errorf("missing required fields: %s", strings.Join(missing, ", "))
	}

	return nil
}

func (a *DeploymentActivities) validateTerraformConfig(config map[string]interface{}) error {
	// Placeholder for terraform validation
	return nil
}

func (a *DeploymentActivities) validateHelmConfig(config map[string]interface{}) error {
	// Placeholder for helm validation
	return nil
}

// PrepareGeneratorContextInput contains preparation parameters
type PrepareGeneratorContextInput struct {
	DeploymentID  string `json:"deploymentId"`
	AppID         string `json:"appId"`
	GeneratorSlug string `json:"generatorSlug"`
	Config        []byte `json:"config"`
}

// PrepareGeneratorContext creates work directory and renders templates
func (a *DeploymentActivities) PrepareGeneratorContext(ctx context.Context, input PrepareGeneratorContextInput) (string, error) {
	a.logger.Info("Preparing generator context",
		"deploymentID", input.DeploymentID,
		"generatorSlug", input.GeneratorSlug)

	// Create work directory
	workDir := filepath.Join(a.workDir, fmt.Sprintf("deploy-%s", input.DeploymentID))
	if err := os.MkdirAll(workDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create work directory: %w", err)
	}

	// Get generator from Payload
	if a.payloadClient == nil {
		// For now, use default docker-compose template if no client
		return a.prepareDefaultDockerCompose(workDir, input.Config)
	}

	generator, err := a.payloadClient.GetGeneratorBySlug(ctx, input.GeneratorSlug)
	if err != nil {
		_ = os.RemoveAll(workDir)
		return "", fmt.Errorf("failed to get generator: %w", err)
	}

	// Parse config
	var config map[string]interface{}
	if err := json.Unmarshal(input.Config, &config); err != nil {
		_ = os.RemoveAll(workDir)
		return "", fmt.Errorf("failed to parse config: %w", err)
	}

	// Render template files
	for _, tf := range generator.TemplateFiles {
		tmpl, err := template.New(tf.Path).Parse(tf.Content)
		if err != nil {
			_ = os.RemoveAll(workDir)
			return "", fmt.Errorf("failed to parse template %s: %w", tf.Path, err)
		}

		filePath := filepath.Join(workDir, tf.Path)
		f, err := os.Create(filePath)
		if err != nil {
			_ = os.RemoveAll(workDir)
			return "", fmt.Errorf("failed to create file %s: %w", tf.Path, err)
		}

		if err := tmpl.Execute(f, config); err != nil {
			f.Close()
			_ = os.RemoveAll(workDir)
			return "", fmt.Errorf("failed to render template %s: %w", tf.Path, err)
		}
		f.Close()
	}

	a.logger.Info("Generator context prepared", "workDir", workDir)
	return workDir, nil
}

func (a *DeploymentActivities) prepareDefaultDockerCompose(workDir string, configBytes []byte) (string, error) {
	var config map[string]interface{}
	if err := json.Unmarshal(configBytes, &config); err != nil {
		return "", fmt.Errorf("failed to parse config: %w", err)
	}

	serviceName := "app"
	if sn, ok := config["serviceName"].(string); ok {
		serviceName = sn
	}

	port := 3000
	if p, ok := config["port"].(float64); ok {
		port = int(p)
	}

	imageTag := "latest"
	if it, ok := config["imageTag"].(string); ok {
		imageTag = it
	}

	imageRepo := "your-image"
	if ir, ok := config["imageRepository"].(string); ok {
		imageRepo = ir
	}

	composeContent := fmt.Sprintf(`version: '3.8'

services:
  %s:
    image: %s:%s
    ports:
      - "%d:%d"
    restart: unless-stopped
`, serviceName, imageRepo, imageTag, port, port)

	composePath := filepath.Join(workDir, "docker-compose.yml")
	if err := os.WriteFile(composePath, []byte(composeContent), 0644); err != nil {
		return "", fmt.Errorf("failed to write docker-compose.yml: %w", err)
	}

	return workDir, nil
}

// ExecuteGeneratorInput contains execution parameters
type ExecuteGeneratorInput struct {
	DeploymentID  string                          `json:"deploymentId"`
	GeneratorType string                          `json:"generatorType"`
	WorkDir       string                          `json:"workDir"`
	Target        workflows.DeploymentTargetInput `json:"target"`
}

// ExecuteGenerator runs the deployment generator
func (a *DeploymentActivities) ExecuteGenerator(ctx context.Context, input ExecuteGeneratorInput) (*workflows.ExecuteGeneratorResult, error) {
	a.logger.Info("Executing generator",
		"deploymentID", input.DeploymentID,
		"generatorType", input.GeneratorType,
		"workDir", input.WorkDir)

	switch input.GeneratorType {
	case "docker-compose":
		return a.executeDockerCompose(ctx, input)
	case "terraform":
		return nil, errors.New("terraform generator not implemented")
	case "helm":
		return nil, errors.New("helm generator not implemented")
	default:
		return nil, fmt.Errorf("unsupported generator type: %s", input.GeneratorType)
	}
}

func (a *DeploymentActivities) executeDockerCompose(ctx context.Context, input ExecuteGeneratorInput) (*workflows.ExecuteGeneratorResult, error) {
	// Build docker-compose command
	args := []string{"compose", "-f", filepath.Join(input.WorkDir, "docker-compose.yml")}

	// Add host if specified
	if input.Target.HostURL != "" {
		args = append([]string{"-H", input.Target.HostURL}, args...)
	}

	args = append(args, "up", "-d")

	cmd := exec.CommandContext(ctx, "docker", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		a.logger.Error("Docker compose failed",
			"error", err,
			"output", string(output))
		return &workflows.ExecuteGeneratorResult{
			Success: false,
			Error:   fmt.Sprintf("docker compose failed: %s", string(output)),
		}, nil
	}

	a.logger.Info("Docker compose executed successfully")

	// For local deployments, return localhost URL
	deploymentURL := "http://localhost:3000"
	if input.Target.HostURL != "" && !strings.HasPrefix(input.Target.HostURL, "unix://") {
		// Extract host from URL
		host := strings.TrimPrefix(input.Target.HostURL, "ssh://")
		host = strings.TrimPrefix(host, "tcp://")
		if idx := strings.Index(host, "@"); idx != -1 {
			host = host[idx+1:]
		}
		if idx := strings.Index(host, ":"); idx != -1 {
			host = host[:idx]
		}
		deploymentURL = fmt.Sprintf("http://%s:3000", host)
	}

	return &workflows.ExecuteGeneratorResult{
		Success:       true,
		DeploymentURL: deploymentURL,
		Outputs:       map[string]string{"compose_output": string(output)},
	}, nil
}

// UpdateDeploymentStatusInput contains status update parameters
type UpdateDeploymentStatusInput struct {
	DeploymentID  string `json:"deploymentId"`
	Status        string `json:"status"`
	DeploymentURL string `json:"deploymentUrl,omitempty"`
	ErrorMessage  string `json:"errorMessage,omitempty"`
}

// UpdateDeploymentStatus updates the deployment status in Payload
func (a *DeploymentActivities) UpdateDeploymentStatus(ctx context.Context, input UpdateDeploymentStatusInput) error {
	a.logger.Info("Updating deployment status",
		"deploymentID", input.DeploymentID,
		"status", input.Status)

	if a.payloadClient == nil {
		// Log and return success if no client (for testing)
		a.logger.Warn("No Payload client configured, skipping status update")
		return nil
	}

	return a.payloadClient.UpdateDeploymentStatus(
		ctx,
		input.DeploymentID,
		input.Status,
		input.DeploymentURL,
		input.ErrorMessage,
	)
}
```

**Step 4: Run test to verify it passes**

Run: `cd temporal-workflows && go test -v -run TestValidateDeploymentConfig ./internal/activities/`
Expected: PASS

**Step 5: Commit**

```bash
git add temporal-workflows/internal/activities/deployment_activities.go temporal-workflows/internal/activities/deployment_activities_test.go
git commit -m "feat(catalog): add deployment activities for Docker Compose"
```

---

## Task 6: Register Deployment Workflow in Worker

**Files:**
- Modify: `temporal-workflows/cmd/worker/main.go`

**Step 1: Add imports and registration**

Add to imports:
```go
// Already imported: workflows, activities
```

Add after template activities registration:
```go
// Deployment work directory
deploymentWorkDir := os.Getenv("DEPLOYMENT_WORK_DIR")
if deploymentWorkDir == "" {
    deploymentWorkDir = "/tmp/orbit-deployments"
}

// Register deployment workflow
w.RegisterWorkflow(workflows.DeploymentWorkflow)

// Create and register deployment activities
// TODO: Create PayloadDeploymentClient when implementing full integration
var deploymentPayloadClient activities.PayloadDeploymentClient = nil
deploymentActivities := activities.NewDeploymentActivities(
    deploymentWorkDir,
    deploymentPayloadClient,
    logger,
)
w.RegisterActivity(deploymentActivities.ValidateDeploymentConfig)
w.RegisterActivity(deploymentActivities.PrepareGeneratorContext)
w.RegisterActivity(deploymentActivities.ExecuteGenerator)
w.RegisterActivity(deploymentActivities.UpdateDeploymentStatus)
```

Add to log output:
```go
log.Printf("Deployment work directory: %s", deploymentWorkDir)
```

**Step 2: Verify build**

Run: `cd temporal-workflows && go build ./cmd/worker/`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add temporal-workflows/cmd/worker/main.go
git commit -m "feat(catalog): register DeploymentWorkflow in Temporal worker"
```

---

## Task 7: Create Add Deployment Modal Component

**Files:**
- Create: `orbit-www/src/components/features/apps/AddDeploymentModal.tsx`

**Step 1: Create the modal component**

```typescript
// orbit-www/src/components/features/apps/AddDeploymentModal.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2 } from 'lucide-react'
import { createDeployment } from '@/app/actions/deployments'

const formSchema = z.object({
  name: z.string().min(1, 'Name is required').max(50),
  generator: z.enum(['docker-compose', 'terraform', 'helm', 'custom']),
  targetType: z.string().min(1, 'Target type is required'),
  hostUrl: z.string().optional(),
  serviceName: z.string().min(1, 'Service name is required'),
  imageRepository: z.string().min(1, 'Image repository is required'),
  imageTag: z.string().default('latest'),
  port: z.coerce.number().min(1).max(65535).default(3000),
})

type FormData = z.infer<typeof formSchema>

interface AddDeploymentModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  appId: string
  appName: string
}

export function AddDeploymentModal({
  open,
  onOpenChange,
  appId,
  appName,
}: AddDeploymentModalProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: 'production',
      generator: 'docker-compose',
      targetType: 'docker-host',
      hostUrl: 'unix:///var/run/docker.sock',
      serviceName: appName.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      imageRepository: '',
      imageTag: 'latest',
      port: 3000,
    },
  })

  const onSubmit = async (data: FormData) => {
    setIsSubmitting(true)
    try {
      const config = {
        hostUrl: data.hostUrl,
        serviceName: data.serviceName,
        imageRepository: data.imageRepository,
        imageTag: data.imageTag,
        port: data.port,
      }

      const result = await createDeployment({
        appId,
        name: data.name,
        generator: data.generator,
        config,
        target: {
          type: data.targetType,
          hostUrl: data.hostUrl,
        },
      })

      if (result.success && result.deploymentId) {
        onOpenChange(false)
        router.refresh()
      } else {
        form.setError('root', { message: result.error || 'Failed to create deployment' })
      }
    } catch {
      form.setError('root', { message: 'An unexpected error occurred' })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Deployment</DialogTitle>
          <DialogDescription>
            Configure a new deployment for {appName}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Deployment Name</FormLabel>
                  <FormControl>
                    <Input placeholder="production" {...field} />
                  </FormControl>
                  <FormDescription>
                    e.g., production, staging, development
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="generator"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Deployment Method</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select method" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="docker-compose">Docker Compose</SelectItem>
                      <SelectItem value="terraform" disabled>Terraform (Coming Soon)</SelectItem>
                      <SelectItem value="helm" disabled>Helm (Coming Soon)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="targetType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Target Type</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select target" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="docker-host">Docker Host</SelectItem>
                      <SelectItem value="kubernetes" disabled>Kubernetes (Coming Soon)</SelectItem>
                      <SelectItem value="aws-ecs" disabled>AWS ECS (Coming Soon)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="hostUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Docker Host URL</FormLabel>
                  <FormControl>
                    <Input placeholder="unix:///var/run/docker.sock" {...field} />
                  </FormControl>
                  <FormDescription>
                    Local socket or remote host (ssh://user@host)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="imageRepository"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Image Repository</FormLabel>
                    <FormControl>
                      <Input placeholder="ghcr.io/org/app" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="imageTag"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Image Tag</FormLabel>
                    <FormControl>
                      <Input placeholder="latest" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="serviceName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Service Name</FormLabel>
                    <FormControl>
                      <Input placeholder="my-app" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="port"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Port</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="3000" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {form.formState.errors.root && (
              <p className="text-sm text-destructive">
                {form.formState.errors.root.message}
              </p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Deployment'
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/components/features/apps/AddDeploymentModal.tsx
git commit -m "feat(catalog): add AddDeploymentModal component"
```

---

## Task 8: Create Deployment Server Actions

**Files:**
- Create: `orbit-www/src/app/actions/deployments.ts`

**Step 1: Create the server actions**

```typescript
// orbit-www/src/app/actions/deployments.ts
'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'

interface CreateDeploymentInput {
  appId: string
  name: string
  generator: 'docker-compose' | 'terraform' | 'helm' | 'custom'
  config: Record<string, unknown>
  target: {
    type: string
    region?: string
    cluster?: string
    hostUrl?: string
  }
}

export async function createDeployment(input: CreateDeploymentInput) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  // Verify user has access to the app
  const app = await payload.findByID({
    collection: 'apps',
    id: input.appId,
    depth: 1,
  })

  if (!app) {
    return { success: false, error: 'App not found' }
  }

  const workspaceId = typeof app.workspace === 'string'
    ? app.workspace
    : app.workspace.id

  // Check workspace membership
  const members = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { user: { equals: session.user.id } },
        { status: { equals: 'active' } },
      ],
    },
  })

  if (members.docs.length === 0) {
    return { success: false, error: 'Not a member of this workspace' }
  }

  try {
    // Create deployment record
    const deployment = await payload.create({
      collection: 'deployments',
      data: {
        name: input.name,
        app: input.appId,
        generator: input.generator,
        config: input.config,
        target: {
          type: input.target.type,
          region: input.target.region || '',
          cluster: input.target.cluster || '',
          url: '', // Will be set after deployment
        },
        status: 'pending',
        healthStatus: 'unknown',
      },
    })

    // TODO: Start Temporal workflow
    // For now, just return the deployment ID
    // In future: call repository-service gRPC to start DeploymentWorkflow

    return { success: true, deploymentId: deployment.id }
  } catch (error) {
    console.error('Failed to create deployment:', error)
    return { success: false, error: 'Failed to create deployment' }
  }
}

export async function startDeployment(deploymentId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  // Get deployment with app for access check
  const deployment = await payload.findByID({
    collection: 'deployments',
    id: deploymentId,
    depth: 2,
  })

  if (!deployment) {
    return { success: false, error: 'Deployment not found' }
  }

  // Update status to deploying
  await payload.update({
    collection: 'deployments',
    id: deploymentId,
    data: {
      status: 'deploying',
    },
  })

  // TODO: Start Temporal workflow via gRPC
  // For now, simulate with a timeout

  return { success: true, workflowId: `deploy-${deploymentId}` }
}

export async function getDeploymentStatus(deploymentId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return null
  }

  const payload = await getPayload({ config })

  const deployment = await payload.findByID({
    collection: 'deployments',
    id: deploymentId,
    depth: 1,
  })

  if (!deployment) {
    return null
  }

  return {
    id: deployment.id,
    name: deployment.name,
    status: deployment.status,
    healthStatus: deployment.healthStatus,
    lastDeployedAt: deployment.lastDeployedAt,
    target: deployment.target,
    workflowId: deployment.workflowId,
    deploymentError: deployment.deploymentError,
  }
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/app/actions/deployments.ts
git commit -m "feat(catalog): add deployment server actions"
```

---

## Task 9: Wire Up Add Deployment Button in AppDetail

**Files:**
- Modify: `orbit-www/src/components/features/apps/AppDetail.tsx`

**Step 1: Import modal and add state**

Add imports:
```typescript
import { useState } from 'react'
import { AddDeploymentModal } from './AddDeploymentModal'
```

**Step 2: Add modal state and button handler**

Inside the component, add:
```typescript
const [showAddDeployment, setShowAddDeployment] = useState(false)
```

**Step 3: Update Add Deployment button**

Replace the existing button:
```typescript
<Button size="sm" onClick={() => setShowAddDeployment(true)}>
  <Plus className="mr-2 h-4 w-4" />
  Add Deployment
</Button>
```

**Step 4: Add modal at end of component**

Before the closing `</div>`:
```typescript
<AddDeploymentModal
  open={showAddDeployment}
  onOpenChange={setShowAddDeployment}
  appId={app.id}
  appName={app.name}
/>
```

**Step 5: Verify it works**

Run: `cd orbit-www && bun run dev`
Navigate to an app detail page and click "Add Deployment"
Expected: Modal opens with form

**Step 6: Commit**

```bash
git add orbit-www/src/components/features/apps/AppDetail.tsx
git commit -m "feat(catalog): wire up Add Deployment modal in AppDetail"
```

---

## Phase 2 Complete Checkpoint

At this point you should have:
- [x] DeploymentGenerator collection with built-in Docker Compose generator
- [x] Deployment proto definitions
- [x] DeploymentWorkflow in Temporal with tests
- [x] Deployment activities (validate, prepare, execute, update status)
- [x] Worker registration for deployment workflow
- [x] AddDeploymentModal UI component
- [x] Deployment server actions
- [x] Wired up Add Deployment button

**Verify:**
1. Run `cd temporal-workflows && go test ./...` - all tests pass
2. Run `cd orbit-www && bun run dev` - server starts
3. Navigate to /apps, create/import an app
4. Open app detail, click Add Deployment
5. Fill out form, click Create Deployment
6. Verify deployment appears in table with "pending" status

**Next Phase (Phase 3):** Health monitoring workflow, deployment progress UI, visual graph view

---

## Future Tasks (Not in Phase 2)

### Phase 3: Health Monitoring
- HealthCheckWorkflow (long-running Temporal workflow)
- Health status UI updates
- Alert notifications

### Phase 4: Visual Graph
- D3/React Flow visualization
- Template → App → Deployment lineage tree
- Interactive filtering

### Phase 5: Manifest System
- .orbit.yaml parsing
- Sync mode implementation
- GitHub webhook integration
