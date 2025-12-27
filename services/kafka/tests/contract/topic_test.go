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

// TestCreateTopic_Success tests successful topic creation
func TestCreateTopic_Success(t *testing.T) {
	ctx := context.Background()
	client := getTestClient(t)

	workspaceID := uuid.New().String()
	req := &kafkapb.CreateTopicRequest{
		WorkspaceId:       workspaceID,
		Name:              "test-topic-" + uuid.New().String()[:8],
		Environment:       "development",
		Partitions:        3,
		ReplicationFactor: 1,
		RetentionMs:       604800000, // 7 days
		CleanupPolicy:     "delete",
		Compression:       "none",
		Description:       "Test topic for integration tests",
	}

	resp, err := client.CreateTopic(ctx, req)
	require.NoError(t, err)
	require.NotNil(t, resp)
	require.NotNil(t, resp.Topic)

	// Validate topic properties
	assert.Equal(t, req.Name, resp.Topic.Name)
	assert.Equal(t, req.Environment, resp.Topic.Environment)
	assert.Equal(t, req.Partitions, resp.Topic.Partitions)
	assert.Equal(t, req.ReplicationFactor, resp.Topic.ReplicationFactor)
	assert.Equal(t, req.RetentionMs, resp.Topic.RetentionMs)
	assert.Equal(t, req.CleanupPolicy, resp.Topic.CleanupPolicy)
	assert.Equal(t, req.Description, resp.Topic.Description)

	// Validate generated fields
	assert.NotEmpty(t, resp.Topic.Id)
	assert.Equal(t, workspaceID, resp.Topic.WorkspaceId)
	assert.NotNil(t, resp.Topic.CreatedAt)

	// Status should be pending_approval or provisioning
	assert.Contains(t, []kafkapb.TopicStatus{
		kafkapb.TopicStatus_TOPIC_STATUS_PENDING_APPROVAL,
		kafkapb.TopicStatus_TOPIC_STATUS_PROVISIONING,
	}, resp.Topic.Status)
}

// TestCreateTopic_ValidationErrors tests input validation
func TestCreateTopic_ValidationErrors(t *testing.T) {
	ctx := context.Background()
	client := getTestClient(t)

	testCases := []struct {
		name     string
		req      *kafkapb.CreateTopicRequest
		wantCode codes.Code
	}{
		{
			name: "missing workspace ID",
			req: &kafkapb.CreateTopicRequest{
				Name:        "test-topic",
				Environment: "development",
			},
			wantCode: codes.InvalidArgument,
		},
		{
			name: "missing topic name",
			req: &kafkapb.CreateTopicRequest{
				WorkspaceId: uuid.New().String(),
				Environment: "development",
			},
			wantCode: codes.InvalidArgument,
		},
		{
			name: "missing environment",
			req: &kafkapb.CreateTopicRequest{
				WorkspaceId: uuid.New().String(),
				Name:        "test-topic",
			},
			wantCode: codes.InvalidArgument,
		},
		{
			name: "invalid topic name - uppercase",
			req: &kafkapb.CreateTopicRequest{
				WorkspaceId: uuid.New().String(),
				Name:        "Test-Topic",
				Environment: "development",
			},
			wantCode: codes.InvalidArgument,
		},
		{
			name: "invalid topic name - special chars",
			req: &kafkapb.CreateTopicRequest{
				WorkspaceId: uuid.New().String(),
				Name:        "test@topic!",
				Environment: "development",
			},
			wantCode: codes.InvalidArgument,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			resp, err := client.CreateTopic(ctx, tc.req)
			require.Error(t, err)
			assert.Nil(t, resp)

			st, ok := status.FromError(err)
			require.True(t, ok)
			assert.Equal(t, tc.wantCode, st.Code())
		})
	}
}

// TestListTopics_Success tests listing topics for a workspace
func TestListTopics_Success(t *testing.T) {
	ctx := context.Background()
	client := getTestClient(t)

	workspaceID := uuid.New().String()

	// Create a few topics first
	for i := 0; i < 3; i++ {
		req := &kafkapb.CreateTopicRequest{
			WorkspaceId: workspaceID,
			Name:        "list-test-topic-" + uuid.New().String()[:8],
			Environment: "development",
			Partitions:  1,
		}
		_, err := client.CreateTopic(ctx, req)
		require.NoError(t, err)
	}

	// List topics
	listReq := &kafkapb.ListTopicsRequest{
		WorkspaceId: workspaceID,
	}

	resp, err := client.ListTopics(ctx, listReq)
	require.NoError(t, err)
	require.NotNil(t, resp)
	assert.GreaterOrEqual(t, len(resp.Topics), 3)
}

