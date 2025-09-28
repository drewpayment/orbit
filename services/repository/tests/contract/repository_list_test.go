package contract

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	commonpb "github.com/drewpayment/orbit/proto/gen/go/idp/common/v1"
	repositorypb "github.com/drewpayment/orbit/proto/gen/go/idp/repository/v1"
)

// TestListRepositories_Success tests successful repository listing
func TestListRepositories_Success(t *testing.T) {
	// This test should fail until RepositoryService is implemented
	t.Skip("Implementation pending - TDD requirement: test must exist and fail before implementation")

	ctx := context.Background()
	var service repositorypb.RepositoryServiceClient

	req := &repositorypb.ListRepositoriesRequest{
		WorkspaceId: "workspace-123",
		Pagination: &commonpb.PaginationRequest{
			PageSize: 10,
			Page:     1,
		},
	}

	resp, err := service.ListRepositories(ctx, req)

	require.NoError(t, err)
	require.NotNil(t, resp)
	require.NotNil(t, resp.Repositories)
	require.NotNil(t, resp.Pagination)

	// Validate pagination response
	assert.LessOrEqual(t, len(resp.Repositories), int(req.Pagination.PageSize))
	assert.GreaterOrEqual(t, resp.Pagination.TotalItems, int64(len(resp.Repositories)))
	assert.Equal(t, req.Pagination.Page, resp.Pagination.Page)
	assert.Equal(t, req.Pagination.PageSize, resp.Pagination.PageSize)

	// Validate each repository has required fields
	for _, repo := range resp.Repositories {
		assert.NotEmpty(t, repo.Id)
		assert.NotEmpty(t, repo.Name)
		assert.NotEmpty(t, repo.Language)
		assert.NotEmpty(t, repo.WorkspaceId)
		assert.Equal(t, req.WorkspaceId, repo.WorkspaceId)
		assert.NotNil(t, repo.CreatedAt)
		assert.NotNil(t, repo.UpdatedAt)
	}
}

// TestListRepositories_EmptyWorkspace tests listing repositories in empty workspace
func TestListRepositories_EmptyWorkspace(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service repositorypb.RepositoryServiceClient

	req := &repositorypb.ListRepositoriesRequest{
		WorkspaceId: "empty-workspace-123",
		Pagination: &commonpb.PaginationRequest{
			PageSize: 10,
			Page:     1,
		},
	}

	resp, err := service.ListRepositories(ctx, req)

	require.NoError(t, err)
	require.NotNil(t, resp)
	require.NotNil(t, resp.Repositories)
	require.NotNil(t, resp.Pagination)

	assert.Empty(t, resp.Repositories)
	assert.Equal(t, int64(0), resp.Pagination.TotalItems)
	assert.Equal(t, int64(1), resp.Pagination.Page)
	assert.Equal(t, int64(0), resp.Pagination.TotalPages)
}

// TestListRepositories_Pagination tests pagination functionality
func TestListRepositories_Pagination(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service repositorypb.RepositoryServiceClient

	testCases := []struct {
		name     string
		pageSize int64
		page     int64
		wantErr  bool
	}{
		{
			name:     "first page",
			pageSize: 5,
			page:     1,
			wantErr:  false,
		},
		{
			name:     "second page",
			pageSize: 5,
			page:     2,
			wantErr:  false,
		},
		{
			name:     "large page size",
			pageSize: 100,
			page:     1,
			wantErr:  false,
		},
		{
			name:     "zero page size (should use default)",
			pageSize: 0,
			page:     1,
			wantErr:  false,
		},
		{
			name:     "zero page (should use default)",
			pageSize: 10,
			page:     0,
			wantErr:  false,
		},
		{
			name:     "excessive page size",
			pageSize: 1000,
			page:     1,
			wantErr:  true,
		},
		{
			name:     "negative page",
			pageSize: 10,
			page:     -1,
			wantErr:  true,
		},
		{
			name:     "negative page size",
			pageSize: -10,
			page:     1,
			wantErr:  true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			req := &repositorypb.ListRepositoriesRequest{
				WorkspaceId: "workspace-123",
				Pagination: &commonpb.PaginationRequest{
					PageSize: tc.pageSize,
					Page:     tc.page,
				},
			}

			resp, err := service.ListRepositories(ctx, req)

			if tc.wantErr {
				require.Error(t, err)
				st, ok := status.FromError(err)
				require.True(t, ok)
				assert.Equal(t, codes.InvalidArgument, st.Code())
			} else {
				require.NoError(t, err)
				require.NotNil(t, resp)

				// Validate pagination normalization
				expectedPageSize := tc.pageSize
				if expectedPageSize <= 0 {
					expectedPageSize = 20 // default page size
				}
				if expectedPageSize > 100 {
					expectedPageSize = 100 // max page size
				}

				expectedPage := tc.page
				if expectedPage <= 0 {
					expectedPage = 1 // default page
				}

				assert.Equal(t, expectedPageSize, resp.Pagination.PageSize)
				assert.Equal(t, expectedPage, resp.Pagination.Page)
			}
		})
	}
}

