package workflows

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/testsuite"
	"go.temporal.io/sdk/workflow"
)

// Stub activities matching the string-named activities the workflow invokes.
func stubRefreshGitHubToken(ctx context.Context, installationID string) (RefreshTokenResult, error) {
	return RefreshTokenResult{}, nil
}

func stubUpdateInstallationStatus(ctx context.Context, installationID, status, reason string) error {
	return nil
}

func registerTokenRefreshStubs(env *testsuite.TestWorkflowEnvironment) {
	env.RegisterActivityWithOptions(stubRefreshGitHubToken, activity.RegisterOptions{
		Name: "RefreshGitHubInstallationTokenActivity",
	})
	env.RegisterActivityWithOptions(stubUpdateInstallationStatus, activity.RegisterOptions{
		Name: "UpdateInstallationStatusActivity",
	})
}

// On the happy path the workflow refreshes on a steady cadence, marks the
// installation active each time, and eventually ContinueAsNew's to cap history.
func TestGitHubTokenRefreshWorkflow_SuccessRefreshesAndContinuesAsNew(t *testing.T) {
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestWorkflowEnvironment()
	registerTokenRefreshStubs(env)

	refreshCalls := 0
	activeStatusCalls := 0

	env.OnActivity(stubRefreshGitHubToken, mock.Anything, mock.Anything).
		Return(func(ctx context.Context, installationID string) (RefreshTokenResult, error) {
			refreshCalls++
			return RefreshTokenResult{Success: true, ExpiresAt: time.Now().Add(time.Hour)}, nil
		})
	env.OnActivity(stubUpdateInstallationStatus, mock.Anything, mock.Anything, mock.Anything, mock.Anything).
		Return(func(ctx context.Context, installationID, status, reason string) error {
			if status == "active" {
				activeStatusCalls++
			}
			require.NotEqual(t, "refresh_failed", status, "happy path must not mark refresh_failed")
			return nil
		})

	env.ExecuteWorkflow(GitHubTokenRefreshWorkflow, GitHubTokenRefreshWorkflowInput{
		InstallationID: "install-123",
	})

	require.True(t, env.IsWorkflowCompleted())

	// Workflow ends by ContinuingAsNew once it hits the iteration cap.
	err := env.GetWorkflowError()
	var canErr *workflow.ContinueAsNewError
	require.True(t, errors.As(err, &canErr), "expected ContinueAsNewError, got %v", err)

	require.Equal(t, maxIterationsBeforeContinueAsNew, refreshCalls)
	require.Equal(t, maxIterationsBeforeContinueAsNew, activeStatusCalls)
}

// A persistently failing (but transient-looking) refresh self-heals with backoff
// for a while, marking refresh_failed, then escalates to needs_reconnect once the
// failure has persisted past the escalation window, and exits.
func TestGitHubTokenRefreshWorkflow_TransientFailurePersistsThenEscalates(t *testing.T) {
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestWorkflowEnvironment()
	registerTokenRefreshStubs(env)

	refreshFailedCalls := 0
	needsReconnectCalls := 0

	env.OnActivity(stubRefreshGitHubToken, mock.Anything, mock.Anything).
		Return(func(ctx context.Context, installationID string) (RefreshTokenResult, error) {
			return RefreshTokenResult{Success: false}, errors.New("github 500")
		})
	env.OnActivity(stubUpdateInstallationStatus, mock.Anything, mock.Anything, mock.Anything, mock.Anything).
		Return(func(ctx context.Context, installationID, status, reason string) error {
			switch status {
			case "refresh_failed":
				refreshFailedCalls++
			case "needs_reconnect":
				needsReconnectCalls++
			}
			return nil
		})

	env.ExecuteWorkflow(GitHubTokenRefreshWorkflow, GitHubTokenRefreshWorkflowInput{
		InstallationID: "install-123",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError(), "escalation exits cleanly, not via error")

	require.Greater(t, refreshFailedCalls, 0, "should self-heal as refresh_failed before escalating")
	require.Equal(t, 1, needsReconnectCalls, "should escalate to needs_reconnect exactly once")
}

// A terminal refresh error (non-retryable) escalates to needs_reconnect
// immediately on the first failure, without burning through the backoff window.
func TestGitHubTokenRefreshWorkflow_TerminalErrorEscalatesImmediately(t *testing.T) {
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestWorkflowEnvironment()
	registerTokenRefreshStubs(env)

	refreshFailedCalls := 0
	needsReconnectCalls := 0

	env.OnActivity(stubRefreshGitHubToken, mock.Anything, mock.Anything).
		Return(func(ctx context.Context, installationID string) (RefreshTokenResult, error) {
			return RefreshTokenResult{Success: false}, temporal.NewNonRetryableApplicationError(
				"installation gone", TerminalInstallationErrorType, nil)
		})
	env.OnActivity(stubUpdateInstallationStatus, mock.Anything, mock.Anything, mock.Anything, mock.Anything).
		Return(func(ctx context.Context, installationID, status, reason string) error {
			switch status {
			case "refresh_failed":
				refreshFailedCalls++
			case "needs_reconnect":
				needsReconnectCalls++
			}
			return nil
		})

	env.ExecuteWorkflow(GitHubTokenRefreshWorkflow, GitHubTokenRefreshWorkflowInput{
		InstallationID: "install-123",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	require.Equal(t, 0, refreshFailedCalls, "terminal error must not be treated as transient")
	require.Equal(t, 1, needsReconnectCalls, "terminal error escalates immediately")
}

// failureBackoff grows exponentially from the initial interval and caps at the max.
func TestFailureBackoff(t *testing.T) {
	require.Equal(t, failureInitialBackoff, failureBackoff(0))
	require.Equal(t, failureInitialBackoff, failureBackoff(1))
	require.Equal(t, 2*failureInitialBackoff, failureBackoff(2))
	require.Equal(t, 4*failureInitialBackoff, failureBackoff(3))
	require.Equal(t, failureMaxBackoff, failureBackoff(50), "must cap at the max backoff")
	require.LessOrEqual(t, int64(failureBackoff(7)), int64(failureMaxBackoff))
}
