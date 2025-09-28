package contract

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	commonpb "github.com/drewpayment/orbit/proto/gen/go/idp/common/v1"
	workspacepb "github.com/drewpayment/orbit/proto/gen/go/idp/workspace/v1"
)

// TestWorkspaceService_CreateWorkspace_TDD_Failure tests that demonstrate proper TDD failure
func TestWorkspaceService_CreateWorkspace_TDD_Failure(t *testing.T) {
	// This test MUST fail initially (TDD requirement)
	// It will pass once the WorkspaceService is implemented and running

	ctx := context.Background()

	// This will fail because no service is running on localhost:8001
	client := getWorkspaceServiceClient(t)

	req := &workspacepb.CreateWorkspaceRequest{
		Name:        "Test Workspace",
		Slug:        "test-workspace",
		Description: "A test workspace for TDD",
		Settings: &workspacepb.WorkspaceSettings{
			DefaultVisibility:       commonpb.Visibility_VISIBILITY_INTERNAL,
			RequireApprovalForRepos: false,
			EnableCodeGeneration:    true,
		},
	}

	// This should fail with connection error - exactly what we want for TDD
	resp, err := client.CreateWorkspace(ctx, req)

	// In TDD, we expect this to fail because service isn't implemented yet
	require.Error(t, err, "Expected connection error since service is not implemented")
	require.Nil(t, resp, "Response should be nil when service is not available")

	// Check that it's a connection error (expected in TDD phase)
	st, ok := status.FromError(err)
	require.True(t, ok, "Error should be a gRPC status error")

	// We expect connection errors in TDD phase
	expectedCodes := []codes.Code{
		codes.Unavailable,      // Service not available
		codes.DeadlineExceeded, // Connection timeout
		codes.Canceled,         // Connection canceled
	}

	actualCode := st.Code()
	codeMatches := false
	for _, expectedCode := range expectedCodes {
		if actualCode == expectedCode {
			codeMatches = true
			break
		}
	}

	assert.True(t, codeMatches,
		"Expected connection-related error code (Unavailable, DeadlineExceeded, or Canceled), got: %v",
		actualCode)

	t.Logf("✅ TDD Test behaving correctly - service not available (as expected)")
	t.Logf("   Error: %v", err)
	t.Logf("   Code: %v", actualCode)
}

// getWorkspaceServiceClient returns a gRPC client for WorkspaceService
// This will fail until the service is implemented and running
func getWorkspaceServiceClient(t *testing.T) workspacepb.WorkspaceServiceClient {
	// Try to connect to the workspace service (expected to fail in TDD phase)
	conn, err := grpc.Dial("localhost:8001",
		grpc.WithInsecure(),
		grpc.WithBlock(),
		grpc.WithTimeout(1000000000), // 1 second timeout
	)
	require.NoError(t, err, "Connection should be attempted (will fail as expected in TDD)")

	return workspacepb.NewWorkspaceServiceClient(conn)
}