// TestListRepositories_Filtering tests repository filtering
func TestListRepositories_Filtering(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service repositorypb.RepositoryServiceClient

	testCases := []struct {
		name   string
		filter *repositorypb.RepositoryFilter
	}{
		{
			name: "filter by language",
			filter: &repositorypb.RepositoryFilter{
				Language: "go",
			},
		},
		{
			name: "filter by visibility",
			filter: &repositorypb.RepositoryFilter{
				Visibility: repositorypb.Repository_VISIBILITY_PRIVATE,
			},
		},
		{
			name: "filter by status",
			filter: &repositorypb.RepositoryFilter{
				Status: repositorypb.Repository_STATUS_ACTIVE,
			},
		},
		{
			name: "filter by template",
			filter: &repositorypb.RepositoryFilter{
				Template: "standard-go-service",
			},
		},
		{
			name: "search by name",
			filter: &repositorypb.RepositoryFilter{
				Search: "test",
			},
		},
		{
			name: "multiple filters",
			filter: &repositorypb.RepositoryFilter{
				Language:   "go",
				Visibility: repositorypb.Repository_VISIBILITY_PRIVATE,
				Status:     repositorypb.Repository_STATUS_ACTIVE,
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			req := &repositorypb.ListRepositoriesRequest{
				WorkspaceId: "workspace-123",
				Filter:      tc.filter,
				Pagination: &commonpb.PaginationRequest{
					PageSize: 20,
					Page:     1,
				},
			}

			resp, err := service.ListRepositories(ctx, req)

			require.NoError(t, err)
			require.NotNil(t, resp)

			// Validate that returned repositories match filter criteria
			for _, repo := range resp.Repositories {
				if tc.filter.Language != "" {
					assert.Equal(t, tc.filter.Language, repo.Language)
				}
				if tc.filter.Visibility != repositorypb.Repository_VISIBILITY_UNSPECIFIED {
					assert.Equal(t, tc.filter.Visibility, repo.Visibility)
				}
				if tc.filter.Status != repositorypb.Repository_STATUS_UNSPECIFIED {
					assert.Equal(t, tc.filter.Status, repo.Status)
				}
				if tc.filter.Template != "" {
					assert.Equal(t, tc.filter.Template, repo.Template)
				}
				if tc.filter.Search != "" {
					// Name should contain search term (case-insensitive)
					assert.Contains(t, repo.Name, tc.filter.Search)
				}
			}
		})
	}
}

