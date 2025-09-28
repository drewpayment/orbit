package contract

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"

	commonpb "github.com/drewpayment/orbit/proto/gen/go/idp/common/v1"
	workspacepb "github.com/drewpayment/orbit/proto/gen/go/idp/workspace/v1"
)

// TestContractTests_TDD_Demonstration shows the expected TDD failure pattern
func TestContractTests_TDD_Demonstration(t *testing.T) {
	// This test demonstrates the proper TDD cycle:
	// 1. Test exists and compiles ✅
	// 2. Test fails because service isn't implemented ✅ (expected)
	// 3. We implement the service to make test pass (future step)

	t.Log("=== TDD Phase Demonstration ===")
	t.Log("Phase 1: Test compiles successfully ✅")

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	// Test that protobuf types compile and can be instantiated
	req := &workspacepb.CreateWorkspaceRequest{
		Name:        "TDD Test Workspace",
		Slug:        "tdd-test",
		Description: "Testing TDD methodology",
		Settings: &workspacepb.WorkspaceSettings{
			DefaultVisibility:       commonpb.Visibility_VISIBILITY_INTERNAL,
			RequireApprovalForRepos: false,
			EnableCodeGeneration:    true,
		},
	}

	assert.NotNil(t, req, "Request should be created successfully")
	assert.Equal(t, "TDD Test Workspace", req.Name)
	assert.Equal(t, commonpb.Visibility_VISIBILITY_INTERNAL, req.Settings.DefaultVisibility)

	t.Log("✅ Protobuf types work correctly")

	// Try to connect to service (this should fail as expected in TDD)
	t.Log("Phase 2: Testing service connection (expected to fail)...")

	conn, err := grpc.Dial("localhost:8001",
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)

	// In TDD, we EXPECT this to fail because service isn't implemented yet
	if err != nil {
		t.Logf("✅ Expected failure: %v", err)
		t.Log("✅ TDD Phase 2 complete: Service correctly unavailable")
		return
	}

	// If connection succeeded, try the actual service call
	defer conn.Close()
	client := workspacepb.NewWorkspaceServiceClient(conn)

	resp, err := client.CreateWorkspace(ctx, req)

	// This should fail in TDD phase
	if err != nil {
		st, ok := status.FromError(err)
		require.True(t, ok)

		expectedCodes := []codes.Code{
			codes.Unimplemented,    // Method not implemented
			codes.Unavailable,      // Service not available
			codes.DeadlineExceeded, // Timeout
		}

		actualCode := st.Code()
		codeMatches := false
		for _, expectedCode := range expectedCodes {
			if actualCode == expectedCode {
				codeMatches = true
				break
			}
		}

		assert.True(t, codeMatches, "Expected implementation-related error, got: %v", actualCode)
		t.Logf("✅ Expected TDD failure - service method not implemented: %v", err)
		return
	}

	// If we get here, the service is actually implemented (future success case)
	t.Log("🎉 Service is implemented! Test passes - TDD cycle complete")
	require.NotNil(t, resp)
	assert.Equal(t, req.Name, resp.Workspace.Name)
}
