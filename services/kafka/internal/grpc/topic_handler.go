package grpc

import (
	"context"

	kafkav1 "github.com/drewpayment/orbit/proto/gen/go/idp/kafka/v1"
	"github.com/drewpayment/orbit/proto/pkg/svcauth"
	"github.com/drewpayment/orbit/services/kafka/internal/domain"
	"github.com/drewpayment/orbit/services/kafka/internal/service"
	"github.com/google/uuid"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// TopicHandler handles topic-related gRPC calls
type TopicHandler struct {
	topicService *service.TopicService
}

// NewTopicHandler creates a new TopicHandler
func NewTopicHandler(topicService *service.TopicService) *TopicHandler {
	return &TopicHandler{
		topicService: topicService,
	}
}

// authorizeTopicAccess loads the topic by id and enforces that it belongs to
// the caller's authorized workspace (GO-H2). ID-based RPCs (get/update/delete/
// approve/metrics/lineage) carry no workspace_id in the body, so the tenant
// boundary cannot be checked from the request alone — it must be derived from
// the persisted entity. Returns the loaded topic so callers avoid a second read.
func (h *TopicHandler) authorizeTopicAccess(ctx context.Context, topicID uuid.UUID) (*domain.KafkaTopic, error) {
	topic, err := h.topicService.GetTopic(ctx, topicID)
	if err != nil {
		if err == domain.ErrTopicNotFound {
			return nil, status.Errorf(codes.NotFound, "topic not found")
		}
		return nil, status.Errorf(codes.Internal, "failed to load topic: %v", err)
	}
	if err := svcauth.EnforceWorkspace(ctx, topic.WorkspaceID.String()); err != nil {
		return nil, err
	}
	return topic, nil
}

// CreateTopic creates a new topic
func (h *TopicHandler) CreateTopic(ctx context.Context, req *kafkav1.CreateTopicRequest) (*kafkav1.CreateTopicResponse, error) {
	workspaceID, err := uuid.Parse(req.WorkspaceId)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid workspace ID: %v", err)
	}

	// GO-H2: a caller may only create topics in its own workspace.
	if err := svcauth.EnforceWorkspace(ctx, req.WorkspaceId); err != nil {
		return nil, err
	}

	topic, err := h.topicService.CreateTopic(ctx, service.CreateTopicRequest{
		WorkspaceID:       workspaceID,
		Name:              req.Name,
		Description:       req.Description,
		Environment:       req.Environment,
		Partitions:        int(req.Partitions),
		ReplicationFactor: int(req.ReplicationFactor),
		RetentionMs:       req.RetentionMs,
		CleanupPolicy:     req.CleanupPolicy,
		Compression:       req.Compression,
		Config:            req.Config,
	})

	if err != nil {
		return &kafkav1.CreateTopicResponse{
			Error: err.Error(),
		}, nil
	}

	return &kafkav1.CreateTopicResponse{
		Topic: topicToProto(topic),
	}, nil
}

// GetTopic retrieves a topic by ID
func (h *TopicHandler) GetTopic(ctx context.Context, req *kafkav1.GetTopicRequest) (*kafkav1.GetTopicResponse, error) {
	topicID, err := uuid.Parse(req.TopicId)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid topic ID: %v", err)
	}

	// GO-H2: enforce the topic's workspace against the caller's wid.
	topic, err := h.authorizeTopicAccess(ctx, topicID)
	if err != nil {
		return nil, err
	}

	return &kafkav1.GetTopicResponse{
		Topic: topicToProto(topic),
	}, nil
}

// ListTopics returns topics for a workspace
func (h *TopicHandler) ListTopics(ctx context.Context, req *kafkav1.ListTopicsRequest) (*kafkav1.ListTopicsResponse, error) {
	workspaceID, err := uuid.Parse(req.WorkspaceId)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid workspace ID: %v", err)
	}

	// GO-H2: a caller may only list topics in its own workspace.
	if err := svcauth.EnforceWorkspace(ctx, req.WorkspaceId); err != nil {
		return nil, err
	}

	topics, err := h.topicService.ListTopics(ctx, workspaceID, req.Environment)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list topics: %v", err)
	}

	pbTopics := make([]*kafkav1.KafkaTopic, len(topics))
	for i, t := range topics {
		pbTopics[i] = topicToProto(t)
	}

	return &kafkav1.ListTopicsResponse{
		Topics: pbTopics,
	}, nil
}

// UpdateTopic updates a topic
func (h *TopicHandler) UpdateTopic(ctx context.Context, req *kafkav1.UpdateTopicRequest) (*kafkav1.UpdateTopicResponse, error) {
	topicID, err := uuid.Parse(req.TopicId)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid topic ID: %v", err)
	}

	// GO-H2: enforce the topic's workspace against the caller's wid.
	if _, err := h.authorizeTopicAccess(ctx, topicID); err != nil {
		return nil, err
	}

	updateReq := service.UpdateTopicRequest{
		Config: req.Config,
	}
	if req.Description != nil {
		updateReq.Description = req.Description
	}
	if req.RetentionMs != nil {
		updateReq.RetentionMs = req.RetentionMs
	}

	topic, err := h.topicService.UpdateTopic(ctx, topicID, updateReq)
	if err != nil {
		return &kafkav1.UpdateTopicResponse{
			Error: err.Error(),
		}, nil
	}

	return &kafkav1.UpdateTopicResponse{
		Topic: topicToProto(topic),
	}, nil
}

