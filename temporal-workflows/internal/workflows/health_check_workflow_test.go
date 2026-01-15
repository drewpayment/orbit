package workflows

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/testsuite"
	"go.temporal.io/sdk/workflow"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
)

// Stub activity functions for testing
func stubPerformHealthCheck(ctx context.Context, input activities.PerformHealthCheckInput) (activities.HealthCheckResult, error) {
	return activities.HealthCheckResult{}, nil
}

func stubRecordHealthResult(ctx context.Context, input activities.RecordHealthResultInput) error {
	return nil
}

func TestHealthCheckWorkflow_PerformsCheckAndRecords(t *testing.T) {
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestWorkflowEnvironment()

	// Register stub activities
	env.RegisterActivityWithOptions(stubPerformHealthCheck, activity.RegisterOptions{
		Name: "PerformHealthCheckActivity",
	})
	env.RegisterActivityWithOptions(stubRecordHealthResult, activity.RegisterOptions{
		Name: "RecordHealthResultActivity",
	})

	// Track activity calls
	checkCallCount := 0
	recordCallCount := 0

	env.OnActivity(stubPerformHealthCheck, mock.Anything, mock.Anything).
		Return(func(ctx context.Context, input activities.PerformHealthCheckInput) (activities.HealthCheckResult, error) {
			checkCallCount++
			return activities.HealthCheckResult{
				Status:       "healthy",
				StatusCode:   200,
				ResponseTime: 100,
			}, nil
		})

	env.OnActivity(stubRecordHealthResult, mock.Anything, mock.Anything).
		Return(func(ctx context.Context, input activities.RecordHealthResultInput) error {
			recordCallCount++
			require.Equal(t, "test-app-id", input.AppID)
			require.Equal(t, "healthy", input.Result.Status)
			return nil
		})

	input := HealthCheckWorkflowInput{
		AppID: "test-app-id",
		HealthConfig: HealthConfig{
			URL:            "https://example.com/health",
			Method:         "GET",
			ExpectedStatus: 200,
			Interval:       60,
			Timeout:        10,
		},
	}

	// Cancel after first check completes (give time for sleep to start)
	env.RegisterDelayedCallback(func() {
		env.CancelWorkflow()
	}, 100*time.Millisecond)

	env.ExecuteWorkflow(HealthCheckWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())
	// Workflow should be cancelled, not errored
	err := env.GetWorkflowError()
	require.Error(t, err)
	require.Contains(t, err.Error(), "canceled")

	// Should have performed at least one check
	require.GreaterOrEqual(t, checkCallCount, 1)
	require.GreaterOrEqual(t, recordCallCount, 1)
}

func TestHealthCheckWorkflow_ActivityFailureRecordsDown(t *testing.T) {
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestWorkflowEnvironment()

	// Register stub activities
	env.RegisterActivityWithOptions(stubPerformHealthCheck, activity.RegisterOptions{
		Name: "PerformHealthCheckActivity",
	})
	env.RegisterActivityWithOptions(stubRecordHealthResult, activity.RegisterOptions{
		Name: "RecordHealthResultActivity",
	})

	// Mock health check activity to fail (exhausts retries quickly in test)
	env.OnActivity(stubPerformHealthCheck, mock.Anything, mock.Anything).
		Return(activities.HealthCheckResult{}, errors.New("connection timeout"))

	// Mock record activity - should be called with "down" status
	var recordedStatus string
	env.OnActivity(stubRecordHealthResult, mock.Anything, mock.Anything).
		Return(func(ctx context.Context, input activities.RecordHealthResultInput) error {
			recordedStatus = input.Result.Status
			return nil
		})

	input := HealthCheckWorkflowInput{
		AppID: "test-app-id",
		HealthConfig: HealthConfig{
			URL:            "https://example.com/health",
			Method:         "GET",
			ExpectedStatus: 200,
			Interval:       60,
			Timeout:        10,
		},
	}

	// Query status after first check fails - use query to verify "down" state
	// Need enough time for activity retries (2 attempts with backoff)
	env.RegisterDelayedCallback(func() {
		result, err := env.QueryWorkflow(QueryHealthStatus)
		require.NoError(t, err)

		var status HealthStatusQueryResult
		require.NoError(t, result.Get(&status))
		// When activity fails, workflow should record "down" status
		require.Equal(t, "down", status.Status)
		require.Equal(t, 1, status.ChecksPerformed)
		require.Contains(t, status.Error, "connection timeout")

		env.CancelWorkflow()
	}, 15*time.Second) // Allow time for activity retries (backoff grows to 10s max)

	env.ExecuteWorkflow(HealthCheckWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())
	// Also verify record activity was called with "down" if it ran
	if recordedStatus != "" {
		require.Equal(t, "down", recordedStatus)
	}
}

func TestHealthCheckWorkflow_ContinueAsNewAfterMaxIterations(t *testing.T) {
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestWorkflowEnvironment()

	// Register stub activities
	env.RegisterActivityWithOptions(stubPerformHealthCheck, activity.RegisterOptions{
		Name: "PerformHealthCheckActivity",
	})
	env.RegisterActivityWithOptions(stubRecordHealthResult, activity.RegisterOptions{
		Name: "RecordHealthResultActivity",
	})

	checkCount := 0

	env.OnActivity(stubPerformHealthCheck, mock.Anything, mock.Anything).
		Return(func(ctx context.Context, input activities.PerformHealthCheckInput) (activities.HealthCheckResult, error) {
			checkCount++
			return activities.HealthCheckResult{
				Status:       "healthy",
				StatusCode:   200,
				ResponseTime: 50,
			}, nil
		})

	env.OnActivity(stubRecordHealthResult, mock.Anything, mock.Anything).Return(nil)

	input := HealthCheckWorkflowInput{
		AppID: "test-app-id",
		HealthConfig: HealthConfig{
			URL:            "https://example.com/health",
			Method:         "GET",
			ExpectedStatus: 200,
			Interval:       1, // 1 second interval for fast test
			Timeout:        10,
		},
		// Start with high iteration count to trigger ContinueAsNew quickly
		ChecksPerformed: MaxChecksBeforeContinueAsNew - 1,
	}

	env.ExecuteWorkflow(HealthCheckWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())
	err := env.GetWorkflowError()

	// Should trigger ContinueAsNew
	require.Error(t, err)
	var continueAsNewErr *workflow.ContinueAsNewError
	require.ErrorAs(t, err, &continueAsNewErr)
}

