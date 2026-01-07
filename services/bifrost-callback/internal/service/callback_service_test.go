package service

import (
	"context"
	"errors"
	"testing"

	gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

// MockTemporalClient is a mock implementation of TemporalClient for testing.
type MockTemporalClient struct {
	mock.Mock
}

// StartWorkflow mocks the StartWorkflow method.
func (m *MockTemporalClient) StartWorkflow(ctx context.Context, workflowType string, workflowID string, input interface{}) error {
	args := m.Called(ctx, workflowType, workflowID, input)
	return args.Error(0)
}

func TestNewCallbackService(t *testing.T) {
	mockClient := &MockTemporalClient{}
	svc := NewCallbackService(mockClient)

	assert.NotNil(t, svc)
	assert.Equal(t, mockClient, svc.temporalClient)
}

func TestTopicCreated_TriggersWorkflow(t *testing.T) {
	ctx := context.Background()
	mockClient := &MockTemporalClient{}
	svc := NewCallbackService(mockClient)

	req := &gatewayv1.TopicCreatedRequest{
		VirtualClusterId:      "vc-123",
		VirtualName:           "orders",
		PhysicalName:          "vc-123_orders",
		Partitions:            3,
		ReplicationFactor:     2,
		Config:                map[string]string{"retention.ms": "604800000"},
		CreatedByCredentialId: "cred-456",
	}

	// Expect StartWorkflow to be called with TopicCreatedSyncWorkflow
	mockClient.On("StartWorkflow",
		ctx,
		"TopicCreatedSyncWorkflow",
		mock.MatchedBy(func(workflowID string) bool {
			// Verify workflow ID format: topic-created-sync-{vcId}-{uuid8}
			return len(workflowID) > 0 &&
				workflowID[:len("topic-created-sync-vc-123-")] == "topic-created-sync-vc-123-"
		}),
		mock.MatchedBy(func(input interface{}) bool {
			i, ok := input.(TopicCreatedInput)
			if !ok {
				return false
			}
			return i.VirtualClusterID == "vc-123" &&
				i.VirtualName == "orders" &&
				i.PhysicalName == "vc-123_orders" &&
				i.Partitions == 3 &&
				i.ReplicationFactor == 2 &&
				i.Config["retention.ms"] == "604800000" &&
				i.CreatedByCredentialID == "cred-456"
		}),
	).Return(nil)

	resp, err := svc.TopicCreated(ctx, req)

	require.NoError(t, err)
	assert.True(t, resp.Success)
	assert.NotEmpty(t, resp.TopicId)
	mockClient.AssertExpectations(t)
}

func TestTopicCreated_WorkflowError(t *testing.T) {
	ctx := context.Background()
	mockClient := &MockTemporalClient{}
	svc := NewCallbackService(mockClient)

	req := &gatewayv1.TopicCreatedRequest{
		VirtualClusterId: "vc-123",
		VirtualName:      "orders",
		PhysicalName:     "vc-123_orders",
	}

	mockClient.On("StartWorkflow",
		ctx,
		"TopicCreatedSyncWorkflow",
		mock.Anything,
		mock.Anything,
	).Return(errors.New("temporal unavailable"))

	resp, err := svc.TopicCreated(ctx, req)

	require.Error(t, err)
	assert.Nil(t, resp)
	assert.Contains(t, err.Error(), "failed to start TopicCreatedSyncWorkflow")
	assert.Contains(t, err.Error(), "temporal unavailable")
	mockClient.AssertExpectations(t)
}

func TestTopicCreated_NilRequest(t *testing.T) {
	ctx := context.Background()
	mockClient := &MockTemporalClient{}
	svc := NewCallbackService(mockClient)

	resp, err := svc.TopicCreated(ctx, nil)

	require.Error(t, err)
	assert.Nil(t, resp)
	assert.Contains(t, err.Error(), "request cannot be nil")
}

func TestTopicDeleted_TriggersWorkflow(t *testing.T) {
	ctx := context.Background()
	mockClient := &MockTemporalClient{}
	svc := NewCallbackService(mockClient)

	req := &gatewayv1.TopicDeletedRequest{
		VirtualClusterId:      "vc-123",
		VirtualName:           "orders",
		PhysicalName:          "vc-123_orders",
		DeletedByCredentialId: "cred-789",
	}

	// Expect StartWorkflow to be called with TopicDeletedSyncWorkflow
	mockClient.On("StartWorkflow",
		ctx,
		"TopicDeletedSyncWorkflow",
		mock.MatchedBy(func(workflowID string) bool {
			// Verify workflow ID format: topic-deleted-sync-{vcId}-{uuid8}
			return len(workflowID) > 0 &&
				workflowID[:len("topic-deleted-sync-vc-123-")] == "topic-deleted-sync-vc-123-"
		}),
		mock.MatchedBy(func(input interface{}) bool {
			i, ok := input.(TopicDeletedInput)
			if !ok {
				return false
			}
			return i.VirtualClusterID == "vc-123" &&
				i.VirtualName == "orders" &&
				i.PhysicalName == "vc-123_orders" &&
				i.DeletedByCredentialID == "cred-789"
		}),
	).Return(nil)

	resp, err := svc.TopicDeleted(ctx, req)

	require.NoError(t, err)
	assert.True(t, resp.Success)
	mockClient.AssertExpectations(t)
}

func TestTopicDeleted_WorkflowError(t *testing.T) {
	ctx := context.Background()
	mockClient := &MockTemporalClient{}
	svc := NewCallbackService(mockClient)

	req := &gatewayv1.TopicDeletedRequest{
		VirtualClusterId: "vc-123",
		VirtualName:      "orders",
		PhysicalName:     "vc-123_orders",
	}

	mockClient.On("StartWorkflow",
		ctx,
		"TopicDeletedSyncWorkflow",
		mock.Anything,
		mock.Anything,
	).Return(errors.New("temporal unavailable"))

	resp, err := svc.TopicDeleted(ctx, req)

	require.Error(t, err)
	assert.Nil(t, resp)
	assert.Contains(t, err.Error(), "failed to start TopicDeletedSyncWorkflow")
	mockClient.AssertExpectations(t)
}

func TestTopicDeleted_NilRequest(t *testing.T) {
	ctx := context.Background()
	mockClient := &MockTemporalClient{}
	svc := NewCallbackService(mockClient)

	resp, err := svc.TopicDeleted(ctx, nil)

	require.Error(t, err)
	assert.Nil(t, resp)
	assert.Contains(t, err.Error(), "request cannot be nil")
}

func TestTopicConfigUpdated_TriggersWorkflow(t *testing.T) {
	ctx := context.Background()
	mockClient := &MockTemporalClient{}
	svc := NewCallbackService(mockClient)

	req := &gatewayv1.TopicConfigUpdatedRequest{
		VirtualClusterId:      "vc-123",
		VirtualName:           "orders",
		Config:                map[string]string{"retention.ms": "86400000", "max.message.bytes": "1048576"},
		UpdatedByCredentialId: "cred-101",
	}

	// Expect StartWorkflow to be called with TopicConfigSyncWorkflow
	mockClient.On("StartWorkflow",
		ctx,
		"TopicConfigSyncWorkflow",
		mock.MatchedBy(func(workflowID string) bool {
			// Verify workflow ID format: topic-config-sync-{vcId}-{uuid8}
			return len(workflowID) > 0 &&
				workflowID[:len("topic-config-sync-vc-123-")] == "topic-config-sync-vc-123-"
		}),
		mock.MatchedBy(func(input interface{}) bool {
			i, ok := input.(TopicConfigUpdatedInput)
			if !ok {
				return false
			}
			return i.VirtualClusterID == "vc-123" &&
				i.VirtualName == "orders" &&
				i.Config["retention.ms"] == "86400000" &&
				i.Config["max.message.bytes"] == "1048576" &&
				i.UpdatedByCredentialID == "cred-101"
		}),
	).Return(nil)

	resp, err := svc.TopicConfigUpdated(ctx, req)

	require.NoError(t, err)
	assert.True(t, resp.Success)
	mockClient.AssertExpectations(t)
}

func TestTopicConfigUpdated_WorkflowError(t *testing.T) {
	ctx := context.Background()
	mockClient := &MockTemporalClient{}
	svc := NewCallbackService(mockClient)

	req := &gatewayv1.TopicConfigUpdatedRequest{
		VirtualClusterId: "vc-123",
		VirtualName:      "orders",
		Config:           map[string]string{"retention.ms": "86400000"},
	}

	mockClient.On("StartWorkflow",
		ctx,
		"TopicConfigSyncWorkflow",
		mock.Anything,
		mock.Anything,
	).Return(errors.New("temporal unavailable"))

	resp, err := svc.TopicConfigUpdated(ctx, req)

	require.Error(t, err)
	assert.Nil(t, resp)
	assert.Contains(t, err.Error(), "failed to start TopicConfigSyncWorkflow")
	mockClient.AssertExpectations(t)
}

func TestTopicConfigUpdated_NilRequest(t *testing.T) {
	ctx := context.Background()
	mockClient := &MockTemporalClient{}
	svc := NewCallbackService(mockClient)

	resp, err := svc.TopicConfigUpdated(ctx, nil)

	require.Error(t, err)
	assert.Nil(t, resp)
	assert.Contains(t, err.Error(), "request cannot be nil")
}

func TestGenerateWorkflowID(t *testing.T) {
	tests := []struct {
		name     string
		prefix   string
		vcID     string
		wantLen  int
		wantPfx  string
	}{
		{
			name:    "topic created workflow",
			prefix:  "topic-created-sync",
			vcID:    "vc-123",
			wantLen: len("topic-created-sync-vc-123-") + 8,
			wantPfx: "topic-created-sync-vc-123-",
		},
		{
			name:    "topic deleted workflow",
			prefix:  "topic-deleted-sync",
			vcID:    "vc-456",
			wantLen: len("topic-deleted-sync-vc-456-") + 8,
			wantPfx: "topic-deleted-sync-vc-456-",
		},
		{
			name:    "topic config workflow",
			prefix:  "topic-config-sync",
			vcID:    "vc-789",
			wantLen: len("topic-config-sync-vc-789-") + 8,
			wantPfx: "topic-config-sync-vc-789-",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := generateWorkflowID(tt.prefix, tt.vcID)
			assert.Equal(t, tt.wantLen, len(got), "workflow ID length mismatch")
			assert.Equal(t, tt.wantPfx, got[:len(tt.wantPfx)], "workflow ID prefix mismatch")

			// Ensure uniqueness
			got2 := generateWorkflowID(tt.prefix, tt.vcID)
			assert.NotEqual(t, got, got2, "workflow IDs should be unique")
		})
	}
}
