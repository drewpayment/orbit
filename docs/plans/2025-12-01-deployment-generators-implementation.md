# Deployment Generators Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Connect the existing deployment infrastructure to enable users to create deployments that generate docker-compose.yml files and commit them to the app's repository.

**Architecture:** The infrastructure largely exists (collections, workflow, activities). This plan focuses on: (1) adding gRPC endpoint to start DeploymentWorkflow, (2) modifying Docker Compose executor to generate-only (commit to repo, not run docker), (3) connecting the frontend to trigger workflows.

**Tech Stack:** Go 1.21+, Temporal, gRPC/Connect, Payload 3.0, Next.js 15, TypeScript

**Design Document:** `docs/plans/2025-12-01-deployment-generators-design.md`

---

## Current State Assessment

| Component | Status | Location |
|-----------|--------|----------|
| DeploymentGenerators collection | ✅ Exists | `orbit-www/src/collections/DeploymentGenerators.ts` |
| Deployments collection | ✅ Exists | `orbit-www/src/collections/Deployments.ts` |
| DeploymentWorkflow | ✅ Exists | `temporal-workflows/internal/workflows/deployment_workflow.go` |
| DeploymentActivities | ✅ Exists | `temporal-workflows/internal/activities/deployment_activities.go` |
| Server actions | ⚠️ Has TODO | `orbit-www/src/app/actions/deployments.ts` |
| gRPC endpoint | ❌ Missing | Need to create |
| Docker Compose executor | ⚠️ Runs docker | Needs generate-only mode |
| CommitToRepo activity | ❌ Missing | Need to create |

---

## Phase 1: Add Generate-Only Mode to Docker Compose Executor

### Task 1.1: Add CommitToRepo Activity

**Files:**
- Modify: `temporal-workflows/internal/activities/deployment_activities.go`

**Step 1: Add CommitToRepo input/output types**

Add after the existing types around line 97:

```go
type CommitToRepoInput struct {
	DeploymentID string            `json:"deploymentId"`
	AppID        string            `json:"appId"`
	WorkspaceID  string            `json:"workspaceId"`
	Files        []GeneratedFile   `json:"files"`
	CommitMessage string           `json:"commitMessage"`
}

type GeneratedFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type CommitToRepoResult struct {
	Success   bool   `json:"success"`
	CommitSHA string `json:"commitSha"`
	Error     string `json:"error,omitempty"`
}
```

**Step 2: Add CommitToRepo activity method**

Add after `UpdateDeploymentStatus` method:

```go
// CommitToRepo commits generated files to the app's repository
func (a *DeploymentActivities) CommitToRepo(ctx context.Context, input CommitToRepoInput) (*CommitToRepoResult, error) {
	a.logger.Info("Committing files to repository",
		"deploymentID", input.DeploymentID,
		"appID", input.AppID,
		"fileCount", len(input.Files))

	// For now, return success - will implement GitHub commit in next task
	// This is a placeholder that allows the workflow to complete
	return &CommitToRepoResult{
		Success:   true,
		CommitSHA: "placeholder-sha",
	}, nil
}
```

**Step 3: Verify it compiles**

