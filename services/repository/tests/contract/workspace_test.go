package contract

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	workspacepb "github.com/drewpayment/orbit/proto/gen/go/idp/workspace/v1"
)

// TestWorkspaceService_CreateWorkspace tests the CreateWorkspace gRPC endpoint contract
func TestWorkspaceService_CreateWorkspace(t *testing.T) {
	// This test MUST fail initially (TDD requirement)
	// It will pass once the WorkspaceService is implemented

	tests := []struct {
		name    string
		request *workspacepb.CreateWorkspaceRequest
		wantErr bool
		errCode codes.Code
	}{
		{
			name: "valid workspace creation",
			request: &workspacepb.CreateWorkspaceRequest{
				Name:        "Test Workspace",
				Slug:        "test-workspace",
				Description: "A test workspace for development",
				Settings: &workspacepb.WorkspaceSettings{
					DefaultVisibility:       workspacepb.Visibility_VISIBILITY_INTERNAL,
					RequireApprovalForRepos: false,
					EnableCodeGeneration:    true,
					AllowedTemplateTypes:    []string{"service", "library"},
				},
			},
			wantErr: false,
		},
		{
			name: "empty name should fail",
			request: &workspacepb.CreateWorkspaceRequest{
				Name:        "",
				Slug:        "test-workspace",
				Description: "A test workspace",
			},
			wantErr: true,
			errCode: codes.InvalidArgument,
		},
		{
			name: "empty slug should fail",
			request: &workspacepb.CreateWorkspaceRequest{
				Name:        "Test Workspace",
				Slug:        "",
				Description: "A test workspace",
			},
			wantErr: true,
			errCode: codes.InvalidArgument,
		},
		{
			name: "invalid slug format should fail",
			request: &workspacepb.CreateWorkspaceRequest{
				Name:        "Test Workspace",
				Slug:        "Test Workspace!", // Invalid: spaces and special chars
				Description: "A test workspace",
			},
			wantErr: true,
			errCode: codes.InvalidArgument,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// This will fail until we implement the workspace service
			client := getWorkspaceServiceClient(t)

			resp, err := client.CreateWorkspace(context.Background(), tt.request)

			if tt.wantErr {
				require.Error(t, err)
				assert.Equal(t, tt.errCode, status.Code(err))
				assert.Nil(t, resp)
			} else {
				require.NoError(t, err)
				require.NotNil(t, resp)
				require.NotNil(t, resp.Workspace)

				// Verify workspace fields
				workspace := resp.Workspace
				assert.Equal(t, tt.request.Name, workspace.Name)
				assert.Equal(t, tt.request.Slug, workspace.Slug)
				assert.Equal(t, tt.request.Description, workspace.Description)
				assert.NotEmpty(t, workspace.Metadata.Id)
				assert.NotNil(t, workspace.Metadata.CreatedAt)
				assert.NotNil(t, workspace.Settings)
			}
		})
	}
}

// getWorkspaceServiceClient returns a gRPC client for WorkspaceService
// This will fail until the service is implemented
func getWorkspaceServiceClient(t *testing.T) workspacepb.WorkspaceServiceClient {
	// TODO: Replace with actual gRPC connection once service is implemented
	// For now, this will cause test failure as required by TDD
	conn, err := grpc.Dial("localhost:8001", grpc.WithInsecure())
	require.NoError(t, err, "Failed to connect to workspace service - service not implemented yet")

	return workspacepb.NewWorkspaceServiceClient(conn)
}

// TestWorkspaceService_CreateWorkspace_DatabaseIntegration tests database persistence
func TestWorkspaceService_CreateWorkspace_DatabaseIntegration(t *testing.T) {
	// This test ensures workspace is properly persisted to database
	// Will fail until database layer is implemented

	client := getWorkspaceServiceClient(t)

	request := &workspacepb.CreateWorkspaceRequest{
		Name:        "Persistence Test Workspace",
		Slug:        "persistence-test",
		Description: "Testing database persistence",
		Settings: &workspacepb.WorkspaceSettings{
			DefaultVisibility:    workspacepb.Visibility_VISIBILITY_PRIVATE,
			EnableCodeGeneration: true,
		},
	}

	// Create workspace
	createResp, err := client.CreateWorkspace(context.Background(), request)
	require.NoError(t, err)
	require.NotNil(t, createResp.Workspace)

	workspaceId := createResp.Workspace.Metadata.Id

	// Verify workspace can be retrieved
	getResp, err := client.GetWorkspace(context.Background(), &workspacepb.GetWorkspaceRequest{
		Id: workspaceId,
	})
	require.NoError(t, err)
	require.NotNil(t, getResp.Workspace)

	// Verify fields match
	assert.Equal(t, request.Name, getResp.Workspace.Name)
	assert.Equal(t, request.Slug, getResp.Workspace.Slug)
	assert.Equal(t, request.Description, getResp.Workspace.Description)
}