// DeleteTopic deletes a topic
func (h *TopicHandler) DeleteTopic(ctx context.Context, req *kafkav1.DeleteTopicRequest) (*kafkav1.DeleteTopicResponse, error) {
	topicID, err := uuid.Parse(req.TopicId)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid topic ID: %v", err)
	}

	// GO-H2: enforce the topic's workspace against the caller's wid.
	if _, err := h.authorizeTopicAccess(ctx, topicID); err != nil {
		return nil, err
	}

	if err := h.topicService.DeleteTopic(ctx, topicID); err != nil {
		return &kafkav1.DeleteTopicResponse{
			Success: false,
			Error:   err.Error(),
		}, nil
	}

	return &kafkav1.DeleteTopicResponse{
		Success: true,
	}, nil
}

// ApproveTopic approves a pending topic
func (h *TopicHandler) ApproveTopic(ctx context.Context, req *kafkav1.ApproveTopicRequest) (*kafkav1.ApproveTopicResponse, error) {
	topicID, err := uuid.Parse(req.TopicId)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid topic ID: %v", err)
	}

	// GO-H2: enforce the topic's workspace against the caller's wid.
	if _, err := h.authorizeTopicAccess(ctx, topicID); err != nil {
		return nil, err
	}

	// GO-H1: the approver is the verified caller. req.ApprovedBy is ignored — a
	// caller must not attribute an approval to an arbitrary user.
	approverID, err := callerUserID(ctx)
	if err != nil {
		return nil, err
	}

	topic, err := h.topicService.ApproveTopic(ctx, topicID, approverID)
	if err != nil {
		return &kafkav1.ApproveTopicResponse{
			Error: err.Error(),
		}, nil
	}

	return &kafkav1.ApproveTopicResponse{
		Topic: topicToProto(topic),
	}, nil
}

// GetTopicMetrics returns metrics for a topic
func (h *TopicHandler) GetTopicMetrics(ctx context.Context, req *kafkav1.GetTopicMetricsRequest) (*kafkav1.GetTopicMetricsResponse, error) {
	topicID, err := uuid.Parse(req.TopicId)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid topic ID: %v", err)
	}
	// GO-H2: enforce the topic's workspace before returning its metrics, so the
	// guard is in place when this stub is filled in.
	if _, err := h.authorizeTopicAccess(ctx, topicID); err != nil {
		return nil, err
	}

	// This would be implemented with actual metrics collection
	return &kafkav1.GetTopicMetricsResponse{
		Metrics: []*kafkav1.KafkaUsageMetrics{},
	}, nil
}

// GetTopicLineage returns lineage information for a topic
func (h *TopicHandler) GetTopicLineage(ctx context.Context, req *kafkav1.GetTopicLineageRequest) (*kafkav1.GetTopicLineageResponse, error) {
	topicID, err := uuid.Parse(req.TopicId)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid topic ID: %v", err)
	}
	// GO-H2: enforce the topic's workspace before returning its lineage, so the
	// guard is in place when this stub is filled in.
	if _, err := h.authorizeTopicAccess(ctx, topicID); err != nil {
		return nil, err
	}

	// This would be implemented with actual lineage tracking
	return &kafkav1.GetTopicLineageResponse{
		Producers: []*kafkav1.LineageNode{},
		Consumers: []*kafkav1.LineageNode{},
	}, nil
}

// Helper functions for proto conversion

func topicToProto(t *domain.KafkaTopic) *kafkav1.KafkaTopic {
	pb := &kafkav1.KafkaTopic{
		Id:                t.ID.String(),
		WorkspaceId:       t.WorkspaceID.String(),
		Name:              t.Name,
		Description:       t.Description,
		Environment:       t.Environment,
		Partitions:        int32(t.Partitions),
		ReplicationFactor: int32(t.ReplicationFactor),
		RetentionMs:       t.RetentionMs,
		CleanupPolicy:     string(t.CleanupPolicy),
		Compression:       string(t.Compression),
		Config:            t.Config,
		Status:            topicStatusToProto(t.Status),
		ApprovalRequired:  t.ApprovalRequired,
		WorkflowId:        t.WorkflowID,
	}

	if t.ClusterID != uuid.Nil {
		pb.ClusterId = t.ClusterID.String()
	}
	if t.ApprovedBy != nil {
		pb.ApprovedBy = t.ApprovedBy.String()
	}
	if t.ApprovedAt != nil {
		pb.ApprovedAt = timestamppb.New(*t.ApprovedAt)
	}
	if !t.CreatedAt.IsZero() {
		pb.CreatedAt = timestamppb.New(t.CreatedAt)
	}
	if !t.UpdatedAt.IsZero() {
		pb.UpdatedAt = timestamppb.New(t.UpdatedAt)
	}

	return pb
}

func topicStatusToProto(s domain.TopicStatus) kafkav1.TopicStatus {
	switch s {
	case domain.TopicStatusPendingApproval:
		return kafkav1.TopicStatus_TOPIC_STATUS_PENDING_APPROVAL
	case domain.TopicStatusProvisioning:
		return kafkav1.TopicStatus_TOPIC_STATUS_PROVISIONING
	case domain.TopicStatusActive:
		return kafkav1.TopicStatus_TOPIC_STATUS_ACTIVE
	case domain.TopicStatusFailed:
		return kafkav1.TopicStatus_TOPIC_STATUS_FAILED
	case domain.TopicStatusDeleting:
		return kafkav1.TopicStatus_TOPIC_STATUS_DELETING
	default:
		return kafkav1.TopicStatus_TOPIC_STATUS_UNSPECIFIED
	}
}
