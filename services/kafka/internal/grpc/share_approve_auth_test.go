package grpc

import (
	"context"
	"testing"

	kafkav1 "github.com/drewpayment/orbit/proto/gen/go/idp/kafka/v1"
	"github.com/drewpayment/orbit/proto/pkg/svcauth"
	"github.com/drewpayment/orbit/services/kafka/internal/domain"
	"github.com/drewpayment/orbit/services/kafka/internal/service"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type fakeShareRepo struct {
	share   *domain.KafkaTopicShare
	updated bool
}

func (f *fakeShareRepo) Create(context.Context, *domain.KafkaTopicShare) error { return nil }
func (f *fakeShareRepo) GetByID(_ context.Context, id uuid.UUID) (*domain.KafkaTopicShare, error) {
	if f.share != nil && f.share.ID == id {
		return f.share, nil
	}
	return nil, nil
}
func (f *fakeShareRepo) List(context.Context, service.ShareFilter) ([]*domain.KafkaTopicShare, error) {
	return nil, nil
}
func (f *fakeShareRepo) Update(context.Context, *domain.KafkaTopicShare) error {
	f.updated = true
	return nil
}
func (f *fakeShareRepo) Delete(context.Context, uuid.UUID) error { return nil }
func (f *fakeShareRepo) GetExisting(context.Context, uuid.UUID, uuid.UUID) (*domain.KafkaTopicShare, error) {
	return nil, nil
}

// Approving a share is the topic owner's decision, so the caller's wid must be
// the topic's owning workspace — not the requester's, and not absent.
func TestApproveTopicAccess_OnlyTopicOwnerWorkspace(t *testing.T) {
	ownerWS := uuid.New()
	requesterWS := uuid.New()
	topic := &domain.KafkaTopic{ID: uuid.New(), WorkspaceID: ownerWS, Status: domain.TopicStatusActive}

	tests := []struct {
		name         string
		wid          string
		wantCode     codes.Code
		wantApproved bool
	}{
		{"requesting workspace cannot self-approve", requesterWS.String(), codes.PermissionDenied, false},
		{"token without workspace", "", codes.PermissionDenied, false},
		{"owning workspace approves", ownerWS.String(), codes.OK, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			share := &domain.KafkaTopicShare{
				ID:                    uuid.New(),
				TopicID:               topic.ID,
				SharedWithWorkspaceID: &requesterWS,
				Status:                domain.ShareStatusPendingRequest,
			}
			shareRepo := &fakeShareRepo{share: share}
			topicService := service.NewTopicService(&fakeTopicRepo{topic: topic}, nil, nil, nil)
			shareService := service.NewShareService(shareRepo, nil, nil, topicService)
			srv := NewKafkaServer(nil, topicService, nil, shareService)

			ctx := svcauth.WithIdentity(context.Background(), svcauth.Identity{UserID: uuid.NewString(), WorkspaceID: tc.wid})
			_, err := srv.ApproveTopicAccess(ctx, &kafkav1.ApproveTopicAccessRequest{ShareId: share.ID.String()})

			if tc.wantCode == codes.OK {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
			}
			assert.Equal(t, tc.wantCode, status.Code(err))
			assert.Equal(t, tc.wantApproved, shareRepo.updated)
		})
	}
}

// ListTopicShares may omit workspace_id (the listing is pinned to the caller's
// own workspace); that must keep working now that EnforceWorkspace fails closed
// on an empty id, while a mismatching explicit id is still rejected.
func TestListTopicShares_OmittedWorkspacePinnedToCaller(t *testing.T) {
	callerWS := uuid.New()
	shareService := service.NewShareService(&fakeShareRepo{}, nil, nil, nil)
	srv := NewKafkaServer(nil, nil, nil, shareService)
	ctx := svcauth.WithIdentity(context.Background(), svcauth.Identity{UserID: uuid.NewString(), WorkspaceID: callerWS.String()})

	_, err := srv.ListTopicShares(ctx, &kafkav1.ListTopicSharesRequest{})
	require.NoError(t, err)

	_, err = srv.ListTopicShares(ctx, &kafkav1.ListTopicSharesRequest{WorkspaceId: uuid.NewString()})
	assert.Equal(t, codes.PermissionDenied, status.Code(err))
}
