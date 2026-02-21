package workflows

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/testsuite"
)

// Stub activity functions for spec sync testing

func stubListRepoSpecFiles(ctx context.Context, input ListSpecFilesInput) (*ListSpecFilesResult, error) {
	return &ListSpecFilesResult{}, nil
}

func stubFetchSpecContent(ctx context.Context, input FetchSpecContentInput) (*FetchSpecContentResult, error) {
	return &FetchSpecContentResult{}, nil
}

func stubUpsertAPISchema(ctx context.Context, input UpsertSchemaInput) (*UpsertSchemaResult, error) {
	return &UpsertSchemaResult{}, nil
}

func stubRemoveOrphanedSpecs(ctx context.Context, input RemoveOrphanedSpecsInput) error {
	return nil
}

func TestRepositorySpecSyncWorkflow_InitialScan(t *testing.T) {
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestWorkflowEnvironment()

	// Register stub activities with names matching workflow constants
	env.RegisterActivityWithOptions(stubListRepoSpecFiles, activity.RegisterOptions{
		Name: ActivityListRepoSpecFiles,
	})
	env.RegisterActivityWithOptions(stubFetchSpecContent, activity.RegisterOptions{
		Name: ActivityFetchSpecContent,
	})
	env.RegisterActivityWithOptions(stubUpsertAPISchema, activity.RegisterOptions{
		Name: ActivityUpsertAPISchema,
	})
	env.RegisterActivityWithOptions(stubRemoveOrphanedSpecs, activity.RegisterOptions{
		Name: ActivityRemoveOrphanedSpecs,
	})

	// Mock ListRepoSpecFiles to return 1 spec file
	env.OnActivity(stubListRepoSpecFiles, mock.Anything, mock.Anything).Return(&ListSpecFilesResult{
		Files: []SpecFileInfo{
			{Path: "api/openapi.yaml", SpecType: "openapi"},
		},
	}, nil)

	// Mock FetchSpecContent
	env.OnActivity(stubFetchSpecContent, mock.Anything, mock.Anything).Return(&FetchSpecContentResult{
		Content:  "openapi: 3.0.0\ninfo:\n  title: Test API",
		FilePath: "api/openapi.yaml",
	}, nil)

	// Mock UpsertAPISchema
	env.OnActivity(stubUpsertAPISchema, mock.Anything, mock.Anything).Return(&UpsertSchemaResult{
		SchemaID: "schema-001",
	}, nil)

	// Mock RemoveOrphanedSpecs
	env.OnActivity(stubRemoveOrphanedSpecs, mock.Anything, mock.Anything).Return(nil)

	input := SpecSyncInput{
		AppID:          "app-123",
		RepoFullName:   "my-org/my-repo",
		InstallationID: "install-456",
		WorkspaceID:    "workspace-789",
	}

	// Cancel after initial scan completes and workflow enters signal loop
	env.RegisterDelayedCallback(func() {
		// Query progress to verify initial scan results
		encoded, err := env.QueryWorkflow("progress")
		require.NoError(t, err)
		var progress SpecSyncProgress
		require.NoError(t, encoded.Get(&progress))
		require.Equal(t, 1, progress.SpecsFound)

		env.CancelWorkflow()
	}, 100*time.Millisecond)

	env.ExecuteWorkflow(RepositorySpecSyncWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())
	// The workflow ends with an error since it's a long-running workflow
	// that was interrupted (either canceled or deadline exceeded)
	err := env.GetWorkflowError()
	require.Error(t, err)
}
