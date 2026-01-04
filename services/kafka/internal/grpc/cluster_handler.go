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

// ClusterHandler handles cluster-related gRPC calls
type ClusterHandler struct {
	clusterService *service.ClusterService
}

// NewClusterHandler creates a new ClusterHandler
func NewClusterHandler(clusterService *service.ClusterService) *ClusterHandler {
	return &ClusterHandler{
		clusterService: clusterService,
	}
}

// ListProviders returns all available Kafka providers
func (h *ClusterHandler) ListProviders(ctx context.Context, req *kafkav1.ListProvidersRequest) (*kafkav1.ListProvidersResponse, error) {
	providers, err := h.clusterService.ListProviders(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list providers: %v", err)
	}

	pbProviders := make([]*kafkav1.KafkaProvider, len(providers))
	for i, p := range providers {
		pbProviders[i] = providerToProto(p)
	}

	return &kafkav1.ListProvidersResponse{
		Providers: pbProviders,
	}, nil
}

// RegisterCluster registers a new Kafka cluster
func (h *ClusterHandler) RegisterCluster(ctx context.Context, req *kafkav1.RegisterClusterRequest) (*kafkav1.RegisterClusterResponse, error) {
	cluster, err := h.clusterService.RegisterCluster(ctx, service.RegisterClusterRequest{
		Name:             req.Name,
		ProviderID:       req.ProviderId,
		ConnectionConfig: req.ConnectionConfig,
		Credentials:      req.Credentials,
	})

	if err != nil {
		return &kafkav1.RegisterClusterResponse{
			Error: err.Error(),
		}, nil
	}

	return &kafkav1.RegisterClusterResponse{
		Cluster: clusterToProto(cluster),
	}, nil
}

// ValidateCluster validates a cluster connection (cluster stored in Go service)
func (h *ClusterHandler) ValidateCluster(ctx context.Context, req *kafkav1.ValidateClusterRequest) (*kafkav1.ValidateClusterResponse, error) {
	clusterID, err := uuid.Parse(req.ClusterId)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid cluster ID: %v", err)
	}

	valid, err := h.clusterService.ValidateCluster(ctx, clusterID, nil)
	if err != nil {
		return &kafkav1.ValidateClusterResponse{
			Valid: false,
			Error: err.Error(),
		}, nil
	}

	return &kafkav1.ValidateClusterResponse{
		Valid: valid,
	}, nil
}

// ValidateClusterConnection validates a Kafka connection using provided config
// This is used when cluster config is stored externally (e.g., Payload CMS)
func (h *ClusterHandler) ValidateClusterConnection(ctx context.Context, req *kafkav1.ValidateClusterConnectionRequest) (*kafkav1.ValidateClusterConnectionResponse, error) {
	valid, err := h.clusterService.ValidateClusterConnection(ctx, req.ConnectionConfig, req.Credentials)
	if err != nil {
		return &kafkav1.ValidateClusterConnectionResponse{
			Valid: false,
			Error: err.Error(),
		}, nil
	}

	return &kafkav1.ValidateClusterConnectionResponse{
		Valid: valid,
	}, nil
}

// DeleteTopicByName deletes a topic directly by name from the Kafka cluster.
// This is used when topic metadata is stored externally (e.g., Payload CMS)
// and we only need to remove the topic from Kafka without looking up internal IDs.
func (h *ClusterHandler) DeleteTopicByName(ctx context.Context, req *kafkav1.DeleteTopicByNameRequest) (*kafkav1.DeleteTopicByNameResponse, error) {
	if req.TopicName == "" {
		return &kafkav1.DeleteTopicByNameResponse{
			Success: false,
			Error:   "topic_name is required",
		}, nil
	}

	err := h.clusterService.DeleteTopicByName(ctx, req.TopicName, req.ConnectionConfig, req.Credentials)
	if err != nil {
		return &kafkav1.DeleteTopicByNameResponse{
			Success: false,
			Error:   err.Error(),
		}, nil
	}

	return &kafkav1.DeleteTopicByNameResponse{
		Success: true,
	}, nil
}