// TestListTopics_FilterByEnvironment tests environment filtering
func TestListTopics_FilterByEnvironment(t *testing.T) {
	ctx := context.Background()
	client := getTestClient(t)

	workspaceID := uuid.New().String()

	// Create topics in different environments
	envs := []string{"development", "staging", "production"}
	for _, env := range envs {
		req := &kafkapb.CreateTopicRequest{
			WorkspaceId: workspaceID,
			Name:        "env-test-" + env + "-" + uuid.New().String()[:8],
			Environment: env,
			Partitions:  1,
		}
		_, err := client.CreateTopic(ctx, req)
		require.NoError(t, err)
	}

	// List only development topics
	listReq := &kafkapb.ListTopicsRequest{
		WorkspaceId: workspaceID,
		Environment: "development",
	}

	resp, err := client.ListTopics(ctx, listReq)
	require.NoError(t, err)
	require.NotNil(t, resp)

	for _, topic := range resp.Topics {
		assert.Equal(t, "development", topic.Environment)
	}
}

// TestGetTopic_Success tests getting a specific topic
func TestGetTopic_Success(t *testing.T) {
	ctx := context.Background()
	client := getTestClient(t)

	// Create a topic first
	createReq := &kafkapb.CreateTopicRequest{
		WorkspaceId: uuid.New().String(),
		Name:        "get-test-topic-" + uuid.New().String()[:8],
		Environment: "development",
		Partitions:  3,
		Description: "Topic for get test",
	}

	createResp, err := client.CreateTopic(ctx, createReq)
	require.NoError(t, err)

	// Get the topic
	getReq := &kafkapb.GetTopicRequest{
		TopicId: createResp.Topic.Id,
	}

	resp, err := client.GetTopic(ctx, getReq)
	require.NoError(t, err)
	require.NotNil(t, resp)
	require.NotNil(t, resp.Topic)

	assert.Equal(t, createResp.Topic.Id, resp.Topic.Id)
	assert.Equal(t, createReq.Name, resp.Topic.Name)
	assert.Equal(t, createReq.Description, resp.Topic.Description)
}

// TestGetTopic_NotFound tests getting a non-existent topic
func TestGetTopic_NotFound(t *testing.T) {
	ctx := context.Background()
	client := getTestClient(t)

	req := &kafkapb.GetTopicRequest{
		TopicId: uuid.New().String(),
	}

	resp, err := client.GetTopic(ctx, req)
	require.Error(t, err)
	assert.Nil(t, resp)

	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, st.Code())
}

// TestDeleteTopic_Success tests successful topic deletion
func TestDeleteTopic_Success(t *testing.T) {
	ctx := context.Background()
	client := getTestClient(t)

	// Create a topic first
	createReq := &kafkapb.CreateTopicRequest{
		WorkspaceId: uuid.New().String(),
		Name:        "delete-test-topic-" + uuid.New().String()[:8],
		Environment: "development",
		Partitions:  1,
	}

	createResp, err := client.CreateTopic(ctx, createReq)
	require.NoError(t, err)

	// Delete the topic
	deleteReq := &kafkapb.DeleteTopicRequest{
		TopicId: createResp.Topic.Id,
	}

	resp, err := client.DeleteTopic(ctx, deleteReq)
	require.NoError(t, err)
	require.NotNil(t, resp)
	assert.True(t, resp.Success)

	// Verify topic is deleted or marked for deletion
	getReq := &kafkapb.GetTopicRequest{
		TopicId: createResp.Topic.Id,
	}

	getResp, err := client.GetTopic(ctx, getReq)
	if err == nil {
		// If still found, should be in deleting status
		assert.Equal(t, kafkapb.TopicStatus_TOPIC_STATUS_DELETING, getResp.Topic.Status)
	} else {
		// Or should be not found
		st, ok := status.FromError(err)
		require.True(t, ok)
		assert.Equal(t, codes.NotFound, st.Code())
	}
}

// TestUpdateTopic_Success tests successful topic update
func TestUpdateTopic_Success(t *testing.T) {
	ctx := context.Background()
	client := getTestClient(t)

	// Create a topic first
	createReq := &kafkapb.CreateTopicRequest{
		WorkspaceId: uuid.New().String(),
		Name:        "update-test-topic-" + uuid.New().String()[:8],
		Environment: "development",
		Partitions:  3,
		Description: "Original description",
	}

	createResp, err := client.CreateTopic(ctx, createReq)
	require.NoError(t, err)

	// Update the topic
	newDescription := "Updated description"
	newRetention := int64(86400000) // 1 day
	updateReq := &kafkapb.UpdateTopicRequest{
		TopicId:     createResp.Topic.Id,
		Description: &newDescription,
		RetentionMs: &newRetention,
	}

	resp, err := client.UpdateTopic(ctx, updateReq)
	require.NoError(t, err)
	require.NotNil(t, resp)
	require.NotNil(t, resp.Topic)

	assert.Equal(t, newDescription, resp.Topic.Description)
	assert.Equal(t, newRetention, resp.Topic.RetentionMs)
}