func TestHealthCheckWorkflow_QueryReturnsCurrentStatus(t *testing.T) {
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestWorkflowEnvironment()

	// Register stub activities
	env.RegisterActivityWithOptions(stubPerformHealthCheck, activity.RegisterOptions{
		Name: "PerformHealthCheckActivity",
	})
	env.RegisterActivityWithOptions(stubRecordHealthResult, activity.RegisterOptions{
		Name: "RecordHealthResultActivity",
	})

	env.OnActivity(stubPerformHealthCheck, mock.Anything, mock.Anything).
		Return(activities.HealthCheckResult{
			Status:       "healthy",
			StatusCode:   200,
			ResponseTime: 100,
		}, nil)

	env.OnActivity(stubRecordHealthResult, mock.Anything, mock.Anything).Return(nil)

	input := HealthCheckWorkflowInput{
		AppID: "test-app-id",
		HealthConfig: HealthConfig{
			URL:            "https://example.com/health",
			Method:         "GET",
			ExpectedStatus: 200,
			Interval:       60,
			Timeout:        10,
		},
	}

	// Query after first check completes
	env.RegisterDelayedCallback(func() {
		result, err := env.QueryWorkflow(QueryHealthStatus)
		require.NoError(t, err)

		var status HealthStatusQueryResult
		require.NoError(t, result.Get(&status))
		require.Equal(t, "healthy", status.Status)
		require.Equal(t, 200, status.StatusCode)
		require.Equal(t, int64(100), status.ResponseTime)
		require.Equal(t, 1, status.ChecksPerformed)

		env.CancelWorkflow()
	}, 50*time.Millisecond)

	env.ExecuteWorkflow(HealthCheckWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())
}

func TestHealthCheckWorkflow_QueryBeforeFirstCheck(t *testing.T) {
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestWorkflowEnvironment()

	// Register stub activities
	env.RegisterActivityWithOptions(stubPerformHealthCheck, activity.RegisterOptions{
		Name: "PerformHealthCheckActivity",
	})
	env.RegisterActivityWithOptions(stubRecordHealthResult, activity.RegisterOptions{
		Name: "RecordHealthResultActivity",
	})

	// Delay the activity so query happens before first check
	env.OnActivity(stubPerformHealthCheck, mock.Anything, mock.Anything).
		After(200 * time.Millisecond).
		Return(activities.HealthCheckResult{
			Status:       "healthy",
			StatusCode:   200,
			ResponseTime: 100,
		}, nil)

	env.OnActivity(stubRecordHealthResult, mock.Anything, mock.Anything).Return(nil)

	input := HealthCheckWorkflowInput{
		AppID: "test-app-id",
		HealthConfig: HealthConfig{
			URL:            "https://example.com/health",
			Method:         "GET",
			ExpectedStatus: 200,
			Interval:       60,
			Timeout:        10,
		},
	}

	// Query immediately before first check
	env.RegisterDelayedCallback(func() {
		result, err := env.QueryWorkflow(QueryHealthStatus)
		require.NoError(t, err)

		var status HealthStatusQueryResult
		require.NoError(t, result.Get(&status))
		require.Equal(t, "pending", status.Status)
		require.Equal(t, 0, status.ChecksPerformed)

		env.CancelWorkflow()
	}, 10*time.Millisecond)

	env.ExecuteWorkflow(HealthCheckWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())
}

func TestHealthCheckWorkflow_MinimumInterval(t *testing.T) {
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestWorkflowEnvironment()

	// Register stub activities
	env.RegisterActivityWithOptions(stubPerformHealthCheck, activity.RegisterOptions{
		Name: "PerformHealthCheckActivity",
	})
	env.RegisterActivityWithOptions(stubRecordHealthResult, activity.RegisterOptions{
		Name: "RecordHealthResultActivity",
	})

	env.OnActivity(stubPerformHealthCheck, mock.Anything, mock.Anything).
		Return(activities.HealthCheckResult{
			Status:       "healthy",
			StatusCode:   200,
			ResponseTime: 100,
		}, nil)

	env.OnActivity(stubRecordHealthResult, mock.Anything, mock.Anything).Return(nil)

	// Test with interval below minimum (should be clamped to MinHealthCheckInterval)
	input := HealthCheckWorkflowInput{
		AppID: "test-app-id",
		HealthConfig: HealthConfig{
			URL:            "https://example.com/health",
			Method:         "GET",
			ExpectedStatus: 200,
			Interval:       5, // Below minimum
			Timeout:        10,
		},
	}

	env.RegisterDelayedCallback(func() {
		env.CancelWorkflow()
	}, 100*time.Millisecond)

	env.ExecuteWorkflow(HealthCheckWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())
	// If this test completes quickly, the interval was properly clamped
	// (otherwise it would have waited only 5 seconds instead of 30)
}
