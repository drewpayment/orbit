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
func stubAnalyzeRepository(ctx context.Context, input AnalyzeRepositoryInput) (*AnalyzeRepositoryResult, error) {
	return &AnalyzeRepositoryResult{}, nil
}

func stubBuildAndPushImage(ctx context.Context, input BuildAndPushInput) (*BuildAndPushResult, error) {
	return &BuildAndPushResult{}, nil
}

func stubUpdateBuildStatus(ctx context.Context, input UpdateBuildStatusInput) error {
	return nil
}

func TestBuildWorkflow_Success(t *testing.T) {
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestWorkflowEnvironment()

	// Register stub activities with names matching the workflow constants
	env.RegisterActivityWithOptions(stubAnalyzeRepository, activity.RegisterOptions{
		Name: ActivityAnalyzeRepository,
	})
	env.RegisterActivityWithOptions(stubBuildAndPushImage, activity.RegisterOptions{
		Name: ActivityBuildAndPushImage,
	})
	env.RegisterActivityWithOptions(stubUpdateBuildStatus, activity.RegisterOptions{
		Name: ActivityUpdateBuildStatus,
	})

	input := BuildWorkflowInput{
		RequestID:   "req-123",
		AppID:       "app-456",
		WorkspaceID: "ws-789",
		UserID:      "user-001",
		RepoURL:     "https://github.com/example/repo",
		Ref:         "main",
		Registry: BuildRegistryConfig{
			Type:       "ghcr",
			URL:        "ghcr.io",
			Repository: "example/repo",
			Token:      "ghp_test",
		},
		ImageTag: "v1.0.0",
	}

	// Mock successful analysis
	env.OnActivity(stubAnalyzeRepository, mock.Anything, mock.Anything).Return(&AnalyzeRepositoryResult{
		Detected:        true,
		Language:        "node",
		LanguageVersion: "20",
		Framework:       "nextjs",
		BuildCommand:    "npm run build",
		StartCommand:    "npm start",
	}, nil)

	// Mock successful build
	env.OnActivity(stubBuildAndPushImage, mock.Anything, mock.Anything).Return(&BuildAndPushResult{
		Success:     true,
		ImageURL:    "ghcr.io/example/repo:v1.0.0",
		ImageDigest: "sha256:abc123",
	}, nil)

	// Mock status updates (called 3 times: analyzing, building, success)
	env.OnActivity(stubUpdateBuildStatus, mock.Anything, mock.Anything).Return(nil).Times(3)

	env.ExecuteWorkflow(BuildWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var result BuildWorkflowResult
	require.NoError(t, env.GetWorkflowResult(&result))
	require.Equal(t, "success", result.Status)
	require.Equal(t, "ghcr.io/example/repo:v1.0.0", result.ImageURL)
	require.Equal(t, "sha256:abc123", result.ImageDigest)
	require.NotNil(t, result.DetectedConfig)
	require.Equal(t, "node", result.DetectedConfig.Language)
	require.Equal(t, "20", result.DetectedConfig.LanguageVersion)
	require.Equal(t, "nextjs", result.DetectedConfig.Framework)
}

func TestBuildWorkflow_AnalysisFails(t *testing.T) {
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestWorkflowEnvironment()

	// Register stub activities
	env.RegisterActivityWithOptions(stubAnalyzeRepository, activity.RegisterOptions{
		Name: ActivityAnalyzeRepository,
	})
	env.RegisterActivityWithOptions(stubUpdateBuildStatus, activity.RegisterOptions{
		Name: ActivityUpdateBuildStatus,
	})

	input := BuildWorkflowInput{
		RequestID:   "req-123",
		AppID:       "app-456",
		WorkspaceID: "ws-789",
		UserID:      "user-001",
		RepoURL:     "https://github.com/example/repo",
		Ref:         "main",
		Registry: BuildRegistryConfig{
			Type:       "ghcr",
			URL:        "ghcr.io",
			Repository: "example/repo",
			Token:      "ghp_test",
		},
	}

	// Mock failed analysis - return error
	env.OnActivity(stubAnalyzeRepository, mock.Anything, mock.Anything).
		Return(nil, fmt.Errorf("failed to clone repository"))

	// Mock status updates (called 2 times: analyzing, failed)
	env.OnActivity(stubUpdateBuildStatus, mock.Anything, mock.Anything).Return(nil).Times(2)

	env.ExecuteWorkflow(BuildWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())

	var result BuildWorkflowResult
	require.NoError(t, env.GetWorkflowResult(&result))
	require.Equal(t, "failed", result.Status)
	require.Contains(t, result.Error, "failed to clone repository")
}

func TestBuildWorkflow_AnalysisDetectionFails(t *testing.T) {
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestWorkflowEnvironment()

	// Register stub activities
	env.RegisterActivityWithOptions(stubAnalyzeRepository, activity.RegisterOptions{
		Name: ActivityAnalyzeRepository,
	})
	env.RegisterActivityWithOptions(stubUpdateBuildStatus, activity.RegisterOptions{
		Name: ActivityUpdateBuildStatus,
	})

	input := BuildWorkflowInput{
		RequestID:   "req-123",
		AppID:       "app-456",
		WorkspaceID: "ws-789",
		UserID:      "user-001",
		RepoURL:     "https://github.com/example/repo",
		Ref:         "main",
		Registry: BuildRegistryConfig{
			Type:       "ghcr",
			URL:        "ghcr.io",
			Repository: "example/repo",
			Token:      "ghp_test",
		},
	}

	// Mock analysis that doesn't detect a supported language
	env.OnActivity(stubAnalyzeRepository, mock.Anything, mock.Anything).Return(&AnalyzeRepositoryResult{
		Detected: false,
		Error:    "no supported language detected",
	}, nil)

	// Mock status updates (called 2 times: analyzing, failed)
	env.OnActivity(stubUpdateBuildStatus, mock.Anything, mock.Anything).Return(nil).Times(2)

	env.ExecuteWorkflow(BuildWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())

	var result BuildWorkflowResult
	require.NoError(t, env.GetWorkflowResult(&result))
	require.Equal(t, "failed", result.Status)
	require.Contains(t, result.Error, "no supported language detected")
}

func TestBuildWorkflow_BuildFails(t *testing.T) {
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestWorkflowEnvironment()

	// Register stub activities
	env.RegisterActivityWithOptions(stubAnalyzeRepository, activity.RegisterOptions{
		Name: ActivityAnalyzeRepository,
	})
	env.RegisterActivityWithOptions(stubBuildAndPushImage, activity.RegisterOptions{
		Name: ActivityBuildAndPushImage,
	})
	env.RegisterActivityWithOptions(stubUpdateBuildStatus, activity.RegisterOptions{
		Name: ActivityUpdateBuildStatus,
	})

	input := BuildWorkflowInput{
		RequestID:   "req-123",
		AppID:       "app-456",
		WorkspaceID: "ws-789",
		UserID:      "user-001",
		RepoURL:     "https://github.com/example/repo",
		Ref:         "main",
		Registry: BuildRegistryConfig{
			Type:       "ghcr",
			URL:        "ghcr.io",
			Repository: "example/repo",
			Token:      "ghp_test",
		},
	}

	// Mock successful analysis
	env.OnActivity(stubAnalyzeRepository, mock.Anything, mock.Anything).Return(&AnalyzeRepositoryResult{
		Detected:        true,
		Language:        "node",
		LanguageVersion: "20",
		Framework:       "nextjs",
		BuildCommand:    "npm run build",
		StartCommand:    "npm start",
	}, nil)

	// Mock failed build
	env.OnActivity(stubBuildAndPushImage, mock.Anything, mock.Anything).Return(&BuildAndPushResult{
		Success: false,
		Error:   "docker build failed: exit code 1",
	}, nil)

	// Mock status updates (called 3 times: analyzing, building, failed)
	env.OnActivity(stubUpdateBuildStatus, mock.Anything, mock.Anything).Return(nil).Times(3)

	env.ExecuteWorkflow(BuildWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())

	var result BuildWorkflowResult
	require.NoError(t, env.GetWorkflowResult(&result))
	require.Equal(t, "failed", result.Status)
	require.Contains(t, result.Error, "docker build failed")
}

func TestBuildWorkflow_WithOverrides(t *testing.T) {
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestWorkflowEnvironment()

	// Register stub activities
	env.RegisterActivityWithOptions(stubAnalyzeRepository, activity.RegisterOptions{
		Name: ActivityAnalyzeRepository,
	})
	env.RegisterActivityWithOptions(stubBuildAndPushImage, activity.RegisterOptions{
		Name: ActivityBuildAndPushImage,
	})
	env.RegisterActivityWithOptions(stubUpdateBuildStatus, activity.RegisterOptions{
		Name: ActivityUpdateBuildStatus,
	})

	input := BuildWorkflowInput{
		RequestID:   "req-123",
		AppID:       "app-456",
		WorkspaceID: "ws-789",
		UserID:      "user-001",
		RepoURL:     "https://github.com/example/repo",
		Ref:         "main",
		Registry: BuildRegistryConfig{
			Type:       "ghcr",
			URL:        "ghcr.io",
			Repository: "example/repo",
			Token:      "ghp_test",
		},
		// Overrides
		LanguageVersion: "18",
		BuildCommand:    "npm run custom-build",
		StartCommand:    "npm run custom-start",
		BuildEnv: map[string]string{
			"NODE_ENV": "production",
		},
		ImageTag: "custom-tag",
	}

	// Mock successful analysis with default values
	env.OnActivity(stubAnalyzeRepository, mock.Anything, mock.Anything).Return(&AnalyzeRepositoryResult{
		Detected:        true,
		Language:        "node",
		LanguageVersion: "20", // Will be overridden
		Framework:       "nextjs",
		BuildCommand:    "npm run build",  // Will be overridden
		StartCommand:    "npm start",      // Will be overridden
	}, nil)

	// Mock successful build - verify overrides are applied
	env.OnActivity(stubBuildAndPushImage, mock.Anything, mock.MatchedBy(func(input BuildAndPushInput) bool {
		return input.LanguageVersion == "18" &&
			input.BuildCommand == "npm run custom-build" &&
			input.StartCommand == "npm run custom-start" &&
			input.ImageTag == "custom-tag" &&
			input.BuildEnv["NODE_ENV"] == "production"
	})).Return(&BuildAndPushResult{
		Success:     true,
		ImageURL:    "ghcr.io/example/repo:custom-tag",
		ImageDigest: "sha256:abc123",
	}, nil)

	// Mock status updates
	env.OnActivity(stubUpdateBuildStatus, mock.Anything, mock.Anything).Return(nil).Times(3)

	env.ExecuteWorkflow(BuildWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var result BuildWorkflowResult
	require.NoError(t, env.GetWorkflowResult(&result))
	require.Equal(t, "success", result.Status)
	require.Equal(t, "ghcr.io/example/repo:custom-tag", result.ImageURL)
	require.NotNil(t, result.DetectedConfig)
	require.Equal(t, "18", result.DetectedConfig.LanguageVersion)
	require.Equal(t, "npm run custom-build", result.DetectedConfig.BuildCommand)
	require.Equal(t, "npm run custom-start", result.DetectedConfig.StartCommand)
}