Run: `cd temporal-workflows && go build ./...`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add temporal-workflows/internal/activities/deployment_activities.go
git commit -m "feat: add CommitToRepo activity placeholder for deployment generators"
```

---

### Task 1.2: Add Generate-Only Mode to ExecuteGenerator

**Files:**
- Modify: `temporal-workflows/internal/activities/deployment_activities.go`

**Step 1: Update ExecuteGeneratorInput to include mode**

Find `ExecuteGeneratorInput` and update:

```go
type ExecuteGeneratorInput struct {
	DeploymentID  string                `json:"deploymentId"`
	GeneratorType string                `json:"generatorType"`
	GeneratorSlug string                `json:"generatorSlug"`
	WorkDir       string                `json:"workDir"`
	Target        DeploymentTargetInput `json:"target"`
	Mode          string                `json:"mode"` // "generate" or "execute"
}
```

**Step 2: Update ExecuteGeneratorResult to include generated files**

```go
type ExecuteGeneratorResult struct {
	Success        bool              `json:"success"`
	DeploymentURL  string            `json:"deploymentUrl"`
	Outputs        map[string]string `json:"outputs"`
	Error          string            `json:"error,omitempty"`
	GeneratedFiles []GeneratedFile   `json:"generatedFiles,omitempty"` // For generate mode
}
```

**Step 3: Update executeDockerCompose for generate mode**

Replace the existing `executeDockerCompose` method:

```go
func (a *DeploymentActivities) executeDockerCompose(ctx context.Context, input ExecuteGeneratorInput) (*ExecuteGeneratorResult, error) {
	composeFilePath := filepath.Join(input.WorkDir, "docker-compose.yml")
	composeData, err := os.ReadFile(composeFilePath)
	if err != nil {
		return &ExecuteGeneratorResult{
			Success: false,
			Error:   fmt.Sprintf("failed to read docker-compose.yml: %v", err),
		}, nil
	}

	// Generate mode: return the files without executing
	if input.Mode == "generate" {
		a.logger.Info("Docker Compose generate mode - returning files for commit")
		return &ExecuteGeneratorResult{
			Success: true,
			GeneratedFiles: []GeneratedFile{
				{
					Path:    "docker-compose.yml",
					Content: string(composeData),
				},
			},
			Outputs: map[string]string{
				"mode": "generate",
				"file": "docker-compose.yml",
			},
		}, nil
	}

	// Execute mode: run docker compose (existing behavior)
	a.logger.Info("Docker Compose execute mode - running docker compose up")

	// Extract port from docker-compose file
	port := 3000
	lines := strings.Split(string(composeData), "\n")
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "- \"") && strings.Contains(trimmed, ":") {
			portStr := strings.TrimPrefix(trimmed, "- \"")
			portStr = strings.TrimSuffix(portStr, "\"")
			parts := strings.Split(portStr, ":")
			if len(parts) == 2 {
				if p, err := strconv.Atoi(parts[0]); err == nil {
					port = p
				}
			}
			break
		}
	}

	// Build docker-compose command
	args := []string{"compose", "-f", composeFilePath}
	if input.Target.HostURL != "" {
		args = append([]string{"-H", input.Target.HostURL}, args...)
	}
	args = append(args, "up", "-d")

	cmd := exec.CommandContext(ctx, "docker", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		a.logger.Error("Docker compose failed", "error", err, "output", string(output))
		return &ExecuteGeneratorResult{
			Success: false,
			Error:   fmt.Sprintf("docker compose failed: %s", string(output)),
		}, nil
	}

	deploymentURL := fmt.Sprintf("http://localhost:%d", port)
	if input.Target.HostURL != "" && !strings.HasPrefix(input.Target.HostURL, "unix://") {
		host := strings.TrimPrefix(input.Target.HostURL, "ssh://")
		host = strings.TrimPrefix(host, "tcp://")
		if idx := strings.Index(host, "@"); idx != -1 {
			host = host[idx+1:]
		}
		if idx := strings.Index(host, ":"); idx != -1 {
			host = host[:idx]
		}
		deploymentURL = fmt.Sprintf("http://%s:%d", host, port)
	}

	return &ExecuteGeneratorResult{
		Success:       true,
		DeploymentURL: deploymentURL,
		Outputs:       map[string]string{"compose_output": string(output)},
	}, nil
}
```

**Step 4: Verify it compiles**

Run: `cd temporal-workflows && go build ./...`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add temporal-workflows/internal/activities/deployment_activities.go
git commit -m "feat: add generate-only mode to Docker Compose executor"
```

---

### Task 1.3: Update DeploymentWorkflow to Support Generate Mode

**Files:**
- Modify: `temporal-workflows/internal/workflows/deployment_workflow.go`

**Step 1: Add Mode to workflow input**

Update `DeploymentWorkflowInput`:

```go
type DeploymentWorkflowInput struct {
	DeploymentID  string                `json:"deploymentId"`
	AppID         string                `json:"appId"`
	WorkspaceID   string                `json:"workspaceId"`
	UserID        string                `json:"userId"`
	GeneratorType string                `json:"generatorType"`
	GeneratorSlug string                `json:"generatorSlug"`
	Config        []byte                `json:"config"`
	Target        DeploymentTargetInput `json:"target"`
	Mode          string                `json:"mode"` // "generate" or "execute", defaults to "execute"
}
```

**Step 2: Add CommitToRepo activity input type**

Add after existing activity input types:

