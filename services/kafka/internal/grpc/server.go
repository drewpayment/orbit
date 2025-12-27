package grpc

import (
	"context"

	kafkav1 "github.com/drewpayment/orbit/proto/gen/go/idp/kafka/v1"
	"github.com/drewpayment/orbit/services/kafka/internal/service"
)

// KafkaServer implements the KafkaService gRPC server
type KafkaServer struct {
	kafkav1.UnimplementedKafkaServiceServer
	clusterHandler *ClusterHandler
	topicHandler   *TopicHandler
	schemaHandler  *SchemaHandler
	shareHandler   *ShareHandler
}

// NewKafkaServer creates a new KafkaServer
func NewKafkaServer(
	clusterService *service.ClusterService,
	topicService *service.TopicService,
	schemaService *service.SchemaService,
	shareService *service.ShareService,
) *KafkaServer {
	return &KafkaServer{
		clusterHandler: NewClusterHandler(clusterService),
		topicHandler:   NewTopicHandler(topicService),
		schemaHandler:  NewSchemaHandler(schemaService),
		shareHandler:   NewShareHandler(shareService),
	}
}

// Cluster Management
func (s *KafkaServer) ListProviders(ctx context.Context, req *kafkav1.ListProvidersRequest) (*kafkav1.ListProvidersResponse, error) {
	return s.clusterHandler.ListProviders(ctx, req)
}

func (s *KafkaServer) RegisterCluster(ctx context.Context, req *kafkav1.RegisterClusterRequest) (*kafkav1.RegisterClusterResponse, error) {
	return s.clusterHandler.RegisterCluster(ctx, req)
}

func (s *KafkaServer) ValidateCluster(ctx context.Context, req *kafkav1.ValidateClusterRequest) (*kafkav1.ValidateClusterResponse, error) {
	return s.clusterHandler.ValidateCluster(ctx, req)
}

func (s *KafkaServer) ListClusters(ctx context.Context, req *kafkav1.ListClustersRequest) (*kafkav1.ListClustersResponse, error) {
	return s.clusterHandler.ListClusters(ctx, req)
}

func (s *KafkaServer) DeleteCluster(ctx context.Context, req *kafkav1.DeleteClusterRequest) (*kafkav1.DeleteClusterResponse, error) {
	return s.clusterHandler.DeleteCluster(ctx, req)
}

// Environment Mapping
func (s *KafkaServer) CreateEnvironmentMapping(ctx context.Context, req *kafkav1.CreateEnvironmentMappingRequest) (*kafkav1.CreateEnvironmentMappingResponse, error) {
	return s.clusterHandler.CreateEnvironmentMapping(ctx, req)
}

func (s *KafkaServer) ListEnvironmentMappings(ctx context.Context, req *kafkav1.ListEnvironmentMappingsRequest) (*kafkav1.ListEnvironmentMappingsResponse, error) {
	return s.clusterHandler.ListEnvironmentMappings(ctx, req)
}

func (s *KafkaServer) DeleteEnvironmentMapping(ctx context.Context, req *kafkav1.DeleteEnvironmentMappingRequest) (*kafkav1.DeleteEnvironmentMappingResponse, error) {
	return s.clusterHandler.DeleteEnvironmentMapping(ctx, req)
}

// Topic Management
func (s *KafkaServer) CreateTopic(ctx context.Context, req *kafkav1.CreateTopicRequest) (*kafkav1.CreateTopicResponse, error) {
	return s.topicHandler.CreateTopic(ctx, req)
}

func (s *KafkaServer) GetTopic(ctx context.Context, req *kafkav1.GetTopicRequest) (*kafkav1.GetTopicResponse, error) {
	return s.topicHandler.GetTopic(ctx, req)
}

func (s *KafkaServer) ListTopics(ctx context.Context, req *kafkav1.ListTopicsRequest) (*kafkav1.ListTopicsResponse, error) {
	return s.topicHandler.ListTopics(ctx, req)
}

func (s *KafkaServer) UpdateTopic(ctx context.Context, req *kafkav1.UpdateTopicRequest) (*kafkav1.UpdateTopicResponse, error) {
	return s.topicHandler.UpdateTopic(ctx, req)
}

