package contract

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	commonpb "github.com/drewpayment/orbit/proto/gen/go/idp/common/v1"
	workspacepb "github.com/drewpayment/orbit/proto/gen/go/idp/workspace/v1"
)

// TestWorkspaceService_ListWorkspaces tests the ListWorkspaces gRPC endpoint contract
func TestWorkspaceService_ListWorkspaces(t *testing.T) {
	// This test MUST fail initially (TDD requirement)
	// It will pass once the WorkspaceService is implemented

	tests := []struct {
		name    string
		request *workspacepb.ListWorkspacesRequest
		setup   func() []*workspacepb.Workspace // Setup workspaces for test
		wantErr bool
		errCode codes.Code
	}{
		{
			name: "list workspaces with default pagination",
			request: &workspacepb.ListWorkspacesRequest{
				Pagination: &commonpb.PaginationRequest{
					Page: 1,
					Size: 20,
				},
			},
			setup: func() []*workspacepb.Workspace {
				// Create test workspaces
				return createTestWorkspaces(t, 5)
			},
			wantErr: false,
		},
		{
			name: "list workspaces with custom page size",
			request: &workspacepb.ListWorkspacesRequest{
				Pagination: &commonpb.PaginationRequest{
					Page: 1,
					Size: 2,
				},
			},
			setup: func() []*workspacepb.Workspace {
				return createTestWorkspaces(t, 5)
			},
			wantErr: false,
		},
		{
			name: "list workspaces with filters",
			request: &workspacepb.ListWorkspacesRequest{
				Pagination: &commonpb.PaginationRequest{
					Page: 1,
					Size: 20,
				},
				Filters: []*commonpb.Filter{
					{
						Field:    "name",
						Operator: commonpb.FilterOperator_FILTER_OPERATOR_CONTAINS,
						Values:   []string{"test"},
					},
				},
			},
			setup: func() []*workspacepb.Workspace {
				return createTestWorkspaces(t, 3)
			},
			wantErr: false,
		},
		{
			name: "invalid page size should fail",
			request: &workspacepb.ListWorkspacesRequest{
				Pagination: &commonpb.PaginationRequest{
					Page: 1,
					Size: -1, // Invalid page size
				},
			},
			wantErr: true,
			errCode: codes.InvalidArgument,
		},
		{
			name: "invalid page number should fail",
			request: &workspacepb.ListWorkspacesRequest{
				Pagination: &commonpb.PaginationRequest{
					Page: 0, // Invalid page number (should be 1-based)
					Size: 20,
				},
			},
			wantErr: true,
			errCode: codes.InvalidArgument,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Setup test data if needed
			var expectedWorkspaces []*workspacepb.Workspace
			if tt.setup != nil {
				expectedWorkspaces = tt.setup()
			}

			// This will fail until we implement the workspace service
			client := getWorkspaceServiceClient(t)

			resp, err := client.ListWorkspaces(context.Background(), tt.request)

			if tt.wantErr {
				require.Error(t, err)
				assert.Equal(t, tt.errCode, status.Code(err))
				assert.Nil(t, resp)
			} else {
				require.NoError(t, err)
				require.NotNil(t, resp)
				require.NotNil(t, resp.Pagination)

				// Verify pagination metadata
				pagination := resp.Pagination
				assert.Equal(t, tt.request.Pagination.Page, pagination.Page)
				assert.Equal(t, tt.request.Pagination.Size, pagination.Size)
				assert.True(t, pagination.Total >= 0)

				// Verify workspaces returned
				assert.LessOrEqual(t, len(resp.Workspaces), int(tt.request.Pagination.Size))

				// Verify workspace structure
				for _, workspace := range resp.Workspaces {
					assert.NotEmpty(t, workspace.Metadata.Id)
					assert.NotEmpty(t, workspace.Name)
					assert.NotEmpty(t, workspace.Slug)
					assert.NotNil(t, workspace.Metadata.CreatedAt)
					assert.NotNil(t, workspace.Settings)
				}

				// If we have expected workspaces, verify some are returned
				if len(expectedWorkspaces) > 0 {
					assert.Greater(t, len(resp.Workspaces), 0, "Should return at least some workspaces")
				}
			}
		})
	}
}

// TestWorkspaceService_ListWorkspaces_Sorting tests sorting functionality
func TestWorkspaceService_ListWorkspaces_Sorting(t *testing.T) {
	// Will fail until service is implemented
	client := getWorkspaceServiceClient(t)

	// Create test workspaces with different names and dates
	_ = createTestWorkspaces(t, 3)

	tests := []struct {
		name     string
		sortBy   string
		order    commonpb.SortOrder
		validate func([]*workspacepb.Workspace)
	}{
		{
			name:   "sort by name ascending",
			sortBy: "name",
			order:  commonpb.SortOrder_SORT_ORDER_ASC,
			validate: func(workspaces []*workspacepb.Workspace) {
				for i := 1; i < len(workspaces); i++ {
					assert.LessOrEqual(t, workspaces[i-1].Name, workspaces[i].Name)
				}
			},
		},
		{
			name:   "sort by created_at descending",
			sortBy: "created_at",
			order:  commonpb.SortOrder_SORT_ORDER_DESC,
			validate: func(workspaces []*workspacepb.Workspace) {
				for i := 1; i < len(workspaces); i++ {
					assert.True(t, workspaces[i-1].Metadata.CreatedAt.AsTime().After(workspaces[i].Metadata.CreatedAt.AsTime()) ||
						workspaces[i-1].Metadata.CreatedAt.AsTime().Equal(workspaces[i].Metadata.CreatedAt.AsTime()))
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			request := &workspacepb.ListWorkspacesRequest{
				Pagination: &commonpb.PaginationRequest{
					Page: 1,
					Size: 10,
				},
				Sort: []*commonpb.Sort{
					{
						Field: tt.sortBy,
						Order: tt.order,
					},
				},
			}

			resp, err := client.ListWorkspaces(context.Background(), request)
			require.NoError(t, err)
			require.NotNil(t, resp)

			if len(resp.Workspaces) > 1 {
				tt.validate(resp.Workspaces)
			}
		})
	}
}

// createTestWorkspaces creates test workspaces for testing
// Will fail until service is implemented
func createTestWorkspaces(t *testing.T, count int) []*workspacepb.Workspace {
	client := getWorkspaceServiceClient(t)
	var workspaces []*workspacepb.Workspace

	for i := 0; i < count; i++ {
		request := &workspacepb.CreateWorkspaceRequest{
			Name:        fmt.Sprintf("Test Workspace %d", i+1),
			Slug:        fmt.Sprintf("test-workspace-%d", i+1),
			Description: fmt.Sprintf("Test workspace %d for testing", i+1),
			Settings: &workspacepb.WorkspaceSettings{
				DefaultVisibility:    workspacepb.Visibility_VISIBILITY_INTERNAL,
				EnableCodeGeneration: true,
			},
		}

		resp, err := client.CreateWorkspace(context.Background(), request)
		require.NoError(t, err)
		require.NotNil(t, resp.Workspace)

		workspaces = append(workspaces, resp.Workspace)
	}

	return workspaces
}