```go
type CommitToRepoInput struct {
	DeploymentID  string          `json:"deploymentId"`
	AppID         string          `json:"appId"`
	WorkspaceID   string          `json:"workspaceId"`
	Files         []GeneratedFile `json:"files"`
	CommitMessage string          `json:"commitMessage"`
}

type GeneratedFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type CommitToRepoResult struct {
	Success   bool   `json:"success"`
	CommitSHA string `json:"commitSha"`
	Error     string `json:"error,omitempty"`
}
```

**Step 3: Add activity constant**

Add to the const block:

```go
ActivityCommitToRepo = "CommitToRepo"
```

**Step 4: Update workflow to call CommitToRepo in generate mode**

In the `DeploymentWorkflow` function, find the section after `ActivityExecuteGenerator` (around line 178) and update:

```go
	// Step 4: Execute generator
	progress.CurrentStep = "deploying"
	progress.StepsCurrent = 4
	progress.Message = "Executing deployment"

	// Default mode to "execute" if not specified
	mode := input.Mode
	if mode == "" {
		mode = "execute"
	}

	executeInput := ExecuteGeneratorInput{
		DeploymentID:  input.DeploymentID,
		GeneratorType: input.GeneratorType,
		GeneratorSlug: input.GeneratorSlug,
		WorkDir:       workDir,
		Target:        input.Target,
		Mode:          mode,
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

	// Step 4b: If generate mode, commit files to repo
	if mode == "generate" && len(executeResult.GeneratedFiles) > 0 {
		progress.CurrentStep = "committing"
		progress.Message = "Committing generated files to repository"

		commitInput := CommitToRepoInput{
			DeploymentID:  input.DeploymentID,
			AppID:         input.AppID,
			WorkspaceID:   input.WorkspaceID,
			Files:         executeResult.GeneratedFiles,
			CommitMessage: fmt.Sprintf("chore(orbit): add deployment config via %s generator", input.GeneratorType),
		}
		var commitResult CommitToRepoResult
		err = workflow.ExecuteActivity(ctx, ActivityCommitToRepo, commitInput).Get(ctx, &commitResult)
		if err != nil || !commitResult.Success {
			errMsg := "failed to commit files to repository"
			if err != nil {
				errMsg = err.Error()
			} else if commitResult.Error != "" {
				errMsg = commitResult.Error
			}
			logger.Error("Commit failed", "error", errMsg)
			updateStatusOnFailure(errMsg)
			return &DeploymentWorkflowResult{
				Status: "failed",
				Error:  errMsg,
			}, nil
		}
	}

	// Step 5: Update status
	progress.CurrentStep = "finalizing"
	progress.StepsCurrent = 5
	progress.Message = "Finalizing deployment"

	// Set final status based on mode
	finalStatus := "deployed"
	if mode == "generate" {
		finalStatus = "generated"
	}

	statusInput = UpdateDeploymentStatusInput{
		DeploymentID:  input.DeploymentID,
		Status:        finalStatus,
		DeploymentURL: executeResult.DeploymentURL,
	}
```

**Step 5: Update ExecuteGeneratorInput type**

Update the existing type at the bottom of the file:

```go
type ExecuteGeneratorInput struct {
	DeploymentID  string                `json:"deploymentId"`
	GeneratorType string                `json:"generatorType"`
	GeneratorSlug string                `json:"generatorSlug"`
	WorkDir       string                `json:"workDir"`
	Target        DeploymentTargetInput `json:"target"`
	Mode          string                `json:"mode"`
}
```

**Step 6: Verify it compiles**

Run: `cd temporal-workflows && go build ./...`
Expected: Build succeeds

**Step 7: Commit**

```bash
git add temporal-workflows/internal/workflows/deployment_workflow.go
git commit -m "feat: update DeploymentWorkflow to support generate mode with CommitToRepo"
```

---

## Phase 2: Add gRPC Endpoint to Start Deployment Workflow

### Task 2.1: Create Deployment Proto Definition

**Files:**
- Create: `proto/idp/deployment/v1/deployment.proto`

**Step 1: Create the proto file**

