package grpc

import (
	"context"
	"errors"
	"testing"
	"time"

	kafkav1 "github.com/drewpayment/orbit/proto/gen/go/idp/kafka/v1"
	"github.com/drewpayment/orbit/proto/pkg/svcauth"
	"github.com/drewpayment/orbit/services/kafka/internal/adapters"
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

// mintKafkaAdminToken is the platform-admin counterpart of mintKafkaToken (in
// share_handler_auth_test.go): it sets adm=true so the token satisfies
// EnforcePlatformAdmin. Kept as a separate helper so the existing non-admin
// minter and its call sites stay untouched.
func mintKafkaAdminToken(t *testing.T, sub, wid string) string {
	t.Helper()
	now := time.Now()
	claims := jwt.MapClaims{
		"iss": "orbit-www",
		"aud": "orbit-services",
		"sub": sub,
		"wid": wid,
		"adm": true,
		"iat": now.Unix(),
		"exp": now.Add(120 * time.Second).Unix(),
		"jti": uuid.NewString(),
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testAuthSecret))
	require.NoError(t, err)
	return signed
}

// The fakes below are minimal in-memory stand-ins for the ClusterService's
// dependencies. They return "not found" / empty / adapter-unavailable results so
// that once a request passes the platform-admin gate the handler runs to
// completion and returns a nil top-level gRPC error (domain failures are folded
// into the response's Error field). That lets the admin-case assertion be a
// clean require.NoError, proving the gate was passed without depending on a real
// broker or database.

type fakeClusterRepo struct{}

func (fakeClusterRepo) Create(context.Context, *domain.KafkaCluster) error { return nil }
func (fakeClusterRepo) GetByID(context.Context, uuid.UUID) (*domain.KafkaCluster, error) {
	return nil, nil
}
func (fakeClusterRepo) List(context.Context) ([]*domain.KafkaCluster, error) { return nil, nil }
func (fakeClusterRepo) Update(context.Context, *domain.KafkaCluster) error   { return nil }
func (fakeClusterRepo) Delete(context.Context, uuid.UUID) error              { return nil }

type fakeProviderRepo struct{}

func (fakeProviderRepo) GetByID(context.Context, string) (*domain.KafkaProvider, error) {
	return nil, nil
}
func (fakeProviderRepo) List(context.Context) ([]*domain.KafkaProvider, error) { return nil, nil }

type fakeEnvMappingRepo struct{}

func (fakeEnvMappingRepo) Create(context.Context, *domain.KafkaEnvironmentMapping) error { return nil }
func (fakeEnvMappingRepo) GetByID(context.Context, uuid.UUID) (*domain.KafkaEnvironmentMapping, error) {
	return nil, nil
}
func (fakeEnvMappingRepo) List(context.Context, string) ([]*domain.KafkaEnvironmentMapping, error) {
	return nil, nil
}
func (fakeEnvMappingRepo) Delete(context.Context, uuid.UUID) error { return nil }
func (fakeEnvMappingRepo) GetDefaultForEnvironment(context.Context, string) (*domain.KafkaEnvironmentMapping, error) {
	return nil, nil
}

// fakeAdapterFactory fails to create an adapter, so the connection/topic RPCs
// return a folded domain error rather than dialing a real broker.
type fakeAdapterFactory struct{}

func (fakeAdapterFactory) CreateKafkaAdapter(*domain.KafkaCluster, map[string]string) (adapters.KafkaAdapter, error) {
	return nil, errors.New("no broker available in test")
}
func (fakeAdapterFactory) CreateSchemaRegistryAdapter(*domain.SchemaRegistry, map[string]string) (adapters.SchemaRegistryAdapter, error) {
	return nil, errors.New("no schema registry available in test")
}

// newAuthedClusterServer wires the real auth interceptor in front of a
// KafkaServer whose ClusterService is backed by the fakes above.
func newAuthedClusterServer() (grpc.UnaryServerInterceptor, *KafkaServer) {
	clusterService := service.NewClusterService(
		fakeClusterRepo{}, fakeProviderRepo{}, fakeEnvMappingRepo{}, fakeAdapterFactory{},
	)
	srv := NewKafkaServer(clusterService, nil, nil, nil)
	interceptor := svcauth.UnaryServerInterceptor([]byte(testAuthSecret), true)
	return interceptor, srv
}

