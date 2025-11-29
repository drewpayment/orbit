package workflows

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/testsuite"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
)

func TestHealthCheckWorkflow_Success(t *testing.T) {
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestWorkflowEnvironment()

	// Mock activities with correct number of arguments (receiver, context, input)
	env.OnActivity((*activities.HealthCheckActivities).PerformHealthCheckActivity, mock.Anything, mock.Anything, mock.Anything).
		Return(activities.HealthCheckResult{
			Status:       "healthy",
			StatusCode:   200,
			ResponseTime: 100,
		}, nil)

	env.OnActivity((*activities.HealthCheckActivities).RecordHealthResultActivity, mock.Anything, mock.Anything, mock.Anything).
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

func TestHealthCheckWorkflow_ActivityFailure(t *testing.T) {
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestWorkflowEnvironment()

	// Mock health check activity to fail
	env.OnActivity((*activities.HealthCheckActivities).PerformHealthCheckActivity, mock.Anything, mock.Anything, mock.Anything).
		Return(activities.HealthCheckResult{}, errors.New("connection timeout"))

	// Mock record activity - should be called with "down" status
	env.OnActivity((*activities.HealthCheckActivities).RecordHealthResultActivity, mock.Anything, mock.Anything, mock.Anything).
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

	// Workflow should complete successfully even if health check fails
	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
}
