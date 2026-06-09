package workflows

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/testsuite"
)

func stubReconcile(ctx context.Context) (GitHubReconcileResult, error) {
	return GitHubReconcileResult{}, nil
}

func TestGitHubInstallationReconcileWorkflow_ReturnsActivityResult(t *testing.T) {
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestWorkflowEnvironment()
	env.RegisterActivityWithOptions(stubReconcile, activity.RegisterOptions{
		Name: "ReconcileGitHubInstallationsActivity",
	})

	env.OnActivity(stubReconcile, mock.Anything).
		Return(func(ctx context.Context) (GitHubReconcileResult, error) {
			return GitHubReconcileResult{Checked: 3, Started: 1, Signaled: 2, Failed: 0}, nil
		})

	env.ExecuteWorkflow(GitHubInstallationReconcileWorkflow)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var result GitHubReconcileResult
	require.NoError(t, env.GetWorkflowResult(&result))
	require.Equal(t, 3, result.Checked)
	require.Equal(t, 1, result.Started)
	require.Equal(t, 2, result.Signaled)
}

func TestGitHubInstallationReconcileWorkflow_PropagatesError(t *testing.T) {
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestWorkflowEnvironment()
	env.RegisterActivityWithOptions(stubReconcile, activity.RegisterOptions{
		Name: "ReconcileGitHubInstallationsActivity",
	})

	env.OnActivity(stubReconcile, mock.Anything).
		Return(func(ctx context.Context) (GitHubReconcileResult, error) {
			return GitHubReconcileResult{}, errors.New("orbit-www down")
		})

	env.ExecuteWorkflow(GitHubInstallationReconcileWorkflow)

	require.True(t, env.IsWorkflowCompleted())
	require.Error(t, env.GetWorkflowError())
}
