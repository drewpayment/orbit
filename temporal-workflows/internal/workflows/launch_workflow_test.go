package workflows

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/testsuite"
	"github.com/drewpayment/orbit/temporal-workflows/pkg/types"
)

// Stub activity functions for launch workflow testing

func stubValidateLaunchInputs(_ context.Context, _ types.LaunchWorkflowInput) error {
	return nil
}

func stubUpdateLaunchStatus(_ context.Context, _ types.UpdateLaunchStatusInput) error {
	return nil
}

func stubStoreLaunchOutputs(_ context.Context, _ types.StoreLaunchOutputsInput) error {
	return nil
}

func stubProvisionInfra(_ context.Context, _ types.ProvisionInfraInput) (*types.ProvisionInfraResult, error) {
	return &types.ProvisionInfraResult{}, nil
}

func stubDestroyInfra(_ context.Context, _ types.DestroyInfraInput) error {
	return nil
}

// newLaunchTestInput returns a standard test input for launch workflow tests.
func newLaunchTestInput() types.LaunchWorkflowInput {
	return types.LaunchWorkflowInput{
		LaunchID:          "launch-001",
		TemplateSlug:      "s3-bucket",
		CloudAccountID:    "cloud-acct-1",
		Provider:          "aws",
		Region:            "us-east-1",
		Parameters:        map[string]interface{}{"bucketName": "my-bucket"},
		ApprovalRequired:  false,
		PulumiProjectPath: "templates/aws-s3-bucket",
		WorkspaceID:       "ws-001",
	}
}

// registerAllLaunchActivities registers all stub activities with the test environment.
func registerAllLaunchActivities(env *testsuite.TestWorkflowEnvironment) {
	env.RegisterActivityWithOptions(stubValidateLaunchInputs, activity.RegisterOptions{
		Name: ActivityValidateLaunchInputs,
	})
	env.RegisterActivityWithOptions(stubUpdateLaunchStatus, activity.RegisterOptions{
		Name: ActivityUpdateLaunchStatus,
	})
	env.RegisterActivityWithOptions(stubStoreLaunchOutputs, activity.RegisterOptions{
		Name: ActivityStoreLaunchOutputs,
	})
	env.RegisterActivityWithOptions(stubProvisionInfra, activity.RegisterOptions{
		Name: ActivityProvisionInfra,
	})
	env.RegisterActivityWithOptions(stubDestroyInfra, activity.RegisterOptions{
		Name: ActivityDestroyInfra,
	})
}

func TestLaunchWorkflow_Success(t *testing.T) {
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestWorkflowEnvironment()
	registerAllLaunchActivities(env)

	input := newLaunchTestInput()

	// Mock activities — happy path
	env.OnActivity(stubValidateLaunchInputs, mock.Anything, mock.Anything).Return(nil)
	// UpdateLaunchStatus is called for: launching, active
	env.OnActivity(stubUpdateLaunchStatus, mock.Anything, mock.Anything).Return(nil)
	env.OnActivity(stubProvisionInfra, mock.Anything, mock.Anything).Return(&types.ProvisionInfraResult{
		Outputs: map[string]interface{}{"bucketArn": "arn:aws:s3:::my-bucket"},
		Summary: []string{"Created S3 bucket"},
	}, nil)
	env.OnActivity(stubStoreLaunchOutputs, mock.Anything, mock.Anything).Return(nil)

	// After reaching active state, the workflow blocks waiting for deorbit/abort signal.
	// Send a deorbit signal so the workflow can complete.
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(DeorbitSignal, types.DeorbitSignalInput{
			RequestedBy: "test-user",
			Reason:      "test cleanup",
		})
	}, 0)

	// Mock the destroy activity for the deorbit phase
	env.OnActivity(stubDestroyInfra, mock.Anything, mock.Anything).Return(nil)

	env.ExecuteWorkflow(LaunchWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
}

func TestLaunchWorkflow_WithApproval(t *testing.T) {
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestWorkflowEnvironment()
	registerAllLaunchActivities(env)

	input := newLaunchTestInput()
	input.ApprovalRequired = true

	// Mock activities
	env.OnActivity(stubValidateLaunchInputs, mock.Anything, mock.Anything).Return(nil)
	env.OnActivity(stubUpdateLaunchStatus, mock.Anything, mock.Anything).Return(nil)
	env.OnActivity(stubProvisionInfra, mock.Anything, mock.Anything).Return(&types.ProvisionInfraResult{
		Outputs: map[string]interface{}{"bucketArn": "arn:aws:s3:::my-bucket"},
	}, nil)
	env.OnActivity(stubStoreLaunchOutputs, mock.Anything, mock.Anything).Return(nil)
	env.OnActivity(stubDestroyInfra, mock.Anything, mock.Anything).Return(nil)

	// Send approval signal after a short delay
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(ApprovalSignal, types.ApprovalSignalInput{
			Approved:   true,
			ApprovedBy: "admin@example.com",
			Notes:      "Looks good",
		})
	}, time.Millisecond)

	// Send deorbit signal to let workflow complete after reaching active state
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(DeorbitSignal, types.DeorbitSignalInput{
			RequestedBy: "test-user",
			Reason:      "test cleanup",
		})
	}, 2*time.Millisecond)

	env.ExecuteWorkflow(LaunchWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
}

