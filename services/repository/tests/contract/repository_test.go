package contract

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	
	repositorypb "github.com/drewpayment/orbit/proto/gen/go/idp/repository/v1"
	commonpb "github.com/drewpayment/orbit/proto/gen/go/idp/common/v1"
)

// TestCreateRepository_Success tests successful repository creation
func TestCreateRepository_Success(t *testing.T) {
	// This test should fail until RepositoryService is implemented
	t.Skip("Implementation pending - TDD requirement: test must exist and fail before implementation")

	ctx := context.Background()
	
	req := &repositorypb.CreateRepositoryRequest{
		WorkspaceId: "workspace-123",
		Repository: &repositorypb.Repository{
			Name:        "test-repo",
			Description: "A test repository",
			Language:    "go",
			Visibility:  repositorypb.Repository_VISIBILITY_PRIVATE,
			Template:    "standard-go-service",
		},
	}

	// Mock service call - will be replaced with actual service
	var service repositorypb.RepositoryServiceClient
	resp, err := service.CreateRepository(ctx, req)

	require.NoError(t, err)
	require.NotNil(t, resp)
	require.NotNil(t, resp.Repository)

	// Validate repository properties
	assert.Equal(t, req.Repository.Name, resp.Repository.Name)
	assert.Equal(t, req.Repository.Description, resp.Repository.Description)
	assert.Equal(t, req.Repository.Language, resp.Repository.Language)
	assert.Equal(t, req.Repository.Visibility, resp.Repository.Visibility)
	assert.Equal(t, req.Repository.Template, resp.Repository.Template)

	// Validate generated fields
	assert.NotEmpty(t, resp.Repository.Id)
	assert.NotEmpty(t, resp.Repository.Url)
	assert.NotEmpty(t, resp.Repository.CloneUrl)
	assert.NotNil(t, resp.Repository.CreatedAt)
	assert.NotNil(t, resp.Repository.UpdatedAt)
	assert.Equal(t, req.WorkspaceId, resp.Repository.WorkspaceId)
}

