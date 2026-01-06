//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/client"

	"github.com/drewpayment/orbit/temporal-workflows/internal/workflows"
)

func TestVirtualClusterProvisionWorkflow_Integration(t *testing.T) {
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

	// Test input
	input := workflows.VirtualClusterProvisionInput{
		ApplicationID:   "test-app-" + time.Now().Format("20060102150405"),
		ApplicationSlug: "test-app",
		WorkspaceID:     "test-workspace-id",
		WorkspaceSlug:   "acme",
	}

	workflowOptions := client.StartWorkflowOptions{
		ID:        "test-vc-provision-" + time.Now().Format("20060102150405"),
		TaskQueue: "orbit-workflows",
	}

	we, err := c.ExecuteWorkflow(context.Background(), workflowOptions, workflows.VirtualClusterProvisionWorkflow, input)
	require.NoError(t, err)

	// Wait for workflow completion
	var result workflows.VirtualClusterProvisionResult
	err = we.Get(context.Background(), &result)
	require.NoError(t, err)

	// Verify results
	assert.True(t, result.Success, "Workflow should succeed")
	assert.Len(t, result.VirtualClusters, 3, "Should provision 3 virtual clusters (dev, stage, prod)")
	assert.Empty(t, result.Error, "Should have no error")
}

func TestVirtualClusterProvisionWorkflow_PartialFailure(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	// This test would require mocking to simulate partial failure
	// For now, just skip it as a placeholder
	t.Skip("Partial failure test requires mock infrastructure")
}
