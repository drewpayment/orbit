package grpc

import (
	"context"

	kafkav1 "github.com/drewpayment/orbit/proto/gen/go/idp/kafka/v1"
	"github.com/drewpayment/orbit/services/kafka/internal/domain"
	"github.com/drewpayment/orbit/services/kafka/internal/service"
	"github.com/google/uuid"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ShareHandler handles share-related gRPC calls
type ShareHandler struct {
	shareService *service.ShareService
}

// NewShareHandler creates a new ShareHandler
func NewShareHandler(shareService *service.ShareService) *ShareHandler {
	return &ShareHandler{
		shareService: shareService,
	}
}

// RequestTopicAccess requests access to a topic
func (h *ShareHandler) RequestTopicAccess(ctx context.Context, req *kafkav1.RequestTopicAccessRequest) (*kafkav1.RequestTopicAccessResponse, error) {
	topicID, err := uuid.Parse(req.TopicId)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid topic ID: %v", err)
	}

	requestingWorkspaceID, err := uuid.Parse(req.RequestingWorkspaceId)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid requesting workspace ID: %v", err)
	}

	share, err := h.shareService.RequestTopicAccess(ctx, service.RequestAccessRequest{
		TopicID:           topicID,
		TargetWorkspaceID: requestingWorkspaceID,
		Permission:        sharePermissionFromProto(req.Permission),
		Reason:            req.Justification,
	})

	if err != nil {
		return &kafkav1.RequestTopicAccessResponse{
			Error: err.Error(),
		}, nil
	}

	return &kafkav1.RequestTopicAccessResponse{
		Share: shareToProto(share),
	}, nil
}

// ApproveTopicAccess approves a share request
func (h *ShareHandler) ApproveTopicAccess(ctx context.Context, req *kafkav1.ApproveTopicAccessRequest) (*kafkav1.ApproveTopicAccessResponse, error) {
	shareID, err := uuid.Parse(req.ShareId)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid share ID: %v", err)
	}

	approverID, err := uuid.Parse(req.ApprovedBy)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid approver ID: %v", err)
	}

	share, err := h.shareService.ApproveTopicAccess(ctx, shareID, approverID)
	if err != nil {
		return &kafkav1.ApproveTopicAccessResponse{
			Error: err.Error(),
		}, nil
	}

	return &kafkav1.ApproveTopicAccessResponse{
		Share: shareToProto(share),
	}, nil
}

// RevokeTopicAccess revokes a share
func (h *ShareHandler) RevokeTopicAccess(ctx context.Context, req *kafkav1.RevokeTopicAccessRequest) (*kafkav1.RevokeTopicAccessResponse, error) {
	shareID, err := uuid.Parse(req.ShareId)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid share ID: %v", err)
	}

	_, err = h.shareService.RevokeTopicAccess(ctx, shareID)
	if err != nil {
		return &kafkav1.RevokeTopicAccessResponse{
			Success: false,
			Error:   err.Error(),
		}, nil
	}

	return &kafkav1.RevokeTopicAccessResponse{
		Success: true,
	}, nil
}

// ListTopicShares lists topic shares
func (h *ShareHandler) ListTopicShares(ctx context.Context, req *kafkav1.ListTopicSharesRequest) (*kafkav1.ListTopicSharesResponse, error) {
	filter := service.ShareFilter{}

	if req.TopicId != "" {
		topicID, err := uuid.Parse(req.TopicId)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "invalid topic ID: %v", err)
		}
		filter.TopicID = &topicID
	}

	if req.WorkspaceId != "" {
		workspaceID, err := uuid.Parse(req.WorkspaceId)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "invalid workspace ID: %v", err)
		}
		filter.WorkspaceID = &workspaceID
	}

	if req.Status != kafkav1.ShareStatus_SHARE_STATUS_UNSPECIFIED {
		status := shareStatusFromProto(req.Status)
		filter.Status = &status
	}

	shares, err := h.shareService.ListTopicShares(ctx, filter)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list shares: %v", err)
	}

	pbShares := make([]*kafkav1.KafkaTopicShare, len(shares))
	for i, s := range shares {
		pbShares[i] = shareToProto(s)
	}

	return &kafkav1.ListTopicSharesResponse{
		Shares: pbShares,
	}, nil
}