```protobuf
syntax = "proto3";

package idp.deployment.v1;

option go_package = "github.com/drewpayment/orbit/proto/gen/go/idp/deployment/v1;deploymentv1";

// DeploymentService handles application deployment operations
service DeploymentService {
  // Start a new deployment workflow
  rpc StartDeployment(StartDeploymentRequest) returns (StartDeploymentResponse);

  // Get current progress of a deployment
  rpc GetDeploymentProgress(GetDeploymentProgressRequest) returns (GetDeploymentProgressResponse);

  // Cancel an in-progress deployment
  rpc CancelDeployment(CancelDeploymentRequest) returns (CancelDeploymentResponse);
}

message StartDeploymentRequest {
  string deployment_id = 1;
  string app_id = 2;
  string workspace_id = 3;
  string user_id = 4;
  string generator_type = 5;   // "docker-compose", "terraform", "helm"
  string generator_slug = 6;   // Slug of the generator to use
  bytes config = 7;            // JSON config for the generator
  DeploymentTarget target = 8;
  string mode = 9;             // "generate" or "execute"
}

message DeploymentTarget {
  string type = 1;       // "local", "kubernetes", "aws-ecs", etc.
  string region = 2;
  string cluster = 3;
  string host_url = 4;   // For docker-compose: docker host URL
}

message StartDeploymentResponse {
  string workflow_id = 1;
}

message GetDeploymentProgressRequest {
  string workflow_id = 1;
}

message GetDeploymentProgressResponse {
  string workflow_id = 1;
  DeploymentStatus status = 2;
  string current_step = 3;
  int32 steps_total = 4;
  int32 steps_current = 5;
  string message = 6;
  string error_message = 7;
  string deployment_url = 8;
}

enum DeploymentStatus {
  DEPLOYMENT_STATUS_UNSPECIFIED = 0;
  DEPLOYMENT_STATUS_PENDING = 1;
  DEPLOYMENT_STATUS_RUNNING = 2;
  DEPLOYMENT_STATUS_COMPLETED = 3;
  DEPLOYMENT_STATUS_FAILED = 4;
  DEPLOYMENT_STATUS_CANCELLED = 5;
}

message CancelDeploymentRequest {
  string workflow_id = 1;
}

message CancelDeploymentResponse {
  bool success = 1;
}
```

**Step 2: Generate code**

Run: `make proto-gen`
Expected: Generated files in `proto/gen/go/idp/deployment/v1/`

**Step 3: Commit**

```bash
git add proto/idp/deployment/v1/deployment.proto proto/gen/
git commit -m "feat: add DeploymentService proto definition"
```

---

### Task 2.2: Implement DeploymentService gRPC Server

**Files:**
- Create: `services/repository/internal/grpc/deployment_server.go`

**Step 1: Create the gRPC server implementation**

