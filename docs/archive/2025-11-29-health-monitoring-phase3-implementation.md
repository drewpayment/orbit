# Health Monitoring Phase 3 - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add active health monitoring for applications using Temporal scheduled tasks, with history tracking in a dedicated collection.

**Architecture:** Per-app Temporal schedules trigger HealthCheckWorkflow at configured intervals. Each workflow performs an HTTP check and records results in Payload (current status on App, history in HealthChecks collection).

**Tech Stack:** Temporal SDK (Go), Payload CMS hooks, gRPC, HTTP client, TypeScript/React

---

## Task 1: Create HealthChecks Collection

**Files:**
- Create: `orbit-www/src/collections/HealthChecks.ts`
- Modify: `orbit-www/src/payload.config.ts:1-58`

**Step 1: Write the HealthChecks collection**

Create `orbit-www/src/collections/HealthChecks.ts`:

```typescript
import type { CollectionConfig, Where } from 'payload'

export const HealthChecks: CollectionConfig = {
  slug: 'health-checks',
  admin: {
    group: 'Monitoring',
    defaultColumns: ['app', 'status', 'responseTime', 'checkedAt'],
  },
  access: {
    // Same workspace-scoped access as Apps
    read: async ({ req: { user, payload } }) => {
      if (!user) return false
      if (user.collection === 'users') return true

      const memberships = await payload.find({
        collection: 'workspace-members',
        where: {
          user: { equals: user.id },
          status: { equals: 'active' },
        },
        limit: 1000,
        overrideAccess: true,
      })

      const workspaceIds = memberships.docs.map(m =>
        String(typeof m.workspace === 'string' ? m.workspace : m.workspace.id)
      )

      // Get apps in user's workspaces
      const apps = await payload.find({
        collection: 'apps',
        where: { workspace: { in: workspaceIds } },
        limit: 10000,
        overrideAccess: true,
      })

      const appIds = apps.docs.map(a => a.id)

      return {
        app: { in: appIds },
      } as Where
    },
    create: () => false, // Only system can create
    update: () => false, // Immutable records
    delete: ({ req: { user } }) => user?.collection === 'users', // Admin only
  },
  fields: [
    {
      name: 'app',
      type: 'relationship',
      relationTo: 'apps',
      required: true,
      index: true,
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      options: [
        { label: 'Healthy', value: 'healthy' },
        { label: 'Degraded', value: 'degraded' },
        { label: 'Down', value: 'down' },
      ],
    },
    {
      name: 'statusCode',
      type: 'number',
      admin: {
        description: 'HTTP response status code',
      },
    },
    {
      name: 'responseTime',
      type: 'number',
      admin: {
        description: 'Response time in milliseconds',
      },
    },
    {
      name: 'error',
      type: 'text',
      admin: {
        description: 'Error message if check failed',
      },
    },
    {
      name: 'checkedAt',
      type: 'date',
      required: true,
      index: true,
    },
  ],
  timestamps: true,
}
```

**Step 2: Register collection in payload.config.ts**

Add import at line 28:
```typescript
import { HealthChecks } from './collections/HealthChecks'
```

Add to collections array (after `DeploymentGenerators`):
```typescript
    DeploymentGenerators,
    HealthChecks,
```

**Step 3: Generate types**

Run: `cd orbit-www && bun run generate:types`
Expected: payload-types.ts updated with HealthCheck type

**Step 4: Verify collection appears in admin**

Run: `cd orbit-www && bun run dev`
Navigate to: http://localhost:3000/admin
Expected: "Health Checks" appears under "Monitoring" group

**Step 5: Commit**

```bash
git add orbit-www/src/collections/HealthChecks.ts orbit-www/src/payload.config.ts
git commit -m "feat: add HealthChecks collection for monitoring history"
```

---

## Task 2: Add Health Check Server Action

**Files:**
- Modify: `orbit-www/src/app/actions/apps.ts`

**Step 1: Add getHealthHistory action**

Add to `orbit-www/src/app/actions/apps.ts`:

