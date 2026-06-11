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
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// fakeTopicRepo is an in-memory TopicRepository whose GetByID returns a single
// preconfigured topic, so ID-based authorization can be exercised without a DB.
type fakeTopicRepo struct {
	topic   *domain.KafkaTopic
	deleted bool
}

func (f *fakeTopicRepo) Create(context.Context, *domain.KafkaTopic) error { return nil }
func (f *fakeTopicRepo) GetByID(_ context.Context, id uuid.UUID) (*domain.KafkaTopic, error) {
	if f.topic != nil && f.topic.ID == id {
		return f.topic, nil
	}
	return nil, domain.ErrTopicNotFound
}
func (f *fakeTopicRepo) GetByName(context.Context, uuid.UUID, string, string) (*domain.KafkaTopic, error) {
	return nil, domain.ErrTopicNotFound
}
func (f *fakeTopicRepo) List(context.Context, uuid.UUID, string) ([]*domain.KafkaTopic, error) {
	return nil, nil
}
func (f *fakeTopicRepo) Update(_ context.Context, t *domain.KafkaTopic) error {
	if t.Status == domain.TopicStatusDeleting {
		f.deleted = true
	}
	return nil
}
func (f *fakeTopicRepo) Delete(context.Context, uuid.UUID) error {
	f.deleted = true
	return nil
}

// newTopicHandlerWithTopic builds a TopicHandler over a fake repo holding one
// topic in the given workspace, plus the auth interceptor. Cluster/adapter deps
// are nil because the authorization guard runs before any provisioning path.
func newTopicHandlerWithTopic(topic *domain.KafkaTopic) (*KafkaServer, *fakeTopicRepo) {
	repo := &fakeTopicRepo{topic: topic}
	topicService := service.NewTopicService(repo, nil, nil, nil)
	srv := NewKafkaServer(nil, topicService, nil, nil)
	return srv, repo
}

func TestDeleteTopic_CrossTenantRejected(t *testing.T) {
	// GO-H2 regression: a caller whose wid differs from the topic's workspace
	// is rejected, and the topic is NOT deleted — even though DeleteTopic takes
	// only a topic id and carries no workspace_id in the body.
	topicWorkspace := uuid.New()
	topic := &domain.KafkaTopic{
		ID:          uuid.New(),
		WorkspaceID: topicWorkspace,
		Name:        "victim-topic",
		Status:      domain.TopicStatusActive,
	}
	srv, repo := newTopicHandlerWithTopic(topic)
	interceptor := svcauth.UnaryServerInterceptor([]byte(testAuthSecret), true)

	// Attacker authorized for a DIFFERENT workspace.
	token := mintKafkaToken(t, uuid.NewString(), uuid.NewString())
	ctx := metadata.NewIncomingContext(context.Background(),
		metadata.Pairs("authorization", "Bearer "+token))

	_, err := invoke(interceptor, ctx,
		"/idp.kafka.v1.KafkaService/DeleteTopic",
		&kafkav1.DeleteTopicRequest{TopicId: topic.ID.String()},
		func(ctx context.Context, req any) (any, error) {
			return srv.DeleteTopic(ctx, req.(*kafkav1.DeleteTopicRequest))
		},
	)

	require.Error(t, err)
	assert.Equal(t, codes.PermissionDenied, status.Code(err))
	assert.False(t, repo.deleted, "topic in another tenant's workspace must not be deleted")
}

func TestDeleteTopic_SameWorkspaceAllowed(t *testing.T) {
	// Positive control: a caller authorized for the topic's workspace passes the
	// guard and the delete proceeds.
	topicWorkspace := uuid.New()
	topic := &domain.KafkaTopic{
		ID:          uuid.New(),
		WorkspaceID: topicWorkspace,
		Name:        "own-topic",
		Status:      domain.TopicStatusActive,
	}
	srv, repo := newTopicHandlerWithTopic(topic)
	interceptor := svcauth.UnaryServerInterceptor([]byte(testAuthSecret), true)

	token := mintKafkaToken(t, uuid.NewString(), topicWorkspace.String())
	ctx := metadata.NewIncomingContext(context.Background(),
		metadata.Pairs("authorization", "Bearer "+token))

	resp, err := invoke(interceptor, ctx,
		"/idp.kafka.v1.KafkaService/DeleteTopic",
		&kafkav1.DeleteTopicRequest{TopicId: topic.ID.String()},
		func(ctx context.Context, req any) (any, error) {
			return srv.DeleteTopic(ctx, req.(*kafkav1.DeleteTopicRequest))
		},
	)

	require.NoError(t, err)
	deleteResp, ok := resp.(*kafkav1.DeleteTopicResponse)
	require.True(t, ok)
	assert.True(t, deleteResp.Success)
	assert.True(t, repo.deleted)
}
