package grpc

import (
	"context"
	"testing"
	"time"

	kafkav1 "github.com/drewpayment/orbit/proto/gen/go/idp/kafka/v1"
	"github.com/drewpayment/orbit/proto/pkg/svcauth"
	"github.com/drewpayment/orbit/services/kafka/internal/domain"
	"github.com/drewpayment/orbit/services/kafka/internal/service"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// fakeServiceAccountRepo is an in-memory ServiceAccountRepository so the
// regression test can assert the persisted CreatedBy without a database.
type fakeServiceAccountRepo struct {
	created []*domain.KafkaServiceAccount
}

func (f *fakeServiceAccountRepo) Create(_ context.Context, a *domain.KafkaServiceAccount) error {
	f.created = append(f.created, a)
	return nil
}
func (f *fakeServiceAccountRepo) GetByID(context.Context, uuid.UUID) (*domain.KafkaServiceAccount, error) {
	return nil, nil
}
func (f *fakeServiceAccountRepo) List(context.Context, uuid.UUID) ([]*domain.KafkaServiceAccount, error) {
	return nil, nil
}
func (f *fakeServiceAccountRepo) Update(context.Context, *domain.KafkaServiceAccount) error {
	return nil
}

const testAuthSecret = "kafka-test-secret-at-least-32-bytes-long!!"

func mintKafkaToken(t *testing.T, sub, wid string) string {
	t.Helper()
	now := time.Now()
	claims := jwt.MapClaims{
		"iss": "orbit-www",
		"aud": "orbit-services",
		"sub": sub,
		"wid": wid,
		"iat": now.Unix(),
		"exp": now.Add(120 * time.Second).Unix(),
		"jti": uuid.NewString(),
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testAuthSecret))
	require.NoError(t, err)
	return signed
}

// newAuthedKafkaServer wires the real auth interceptor in front of a KafkaServer
// backed by an in-memory service-account repo, returning the repo so tests can
// inspect what was persisted. topicService is nil because the exercised RPCs do
// not touch it.
func newAuthedKafkaServer(t *testing.T) (grpc.UnaryServerInterceptor, *KafkaServer, *fakeServiceAccountRepo) {
	t.Helper()
	repo := &fakeServiceAccountRepo{}
	shareService := service.NewShareService(nil, nil, repo, nil)
	// Only the share handler is exercised; the other services can be nil.
	srv := NewKafkaServer(nil, nil, nil, shareService)
	interceptor := svcauth.UnaryServerInterceptor([]byte(testAuthSecret), true)
	return interceptor, srv, repo
}

// invoke runs the request through the interceptor exactly as the gRPC runtime
// would, so identity injection and rejection are exercised together.
func invoke(interceptor grpc.UnaryServerInterceptor, ctx context.Context, method string, req any, handler grpc.UnaryHandler) (any, error) {
	info := &grpc.UnaryServerInfo{FullMethod: method}
	return interceptor(ctx, req, info, handler)
}

func TestCreateServiceAccount_ForgedMetadataRejected(t *testing.T) {
	// GO-H1 regression: a forged user-id metadata header with NO bearer token
	// must be rejected by the interceptor; the handler must never run.
	interceptor, srv, repo := newAuthedKafkaServer(t)

	forged := metadata.Pairs("user-id", uuid.NewString())
	ctx := metadata.NewIncomingContext(context.Background(), forged)

	_, err := invoke(interceptor, ctx,
		"/idp.kafka.v1.KafkaService/CreateServiceAccount",
		&kafkav1.CreateServiceAccountRequest{WorkspaceId: uuid.NewString(), Name: "svc"},
		func(ctx context.Context, req any) (any, error) {
			return srv.CreateServiceAccount(ctx, req.(*kafkav1.CreateServiceAccountRequest))
		},
	)

	require.Error(t, err)
	assert.Equal(t, codes.Unauthenticated, status.Code(err))
	assert.Empty(t, repo.created, "no account should be persisted for an unauthenticated call")
}

func TestCreateServiceAccount_CreatedByFromToken(t *testing.T) {
	// GO-H6 regression: with a valid token, the persisted CreatedBy equals the
	// token sub — never uuid.Nil and never a body field.
	interceptor, srv, repo := newAuthedKafkaServer(t)

	userID := uuid.NewString()
	workspaceID := uuid.NewString()
	token := mintKafkaToken(t, userID, workspaceID)
	ctx := metadata.NewIncomingContext(context.Background(),
		metadata.Pairs("authorization", "Bearer "+token))

	_, err := invoke(interceptor, ctx,
		"/idp.kafka.v1.KafkaService/CreateServiceAccount",
		&kafkav1.CreateServiceAccountRequest{WorkspaceId: workspaceID, Name: "svc"},
		func(ctx context.Context, req any) (any, error) {
			return srv.CreateServiceAccount(ctx, req.(*kafkav1.CreateServiceAccountRequest))
		},
	)

	require.NoError(t, err)
	require.Len(t, repo.created, 1)
	assert.Equal(t, userID, repo.created[0].CreatedBy.String())
	assert.NotEqual(t, uuid.Nil, repo.created[0].CreatedBy)
}

func TestCreateServiceAccount_CrossTenantWorkspaceRejected(t *testing.T) {
	// GO-H2 regression: a body workspace_id different from the token wid is
	// rejected with PermissionDenied, and nothing is persisted.
	interceptor, srv, repo := newAuthedKafkaServer(t)

	token := mintKafkaToken(t, uuid.NewString(), uuid.NewString()) // wid = some workspace
	ctx := metadata.NewIncomingContext(context.Background(),
		metadata.Pairs("authorization", "Bearer "+token))

	_, err := invoke(interceptor, ctx,
		"/idp.kafka.v1.KafkaService/CreateServiceAccount",
		&kafkav1.CreateServiceAccountRequest{WorkspaceId: uuid.NewString(), Name: "svc"}, // different workspace
		func(ctx context.Context, req any) (any, error) {
			return srv.CreateServiceAccount(ctx, req.(*kafkav1.CreateServiceAccountRequest))
		},
	)

	require.Error(t, err)
	assert.Equal(t, codes.PermissionDenied, status.Code(err))
	assert.Empty(t, repo.created)
}