```typescript
interface GetHealthHistoryInput {
  appId: string
  limit?: number
}

export async function getHealthHistory(input: GetHealthHistoryInput) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Unauthorized', data: [] }
  }

  const payload = await getPayload({ config })

  // Verify user has access to this app
  const app = await payload.findByID({
    collection: 'apps',
    id: input.appId,
  })

  if (!app) {
    return { success: false, error: 'App not found', data: [] }
  }

  try {
    const healthChecks = await payload.find({
      collection: 'health-checks',
      where: {
        app: { equals: input.appId },
      },
      sort: '-checkedAt',
      limit: input.limit || 20,
    })

    return {
      success: true,
      data: healthChecks.docs,
    }
  } catch (error) {
    console.error('Failed to fetch health history:', error)
    return { success: false, error: 'Failed to fetch health history', data: [] }
  }
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/app/actions/apps.ts
git commit -m "feat: add getHealthHistory server action"
```

---

## Task 3: Create Health Check Workflow Types

**Files:**
- Create: `temporal-workflows/internal/workflows/health_check_types.go`

**Step 1: Define workflow types**

Create `temporal-workflows/internal/workflows/health_check_types.go`:

```go
package workflows

// HealthConfig contains configuration for health checks
type HealthConfig struct {
	URL            string `json:"url"`
	Method         string `json:"method"`
	ExpectedStatus int    `json:"expectedStatus"`
	Interval       int    `json:"interval"`
	Timeout        int    `json:"timeout"`
}

// HealthCheckWorkflowInput contains all parameters for the workflow
type HealthCheckWorkflowInput struct {
	AppID        string       `json:"appId"`
	HealthConfig HealthConfig `json:"healthConfig"`
}

// HealthCheckResult contains the result of a health check
type HealthCheckResult struct {
	Status       string `json:"status"` // healthy, degraded, down
	StatusCode   int    `json:"statusCode"`
	ResponseTime int64  `json:"responseTime"` // milliseconds
	Error        string `json:"error"`
}
```

**Step 2: Commit**

```bash
git add temporal-workflows/internal/workflows/health_check_types.go
git commit -m "feat: add health check workflow types"
```

---

## Task 4: Create Health Check Activities

**Files:**
- Create: `temporal-workflows/internal/activities/health_check_activities.go`
- Create: `temporal-workflows/internal/activities/health_check_activities_test.go`

**Step 1: Write failing test for PerformHealthCheck**

Create `temporal-workflows/internal/activities/health_check_activities_test.go`:

```go
package activities

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPerformHealthCheckActivity_Healthy(t *testing.T) {
	// Setup test server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	activities := NewHealthCheckActivities(nil)

	input := PerformHealthCheckInput{
		URL:            server.URL,
		Method:         "GET",
		ExpectedStatus: 200,
		Timeout:        10,
	}

	result, err := activities.PerformHealthCheckActivity(context.Background(), input)

	require.NoError(t, err)
	assert.Equal(t, "healthy", result.Status)
	assert.Equal(t, 200, result.StatusCode)
	assert.Greater(t, result.ResponseTime, int64(0))
}

func TestPerformHealthCheckActivity_Down(t *testing.T) {
	// Setup test server that returns 500
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	activities := NewHealthCheckActivities(nil)

	input := PerformHealthCheckInput{
		URL:            server.URL,
		Method:         "GET",
		ExpectedStatus: 200,
		Timeout:        10,
	}

	result, err := activities.PerformHealthCheckActivity(context.Background(), input)

	require.NoError(t, err)
	assert.Equal(t, "down", result.Status)
	assert.Equal(t, 500, result.StatusCode)
}

func TestPerformHealthCheckActivity_Degraded(t *testing.T) {
	// Setup test server that returns 404
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	activities := NewHealthCheckActivities(nil)

	input := PerformHealthCheckInput{
		URL:            server.URL,
		Method:         "GET",
		ExpectedStatus: 200,
		Timeout:        10,
	}

	result, err := activities.PerformHealthCheckActivity(context.Background(), input)

	require.NoError(t, err)
	assert.Equal(t, "degraded", result.Status)
	assert.Equal(t, 404, result.StatusCode)
}
```

**Step 2: Run test to verify it fails**

Run: `cd temporal-workflows && go test -v -run TestPerformHealthCheckActivity ./internal/activities/`
Expected: FAIL - HealthCheckActivities not defined

**Step 3: Implement HealthCheckActivities**