// CreateTopicDirect creates a topic directly on the Kafka cluster.
// This is used when topic metadata is stored externally (e.g., Payload CMS)
// and we only need to create the topic on Kafka without storing in Go service.
func (h *ClusterHandler) CreateTopicDirect(ctx context.Context, req *kafkav1.CreateTopicDirectRequest) (*kafkav1.CreateTopicDirectResponse, error) {
	if req.TopicName == "" {
		return &kafkav1.CreateTopicDirectResponse{
			Success: false,
			Error:   "topic_name is required",
		}, nil
	}

	err := h.clusterService.CreateTopicDirect(ctx, service.CreateTopicDirectRequest{
		TopicName:         req.TopicName,
		Partitions:        int(req.Partitions),
		ReplicationFactor: int(req.ReplicationFactor),
		Config:            req.Config,
		ConnectionConfig:  req.ConnectionConfig,
		Credentials:       req.Credentials,
	})
	if err != nil {
		return &kafkav1.CreateTopicDirectResponse{
			Success: false,
			Error:   err.Error(),
		}, nil
	}

	return &kafkav1.CreateTopicDirectResponse{
		Success: true,
	}, nil
}

// ListClusters returns all registered clusters
func (h *ClusterHandler) ListClusters(ctx context.Context, req *kafkav1.ListClustersRequest) (*kafkav1.ListClustersResponse, error) {
	clusters, err := h.clusterService.ListClusters(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list clusters: %v", err)
	}

	pbClusters := make([]*kafkav1.KafkaCluster, len(clusters))
	for i, c := range clusters {
		pbClusters[i] = clusterToProto(c)
	}

	return &kafkav1.ListClustersResponse{
		Clusters: pbClusters,
	}, nil
}

// DeleteCluster deletes a cluster
func (h *ClusterHandler) DeleteCluster(ctx context.Context, req *kafkav1.DeleteClusterRequest) (*kafkav1.DeleteClusterResponse, error) {
	clusterID, err := uuid.Parse(req.ClusterId)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid cluster ID: %v", err)
	}

	if err := h.clusterService.DeleteCluster(ctx, clusterID); err != nil {
		return &kafkav1.DeleteClusterResponse{
			Success: false,
			Error:   err.Error(),
		}, nil
	}

	return &kafkav1.DeleteClusterResponse{
		Success: true,
	}, nil
}

// CreateEnvironmentMapping creates an environment to cluster mapping
func (h *ClusterHandler) CreateEnvironmentMapping(ctx context.Context, req *kafkav1.CreateEnvironmentMappingRequest) (*kafkav1.CreateEnvironmentMappingResponse, error) {
	clusterID, err := uuid.Parse(req.ClusterId)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid cluster ID: %v", err)
	}

	mapping, err := h.clusterService.CreateEnvironmentMapping(ctx, service.CreateEnvironmentMappingRequest{
		Environment: req.Environment,
		ClusterID:   clusterID,
		RoutingRule: req.RoutingRule,
		Priority:    int(req.Priority),
		IsDefault:   req.IsDefault,
	})

	if err != nil {
		return &kafkav1.CreateEnvironmentMappingResponse{
			Error: err.Error(),
		}, nil
	}

	return &kafkav1.CreateEnvironmentMappingResponse{
		Mapping: mappingToProto(mapping),
	}, nil
}

// ListEnvironmentMappings returns environment mappings
func (h *ClusterHandler) ListEnvironmentMappings(ctx context.Context, req *kafkav1.ListEnvironmentMappingsRequest) (*kafkav1.ListEnvironmentMappingsResponse, error) {
	mappings, err := h.clusterService.ListEnvironmentMappings(ctx, req.Environment)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list mappings: %v", err)
	}

	pbMappings := make([]*kafkav1.KafkaEnvironmentMapping, len(mappings))
	for i, m := range mappings {
		pbMappings[i] = mappingToProto(m)
	}

	return &kafkav1.ListEnvironmentMappingsResponse{
		Mappings: pbMappings,
	}, nil
}