```go
package grpc

import (
	"context"
	"encoding/json"
	"fmt"

	"connectrpc.com/connect"
	"go.temporal.io/sdk/client"

	deploymentv1 "github.com/drewpayment/orbit/proto/gen/go/idp/deployment/v1"
	"github.com/drewpayment/orbit/proto/gen/go/idp/deployment/v1/deploymentv1connect"
)

// DeploymentServer implements the DeploymentService
type DeploymentServer struct {
	temporalClient client.Client
}

// NewDeploymentServer creates a new deployment server
func NewDeploymentServer(temporalClient client.Client) *DeploymentServer {
	return &DeploymentServer{
		temporalClient: temporalClient,
	}
}

// Ensure DeploymentServer implements the interface
var _ deploymentv1connect.DeploymentServiceHandler = (*DeploymentServer)(nil)

// DeploymentWorkflowInput matches the Temporal workflow input
type DeploymentWorkflowInput struct {
	DeploymentID  string                `json:"deploymentId"`
	AppID         string                `json:"appId"`
	WorkspaceID   string                `json:"workspaceId"`
	UserID        string                `json:"userId"`
	GeneratorType string                `json:"generatorType"`
	GeneratorSlug string                `json:"generatorSlug"`
	Config        []byte                `json:"config"`
	Target        DeploymentTargetInput `json:"target"`
	Mode          string                `json:"mode"`
}

type DeploymentTargetInput struct {
	Type    string `json:"type"`
	Region  string `json:"region,omitempty"`
	Cluster string `json:"cluster,omitempty"`
	HostURL string `json:"hostUrl,omitempty"`
}

// StartDeployment starts a new deployment workflow
func (s *DeploymentServer) StartDeployment(
	ctx context.Context,
	req *connect.Request[deploymentv1.StartDeploymentRequest],
) (*connect.Response[deploymentv1.StartDeploymentResponse], error) {
	input := req.Msg

	// Validate required fields
	if input.DeploymentId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("deployment_id is required"))
	}
	if input.AppId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("app_id is required"))
	}
	if input.GeneratorType == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("generator_type is required"))
	}

	// Build workflow input
	workflowInput := DeploymentWorkflowInput{
		DeploymentID:  input.DeploymentId,
		AppID:         input.AppId,
		WorkspaceID:   input.WorkspaceId,
		UserID:        input.UserId,
		GeneratorType: input.GeneratorType,
		GeneratorSlug: input.GeneratorSlug,
		Config:        input.Config,
		Mode:          input.Mode,
	}

	if input.Target != nil {
		workflowInput.Target = DeploymentTargetInput{
			Type:    input.Target.Type,
			Region:  input.Target.Region,
			Cluster: input.Target.Cluster,
			HostURL: input.Target.HostUrl,
		}
	}

	// Default mode to "execute" if not specified
	if workflowInput.Mode == "" {
		workflowInput.Mode = "execute"
	}

	// Start the Temporal workflow
	workflowID := fmt.Sprintf("deployment-%s", input.DeploymentId)
	workflowOptions := client.StartWorkflowOptions{
		ID:        workflowID,
		TaskQueue: "deployments",
	}

	run, err := s.temporalClient.ExecuteWorkflow(ctx, workflowOptions, "DeploymentWorkflow", workflowInput)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to start workflow: %w", err))
	}

	return connect.NewResponse(&deploymentv1.StartDeploymentResponse{
		WorkflowId: run.GetID(),
	}), nil
}

// GetDeploymentProgress gets the progress of a deployment workflow
func (s *DeploymentServer) GetDeploymentProgress(
	ctx context.Context,
	req *connect.Request[deploymentv1.GetDeploymentProgressRequest],
) (*connect.Response[deploymentv1.GetDeploymentProgressResponse], error) {
	workflowID := req.Msg.WorkflowId

	// Query the workflow for progress
	resp, err := s.temporalClient.QueryWorkflow(ctx, workflowID, "", "progress")
	if err != nil {
		// Workflow might have completed - try to get result
		run := s.temporalClient.GetWorkflow(ctx, workflowID, "")

		var result struct {
			Status        string `json:"status"`
			DeploymentURL string `json:"deploymentUrl"`
			Error         string `json:"error"`
		}
		err := run.Get(ctx, &result)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to get workflow status: %w", err))
		}

		status := deploymentv1.DeploymentStatus_DEPLOYMENT_STATUS_COMPLETED
		if result.Status == "failed" {
			status = deploymentv1.DeploymentStatus_DEPLOYMENT_STATUS_FAILED
		}

		return connect.NewResponse(&deploymentv1.GetDeploymentProgressResponse{
			WorkflowId:    workflowID,
			Status:        status,
			CurrentStep:   "completed",
			StepsTotal:    5,
			StepsCurrent:  5,
			Message:       "Deployment " + result.Status,
			DeploymentUrl: result.DeploymentURL,
			ErrorMessage:  result.Error,
		}), nil
	}

	var progress struct {
		CurrentStep  string `json:"currentStep"`
		StepsTotal   int    `json:"stepsTotal"`
		StepsCurrent int    `json:"stepsCurrent"`
		Message      string `json:"message"`
	}
	if err := resp.Get(&progress); err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to decode progress: %w", err))
	}

	return connect.NewResponse(&deploymentv1.GetDeploymentProgressResponse{
		WorkflowId:   workflowID,
		Status:       deploymentv1.DeploymentStatus_DEPLOYMENT_STATUS_RUNNING,
		CurrentStep:  progress.CurrentStep,
		StepsTotal:   int32(progress.StepsTotal),
		StepsCurrent: int32(progress.StepsCurrent),
		Message:      progress.Message,
	}), nil
}

// CancelDeployment cancels an in-progress deployment
func (s *DeploymentServer) CancelDeployment(
	ctx context.Context,
	req *connect.Request[deploymentv1.CancelDeploymentRequest],
) (*connect.Response[deploymentv1.CancelDeploymentResponse], error) {
	workflowID := req.Msg.WorkflowId

	err := s.temporalClient.CancelWorkflow(ctx, workflowID, "")
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to cancel workflow: %w", err))
	}

	return connect.NewResponse(&deploymentv1.CancelDeploymentResponse{
		Success: true,
	}), nil
}
```

**Step 2: Verify it compiles**

Run: `cd services/repository && go build ./...`
Expected: Build succeeds (may need to run go mod tidy first)

