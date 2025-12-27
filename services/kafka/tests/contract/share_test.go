package contract

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	kafkapb "github.com/drewpayment/orbit/proto/gen/go/idp/kafka/v1"
)

// TestRequestTopicAccess_Success tests successful access request
func TestRequestTopicAccess_Success(t *testing.T) {
	ctx := context.Background()
	client := getTestClient(t)

	// Create a topic in workspace A
	workspaceA := uuid.New().String()
	topicReq := &kafkapb.CreateTopicRequest{
		WorkspaceId: workspaceA,
		Name:        "share-test-topic-" + uuid.New().String()[:8],
		Environment: "development",
		Partitions:  1,
	}
	topicResp, err := client.CreateTopic(ctx, topicReq)
	require.NoError(t, err)

	// Request access from workspace B
	workspaceB := uuid.New().String()
	req := &kafkapb.RequestTopicAccessRequest{
		TopicId:               topicResp.Topic.Id,
		RequestingWorkspaceId: workspaceB,
		Permission:            kafkapb.SharePermission_SHARE_PERMISSION_READ,
		Justification:         "Need to consume events for analytics",
	}

	resp, err := client.RequestTopicAccess(ctx, req)
	require.NoError(t, err)
	require.NotNil(t, resp)
	require.NotNil(t, resp.Share)

	assert.NotEmpty(t, resp.Share.Id)
	assert.Equal(t, topicResp.Topic.Id, resp.Share.TopicId)
	assert.Equal(t, kafkapb.SharePermission_SHARE_PERMISSION_READ, resp.Share.Permission)
	assert.Equal(t, kafkapb.ShareStatus_SHARE_STATUS_PENDING_REQUEST, resp.Share.Status)
	assert.Equal(t, req.Justification, resp.Share.Justification)
}

// TestRequestTopicAccess_ValidationErrors tests access request validation
func TestRequestTopicAccess_ValidationErrors(t *testing.T) {
	ctx := context.Background()
	client := getTestClient(t)

	testCases := []struct {
		name     string
		req      *kafkapb.RequestTopicAccessRequest
		wantCode codes.Code
	}{
		{
			name: "missing topic ID",
			req: &kafkapb.RequestTopicAccessRequest{
				RequestingWorkspaceId: uuid.New().String(),
				Permission:            kafkapb.SharePermission_SHARE_PERMISSION_READ,
				Justification:         "Need access",
			},
			wantCode: codes.InvalidArgument,
		},
		{
			name: "missing requesting workspace ID",
			req: &kafkapb.RequestTopicAccessRequest{
				TopicId:       uuid.New().String(),
				Permission:    kafkapb.SharePermission_SHARE_PERMISSION_READ,
				Justification: "Need access",
			},
			wantCode: codes.InvalidArgument,
		},
		{
			name: "missing justification",
			req: &kafkapb.RequestTopicAccessRequest{
				TopicId:               uuid.New().String(),
				RequestingWorkspaceId: uuid.New().String(),
				Permission:            kafkapb.SharePermission_SHARE_PERMISSION_READ,
			},
			wantCode: codes.InvalidArgument,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			resp, err := client.RequestTopicAccess(ctx, tc.req)
			require.Error(t, err)
			assert.Nil(t, resp)

			st, ok := status.FromError(err)
			require.True(t, ok)
			assert.Equal(t, tc.wantCode, st.Code())
		})
	}
}

// TestApproveTopicAccess_Success tests successful access approval
func TestApproveTopicAccess_Success(t *testing.T) {
	ctx := context.Background()
	client := getTestClient(t)

	// Create topic and request access
	workspaceA := uuid.New().String()
	topicReq := &kafkapb.CreateTopicRequest{
		WorkspaceId: workspaceA,
		Name:        "approve-test-topic-" + uuid.New().String()[:8],
		Environment: "development",
		Partitions:  1,
	}
	topicResp, err := client.CreateTopic(ctx, topicReq)
	require.NoError(t, err)

	workspaceB := uuid.New().String()
	requestReq := &kafkapb.RequestTopicAccessRequest{
		TopicId:               topicResp.Topic.Id,
		RequestingWorkspaceId: workspaceB,
		Permission:            kafkapb.SharePermission_SHARE_PERMISSION_READ,
		Justification:         "Need to consume events",
	}
	requestResp, err := client.RequestTopicAccess(ctx, requestReq)
	require.NoError(t, err)

	// Approve the access request
	approveReq := &kafkapb.ApproveTopicAccessRequest{
		ShareId:    requestResp.Share.Id,
		ApprovedBy: "admin-user-id",
	}

	resp, err := client.ApproveTopicAccess(ctx, approveReq)
	require.NoError(t, err)
	require.NotNil(t, resp)
	require.NotNil(t, resp.Share)

	assert.Equal(t, requestResp.Share.Id, resp.Share.Id)
	assert.Equal(t, kafkapb.ShareStatus_SHARE_STATUS_APPROVED, resp.Share.Status)
	assert.Equal(t, "admin-user-id", resp.Share.ApprovedBy)
	assert.NotNil(t, resp.Share.ApprovedAt)
}