func TestLaunchWorkflow_ApprovalRejected(t *testing.T) {
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestWorkflowEnvironment()
	registerAllLaunchActivities(env)

	input := newLaunchTestInput()
	input.ApprovalRequired = true

	// Mock activities
	env.OnActivity(stubValidateLaunchInputs, mock.Anything, mock.Anything).Return(nil)
	env.OnActivity(stubUpdateLaunchStatus, mock.Anything, mock.Anything).Return(nil)

	// Send rejection signal
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(ApprovalSignal, types.ApprovalSignalInput{
			Approved:   false,
			ApprovedBy: "admin@example.com",
			Notes:      "Not approved",
		})
	}, time.Millisecond)

	env.ExecuteWorkflow(LaunchWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())
	// Rejection returns nil (graceful abort), not an error
	require.NoError(t, env.GetWorkflowError())
}

func TestLaunchWorkflow_ProvisionFailed(t *testing.T) {
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestWorkflowEnvironment()
	registerAllLaunchActivities(env)

	input := newLaunchTestInput()

	// Mock activities
	env.OnActivity(stubValidateLaunchInputs, mock.Anything, mock.Anything).Return(nil)
	env.OnActivity(stubUpdateLaunchStatus, mock.Anything, mock.Anything).Return(nil)
	env.OnActivity(stubProvisionInfra, mock.Anything, mock.Anything).
		Return(nil, fmt.Errorf("Pulumi up failed: access denied"))

	env.ExecuteWorkflow(LaunchWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())
	err := env.GetWorkflowError()
	require.Error(t, err)
	require.Contains(t, err.Error(), "provisioning failed")
}

func TestLaunchWorkflow_Deorbit(t *testing.T) {
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestWorkflowEnvironment()
	registerAllLaunchActivities(env)

	input := newLaunchTestInput()

	// Mock activities — happy path through provisioning
	env.OnActivity(stubValidateLaunchInputs, mock.Anything, mock.Anything).Return(nil)
	env.OnActivity(stubUpdateLaunchStatus, mock.Anything, mock.Anything).Return(nil)
	env.OnActivity(stubProvisionInfra, mock.Anything, mock.Anything).Return(&types.ProvisionInfraResult{
		Outputs: map[string]interface{}{"url": "https://example.com"},
	}, nil)
	env.OnActivity(stubStoreLaunchOutputs, mock.Anything, mock.Anything).Return(nil)
	env.OnActivity(stubDestroyInfra, mock.Anything, mock.Anything).Return(nil)

	// Send deorbit signal once workflow reaches active/entity phase
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(DeorbitSignal, types.DeorbitSignalInput{
			RequestedBy: "ops-team",
			Reason:      "infrastructure no longer needed",
		})
	}, 0)

	env.ExecuteWorkflow(LaunchWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	// Verify the progress query shows deorbited status
	result, err := env.QueryWorkflow(GetLaunchProgress)
	require.NoError(t, err)

	var progress types.LaunchProgress
	require.NoError(t, result.Get(&progress))
	require.Equal(t, "deorbited", progress.Status)
	require.Contains(t, progress.Logs, "Deorbit complete")
}

func TestLaunchWorkflow_ValidationFailed(t *testing.T) {
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestWorkflowEnvironment()
	registerAllLaunchActivities(env)

	input := newLaunchTestInput()

	// Mock validation failure
	env.OnActivity(stubValidateLaunchInputs, mock.Anything, mock.Anything).
		Return(fmt.Errorf("launchId is required"))
	env.OnActivity(stubUpdateLaunchStatus, mock.Anything, mock.Anything).Return(nil)

	env.ExecuteWorkflow(LaunchWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())
	err := env.GetWorkflowError()
	require.Error(t, err)
	require.Contains(t, err.Error(), "validation failed")
}

func TestLaunchWorkflow_ProgressQuery(t *testing.T) {
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestWorkflowEnvironment()
	registerAllLaunchActivities(env)

	input := newLaunchTestInput()

	// Mock all activities to succeed
	env.OnActivity(stubValidateLaunchInputs, mock.Anything, mock.Anything).Return(nil)
	env.OnActivity(stubUpdateLaunchStatus, mock.Anything, mock.Anything).Return(nil)
	env.OnActivity(stubProvisionInfra, mock.Anything, mock.Anything).Return(&types.ProvisionInfraResult{
		Outputs: map[string]interface{}{},
	}, nil)
	env.OnActivity(stubStoreLaunchOutputs, mock.Anything, mock.Anything).Return(nil)
	env.OnActivity(stubDestroyInfra, mock.Anything, mock.Anything).Return(nil)

	// Send deorbit signal to let workflow complete
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(DeorbitSignal, types.DeorbitSignalInput{
			RequestedBy: "test",
			Reason:      "done",
		})
	}, 0)

	env.ExecuteWorkflow(LaunchWorkflow, input)
	require.True(t, env.IsWorkflowCompleted())

	// Query progress after completion
	result, err := env.QueryWorkflow(GetLaunchProgress)
	require.NoError(t, err)

	var progress types.LaunchProgress
	require.NoError(t, result.Get(&progress))
	require.Equal(t, 5, progress.TotalSteps)
	require.NotEmpty(t, progress.Logs)
}

// Verify that taskQueueForProvider returns the correct queue name
func TestTaskQueueForProvider(t *testing.T) {
	require.Equal(t, "launches_aws", taskQueueForProvider("aws"))
	require.Equal(t, "launches_gcp", taskQueueForProvider("gcp"))
	require.Equal(t, "launches_azure", taskQueueForProvider("azure"))
}
