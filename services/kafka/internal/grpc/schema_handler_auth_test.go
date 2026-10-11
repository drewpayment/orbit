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

// fakeSchemaRepo serves one preconfigured schema.
type fakeSchemaRepo struct {
	schema *domain.KafkaSchema
	listed int
}

func (f *fakeSchemaRepo) Create(context.Context, *domain.KafkaSchema) error { return nil }
func (f *fakeSchemaRepo) GetByID(_ context.Context, id uuid.UUID) (*domain.KafkaSchema, error) {
	if f.schema != nil && f.schema.ID == id {
		return f.schema, nil
	}
	return nil, domain.ErrSchemaNotFound
}
func (f *fakeSchemaRepo) GetBySubject(context.Context, uuid.UUID, string) (*domain.KafkaSchema, error) {
	return nil, domain.ErrSchemaNotFound
}
func (f *fakeSchemaRepo) List(context.Context, uuid.UUID) ([]*domain.KafkaSchema, error) {
	f.listed++
	if f.schema == nil {
		return nil, nil
	}
	return []*domain.KafkaSchema{f.schema}, nil
}
func (f *fakeSchemaRepo) Update(context.Context, *domain.KafkaSchema) error { return nil }
func (f *fakeSchemaRepo) Delete(context.Context, uuid.UUID) error           { return nil }

// newSchemaTestServer wires a KafkaServer over one topic and one schema that
// both belong to ownerWS.
func newSchemaTestServer(ownerWS uuid.UUID) (*KafkaServer, *domain.KafkaTopic, *domain.KafkaSchema, *fakeSchemaRepo) {
	topic := &domain.KafkaTopic{ID: uuid.New(), WorkspaceID: ownerWS, Name: "t", Status: domain.TopicStatusActive}
	schema := &domain.KafkaSchema{ID: uuid.New(), WorkspaceID: ownerWS, TopicID: topic.ID, Content: "{}"}
	schemaRepo := &fakeSchemaRepo{schema: schema}
	topicService := service.NewTopicService(&fakeTopicRepo{topic: topic}, nil, nil, nil)
	schemaService := service.NewSchemaService(schemaRepo, nil, topicService, nil)
	return NewKafkaServer(nil, topicService, schemaService, nil), topic, schema, schemaRepo
}

// TestSchemaRPCs_TenantIsolation covers the RPCs that address a schema or
// topic by id and carry no workspace_id in the body: the owning workspace is
// derived server-side and checked against the caller's wid.
func TestSchemaRPCs_TenantIsolation(t *testing.T) {
	owner := uuid.New()
	srv, topic, schema, _ := newSchemaTestServer(owner)
	interceptor := svcauth.UnaryServerInterceptor([]byte(testAuthSecret), true)

	rpcs := []struct {
		name   string
		method string
		req    any
		call   func(ctx context.Context, req any) (any, error)
	}{
		{
			"GetSchema", "/idp.kafka.v1.KafkaService/GetSchema",
			&kafkav1.GetSchemaRequest{SchemaId: schema.ID.String()},
			func(ctx context.Context, req any) (any, error) {
				return srv.GetSchema(ctx, req.(*kafkav1.GetSchemaRequest))
			},
		},
		{
			"ListSchemas", "/idp.kafka.v1.KafkaService/ListSchemas",
			&kafkav1.ListSchemasRequest{TopicId: topic.ID.String()},
			func(ctx context.Context, req any) (any, error) {
				return srv.ListSchemas(ctx, req.(*kafkav1.ListSchemasRequest))
			},
		},
		{
			"RegisterSchema", "/idp.kafka.v1.KafkaService/RegisterSchema",
			&kafkav1.RegisterSchemaRequest{TopicId: topic.ID.String(), Type: "value", Content: "{}"},
			func(ctx context.Context, req any) (any, error) {
				return srv.RegisterSchema(ctx, req.(*kafkav1.RegisterSchemaRequest))
			},
		},
		{
			"CheckSchemaCompatibility", "/idp.kafka.v1.KafkaService/CheckSchemaCompatibility",
			&kafkav1.CheckSchemaCompatibilityRequest{TopicId: topic.ID.String(), Type: "value", Content: "{}"},
			func(ctx context.Context, req any) (any, error) {
				return srv.CheckSchemaCompatibility(ctx, req.(*kafkav1.CheckSchemaCompatibilityRequest))
			},
		},
	}

	callers := []struct {
		name     string
		wid      string
		admin    bool
		wantCode codes.Code
	}{
		{"other tenant", uuid.NewString(), false, codes.PermissionDenied},
		{"token without workspace", "", false, codes.PermissionDenied},
		{"owning workspace", owner.String(), false, codes.OK},
	}

	for _, rpc := range rpcs {
		for _, c := range callers {
			t.Run(rpc.name+"/"+c.name, func(t *testing.T) {
				token := mintKafkaToken(t, uuid.NewString(), c.wid)
				ctx := metadata.NewIncomingContext(context.Background(),
					metadata.Pairs("authorization", "Bearer "+token))

				_, err := invoke(interceptor, ctx, rpc.method, rpc.req, rpc.call)

				assert.Equal(t, c.wantCode, status.Code(err), "err: %v", err)
			})
		}
	}
}

func TestListSchemas_CrossTenantDoesNotReadRepo(t *testing.T) {
	owner := uuid.New()
	srv, topic, _, schemaRepo := newSchemaTestServer(owner)

	ctx := svcauth.WithIdentity(context.Background(), svcauth.Identity{UserID: uuid.NewString(), WorkspaceID: uuid.NewString()})
	_, err := srv.ListSchemas(ctx, &kafkav1.ListSchemasRequest{TopicId: topic.ID.String()})

	require.Error(t, err)
	assert.Equal(t, codes.PermissionDenied, status.Code(err))
	assert.Zero(t, schemaRepo.listed, "schemas of another tenant's topic must not be read")
}

func TestGetSchema_UnknownTopicOrSchemaIsNotFound(t *testing.T) {
	srv, _, _, _ := newSchemaTestServer(uuid.New())
	ctx := svcauth.WithIdentity(context.Background(), svcauth.Identity{UserID: uuid.NewString(), PlatformAdmin: true})

	_, err := srv.GetSchema(ctx, &kafkav1.GetSchemaRequest{SchemaId: uuid.NewString()})
	assert.Equal(t, codes.NotFound, status.Code(err))

	_, err = srv.ListSchemas(ctx, &kafkav1.ListSchemasRequest{TopicId: uuid.NewString()})
	assert.Equal(t, codes.NotFound, status.Code(err))
}