Create `temporal-workflows/internal/activities/health_check_activities.go`:

```go
package activities

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// PerformHealthCheckInput contains parameters for the health check
type PerformHealthCheckInput struct {
	URL            string `json:"url"`
	Method         string `json:"method"`
	ExpectedStatus int    `json:"expectedStatus"`
	Timeout        int    `json:"timeout"`
}

// HealthCheckResult contains the result of a health check
type HealthCheckResult struct {
	Status       string `json:"status"` // healthy, degraded, down
	StatusCode   int    `json:"statusCode"`
	ResponseTime int64  `json:"responseTime"` // milliseconds
	Error        string `json:"error"`
}

// RecordHealthResultInput contains parameters for recording health check results
type RecordHealthResultInput struct {
	AppID  string            `json:"appId"`
	Result HealthCheckResult `json:"result"`
}

// PayloadHealthClient defines the interface for Payload API operations
type PayloadHealthClient interface {
	UpdateAppStatus(ctx context.Context, appID, status string) error
	CreateHealthCheck(ctx context.Context, appID string, result HealthCheckResult) error
}

// HealthCheckActivities holds dependencies for health check activities
type HealthCheckActivities struct {
	payloadClient PayloadHealthClient
	httpClient    *http.Client
}

// NewHealthCheckActivities creates a new instance of HealthCheckActivities
func NewHealthCheckActivities(payloadClient PayloadHealthClient) *HealthCheckActivities {
	return &HealthCheckActivities{
		payloadClient: payloadClient,
		httpClient:    &http.Client{},
	}
}

// PerformHealthCheckActivity performs an HTTP health check
func (a *HealthCheckActivities) PerformHealthCheckActivity(ctx context.Context, input PerformHealthCheckInput) (HealthCheckResult, error) {
	// Set timeout
	timeout := time.Duration(input.Timeout) * time.Second
	if timeout == 0 {
		timeout = 10 * time.Second
	}

	client := &http.Client{
		Timeout: timeout,
	}

	// Create request
	method := input.Method
	if method == "" {
		method = "GET"
	}

	req, err := http.NewRequestWithContext(ctx, method, input.URL, nil)
	if err != nil {
		return HealthCheckResult{
			Status: "down",
			Error:  fmt.Sprintf("failed to create request: %v", err),
		}, nil
	}

	// Perform request and measure time
	start := time.Now()
	resp, err := client.Do(req)
	responseTime := time.Since(start).Milliseconds()

	if err != nil {
		return HealthCheckResult{
			Status:       "down",
			ResponseTime: responseTime,
			Error:        fmt.Sprintf("request failed: %v", err),
		}, nil
	}
	defer resp.Body.Close()

	// Determine status based on response
	expectedStatus := input.ExpectedStatus
	if expectedStatus == 0 {
		expectedStatus = 200
	}

	var status string
	if resp.StatusCode == expectedStatus {
		status = "healthy"
	} else if resp.StatusCode >= 500 {
		status = "down"
	} else {
		status = "degraded"
	}

	return HealthCheckResult{
		Status:       status,
		StatusCode:   resp.StatusCode,
		ResponseTime: responseTime,
	}, nil
}

// RecordHealthResultActivity records the health check result in Payload
func (a *HealthCheckActivities) RecordHealthResultActivity(ctx context.Context, input RecordHealthResultInput) error {
	if a.payloadClient == nil {
		return fmt.Errorf("payload client not configured")
	}

	// Update app status
	if err := a.payloadClient.UpdateAppStatus(ctx, input.AppID, input.Result.Status); err != nil {
		return fmt.Errorf("failed to update app status: %w", err)
	}

	// Create health check record
	if err := a.payloadClient.CreateHealthCheck(ctx, input.AppID, input.Result); err != nil {
		return fmt.Errorf("failed to create health check record: %w", err)
	}

	return nil
}
```

**Step 4: Run tests to verify they pass**

Run: `cd temporal-workflows && go test -v -run TestPerformHealthCheckActivity ./internal/activities/`
Expected: PASS

**Step 5: Commit**

```bash
git add temporal-workflows/internal/activities/health_check_activities.go temporal-workflows/internal/activities/health_check_activities_test.go
git commit -m "feat: add health check activities with tests"
```

---

