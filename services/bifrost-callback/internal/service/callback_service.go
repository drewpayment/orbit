// Package service implements the Bifrost callback service for handling
// topic lifecycle events from the Bifrost gateway.
package service

import (
	"context"
	"fmt"

	gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
	"github.com/google/uuid"
)

// TemporalClient defines the interface for starting Temporal workflows.
// This abstraction allows for easy mocking in tests.
type TemporalClient interface {
	// StartWorkflow starts a new workflow execution with the given ID and input.
	// workflowType is the name of the workflow to execute.
	// workflowID is a unique identifier for this workflow execution.
	// input is the workflow input parameters.
	StartWorkflow(ctx context.Context, workflowType string, workflowID string, input interface{}) error
}

// TopicCreatedInput contains the input parameters for the TopicCreatedSyncWorkflow.
type TopicCreatedInput struct {
	VirtualClusterID      string            `json:"virtual_cluster_id"`
	VirtualName           string            `json:"virtual_name"`
	PhysicalName          string            `json:"physical_name"`
	Partitions            int32             `json:"partitions"`
	ReplicationFactor     int32             `json:"replication_factor"`
	Config                map[string]string `json:"config"`
	CreatedByCredentialID string            `json:"created_by_credential_id"`
}

// TopicDeletedInput contains the input parameters for the TopicDeletedSyncWorkflow.
type TopicDeletedInput struct {
	VirtualClusterID      string `json:"virtual_cluster_id"`
	VirtualName           string `json:"virtual_name"`
	PhysicalName          string `json:"physical_name"`
	DeletedByCredentialID string `json:"deleted_by_credential_id"`
}

// TopicConfigUpdatedInput contains the input parameters for the TopicConfigSyncWorkflow.
type TopicConfigUpdatedInput struct {
	VirtualClusterID      string            `json:"virtual_cluster_id"`
	VirtualName           string            `json:"virtual_name"`
	Config                map[string]string `json:"config"`
	UpdatedByCredentialID string            `json:"updated_by_credential_id"`
}

// CallbackService implements the BifrostCallbackService gRPC server.
// It receives callbacks from the Bifrost gateway when topics are created,
// deleted, or have their configuration updated, and triggers corresponding
// Temporal workflows to sync the changes to Orbit's data model.
type CallbackService struct {
	gatewayv1.UnimplementedBifrostCallbackServiceServer
	temporalClient TemporalClient
}

// NewCallbackService creates a new CallbackService with the given Temporal client.
func NewCallbackService(temporalClient TemporalClient) *CallbackService {
	return &CallbackService{
		temporalClient: temporalClient,
	}
}

// TopicCreated handles the callback when a topic is created via passthrough.
// It triggers a TopicCreatedSyncWorkflow to record the topic in Orbit's catalog.
func (s *CallbackService) TopicCreated(ctx context.Context, req *gatewayv1.TopicCreatedRequest) (*gatewayv1.TopicCreatedResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("request cannot be nil")
	}

	// Generate a unique workflow ID
	workflowID := generateWorkflowID("topic-created-sync", req.VirtualClusterId)

	// Build workflow input
	input := TopicCreatedInput{
		VirtualClusterID:      req.VirtualClusterId,
		VirtualName:           req.VirtualName,
		PhysicalName:          req.PhysicalName,
		Partitions:            req.Partitions,
		ReplicationFactor:     req.ReplicationFactor,
		Config:                req.Config,
		CreatedByCredentialID: req.CreatedByCredentialId,
	}

	// Start the sync workflow
	if err := s.temporalClient.StartWorkflow(ctx, "TopicCreatedSyncWorkflow", workflowID, input); err != nil {
		return nil, fmt.Errorf("failed to start TopicCreatedSyncWorkflow: %w", err)
	}

	// Generate a topic ID for the response
	// The actual topic ID will be created by the workflow, but we return a placeholder
	// to acknowledge receipt of the callback
	topicID := uuid.New().String()

	return &gatewayv1.TopicCreatedResponse{
		Success: true,
		TopicId: topicID,
	}, nil
}

// TopicDeleted handles the callback when a topic is deleted via passthrough.
// It triggers a TopicDeletedSyncWorkflow to update Orbit's catalog.
func (s *CallbackService) TopicDeleted(ctx context.Context, req *gatewayv1.TopicDeletedRequest) (*gatewayv1.TopicDeletedResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("request cannot be nil")
	}

	// Generate a unique workflow ID
	workflowID := generateWorkflowID("topic-deleted-sync", req.VirtualClusterId)

	// Build workflow input
	input := TopicDeletedInput{
		VirtualClusterID:      req.VirtualClusterId,
		VirtualName:           req.VirtualName,
		PhysicalName:          req.PhysicalName,
		DeletedByCredentialID: req.DeletedByCredentialId,
	}

	// Start the sync workflow
	if err := s.temporalClient.StartWorkflow(ctx, "TopicDeletedSyncWorkflow", workflowID, input); err != nil {
		return nil, fmt.Errorf("failed to start TopicDeletedSyncWorkflow: %w", err)
	}

	return &gatewayv1.TopicDeletedResponse{
		Success: true,
	}, nil
}

// TopicConfigUpdated handles the callback when a topic's configuration is updated.
// It triggers a TopicConfigSyncWorkflow to update Orbit's catalog.
func (s *CallbackService) TopicConfigUpdated(ctx context.Context, req *gatewayv1.TopicConfigUpdatedRequest) (*gatewayv1.TopicConfigUpdatedResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("request cannot be nil")
	}

	// Generate a unique workflow ID
	workflowID := generateWorkflowID("topic-config-sync", req.VirtualClusterId)

	// Build workflow input
	input := TopicConfigUpdatedInput{
		VirtualClusterID:      req.VirtualClusterId,
		VirtualName:           req.VirtualName,
		Config:                req.Config,
		UpdatedByCredentialID: req.UpdatedByCredentialId,
	}

	// Start the sync workflow
	if err := s.temporalClient.StartWorkflow(ctx, "TopicConfigSyncWorkflow", workflowID, input); err != nil {
		return nil, fmt.Errorf("failed to start TopicConfigSyncWorkflow: %w", err)
	}

	return &gatewayv1.TopicConfigUpdatedResponse{
		Success: true,
	}, nil
}

// generateWorkflowID creates a unique workflow ID with the format:
// {prefix}-{vcId}-{uuid8}
// where uuid8 is the first 8 characters of a new UUID.
func generateWorkflowID(prefix string, vcID string) string {
	shortUUID := uuid.New().String()[:8]
	return fmt.Sprintf("%s-%s-%s", prefix, vcID, shortUUID)
}