// TestRevokeTopicAccess_Success tests successful access revocation
func TestRevokeTopicAccess_Success(t *testing.T) {
	ctx := context.Background()
	client := getTestClient(t)

	// Create topic, request, and approve access
	workspaceA := uuid.New().String()
	topicReq := &kafkapb.CreateTopicRequest{
		WorkspaceId: workspaceA,
		Name:        "revoke-test-topic-" + uuid.New().String()[:8],
		Environment: "development",
		Partitions:  1,
	}
	topicResp, err := client.CreateTopic(ctx, topicReq)
	require.NoError(t, err)

	workspaceB := uuid.New().String()
	requestReq := &kafkapb.RequestTopicAccessRequest{
		TopicId:               topicResp.Topic.Id,
		RequestingWorkspaceId: workspaceB,
		Permission:            kafkapb.SharePermission_SHARE_PERMISSION_READ,
		Justification:         "Need to consume events",
	}
	requestResp, err := client.RequestTopicAccess(ctx, requestReq)
	require.NoError(t, err)

	approveReq := &kafkapb.ApproveTopicAccessRequest{
		ShareId:    requestResp.Share.Id,
		ApprovedBy: "admin-user-id",
	}
	_, err = client.ApproveTopicAccess(ctx, approveReq)
	require.NoError(t, err)

	// Revoke the access
	revokeReq := &kafkapb.RevokeTopicAccessRequest{
		ShareId: requestResp.Share.Id,
	}

	resp, err := client.RevokeTopicAccess(ctx, revokeReq)
	require.NoError(t, err)
	require.NotNil(t, resp)
	assert.True(t, resp.Success)

	// Verify the share is revoked
	listReq := &kafkapb.ListTopicSharesRequest{
		TopicId: topicResp.Topic.Id,
		Status:  kafkapb.ShareStatus_SHARE_STATUS_REVOKED,
	}
	listResp, err := client.ListTopicShares(ctx, listReq)
	require.NoError(t, err)

	found := false
	for _, share := range listResp.Shares {
		if share.Id == requestResp.Share.Id {
			found = true
			assert.Equal(t, kafkapb.ShareStatus_SHARE_STATUS_REVOKED, share.Status)
		}
	}
	assert.True(t, found, "Revoked share should be in list")
}

// TestListTopicShares_FilterByStatus tests listing shares with status filter
func TestListTopicShares_FilterByStatus(t *testing.T) {
	ctx := context.Background()
	client := getTestClient(t)

	// Create topic
	workspaceA := uuid.New().String()
	topicReq := &kafkapb.CreateTopicRequest{
		WorkspaceId: workspaceA,
		Name:        "list-shares-topic-" + uuid.New().String()[:8],
		Environment: "development",
		Partitions:  1,
	}
	topicResp, err := client.CreateTopic(ctx, topicReq)
	require.NoError(t, err)

	// Create multiple access requests
	for i := 0; i < 3; i++ {
		workspaceB := uuid.New().String()
		requestReq := &kafkapb.RequestTopicAccessRequest{
			TopicId:               topicResp.Topic.Id,
			RequestingWorkspaceId: workspaceB,
			Permission:            kafkapb.SharePermission_SHARE_PERMISSION_READ,
			Justification:         "Need access",
		}
		_, err = client.RequestTopicAccess(ctx, requestReq)
		require.NoError(t, err)
	}

	// List pending shares
	listReq := &kafkapb.ListTopicSharesRequest{
		TopicId: topicResp.Topic.Id,
		Status:  kafkapb.ShareStatus_SHARE_STATUS_PENDING_REQUEST,
	}

	resp, err := client.ListTopicShares(ctx, listReq)
	require.NoError(t, err)
	require.NotNil(t, resp)
	assert.GreaterOrEqual(t, len(resp.Shares), 3)

	for _, share := range resp.Shares {
		assert.Equal(t, kafkapb.ShareStatus_SHARE_STATUS_PENDING_REQUEST, share.Status)
	}
}

// TestDiscoverTopics_Success tests topic discovery
func TestDiscoverTopics_Success(t *testing.T) {
	ctx := context.Background()
	client := getTestClient(t)

	// Create topics in different workspaces
	// (In a real scenario, some topics would be marked as discoverable)
	workspaceA := uuid.New().String()
	for i := 0; i < 2; i++ {
		topicReq := &kafkapb.CreateTopicRequest{
			WorkspaceId: workspaceA,
			Name:        "discover-test-topic-" + uuid.New().String()[:8],
			Environment: "development",
			Partitions:  1,
		}
		_, err := client.CreateTopic(ctx, topicReq)
		require.NoError(t, err)
	}

	// Discover topics from another workspace
	workspaceB := uuid.New().String()
	discoverReq := &kafkapb.DiscoverTopicsRequest{
		RequestingWorkspaceId: workspaceB,
		Environment:           "development",
		Limit:                 10,
	}

	resp, err := client.DiscoverTopics(ctx, discoverReq)
	require.NoError(t, err)
	require.NotNil(t, resp)
	// Result depends on topic visibility settings
}