**Step 3: Commit**

```bash
git add services/repository/internal/grpc/deployment_server.go
git commit -m "feat: implement DeploymentService gRPC server"
```

---

### Task 2.3: Register DeploymentService in Main

**Files:**
- Modify: `services/repository/cmd/server/main.go`

**Step 1: Add import**

Find the imports section and add:

```go
"github.com/drewpayment/orbit/proto/gen/go/idp/deployment/v1/deploymentv1connect"
```

**Step 2: Register the service**

Find where other services are registered (look for `templatev1connect`) and add:

```go
// Create deployment server
deploymentServer := grpc.NewDeploymentServer(temporalClient)

// Register deployment service
path, handler = deploymentv1connect.NewDeploymentServiceHandler(deploymentServer)
mux.Handle(path, handler)
```

**Step 3: Verify it compiles**

Run: `cd services/repository && go build ./cmd/server`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add services/repository/cmd/server/main.go
git commit -m "feat: register DeploymentService in repository service"
```

---

## Phase 3: Connect Frontend to Deployment Workflow

### Task 3.1: Create Deployment Client

**Files:**
- Create: `orbit-www/src/lib/clients/deployment-client.ts`

**Step 1: Create the client**

```typescript
// orbit-www/src/lib/clients/deployment-client.ts
import { createConnectTransport } from '@connectrpc/connect-web'
import { createClient } from '@connectrpc/connect'
import { DeploymentService } from '@/lib/proto/idp/deployment/v1/deployment_connect'

const transport = createConnectTransport({
  baseUrl: process.env.REPOSITORY_SERVICE_URL || 'http://localhost:50051',
})

export const deploymentClient = createClient(DeploymentService, transport)

export type { StartDeploymentRequest, StartDeploymentResponse } from '@/lib/proto/idp/deployment/v1/deployment_pb'
```

**Step 2: Verify TypeScript compiles**

Run: `cd orbit-www && bunx tsc --noEmit`
Expected: No errors (after proto generation)

**Step 3: Commit**

```bash
git add orbit-www/src/lib/clients/deployment-client.ts
git commit -m "feat: add deployment gRPC client"
```

---

### Task 3.2: Update Server Action to Start Workflow

**Files:**
- Modify: `orbit-www/src/app/actions/deployments.ts`

**Step 1: Add import**

Add at the top of the file:

```typescript
import { deploymentClient } from '@/lib/clients/deployment-client'
```

**Step 2: Update startDeployment function**

Replace the existing `startDeployment` function:

```typescript
export async function startDeployment(deploymentId: string, mode: 'generate' | 'execute' = 'execute') {
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

  // Extract app and verify access
  const app = typeof deployment.app === 'string'
    ? await payload.findByID({ collection: 'apps', id: deployment.app, depth: 1 })
    : deployment.app

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
    // Get generator slug
    const generatorSlug = typeof deployment.generator === 'string'
      ? deployment.generator
      : ''

    // Start Temporal workflow via gRPC
    const response = await deploymentClient.startDeployment({
      deploymentId: deploymentId,
      appId: typeof deployment.app === 'string' ? deployment.app : deployment.app.id,
      workspaceId: workspaceId,
      userId: session.user.id,
      generatorType: deployment.generator as string,
      generatorSlug: generatorSlug,
      config: new TextEncoder().encode(JSON.stringify(deployment.config || {})),
      target: {
        type: deployment.target?.type || '',
        region: deployment.target?.region || '',
        cluster: deployment.target?.cluster || '',
        hostUrl: deployment.target?.url || '',
      },
      mode: mode,
    })

    // Update deployment with workflow ID
    await payload.update({
      collection: 'deployments',
      id: deploymentId,
      data: {
        status: 'deploying',
        workflowId: response.workflowId,
      },
    })

    return { success: true, workflowId: response.workflowId }
  } catch (error) {
    console.error('Failed to start deployment:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to start deployment'
    return { success: false, error: errorMessage }
  }
}
```

**Step 3: Verify TypeScript compiles**

Run: `cd orbit-www && bunx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add orbit-www/src/app/actions/deployments.ts
git commit -m "feat: connect startDeployment to Temporal workflow via gRPC"
```

---

### Task 3.3: Add getDeploymentProgress Server Action

**Files:**
- Modify: `orbit-www/src/app/actions/deployments.ts`

**Step 1: Add progress function**

Add after the existing functions:

```typescript
export async function getDeploymentProgress(workflowId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return null
  }

  try {
    const response = await deploymentClient.getDeploymentProgress({
      workflowId: workflowId,
    })

    return {
      workflowId: response.workflowId,
      status: response.status,
      currentStep: response.currentStep,
      stepsTotal: response.stepsTotal,
      stepsCurrent: response.stepsCurrent,
      message: response.message,
      errorMessage: response.errorMessage,
      deploymentUrl: response.deploymentUrl,
    }
  } catch (error) {
    console.error('Failed to get deployment progress:', error)
    return null
  }
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd orbit-www && bunx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add orbit-www/src/app/actions/deployments.ts
git commit -m "feat: add getDeploymentProgress server action"
```

---

## Phase 4: Register Activities with Temporal Worker

### Task 4.1: Register DeploymentActivities

**Files:**
- Modify: `temporal-workflows/cmd/worker/main.go`

**Step 1: Import activities package if not already**

Ensure this import exists:

```go
"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
```

**Step 2: Create and register DeploymentActivities**

Find where activities are registered and add:

```go
// Create deployment activities
deploymentActivities := activities.NewDeploymentActivities(
    workDir,
    nil, // PayloadClient - will implement later
    logger,
)