// DiscoverTopics discovers shareable topics
func (h *ShareHandler) DiscoverTopics(ctx context.Context, req *kafkav1.DiscoverTopicsRequest) (*kafkav1.DiscoverTopicsResponse, error) {
	workspaceID, err := uuid.Parse(req.RequestingWorkspaceId)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid workspace ID: %v", err)
	}

	topics, err := h.shareService.DiscoverTopics(ctx, service.DiscoverTopicsRequest{
		WorkspaceID: workspaceID,
		Environment: req.Environment,
		SearchQuery: req.Search,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to discover topics: %v", err)
	}

	pbTopics := make([]*kafkav1.DiscoverableTopic, len(topics))
	for i, t := range topics {
		pbTopics[i] = &kafkav1.DiscoverableTopic{
			Topic: topicToProto(t),
		}
	}

	return &kafkav1.DiscoverTopicsResponse{
		Topics: pbTopics,
		Total:  int32(len(topics)),
	}, nil
}

// CreateServiceAccount creates a new service account
func (h *ShareHandler) CreateServiceAccount(ctx context.Context, req *kafkav1.CreateServiceAccountRequest) (*kafkav1.CreateServiceAccountResponse, error) {
	workspaceID, err := uuid.Parse(req.WorkspaceId)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid workspace ID: %v", err)
	}

	// TODO: Get createdBy from auth context
	account, err := h.shareService.CreateServiceAccount(ctx, service.CreateServiceAccountRequest{
		WorkspaceID: workspaceID,
		Name:        req.Name,
		Type:        serviceAccountTypeFromProto(req.Type),
		CreatedBy:   uuid.Nil, // Would be set from auth context
	})

	if err != nil {
		return &kafkav1.CreateServiceAccountResponse{
			Error: err.Error(),
		}, nil
	}

	return &kafkav1.CreateServiceAccountResponse{
		ServiceAccount: serviceAccountToProto(account),
	}, nil
}

// ListServiceAccounts lists service accounts for a workspace
func (h *ShareHandler) ListServiceAccounts(ctx context.Context, req *kafkav1.ListServiceAccountsRequest) (*kafkav1.ListServiceAccountsResponse, error) {
	workspaceID, err := uuid.Parse(req.WorkspaceId)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid workspace ID: %v", err)
	}

	accounts, err := h.shareService.ListServiceAccounts(ctx, workspaceID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list service accounts: %v", err)
	}

	pbAccounts := make([]*kafkav1.KafkaServiceAccount, len(accounts))
	for i, a := range accounts {
		pbAccounts[i] = serviceAccountToProto(a)
	}

	return &kafkav1.ListServiceAccountsResponse{
		ServiceAccounts: pbAccounts,
	}, nil
}

// RevokeServiceAccount revokes a service account
func (h *ShareHandler) RevokeServiceAccount(ctx context.Context, req *kafkav1.RevokeServiceAccountRequest) (*kafkav1.RevokeServiceAccountResponse, error) {
	accountID, err := uuid.Parse(req.ServiceAccountId)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid service account ID: %v", err)
	}

	_, err = h.shareService.RevokeServiceAccount(ctx, accountID)
	if err != nil {
		return &kafkav1.RevokeServiceAccountResponse{
			Success: false,
			Error:   err.Error(),
		}, nil
	}

	return &kafkav1.RevokeServiceAccountResponse{
		Success: true,
	}, nil
}

// Helper functions for proto conversion

func shareToProto(s *domain.KafkaTopicShare) *kafkav1.KafkaTopicShare {
	pb := &kafkav1.KafkaTopicShare{
		Id:             s.ID.String(),
		TopicId:        s.TopicID.String(),
		SharedWithType: string(s.SharedWithType),
		Permission:     sharePermissionToProto(s.Permission),
		Status:         shareStatusToProto(s.Status),
		RequestedBy:    s.RequestedBy.String(),
		Justification:  s.Justification,
	}

	if s.SharedWithWorkspaceID != nil {
		pb.SharedWithWorkspaceId = s.SharedWithWorkspaceID.String()
	}
	if s.SharedWithUserID != nil {
		pb.SharedWithUserId = s.SharedWithUserID.String()
	}
	if !s.RequestedAt.IsZero() {
		pb.RequestedAt = timestamppb.New(s.RequestedAt)
	}
	if s.ApprovedBy != nil {
		pb.ApprovedBy = s.ApprovedBy.String()
	}
	if s.ApprovedAt != nil {
		pb.ApprovedAt = timestamppb.New(*s.ApprovedAt)
	}
	if s.ExpiresAt != nil {
		pb.ExpiresAt = timestamppb.New(*s.ExpiresAt)
	}

	return pb
}