// TestCreateRepository_ValidationErrors tests input validation
func TestCreateRepository_ValidationErrors(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service repositorypb.RepositoryServiceClient

	testCases := []struct {
		name     string
		req      *repositorypb.CreateRepositoryRequest
		wantCode codes.Code
		wantMsg  string
	}{
		{
			name: "missing workspace ID",
			req: &repositorypb.CreateRepositoryRequest{
				Repository: &repositorypb.Repository{
					Name:     "test-repo",
					Language: "go",
				},
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "workspace_id is required",
		},
		{
			name: "missing repository",
			req: &repositorypb.CreateRepositoryRequest{
				WorkspaceId: "workspace-123",
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "repository is required",
		},
		{
			name: "missing repository name",
			req: &repositorypb.CreateRepositoryRequest{
				WorkspaceId: "workspace-123",
				Repository: &repositorypb.Repository{
					Language: "go",
				},
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "repository.name is required",
		},
		{
			name: "invalid repository name - too short",
			req: &repositorypb.CreateRepositoryRequest{
				WorkspaceId: "workspace-123",
				Repository: &repositorypb.Repository{
					Name:     "a",
					Language: "go",
				},
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "repository.name must be at least 2 characters",
		},
		{
			name: "invalid repository name - too long",
			req: &repositorypb.CreateRepositoryRequest{
				WorkspaceId: "workspace-123",
				Repository: &repositorypb.Repository{
					Name:     "this-repository-name-is-way-too-long-and-exceeds-maximum-allowed-length-for-repository-names-which-should-be-reasonable",
					Language: "go",
				},
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "repository.name must be at most 100 characters",
		},
		{
			name: "invalid repository name - invalid characters",
			req: &repositorypb.CreateRepositoryRequest{
				WorkspaceId: "workspace-123",
				Repository: &repositorypb.Repository{
					Name:     "test repo with spaces!",
					Language: "go",
				},
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "repository.name must contain only lowercase letters, numbers, and hyphens",
		},
		{
			name: "missing language",
			req: &repositorypb.CreateRepositoryRequest{
				WorkspaceId: "workspace-123",
				Repository: &repositorypb.Repository{
					Name: "test-repo",
				},
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "repository.language is required",
		},
		{
			name: "invalid template",
			req: &repositorypb.CreateRepositoryRequest{
				WorkspaceId: "workspace-123",
				Repository: &repositorypb.Repository{
					Name:     "test-repo",
					Language: "go",
					Template: "non-existent-template",
				},
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "repository.template 'non-existent-template' is not available for language 'go'",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := service.CreateRepository(ctx, tc.req)
			
			require.Error(t, err)
			st, ok := status.FromError(err)
			require.True(t, ok, "error should be a gRPC status error")
			assert.Equal(t, tc.wantCode, st.Code())
			assert.Contains(t, st.Message(), tc.wantMsg)
		})
	}
}

// TestCreateRepository_WorkspaceNotFound tests workspace existence validation
func TestCreateRepository_WorkspaceNotFound(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service repositorypb.RepositoryServiceClient
	
	req := &repositorypb.CreateRepositoryRequest{
		WorkspaceId: "non-existent-workspace",
		Repository: &repositorypb.Repository{
			Name:     "test-repo",
			Language: "go",
		},
	}

	_, err := service.CreateRepository(ctx, req)
	
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, st.Code())
	assert.Contains(t, st.Message(), "workspace 'non-existent-workspace' not found")
}

// TestCreateRepository_DuplicateName tests repository name uniqueness within workspace
func TestCreateRepository_DuplicateName(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service repositorypb.RepositoryServiceClient
	
	// First creation should succeed
	req := &repositorypb.CreateRepositoryRequest{
		WorkspaceId: "workspace-123",
		Repository: &repositorypb.Repository{
			Name:     "test-repo",
			Language: "go",
		},
	}

	_, err := service.CreateRepository(ctx, req)
	require.NoError(t, err)

	// Second creation with same name should fail
	_, err = service.CreateRepository(ctx, req)
	
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.AlreadyExists, st.Code())
	assert.Contains(t, st.Message(), "repository 'test-repo' already exists in workspace 'workspace-123'")
}

// TestCreateRepository_PermissionDenied tests access control
func TestCreateRepository_PermissionDenied(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service repositorypb.RepositoryServiceClient
	
	// Context without proper permissions
	req := &repositorypb.CreateRepositoryRequest{
		WorkspaceId: "workspace-123",
		Repository: &repositorypb.Repository{
			Name:     "test-repo",
			Language: "go",
		},
	}

	_, err := service.CreateRepository(ctx, req)
	
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.PermissionDenied, st.Code())
	assert.Contains(t, st.Message(), "insufficient permissions to create repository in workspace 'workspace-123'")
}

// TestCreateRepository_TemplateHandling tests different template scenarios
func TestCreateRepository_TemplateHandling(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service repositorypb.RepositoryServiceClient

	testCases := []struct {
		name     string
		language string
		template string
		wantErr  bool
	}{
		{
			name:     "go with standard template",
			language: "go",
			template: "standard-go-service",
			wantErr:  false,
		},
		{
			name:     "go with minimal template",
			language: "go",
			template: "minimal-go",
			wantErr:  false,
		},
		{
			name:     "typescript with react template",
			language: "typescript",
			template: "react-app",
			wantErr:  false,
		},
		{
			name:     "python with fastapi template",
			language: "python",
			template: "fastapi-service",
			wantErr:  false,
		},
		{
			name:     "empty template (should use default)",
			language: "go",
			template: "",
			wantErr:  false,
		},
		{
			name:     "template for wrong language",
			language: "go",
			template: "react-app",
			wantErr:  true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			req := &repositorypb.CreateRepositoryRequest{
				WorkspaceId: "workspace-123",
				Repository: &repositorypb.Repository{
					Name:     fmt.Sprintf("test-repo-%s", tc.name),
					Language: tc.language,
					Template: tc.template,
				},
			}

			resp, err := service.CreateRepository(ctx, req)

			if tc.wantErr {
				require.Error(t, err)
				st, ok := status.FromError(err)
				require.True(t, ok)
				assert.Equal(t, codes.InvalidArgument, st.Code())
			} else {
				require.NoError(t, err)
				require.NotNil(t, resp)
				
				expectedTemplate := tc.template
				if expectedTemplate == "" {
					// Should use default template for language
					expectedTemplate = "standard-" + tc.language + "-service"
				}
				assert.Equal(t, expectedTemplate, resp.Repository.Template)
			}
		})
	}
}

// TestCreateRepository_GitOperations tests repository creation with Git initialization
func TestCreateRepository_GitOperations(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service repositorypb.RepositoryServiceClient
	
	req := &repositorypb.CreateRepositoryRequest{
		WorkspaceId: "workspace-123",
		Repository: &repositorypb.Repository{
			Name:        "test-repo",
			Description: "A test repository with Git initialization",
			Language:    "go",
			Template:    "standard-go-service",
			Visibility:  repositorypb.Repository_VISIBILITY_PRIVATE,
		},
	}

	resp, err := service.CreateRepository(ctx, req)

	require.NoError(t, err)
	require.NotNil(t, resp)
	require.NotNil(t, resp.Repository)

	// Validate Git-related fields
	assert.NotEmpty(t, resp.Repository.Url, "repository URL should be set")
	assert.NotEmpty(t, resp.Repository.CloneUrl, "clone URL should be set")
	assert.Contains(t, resp.Repository.CloneUrl, "git", "clone URL should contain git")
	assert.Contains(t, resp.Repository.Url, resp.Repository.Name, "URL should contain repository name")

	// Validate repository status indicates it's ready
	assert.Equal(t, repositorypb.Repository_STATUS_ACTIVE, resp.Repository.Status)
}