## Task 5: Create Health Check Workflow

**Files:**
- Create: `temporal-workflows/internal/workflows/health_check_workflow.go`
- Create: `temporal-workflows/internal/workflows/health_check_workflow_test.go`

**Step 1: Write failing test**

Create `temporal-workflows/internal/workflows/health_check_workflow_test.go`:

```go
package workflows

import (
	"testing"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/testsuite"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
)

func TestHealthCheckWorkflow(t *testing.T) {
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestWorkflowEnvironment()

	// Mock activities
	env.OnActivity((*activities.HealthCheckActivities).PerformHealthCheckActivity, mock.Anything, mock.Anything).
		Return(activities.HealthCheckResult{
			Status:       "healthy",
			StatusCode:   200,
			ResponseTime: 100,
		}, nil)

	env.OnActivity((*activities.HealthCheckActivities).RecordHealthResultActivity, mock.Anything, mock.Anything).
		Return(nil)

	input := HealthCheckWorkflowInput{
		AppID: "test-app-id",
		HealthConfig: HealthConfig{
			URL:            "https://example.com/health",
			Method:         "GET",
			ExpectedStatus: 200,
			Timeout:        10,
		},
	}

	env.ExecuteWorkflow(HealthCheckWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
}
```

**Step 2: Run test to verify it fails**

Run: `cd temporal-workflows && go test -v -run TestHealthCheckWorkflow ./internal/workflows/`
Expected: FAIL - HealthCheckWorkflow not defined

**Step 3: Implement workflow**

Create `temporal-workflows/internal/workflows/health_check_workflow.go`:

```go
package workflows

import (
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
)

// HealthCheckWorkflow performs a single health check and records the result
// This workflow is triggered by a Temporal Schedule at the configured interval
func HealthCheckWorkflow(ctx workflow.Context, input HealthCheckWorkflowInput) error {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting health check workflow", "appId", input.AppID, "url", input.HealthConfig.URL)

	// Activity options with short timeout since health checks should be quick
	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    10 * time.Second,
			MaximumAttempts:    2, // Limited retries - schedule will trigger again
		},
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	// Perform health check
	var result activities.HealthCheckResult
	err := workflow.ExecuteActivity(ctx, (*activities.HealthCheckActivities).PerformHealthCheckActivity, activities.PerformHealthCheckInput{
		URL:            input.HealthConfig.URL,
		Method:         input.HealthConfig.Method,
		ExpectedStatus: input.HealthConfig.ExpectedStatus,
		Timeout:        input.HealthConfig.Timeout,
	}).Get(ctx, &result)

	if err != nil {
		logger.Error("Health check activity failed", "error", err)
		// Record as down
		result = activities.HealthCheckResult{
			Status: "down",
			Error:  err.Error(),
		}
	}

	// Record result (fire and forget - don't fail workflow if recording fails)
	recordCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
		},
	})

	err = workflow.ExecuteActivity(recordCtx, (*activities.HealthCheckActivities).RecordHealthResultActivity, activities.RecordHealthResultInput{
		AppID:  input.AppID,
		Result: result,
	}).Get(ctx, nil)

	if err != nil {
		logger.Error("Failed to record health result", "error", err)
		// Don't return error - the check itself succeeded
	}

	logger.Info("Health check completed", "appId", input.AppID, "status", result.Status)
	return nil
}
```

**Step 4: Run tests to verify they pass**

Run: `cd temporal-workflows && go test -v -run TestHealthCheckWorkflow ./internal/workflows/`
Expected: PASS

**Step 5: Commit**

```bash
git add temporal-workflows/internal/workflows/health_check_workflow.go temporal-workflows/internal/workflows/health_check_workflow_test.go temporal-workflows/internal/workflows/health_check_types.go
git commit -m "feat: add health check workflow with tests"
```

---

## Task 6: Create Payload Health Client

**Files:**
- Create: `temporal-workflows/internal/services/payload_health_client.go`

**Step 1: Implement PayloadHealthClient**

Create `temporal-workflows/internal/services/payload_health_client.go`:

```go
package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
)

// PayloadHealthClientImpl implements PayloadHealthClient for Payload CMS
type PayloadHealthClientImpl struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
}

// NewPayloadHealthClient creates a new PayloadHealthClient
func NewPayloadHealthClient(baseURL, apiKey string) *PayloadHealthClientImpl {
	return &PayloadHealthClientImpl{
		baseURL: baseURL,
		apiKey:  apiKey,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// UpdateAppStatus updates the status field on an App document
func (c *PayloadHealthClientImpl) UpdateAppStatus(ctx context.Context, appID, status string) error {
	url := fmt.Sprintf("%s/api/apps/%s", c.baseURL, appID)

	body := map[string]interface{}{
		"status": status,
	}
	jsonBody, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("failed to marshal body: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "PATCH", url, bytes.NewReader(jsonBody))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.apiKey))
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	return nil
}

// CreateHealthCheck creates a new health check record
func (c *PayloadHealthClientImpl) CreateHealthCheck(ctx context.Context, appID string, result activities.HealthCheckResult) error {
	url := fmt.Sprintf("%s/api/health-checks", c.baseURL)

	body := map[string]interface{}{
		"app":          appID,
		"status":       result.Status,
		"statusCode":   result.StatusCode,
		"responseTime": result.ResponseTime,
		"error":        result.Error,
		"checkedAt":    time.Now().Format(time.RFC3339),
	}
	jsonBody, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("failed to marshal body: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(jsonBody))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.apiKey))
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	return nil
}
```

**Step 2: Commit**

```bash
git add temporal-workflows/internal/services/payload_health_client.go
git commit -m "feat: add PayloadHealthClient for health check recording"
```

---

## Task 7: Register Health Check Workflow in Worker

**Files:**
- Modify: `temporal-workflows/cmd/worker/main.go`

**Step 1: Update worker to register health check workflow and activities**

Add imports:
```go
import (
	// ... existing imports
)
```

Add after deployment activities registration (around line 129):
```go
	// Create and register health check activities
	payloadHealthClient := services.NewPayloadHealthClient(orbitAPIURL, orbitInternalAPIKey)
	healthCheckActivities := activities.NewHealthCheckActivities(payloadHealthClient)
	w.RegisterActivity(healthCheckActivities.PerformHealthCheckActivity)
	w.RegisterActivity(healthCheckActivities.RecordHealthResultActivity)

	// Register health check workflow
	w.RegisterWorkflow(workflows.HealthCheckWorkflow)
```

**Step 2: Verify build**

Run: `cd temporal-workflows && go build ./cmd/worker/`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add temporal-workflows/cmd/worker/main.go
git commit -m "feat: register health check workflow and activities in worker"
```

---

## Task 8: Add Schedule Management gRPC Service

**Files:**
- Create: `proto/health.proto`
- Run: `make proto-gen`

**Step 1: Create health.proto**

Create `proto/health.proto`:

```protobuf
syntax = "proto3";

package idp.health.v1;

option go_package = "github.com/drewpayment/orbit/proto/gen/go/idp/health/v1;healthv1";

service HealthService {
  // ManageSchedule creates, updates, or deletes a health check schedule for an app
  rpc ManageSchedule(ManageScheduleRequest) returns (ManageScheduleResponse);

  // DeleteSchedule removes a health check schedule for an app
  rpc DeleteSchedule(DeleteScheduleRequest) returns (DeleteScheduleResponse);
}

message HealthConfig {
  string url = 1;
  string method = 2;
  int32 expected_status = 3;
  int32 interval = 4;
  int32 timeout = 5;
}

message ManageScheduleRequest {
  string app_id = 1;
  HealthConfig health_config = 2;
}

message ManageScheduleResponse {
  bool success = 1;
  string schedule_id = 2;
  string error = 3;
}

message DeleteScheduleRequest {
  string app_id = 1;
}

message DeleteScheduleResponse {
  bool success = 1;
  string error = 2;
}
```

**Step 2: Generate proto code**

Run: `make proto-gen`
Expected: Go and TypeScript code generated

**Step 3: Commit**

```bash
git add proto/health.proto proto/gen/ orbit-www/src/lib/proto/
git commit -m "feat: add health service protobuf definitions"
```

---

## Task 9: Implement Health gRPC Service

**Files:**
- Create: `services/repository/internal/grpc/health_service.go`
- Create: `services/repository/internal/grpc/health_service_test.go`

**Step 1: Write failing test**

Create `services/repository/internal/grpc/health_service_test.go`:

```go
package grpc

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	healthv1 "github.com/drewpayment/orbit/proto/gen/go/idp/health/v1"
)