// TestListRepositories_Sorting tests repository sorting
func TestListRepositories_Sorting(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service repositorypb.RepositoryServiceClient

	testCases := []struct {
		name    string
		sortBy  string
		sortDir commonpb.SortDirection
	}{
		{
			name:    "sort by name ascending",
			sortBy:  "name",
			sortDir: commonpb.SortDirection_SORT_DIRECTION_ASC,
		},
		{
			name:    "sort by name descending",
			sortBy:  "name",
			sortDir: commonpb.SortDirection_SORT_DIRECTION_DESC,
		},
		{
			name:    "sort by created_at ascending",
			sortBy:  "created_at",
			sortDir: commonpb.SortDirection_SORT_DIRECTION_ASC,
		},
		{
			name:    "sort by created_at descending",
			sortBy:  "created_at",
			sortDir: commonpb.SortDirection_SORT_DIRECTION_DESC,
		},
		{
			name:    "sort by updated_at descending",
			sortBy:  "updated_at",
			sortDir: commonpb.SortDirection_SORT_DIRECTION_DESC,
		},
		{
			name:    "sort by language ascending",
			sortBy:  "language",
			sortDir: commonpb.SortDirection_SORT_DIRECTION_ASC,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			req := &repositorypb.ListRepositoriesRequest{
				WorkspaceId: "workspace-123",
				Sort: &commonpb.SortRequest{
					SortBy:    tc.sortBy,
					Direction: tc.sortDir,
				},
				Pagination: &commonpb.PaginationRequest{
					PageSize: 20,
					Page:     1,
				},
			}

			resp, err := service.ListRepositories(ctx, req)

			require.NoError(t, err)
			require.NotNil(t, resp)

			// Validate sorting if we have multiple repositories
			if len(resp.Repositories) > 1 {
				for i := 1; i < len(resp.Repositories); i++ {
					prev := resp.Repositories[i-1]
					curr := resp.Repositories[i]

					switch tc.sortBy {
					case "name":
						if tc.sortDir == commonpb.SortDirection_SORT_DIRECTION_ASC {
							assert.LessOrEqual(t, prev.Name, curr.Name)
						} else {
							assert.GreaterOrEqual(t, prev.Name, curr.Name)
						}
					case "created_at":
						if tc.sortDir == commonpb.SortDirection_SORT_DIRECTION_ASC {
							assert.LessOrEqual(t, prev.CreatedAt.AsTime(), curr.CreatedAt.AsTime())
						} else {
							assert.GreaterOrEqual(t, prev.CreatedAt.AsTime(), curr.CreatedAt.AsTime())
						}
					case "language":
						if tc.sortDir == commonpb.SortDirection_SORT_DIRECTION_ASC {
							assert.LessOrEqual(t, prev.Language, curr.Language)
						} else {
							assert.GreaterOrEqual(t, prev.Language, curr.Language)
						}
					}
				}
			}
		})
	}
}

// TestListRepositories_ValidationErrors tests input validation
func TestListRepositories_ValidationErrors(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service repositorypb.RepositoryServiceClient

	testCases := []struct {
		name     string
		req      *repositorypb.ListRepositoriesRequest
		wantCode codes.Code
		wantMsg  string
	}{
		{
			name:     "missing workspace ID",
			req:      &repositorypb.ListRepositoriesRequest{},
			wantCode: codes.InvalidArgument,
			wantMsg:  "workspace_id is required",
		},
		{
			name: "invalid sort field",
			req: &repositorypb.ListRepositoriesRequest{
				WorkspaceId: "workspace-123",
				Sort: &commonpb.SortRequest{
					SortBy:    "invalid_field",
					Direction: commonpb.SortDirection_SORT_DIRECTION_ASC,
				},
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "sort_by 'invalid_field' is not supported",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := service.ListRepositories(ctx, tc.req)

			require.Error(t, err)
			st, ok := status.FromError(err)
			require.True(t, ok)
			assert.Equal(t, tc.wantCode, st.Code())
			assert.Contains(t, st.Message(), tc.wantMsg)
		})
	}
}

// TestListRepositories_WorkspaceNotFound tests workspace existence validation
func TestListRepositories_WorkspaceNotFound(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service repositorypb.RepositoryServiceClient

	req := &repositorypb.ListRepositoriesRequest{
		WorkspaceId: "non-existent-workspace",
		Pagination: &commonpb.PaginationRequest{
			PageSize: 10,
			Page:     1,
		},
	}

	_, err := service.ListRepositories(ctx, req)

	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, st.Code())
	assert.Contains(t, st.Message(), "workspace 'non-existent-workspace' not found")
}

// TestListRepositories_PermissionDenied tests access control
func TestListRepositories_PermissionDenied(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service repositorypb.RepositoryServiceClient

	req := &repositorypb.ListRepositoriesRequest{
		WorkspaceId: "restricted-workspace-123",
		Pagination: &commonpb.PaginationRequest{
			PageSize: 10,
			Page:     1,
		},
	}

	_, err := service.ListRepositories(ctx, req)

	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.PermissionDenied, st.Code())
	assert.Contains(t, st.Message(), "insufficient permissions to list repositories in workspace")
}