// DeleteEnvironmentMapping deletes an environment mapping
func (h *ClusterHandler) DeleteEnvironmentMapping(ctx context.Context, req *kafkav1.DeleteEnvironmentMappingRequest) (*kafkav1.DeleteEnvironmentMappingResponse, error) {
	mappingID, err := uuid.Parse(req.MappingId)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid mapping ID: %v", err)
	}

	if err := h.clusterService.DeleteEnvironmentMapping(ctx, mappingID); err != nil {
		return &kafkav1.DeleteEnvironmentMappingResponse{
			Success: false,
			Error:   err.Error(),
		}, nil
	}

	return &kafkav1.DeleteEnvironmentMappingResponse{
		Success: true,
	}, nil
}

// Helper functions for proto conversion

func providerToProto(p *domain.KafkaProvider) *kafkav1.KafkaProvider {
	return &kafkav1.KafkaProvider{
		Id:                   p.ID,
		Name:                 p.Name,
		DisplayName:          p.DisplayName,
		AdapterType:          p.AdapterType,
		RequiredConfigFields: p.RequiredConfigFields,
		Capabilities: &kafkav1.ProviderCapabilities{
			SchemaRegistry: p.Capabilities.SchemaRegistry,
			Transactions:   p.Capabilities.Transactions,
			QuotasApi:      p.Capabilities.QuotasAPI,
			MetricsApi:     p.Capabilities.MetricsAPI,
		},
		DocumentationUrl: p.DocumentationURL,
		IconUrl:          p.IconURL,
	}
}

func clusterToProto(c *domain.KafkaCluster) *kafkav1.KafkaCluster {
	pb := &kafkav1.KafkaCluster{
		Id:               c.ID.String(),
		Name:             c.Name,
		ProviderId:       c.ProviderID,
		ConnectionConfig: c.ConnectionConfig,
		ValidationStatus: clusterValidationStatusToProto(c.ValidationStatus),
	}
	if c.LastValidatedAt != nil {
		pb.LastValidatedAt = timestamppb.New(*c.LastValidatedAt)
	}
	if !c.CreatedAt.IsZero() {
		pb.CreatedAt = timestamppb.New(c.CreatedAt)
	}
	if !c.UpdatedAt.IsZero() {
		pb.UpdatedAt = timestamppb.New(c.UpdatedAt)
	}
	return pb
}

func clusterValidationStatusToProto(s domain.ClusterValidationStatus) kafkav1.ClusterValidationStatus {
	switch s {
	case domain.ClusterValidationStatusPending:
		return kafkav1.ClusterValidationStatus_CLUSTER_VALIDATION_STATUS_PENDING
	case domain.ClusterValidationStatusValid:
		return kafkav1.ClusterValidationStatus_CLUSTER_VALIDATION_STATUS_VALID
	case domain.ClusterValidationStatusInvalid:
		return kafkav1.ClusterValidationStatus_CLUSTER_VALIDATION_STATUS_INVALID
	default:
		return kafkav1.ClusterValidationStatus_CLUSTER_VALIDATION_STATUS_UNSPECIFIED
	}
}

func mappingToProto(m *domain.KafkaEnvironmentMapping) *kafkav1.KafkaEnvironmentMapping {
	return &kafkav1.KafkaEnvironmentMapping{
		Id:          m.ID.String(),
		Environment: m.Environment,
		ClusterId:   m.ClusterID.String(),
		RoutingRule: m.RoutingRule,
		Priority:    int32(m.Priority),
		IsDefault:   m.IsDefault,
	}
}