// Register deployment activities
w.RegisterActivityWithOptions(deploymentActivities.ValidateDeploymentConfig, activity.RegisterOptions{Name: "ValidateDeploymentConfig"})
w.RegisterActivityWithOptions(deploymentActivities.PrepareGeneratorContext, activity.RegisterOptions{Name: "PrepareGeneratorContext"})
w.RegisterActivityWithOptions(deploymentActivities.ExecuteGenerator, activity.RegisterOptions{Name: "ExecuteGenerator"})
w.RegisterActivityWithOptions(deploymentActivities.UpdateDeploymentStatus, activity.RegisterOptions{Name: "UpdateDeploymentStatus"})
w.RegisterActivityWithOptions(deploymentActivities.CommitToRepo, activity.RegisterOptions{Name: "CommitToRepo"})
```

**Step 3: Register DeploymentWorkflow**

Find where workflows are registered and add:

```go
w.RegisterWorkflow(workflows.DeploymentWorkflow)
```

**Step 4: Verify it compiles**

Run: `cd temporal-workflows && go build ./cmd/worker`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add temporal-workflows/cmd/worker/main.go
git commit -m "feat: register DeploymentWorkflow and activities with worker"
```

---

## Phase 5: Update Deployments Collection for Generate Status

### Task 5.1: Add 'generated' Status Option

**Files:**
- Modify: `orbit-www/src/collections/Deployments.ts`

**Step 1: Update status options**

Find the `status` field and update to include 'generated':

```typescript
{
  name: 'status',
  type: 'select',
  defaultValue: 'pending',
  options: [
    { label: 'Pending', value: 'pending' },
    { label: 'Deploying', value: 'deploying' },
    { label: 'Generated', value: 'generated' },  // NEW - for generate-only mode
    { label: 'Deployed', value: 'deployed' },
    { label: 'Failed', value: 'failed' },
  ],
  admin: {
    position: 'sidebar',
  },
},
```

**Step 2: Verify TypeScript compiles**

Run: `cd orbit-www && bunx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add orbit-www/src/collections/Deployments.ts
git commit -m "feat: add 'generated' status for generate-only deployments"
```

---

## Verification Checklist

After completing all tasks:

- [ ] Proto file generates without errors: `make proto-gen`
- [ ] Go services build: `cd services/repository && go build ./...`
- [ ] Temporal worker builds: `cd temporal-workflows && go build ./...`
- [ ] Frontend compiles: `cd orbit-www && bunx tsc --noEmit`
- [ ] Docker Compose dev starts: `make dev`
- [ ] Can create a deployment via UI
- [ ] Deployment workflow starts and reaches "generated" status
- [ ] Generated docker-compose.yml appears (in workflow logs for now)

---

## Future Tasks (Not in This Plan)

1. **Implement CommitToRepo activity** - Actually commit files to GitHub
2. **Add deployment UI components** - Form with generator config, progress display
3. **Implement Terraform executor** - Remote execution with state management
4. **Implement Helm executor** - Deploy to Kubernetes
5. **Add health check integration** - Start HealthCheckWorkflow after deployment