type mockScheduleClient struct {
	createCalled bool
	deleteCalled bool
	scheduleID   string
}

func (m *mockScheduleClient) CreateSchedule(ctx context.Context, appID string, interval int) (string, error) {
	m.createCalled = true
	m.scheduleID = "health-check-" + appID
	return m.scheduleID, nil
}

func (m *mockScheduleClient) DeleteSchedule(ctx context.Context, scheduleID string) error {
	m.deleteCalled = true
	return nil
}

func TestManageSchedule_Create(t *testing.T) {
	mockClient := &mockScheduleClient{}
	service := NewHealthService(mockClient)

	req := &healthv1.ManageScheduleRequest{
		AppId: "test-app",
		HealthConfig: &healthv1.HealthConfig{
			Url:            "https://example.com/health",
			Method:         "GET",
			ExpectedStatus: 200,
			Interval:       60,
			Timeout:        10,
		},
	}

	resp, err := service.ManageSchedule(context.Background(), req)

	require.NoError(t, err)
	assert.True(t, resp.Success)
	assert.Equal(t, "health-check-test-app", resp.ScheduleId)
	assert.True(t, mockClient.createCalled)
}
```

**Step 2: Run test to verify it fails**

Run: `cd services/repository && go test -v -run TestManageSchedule ./internal/grpc/`
Expected: FAIL - HealthService not defined

**Step 3: Implement HealthService**

Create `services/repository/internal/grpc/health_service.go`:

```go
package grpc

import (
	"context"
	"fmt"
	"time"

	"go.temporal.io/sdk/client"

	healthv1 "github.com/drewpayment/orbit/proto/gen/go/idp/health/v1"
	"github.com/drewpayment/orbit/temporal-workflows/internal/workflows"
)

// ScheduleClient interface for Temporal schedule operations
type ScheduleClient interface {
	CreateSchedule(ctx context.Context, appID string, interval int) (string, error)
	DeleteSchedule(ctx context.Context, scheduleID string) error
}

// TemporalScheduleClient implements ScheduleClient using Temporal SDK
type TemporalScheduleClient struct {
	client client.Client
}

// NewTemporalScheduleClient creates a new TemporalScheduleClient
func NewTemporalScheduleClient(c client.Client) *TemporalScheduleClient {
	return &TemporalScheduleClient{client: c}
}

// CreateSchedule creates a Temporal schedule for health checks
func (c *TemporalScheduleClient) CreateSchedule(ctx context.Context, appID string, interval int) (string, error) {
	scheduleID := fmt.Sprintf("health-check-%s", appID)

	// Delete existing schedule if it exists
	handle := c.client.ScheduleClient().GetHandle(ctx, scheduleID)
	_ = handle.Delete(ctx) // Ignore error if doesn't exist

	// Create new schedule
	_, err := c.client.ScheduleClient().Create(ctx, client.ScheduleOptions{
		ID: scheduleID,
		Spec: client.ScheduleSpec{
			Intervals: []client.ScheduleIntervalSpec{{
				Every: time.Duration(interval) * time.Second,
			}},
		},
		Action: &client.ScheduleWorkflowAction{
			ID:        fmt.Sprintf("health-check-workflow-%s", appID),
			Workflow:  workflows.HealthCheckWorkflow,
			TaskQueue: "orbit-workflows",
			Args:      []interface{}{workflows.HealthCheckWorkflowInput{AppID: appID}},
		},
	})
	if err != nil {
		return "", fmt.Errorf("failed to create schedule: %w", err)
	}

	return scheduleID, nil
}

// DeleteSchedule deletes a Temporal schedule
func (c *TemporalScheduleClient) DeleteSchedule(ctx context.Context, scheduleID string) error {
	handle := c.client.ScheduleClient().GetHandle(ctx, scheduleID)
	return handle.Delete(ctx)
}

// HealthService implements the HealthService gRPC service
type HealthService struct {
	healthv1.UnimplementedHealthServiceServer
	scheduleClient ScheduleClient
}