func sharePermissionToProto(p domain.SharePermission) kafkav1.SharePermission {
	switch p {
	case domain.SharePermissionRead:
		return kafkav1.SharePermission_SHARE_PERMISSION_READ
	case domain.SharePermissionWrite:
		return kafkav1.SharePermission_SHARE_PERMISSION_WRITE
	case domain.SharePermissionReadWrite:
		return kafkav1.SharePermission_SHARE_PERMISSION_READ_WRITE
	default:
		return kafkav1.SharePermission_SHARE_PERMISSION_UNSPECIFIED
	}
}

func sharePermissionFromProto(p kafkav1.SharePermission) domain.SharePermission {
	switch p {
	case kafkav1.SharePermission_SHARE_PERMISSION_READ:
		return domain.SharePermissionRead
	case kafkav1.SharePermission_SHARE_PERMISSION_WRITE:
		return domain.SharePermissionWrite
	case kafkav1.SharePermission_SHARE_PERMISSION_READ_WRITE:
		return domain.SharePermissionReadWrite
	default:
		return domain.SharePermissionRead
	}
}

func shareStatusToProto(s domain.ShareStatus) kafkav1.ShareStatus {
	switch s {
	case domain.ShareStatusPendingRequest:
		return kafkav1.ShareStatus_SHARE_STATUS_PENDING_REQUEST
	case domain.ShareStatusApproved:
		return kafkav1.ShareStatus_SHARE_STATUS_APPROVED
	case domain.ShareStatusRejected:
		return kafkav1.ShareStatus_SHARE_STATUS_REJECTED
	case domain.ShareStatusRevoked:
		return kafkav1.ShareStatus_SHARE_STATUS_REVOKED
	default:
		return kafkav1.ShareStatus_SHARE_STATUS_UNSPECIFIED
	}
}

func shareStatusFromProto(s kafkav1.ShareStatus) domain.ShareStatus {
	switch s {
	case kafkav1.ShareStatus_SHARE_STATUS_PENDING_REQUEST:
		return domain.ShareStatusPendingRequest
	case kafkav1.ShareStatus_SHARE_STATUS_APPROVED:
		return domain.ShareStatusApproved
	case kafkav1.ShareStatus_SHARE_STATUS_REJECTED:
		return domain.ShareStatusRejected
	case kafkav1.ShareStatus_SHARE_STATUS_REVOKED:
		return domain.ShareStatusRevoked
	default:
		return domain.ShareStatusPendingRequest
	}
}

func serviceAccountToProto(a *domain.KafkaServiceAccount) *kafkav1.KafkaServiceAccount {
	pb := &kafkav1.KafkaServiceAccount{
		Id:          a.ID.String(),
		WorkspaceId: a.WorkspaceID.String(),
		Name:        a.Name,
		Type:        serviceAccountTypeToProto(a.Type),
		Status:      string(a.Status),
		CreatedBy:   a.CreatedBy.String(),
	}
	if !a.CreatedAt.IsZero() {
		pb.CreatedAt = timestamppb.New(a.CreatedAt)
	}
	return pb
}

func serviceAccountTypeToProto(t domain.ServiceAccountType) kafkav1.ServiceAccountType {
	switch t {
	case domain.ServiceAccountTypeProducer:
		return kafkav1.ServiceAccountType_SERVICE_ACCOUNT_TYPE_PRODUCER
	case domain.ServiceAccountTypeConsumer:
		return kafkav1.ServiceAccountType_SERVICE_ACCOUNT_TYPE_CONSUMER
	case domain.ServiceAccountTypeProducerConsumer:
		return kafkav1.ServiceAccountType_SERVICE_ACCOUNT_TYPE_PRODUCER_CONSUMER
	case domain.ServiceAccountTypeAdmin:
		return kafkav1.ServiceAccountType_SERVICE_ACCOUNT_TYPE_ADMIN
	default:
		return kafkav1.ServiceAccountType_SERVICE_ACCOUNT_TYPE_UNSPECIFIED
	}
}

func serviceAccountTypeFromProto(t kafkav1.ServiceAccountType) domain.ServiceAccountType {
	switch t {
	case kafkav1.ServiceAccountType_SERVICE_ACCOUNT_TYPE_PRODUCER:
		return domain.ServiceAccountTypeProducer
	case kafkav1.ServiceAccountType_SERVICE_ACCOUNT_TYPE_CONSUMER:
		return domain.ServiceAccountTypeConsumer
	case kafkav1.ServiceAccountType_SERVICE_ACCOUNT_TYPE_PRODUCER_CONSUMER:
		return domain.ServiceAccountTypeProducerConsumer
	case kafkav1.ServiceAccountType_SERVICE_ACCOUNT_TYPE_ADMIN:
		return domain.ServiceAccountTypeAdmin
	default:
		return domain.ServiceAccountTypeConsumer
	}
}

