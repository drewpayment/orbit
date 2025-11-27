//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/client"

	"github.com/drewpayment/orbit/temporal-workflows/internal/workflows"
)

func TestTemplateInstantiationWorkflow_Integration(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	// This test requires a running Temporal server
	c, err := client.Dial(client.Options{
		HostPort: "localhost:7233",
	})
	if err != nil {
		t.Skipf("Temporal server not available: %v", err)
	}
	defer c.Close()

	// Test input (will fail at validation without real GitHub credentials)
	input := workflows.TemplateInstantiationInput{
		TemplateID:       "test-template",
		WorkspaceID:      "test-workspace",
		TargetOrg:        "test-org",
		RepositoryName:   "test-repo-" + time.Now().Format("20060102150405"),
		IsGitHubTemplate: false, // Use clone path for testing
		Variables:        map[string]string{"name": "test"},
		UserID:           "test-user",
	}

	workflowOptions := client.StartWorkflowOptions{
		ID:        "test-template-instantiation-" + time.Now().Format("20060102150405"),
		TaskQueue: "orbit-workflows",
	}

	we, err := c.ExecuteWorkflow(context.Background(), workflowOptions, workflows.TemplateInstantiationWorkflow, input)
	require.NoError(t, err)

	// Query progress
	resp, err := c.QueryWorkflow(context.Background(), we.GetID(), we.GetRunID(), "progress")
	require.NoError(t, err)

	var progress workflows.InstantiationProgress
	require.NoError(t, resp.Get(&progress))
	require.NotEmpty(t, progress.CurrentStep)

	// Note: The workflow will fail at validation step since we don't have real GitHub credentials
	// That's expected behavior for integration tests without real credentials
	t.Logf("Workflow started successfully: %s", we.GetID())
	t.Logf("Initial progress: step=%s, message=%s", progress.CurrentStep, progress.Message)
}

func TestTemplateInstantiationWorkflow_ValidationFailure(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	c, err := client.Dial(client.Options{
		HostPort: "localhost:7233",
	})
	if err != nil {
		t.Skipf("Temporal server not available: %v", err)
	}
	defer c.Close()

	// Invalid input - missing required fields
	input := workflows.TemplateInstantiationInput{
		TemplateID:     "",  // Missing
		WorkspaceID:    "",  // Missing
		TargetOrg:      "",  // Missing
		RepositoryName: "",  // Missing
	}

	workflowOptions := client.StartWorkflowOptions{
		ID:        "test-validation-failure-" + time.Now().Format("20060102150405"),
		TaskQueue: "orbit-workflows",
	}

	we, err := c.ExecuteWorkflow(context.Background(), workflowOptions, workflows.TemplateInstantiationWorkflow, input)
	require.NoError(t, err)

	// Wait for workflow to complete (should fail quickly at validation)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var result workflows.TemplateInstantiationResult
	err = we.Get(ctx, &result)

	// Workflow should complete but with failure status
	if err != nil {
		t.Logf("Workflow failed as expected with error: %v", err)
	} else {
		require.Equal(t, "failed", result.Status)
		t.Logf("Workflow completed with expected failure: %s", result.Error)
	}
}