// NewHealthService creates a new HealthService
func NewHealthService(scheduleClient ScheduleClient) *HealthService {
	return &HealthService{
		scheduleClient: scheduleClient,
	}
}

// ManageSchedule creates or updates a health check schedule
func (s *HealthService) ManageSchedule(ctx context.Context, req *healthv1.ManageScheduleRequest) (*healthv1.ManageScheduleResponse, error) {
	if req.HealthConfig == nil || req.HealthConfig.Url == "" {
		// No health config - delete schedule if exists
		scheduleID := fmt.Sprintf("health-check-%s", req.AppId)
		_ = s.scheduleClient.DeleteSchedule(ctx, scheduleID)
		return &healthv1.ManageScheduleResponse{Success: true}, nil
	}

	interval := int(req.HealthConfig.Interval)
	if interval < 30 {
		interval = 60 // Default to 60s
	}

	scheduleID, err := s.scheduleClient.CreateSchedule(ctx, req.AppId, interval)
	if err != nil {
		return &healthv1.ManageScheduleResponse{
			Success: false,
			Error:   err.Error(),
		}, nil
	}

	return &healthv1.ManageScheduleResponse{
		Success:    true,
		ScheduleId: scheduleID,
	}, nil
}

// DeleteSchedule removes a health check schedule
func (s *HealthService) DeleteSchedule(ctx context.Context, req *healthv1.DeleteScheduleRequest) (*healthv1.DeleteScheduleResponse, error) {
	scheduleID := fmt.Sprintf("health-check-%s", req.AppId)
	err := s.scheduleClient.DeleteSchedule(ctx, scheduleID)
	if err != nil {
		return &healthv1.DeleteScheduleResponse{
			Success: false,
			Error:   err.Error(),
		}, nil
	}

	return &healthv1.DeleteScheduleResponse{Success: true}, nil
}
```

**Step 4: Run tests to verify they pass**

Run: `cd services/repository && go test -v -run TestManageSchedule ./internal/grpc/`
Expected: PASS

**Step 5: Commit**

```bash
git add services/repository/internal/grpc/health_service.go services/repository/internal/grpc/health_service_test.go
git commit -m "feat: implement health gRPC service with schedule management"
```

---

## Task 10: Register Health Service in Repository Server

**Files:**
- Modify: `services/repository/cmd/server/main.go`

**Step 1: Register HealthService**

Add to main.go after existing service registrations:

```go
// Create Temporal schedule client
temporalScheduleClient := grpc.NewTemporalScheduleClient(temporalClient)

// Register HealthService
healthService := grpc.NewHealthService(temporalScheduleClient)
healthv1.RegisterHealthServiceServer(grpcServer, healthService)
```

**Step 2: Verify build**

Run: `cd services/repository && go build ./cmd/server/`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add services/repository/cmd/server/main.go
git commit -m "feat: register health service in repository server"
```

---

## Task 11: Add Frontend Health History UI

**Files:**
- Modify: `orbit-www/src/components/features/apps/AppDetail.tsx`

**Step 1: Add health history section to AppDetail**

Add imports:
```typescript
import { useEffect, useState } from 'react'
import { getHealthHistory } from '@/app/actions/apps'
import type { HealthCheck } from '@/payload-types'
```

Add state and fetch logic:
```typescript
const [healthHistory, setHealthHistory] = useState<HealthCheck[]>([])
const [loadingHistory, setLoadingHistory] = useState(false)

useEffect(() => {
  if (app.healthConfig?.url) {
    setLoadingHistory(true)
    getHealthHistory({ appId: app.id, limit: 10 })
      .then(result => {
        if (result.success) {
          setHealthHistory(result.data as HealthCheck[])
        }
      })
      .finally(() => setLoadingHistory(false))
  }
}, [app.id, app.healthConfig?.url])
```