// TestClusterHandler_PlatformAdminGate is the UAC-1 table: every ClusterHandler
// RPC must reject a missing token (Unauthenticated) and a valid non-admin token
// (PermissionDenied), and let an adm=true token through to handler logic.
func TestClusterHandler_PlatformAdminGate(t *testing.T) {
	interceptor, srv := newAuthedClusterServer()

	// A single valid UUID reused for the ID-bearing requests; the gate runs
	// before any ID parsing, and in the admin case these resolve to a folded
	// "not found" response (nil top-level error).
	validID := uuid.NewString()

	cases := []struct {
		name    string
		method  string
		req     any
		handler grpc.UnaryHandler
	}{
		{
			"ListProviders", "/idp.kafka.v1.KafkaService/ListProviders",
			&kafkav1.ListProvidersRequest{},
			func(ctx context.Context, req any) (any, error) {
				return srv.ListProviders(ctx, req.(*kafkav1.ListProvidersRequest))
			},
		},
		{
			"RegisterCluster", "/idp.kafka.v1.KafkaService/RegisterCluster",
			&kafkav1.RegisterClusterRequest{Name: "c", ProviderId: "p"},
			func(ctx context.Context, req any) (any, error) {
				return srv.RegisterCluster(ctx, req.(*kafkav1.RegisterClusterRequest))
			},
		},
		{
			"ValidateCluster", "/idp.kafka.v1.KafkaService/ValidateCluster",
			&kafkav1.ValidateClusterRequest{ClusterId: validID},
			func(ctx context.Context, req any) (any, error) {
				return srv.ValidateCluster(ctx, req.(*kafkav1.ValidateClusterRequest))
			},
		},
		{
			"ValidateClusterConnection", "/idp.kafka.v1.KafkaService/ValidateClusterConnection",
			&kafkav1.ValidateClusterConnectionRequest{ConnectionConfig: map[string]string{"brokers": "x"}},
			func(ctx context.Context, req any) (any, error) {
				return srv.ValidateClusterConnection(ctx, req.(*kafkav1.ValidateClusterConnectionRequest))
			},
		},
		{
			"DeleteTopicByName", "/idp.kafka.v1.KafkaService/DeleteTopicByName",
			&kafkav1.DeleteTopicByNameRequest{TopicName: "t", ConnectionConfig: map[string]string{"brokers": "x"}},
			func(ctx context.Context, req any) (any, error) {
				return srv.DeleteTopicByName(ctx, req.(*kafkav1.DeleteTopicByNameRequest))
			},
		},
		{
			"CreateTopicDirect", "/idp.kafka.v1.KafkaService/CreateTopicDirect",
			&kafkav1.CreateTopicDirectRequest{TopicName: "t", ConnectionConfig: map[string]string{"brokers": "x"}},
			func(ctx context.Context, req any) (any, error) {
				return srv.CreateTopicDirect(ctx, req.(*kafkav1.CreateTopicDirectRequest))
			},
		},
		{
			"ListClusters", "/idp.kafka.v1.KafkaService/ListClusters",
			&kafkav1.ListClustersRequest{},
			func(ctx context.Context, req any) (any, error) {
				return srv.ListClusters(ctx, req.(*kafkav1.ListClustersRequest))
			},
		},
		{
			"DeleteCluster", "/idp.kafka.v1.KafkaService/DeleteCluster",
			&kafkav1.DeleteClusterRequest{ClusterId: validID},
			func(ctx context.Context, req any) (any, error) {
				return srv.DeleteCluster(ctx, req.(*kafkav1.DeleteClusterRequest))
			},
		},
		{
			"CreateEnvironmentMapping", "/idp.kafka.v1.KafkaService/CreateEnvironmentMapping",
			&kafkav1.CreateEnvironmentMappingRequest{ClusterId: validID, Environment: "prod"},
			func(ctx context.Context, req any) (any, error) {
				return srv.CreateEnvironmentMapping(ctx, req.(*kafkav1.CreateEnvironmentMappingRequest))
			},
		},
		{
			"ListEnvironmentMappings", "/idp.kafka.v1.KafkaService/ListEnvironmentMappings",
			&kafkav1.ListEnvironmentMappingsRequest{},
			func(ctx context.Context, req any) (any, error) {
				return srv.ListEnvironmentMappings(ctx, req.(*kafkav1.ListEnvironmentMappingsRequest))
			},
		},
		{
			"DeleteEnvironmentMapping", "/idp.kafka.v1.KafkaService/DeleteEnvironmentMapping",
			&kafkav1.DeleteEnvironmentMappingRequest{MappingId: validID},
			func(ctx context.Context, req any) (any, error) {
				return srv.DeleteEnvironmentMapping(ctx, req.(*kafkav1.DeleteEnvironmentMappingRequest))
			},
		},
	}

	require.Len(t, cases, 11, "every ClusterHandler RPC must be covered")

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Run("no token is Unauthenticated", func(t *testing.T) {
				_, err := invoke(interceptor, context.Background(), tc.method, tc.req, tc.handler)
				require.Error(t, err)
				assert.Equal(t, codes.Unauthenticated, status.Code(err))
			})

			t.Run("non-admin token is PermissionDenied", func(t *testing.T) {
				token := mintKafkaToken(t, uuid.NewString(), "")
				ctx := metadata.NewIncomingContext(context.Background(),
					metadata.Pairs("authorization", "Bearer "+token))
				_, err := invoke(interceptor, ctx, tc.method, tc.req, tc.handler)
				require.Error(t, err)
				assert.Equal(t, codes.PermissionDenied, status.Code(err))
			})

			t.Run("admin token reaches handler", func(t *testing.T) {
				token := mintKafkaAdminToken(t, uuid.NewString(), "")
				ctx := metadata.NewIncomingContext(context.Background(),
					metadata.Pairs("authorization", "Bearer "+token))
				_, err := invoke(interceptor, ctx, tc.method, tc.req, tc.handler)
				require.NoError(t, err, "adm=true token must pass the gate and reach handler logic")
			})
		})
	}
}
