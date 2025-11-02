package workflows

import (
	"context"
	"errors"
	"testing"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/suite"
	"go.temporal.io/sdk/testsuite"
)

type KnowledgeSyncWorkflowTestSuite struct {
	suite.Suite
	testsuite.WorkflowTestSuite
	env *testsuite.TestWorkflowEnvironment
}

func (s *KnowledgeSyncWorkflowTestSuite) SetupTest() {
	s.env = s.NewTestWorkflowEnvironment()

	// Register stub activities for testing
	s.env.RegisterActivity(fetchKnowledgePagesActivityStub)
	s.env.RegisterActivity(transformContentActivityStub)
	s.env.RegisterActivity(syncToExternalSystemActivityStub)
	s.env.RegisterActivity(updateSyncStatusActivityStub)
}

func (s *KnowledgeSyncWorkflowTestSuite) AfterTest(suiteName, testName string) {
	s.env.AssertExpectations(s.T())
}

func TestKnowledgeSyncWorkflowTestSuite(t *testing.T) {
	suite.Run(t, new(KnowledgeSyncWorkflowTestSuite))
}

// Test successful knowledge sync workflow
func (s *KnowledgeSyncWorkflowTestSuite) TestKnowledgeSyncWorkflow_Success() {
	input := KnowledgeSyncWorkflowInput{
		WorkspaceID:  "workspace-123",
		SpaceID:      "space-456",
		TargetSystem: "confluence",
		Credentials: map[string]string{
			"api_key": "test-key",
			"base_url": "https://test.atlassian.net",
		},
	}

	mockPages := []activities.KnowledgePage{
		{
			ID:      "page-1",
			Title:   "Getting Started",
			Content: "# Getting Started\n\nWelcome to our docs!",
			SpaceID: "space-456",
		},
		{
			ID:      "page-2",
			Title:   "API Reference",
			Content: "# API Reference\n\nAPI documentation here.",
			SpaceID: "space-456",
		},
	}

	mockTransformed := []activities.TransformedPage{
		{
			ID:      "page-1",
			Title:   "Getting Started",
			Content: "<ac:structured-macro>Getting Started</ac:structured-macro>",
			Format:  "confluence_storage",
		},
		{
			ID:      "page-2",
			Title:   "API Reference",
			Content: "<ac:structured-macro>API Reference</ac:structured-macro>",
			Format:  "confluence_storage",
		},
	}

	// Mock FetchKnowledgePagesActivity
	s.env.OnActivity(fetchKnowledgePagesActivityStub, mock.Anything, mock.Anything).
		Return(mockPages, nil)

	// Mock TransformContentActivity
	s.env.OnActivity(transformContentActivityStub, mock.Anything, mock.Anything).
		Return(mockTransformed, nil)

	// Mock SyncToExternalSystemActivity
	s.env.OnActivity(syncToExternalSystemActivityStub, mock.Anything, mock.Anything).
		Return(nil)

	// Mock UpdateSyncStatusActivity
	s.env.OnActivity(updateSyncStatusActivityStub, mock.Anything, mock.Anything).
		Return(nil)

	s.env.ExecuteWorkflow(KnowledgeSyncWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.NoError(s.env.GetWorkflowError())

	var result KnowledgeSyncWorkflowResult
	err := s.env.GetWorkflowResult(&result)
	s.NoError(err)
	s.Equal("space-456", result.SpaceID)
	s.Equal(2, result.PagesSynced)
	s.Equal("completed", result.Status)
	s.NotZero(result.LastSyncTime)
}

// Test workflow failure when fetching pages fails
func (s *KnowledgeSyncWorkflowTestSuite) TestKnowledgeSyncWorkflow_FetchPagesFailed() {
	input := KnowledgeSyncWorkflowInput{
		WorkspaceID:  "workspace-123",
		SpaceID:      "space-456",
		TargetSystem: "confluence",
		Credentials:  map[string]string{},
	}

	// Mock FetchKnowledgePagesActivity to return an error
	s.env.OnActivity(fetchKnowledgePagesActivityStub, mock.Anything, mock.Anything).
		Return([]activities.KnowledgePage{}, errors.New("database connection failed"))

	s.env.ExecuteWorkflow(KnowledgeSyncWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.Error(s.env.GetWorkflowError())
}

// Test workflow failure when external system is unavailable
func (s *KnowledgeSyncWorkflowTestSuite) TestKnowledgeSyncWorkflow_ExternalSystemUnavailable() {
	input := KnowledgeSyncWorkflowInput{
		WorkspaceID:  "workspace-123",
		SpaceID:      "space-456",
		TargetSystem: "notion",
		Credentials: map[string]string{
			"api_key": "test-key",
		},
	}

	mockPages := []activities.KnowledgePage{
		{
			ID:      "page-1",
			Title:   "Test Page",
			Content: "# Test\n\nContent",
			SpaceID: "space-456",
		},
	}

	mockTransformed := []activities.TransformedPage{
		{
			ID:      "page-1",
			Title:   "Test Page",
			Content: `{"blocks": [{"type": "heading_1", "text": "Test"}]}`,
			Format:  "notion_blocks",
		},
	}

	// Mock successful fetch and transform
	s.env.OnActivity(fetchKnowledgePagesActivityStub, mock.Anything, mock.Anything).
		Return(mockPages, nil)
	s.env.OnActivity(transformContentActivityStub, mock.Anything, mock.Anything).
		Return(mockTransformed, nil)

	// Mock SyncToExternalSystemActivity to fail
	s.env.OnActivity(syncToExternalSystemActivityStub, mock.Anything, mock.Anything).
		Return(errors.New("notion API unavailable"))

	s.env.ExecuteWorkflow(KnowledgeSyncWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.Error(s.env.GetWorkflowError())
}

// Test partial sync failure
func (s *KnowledgeSyncWorkflowTestSuite) TestKnowledgeSyncWorkflow_PartialSyncFailure() {
	input := KnowledgeSyncWorkflowInput{
		WorkspaceID:  "workspace-123",
		SpaceID:      "space-456",
		TargetSystem: "github_pages",
		Credentials: map[string]string{
			"repo_url": "https://github.com/test/docs.git",
			"token":    "test-token",
		},
	}

	mockPages := []activities.KnowledgePage{
		{
			ID:      "page-1",
			Title:   "Test Page",
			Content: "# Test\n\nContent",
			SpaceID: "space-456",
		},
	}

	mockTransformed := []activities.TransformedPage{
		{
			ID:      "page-1",
			Title:   "Test Page",
			Content: "# Test\n\nContent",
			Format:  "markdown",
		},
	}

	// Mock successful fetch and transform
	s.env.OnActivity(fetchKnowledgePagesActivityStub, mock.Anything, mock.Anything).
		Return(mockPages, nil)
	s.env.OnActivity(transformContentActivityStub, mock.Anything, mock.Anything).
		Return(mockTransformed, nil)

	// Mock sync to fail with authentication error
	s.env.OnActivity(syncToExternalSystemActivityStub, mock.Anything, mock.Anything).
		Return(errors.New("authentication failed"))

	s.env.ExecuteWorkflow(KnowledgeSyncWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.Error(s.env.GetWorkflowError())
}

// Test retry behavior
func (s *KnowledgeSyncWorkflowTestSuite) TestKnowledgeSyncWorkflow_RetryBehavior() {
	input := KnowledgeSyncWorkflowInput{
		WorkspaceID:  "workspace-123",
		SpaceID:      "space-456",
		TargetSystem: "confluence",
		Credentials: map[string]string{
			"api_key": "test-key",
		},
	}

	mockPages := []activities.KnowledgePage{
		{
			ID:      "page-1",
			Title:   "Test Page",
			Content: "# Test\n\nContent",
			SpaceID: "space-456",
		},
	}

	mockTransformed := []activities.TransformedPage{
		{
			ID:      "page-1",
			Title:   "Test Page",
			Content: "<ac:structured-macro>Test</ac:structured-macro>",
			Format:  "confluence_storage",
		},
	}

	// Mock FetchKnowledgePagesActivity to fail twice then succeed
	callCount := 0
	s.env.OnActivity(fetchKnowledgePagesActivityStub, mock.Anything, mock.Anything).
		Return(func(ctx context.Context, input activities.FetchKnowledgePagesInput) ([]activities.KnowledgePage, error) {
			callCount++
			if callCount < 3 {
				return []activities.KnowledgePage{}, errors.New("temporary database error")
			}
			return mockPages, nil
		})

	// Mock other activities
	s.env.OnActivity(transformContentActivityStub, mock.Anything, mock.Anything).
		Return(mockTransformed, nil)
	s.env.OnActivity(syncToExternalSystemActivityStub, mock.Anything, mock.Anything).
		Return(nil)
	s.env.OnActivity(updateSyncStatusActivityStub, mock.Anything, mock.Anything).
		Return(nil)

	s.env.ExecuteWorkflow(KnowledgeSyncWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.NoError(s.env.GetWorkflowError())

	var result KnowledgeSyncWorkflowResult
	err := s.env.GetWorkflowResult(&result)
	s.NoError(err)
	s.Equal("completed", result.Status)
}

// Test empty knowledge space
func (s *KnowledgeSyncWorkflowTestSuite) TestKnowledgeSyncWorkflow_EmptySpace() {
	input := KnowledgeSyncWorkflowInput{
		WorkspaceID:  "workspace-123",
		SpaceID:      "space-empty",
		TargetSystem: "confluence",
		Credentials:  map[string]string{},
	}

	// Mock FetchKnowledgePagesActivity to return empty list
	s.env.OnActivity(fetchKnowledgePagesActivityStub, mock.Anything, mock.Anything).
		Return([]activities.KnowledgePage{}, nil)

	// Mock TransformContentActivity to return empty list
	s.env.OnActivity(transformContentActivityStub, mock.Anything, mock.Anything).
		Return([]activities.TransformedPage{}, nil)

	// Mock SyncToExternalSystemActivity (should still be called)
	s.env.OnActivity(syncToExternalSystemActivityStub, mock.Anything, mock.Anything).
		Return(nil)

	// Mock UpdateSyncStatusActivity
	s.env.OnActivity(updateSyncStatusActivityStub, mock.Anything, mock.Anything).
		Return(nil)

	s.env.ExecuteWorkflow(KnowledgeSyncWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.NoError(s.env.GetWorkflowError())

	var result KnowledgeSyncWorkflowResult
	err := s.env.GetWorkflowResult(&result)
	s.NoError(err)
	s.Equal("space-empty", result.SpaceID)
	s.Equal(0, result.PagesSynced)
	s.Equal("completed", result.Status)
}