Add health history card after the existing Summary Cards section:
```tsx
{/* Health History */}
{app.healthConfig?.url && (
  <Card>
    <CardHeader>
      <CardTitle>Health History</CardTitle>
    </CardHeader>
    <CardContent>
      {loadingHistory ? (
        <div className="text-center py-4 text-muted-foreground">Loading...</div>
      ) : healthHistory.length === 0 ? (
        <div className="text-center py-4 text-muted-foreground">
          No health checks recorded yet
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Response Time</TableHead>
              <TableHead>Status Code</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {healthHistory.map((check) => {
              const checkStatus = check.status || 'unknown'
              const CheckIcon = statusConfig[checkStatus as keyof typeof statusConfig]?.icon || HelpCircle
              return (
                <TableRow key={check.id}>
                  <TableCell>
                    {check.checkedAt
                      ? new Date(check.checkedAt).toLocaleString()
                      : '-'}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <CheckIcon className={`h-4 w-4 ${statusConfig[checkStatus as keyof typeof statusConfig]?.color || 'text-gray-400'}`} />
                      <span className="capitalize">{checkStatus}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {check.responseTime ? `${check.responseTime}ms` : '-'}
                  </TableCell>
                  <TableCell>{check.statusCode || '-'}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </CardContent>
  </Card>
)}
```

**Step 2: Verify build**

Run: `cd orbit-www && bun run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add orbit-www/src/components/features/apps/AppDetail.tsx
git commit -m "feat: add health history table to app detail page"
```

---

## Task 12: Add Payload Hook for Schedule Management

**Files:**
- Modify: `orbit-www/src/collections/Apps.ts`

**Step 1: Add afterChange hook to manage schedules**

Add hook configuration to Apps collection:

```typescript
import { createPromiseClient } from '@connectrpc/connect'
import { createGrpcTransport } from '@connectrpc/connect-node'
import { HealthService } from '@/lib/proto/idp/health/v1/health_connect'

// ... existing code ...

export const Apps: CollectionConfig = {
  slug: 'apps',
  // ... existing config ...
  hooks: {
    afterChange: [
      async ({ doc, previousDoc, operation }) => {
        // Only manage schedules when healthConfig changes
        const healthConfigChanged =
          doc.healthConfig?.url !== previousDoc?.healthConfig?.url ||
          doc.healthConfig?.interval !== previousDoc?.healthConfig?.interval

        if (!healthConfigChanged && operation === 'update') {
          return doc
        }

        try {
          const transport = createGrpcTransport({
            baseUrl: process.env.REPOSITORY_SERVICE_URL || 'http://localhost:50051',
            httpVersion: '2',
          })
          const client = createPromiseClient(HealthService, transport)

          if (doc.healthConfig?.url) {
            await client.manageSchedule({
              appId: doc.id,
              healthConfig: {
                url: doc.healthConfig.url,
                method: doc.healthConfig.method || 'GET',
                expectedStatus: doc.healthConfig.expectedStatus || 200,
                interval: doc.healthConfig.interval || 60,
                timeout: doc.healthConfig.timeout || 10,
              },
            })
          } else {
            await client.deleteSchedule({ appId: doc.id })
          }
        } catch (error) {
          console.error('Failed to manage health schedule:', error)
          // Don't fail the save - schedule management is async
        }

        return doc
      },
    ],
    afterDelete: [
      async ({ doc }) => {
        try {
          const transport = createGrpcTransport({
            baseUrl: process.env.REPOSITORY_SERVICE_URL || 'http://localhost:50051',
            httpVersion: '2',
          })
          const client = createPromiseClient(HealthService, transport)
          await client.deleteSchedule({ appId: doc.id })
        } catch (error) {
          console.error('Failed to delete health schedule:', error)
        }
      },
    ],
  },
  // ... rest of config ...
}
```

**Step 2: Verify build**

Run: `cd orbit-www && bun run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add orbit-www/src/collections/Apps.ts
git commit -m "feat: add Payload hooks for health schedule management"
```

---

## Summary

This plan implements Phase 3 Health Monitoring with:

1. **HealthChecks Collection** - Stores historical health check results
2. **Server Action** - `getHealthHistory` for fetching check history
3. **Temporal Workflow** - `HealthCheckWorkflow` triggered by schedules
4. **Activities** - `PerformHealthCheckActivity` and `RecordHealthResultActivity`
5. **gRPC Service** - `HealthService` for schedule management
6. **Frontend UI** - Health history table in AppDetail
7. **Payload Hooks** - Auto-manage schedules on app create/update/delete

---

**Plan complete and saved to `docs/plans/2025-11-29-health-monitoring-phase3-implementation.md`. Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
