package workflows

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/testsuite"
)

// Stub activity functions for testing
func stubValidateDeploymentConfig(ctx context.Context, input ValidateDeploymentConfigInput) error {
	return nil
}

func stubPrepareGeneratorContext(ctx context.Context, input PrepareGeneratorContextInput) (string, error) {
	return "", nil
}

func stubExecuteGenerator(ctx context.Context, input ExecuteGeneratorInput) (*ExecuteGeneratorResult, error) {
	return &ExecuteGeneratorResult{}, nil
}

func stubUpdateDeploymentStatus(ctx context.Context, input UpdateDeploymentStatusInput) error {
	return nil
}

func stubCleanupWorkDir(ctx context.Context, workDir string) error {
	return nil
}

func TestDeploymentWorkflow_Success(t *testing.T) {
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestWorkflowEnvironment()

	// Register stub activities with names matching the workflow constants
	env.RegisterActivityWithOptions(stubValidateDeploymentConfig, activity.RegisterOptions{
		Name: ActivityValidateDeploymentConfig,
	})
	env.RegisterActivityWithOptions(stubPrepareGeneratorContext, activity.RegisterOptions{
		Name: ActivityPrepareGeneratorContext,
	})
	env.RegisterActivityWithOptions(stubExecuteGenerator, activity.RegisterOptions{
		Name: ActivityExecuteGenerator,
	})
	env.RegisterActivityWithOptions(stubUpdateDeploymentStatus, activity.RegisterOptions{
		Name: ActivityUpdateDeploymentStatus,
	})
	env.RegisterActivityWithOptions(stubCleanupWorkDir, activity.RegisterOptions{
		Name: ActivityCleanupWorkDir,
	})

	input := DeploymentWorkflowInput{
		DeploymentID:  "deploy-123",
		AppID:         "app-456",
		WorkspaceID:   "ws-789",
		UserID:        "user-001",
		GeneratorType: "docker-compose",
		GeneratorSlug: "docker-compose-basic",
		Config:        []byte(`{"hostUrl":"unix:///var/run/docker.sock","serviceName":"my-app","port":3000}`),
		Target: DeploymentTargetInput{
			Type:    "docker-host",
			HostURL: "unix:///var/run/docker.sock",
		},
	}

	// Mock activities
	env.OnActivity(stubUpdateDeploymentStatus, mock.Anything, mock.Anything).Return(nil).Times(2)
	env.OnActivity(stubValidateDeploymentConfig, mock.Anything, mock.Anything).Return(nil)
	env.OnActivity(stubPrepareGeneratorContext, mock.Anything, mock.Anything).Return("/tmp/deploy-123", nil)
	env.OnActivity(stubExecuteGenerator, mock.Anything, mock.Anything).Return(&ExecuteGeneratorResult{
		Success:       true,
		DeploymentURL: "http://localhost:3000",
	}, nil)
	env.OnActivity(stubCleanupWorkDir, mock.Anything, mock.Anything).Return(nil)

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

	// Register stub activities with names matching the workflow constants
	env.RegisterActivityWithOptions(stubValidateDeploymentConfig, activity.RegisterOptions{
		Name: ActivityValidateDeploymentConfig,
	})
	env.RegisterActivityWithOptions(stubUpdateDeploymentStatus, activity.RegisterOptions{
		Name: ActivityUpdateDeploymentStatus,
	})

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
	env.OnActivity(stubUpdateDeploymentStatus, mock.Anything, mock.Anything).Return(nil).Times(2)
	env.OnActivity(stubValidateDeploymentConfig, mock.Anything, mock.Anything).
		Return(fmt.Errorf("validation failed: missing required field 'hostUrl'"))

	env.ExecuteWorkflow(DeploymentWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())

	var result DeploymentWorkflowResult
	require.NoError(t, env.GetWorkflowResult(&result))
	require.Equal(t, "failed", result.Status)
	require.Contains(t, result.Error, "validation failed")
}