func (s *KafkaServer) DeleteTopic(ctx context.Context, req *kafkav1.DeleteTopicRequest) (*kafkav1.DeleteTopicResponse, error) {
	return s.topicHandler.DeleteTopic(ctx, req)
}

func (s *KafkaServer) ApproveTopic(ctx context.Context, req *kafkav1.ApproveTopicRequest) (*kafkav1.ApproveTopicResponse, error) {
	return s.topicHandler.ApproveTopic(ctx, req)
}

// Schema Management
func (s *KafkaServer) RegisterSchema(ctx context.Context, req *kafkav1.RegisterSchemaRequest) (*kafkav1.RegisterSchemaResponse, error) {
	return s.schemaHandler.RegisterSchema(ctx, req)
}

func (s *KafkaServer) GetSchema(ctx context.Context, req *kafkav1.GetSchemaRequest) (*kafkav1.GetSchemaResponse, error) {
	return s.schemaHandler.GetSchema(ctx, req)
}

func (s *KafkaServer) ListSchemas(ctx context.Context, req *kafkav1.ListSchemasRequest) (*kafkav1.ListSchemasResponse, error) {
	return s.schemaHandler.ListSchemas(ctx, req)
}

func (s *KafkaServer) CheckSchemaCompatibility(ctx context.Context, req *kafkav1.CheckSchemaCompatibilityRequest) (*kafkav1.CheckSchemaCompatibilityResponse, error) {
	return s.schemaHandler.CheckSchemaCompatibility(ctx, req)
}

// Service Account Management
func (s *KafkaServer) CreateServiceAccount(ctx context.Context, req *kafkav1.CreateServiceAccountRequest) (*kafkav1.CreateServiceAccountResponse, error) {
	return s.shareHandler.CreateServiceAccount(ctx, req)
}

func (s *KafkaServer) ListServiceAccounts(ctx context.Context, req *kafkav1.ListServiceAccountsRequest) (*kafkav1.ListServiceAccountsResponse, error) {
	return s.shareHandler.ListServiceAccounts(ctx, req)
}

func (s *KafkaServer) RevokeServiceAccount(ctx context.Context, req *kafkav1.RevokeServiceAccountRequest) (*kafkav1.RevokeServiceAccountResponse, error) {
	return s.shareHandler.RevokeServiceAccount(ctx, req)
}

// Topic Sharing
func (s *KafkaServer) RequestTopicAccess(ctx context.Context, req *kafkav1.RequestTopicAccessRequest) (*kafkav1.RequestTopicAccessResponse, error) {
	return s.shareHandler.RequestTopicAccess(ctx, req)
}

func (s *KafkaServer) ApproveTopicAccess(ctx context.Context, req *kafkav1.ApproveTopicAccessRequest) (*kafkav1.ApproveTopicAccessResponse, error) {
	return s.shareHandler.ApproveTopicAccess(ctx, req)
}

func (s *KafkaServer) RevokeTopicAccess(ctx context.Context, req *kafkav1.RevokeTopicAccessRequest) (*kafkav1.RevokeTopicAccessResponse, error) {
	return s.shareHandler.RevokeTopicAccess(ctx, req)
}

func (s *KafkaServer) ListTopicShares(ctx context.Context, req *kafkav1.ListTopicSharesRequest) (*kafkav1.ListTopicSharesResponse, error) {
	return s.shareHandler.ListTopicShares(ctx, req)
}

// Discovery
func (s *KafkaServer) DiscoverTopics(ctx context.Context, req *kafkav1.DiscoverTopicsRequest) (*kafkav1.DiscoverTopicsResponse, error) {
	return s.shareHandler.DiscoverTopics(ctx, req)
}

// Metrics & Lineage
func (s *KafkaServer) GetTopicMetrics(ctx context.Context, req *kafkav1.GetTopicMetricsRequest) (*kafkav1.GetTopicMetricsResponse, error) {
	return s.topicHandler.GetTopicMetrics(ctx, req)
}

func (s *KafkaServer) GetTopicLineage(ctx context.Context, req *kafkav1.GetTopicLineageRequest) (*kafkav1.GetTopicLineageResponse, error) {
	return s.topicHandler.GetTopicLineage(ctx, req)
}
