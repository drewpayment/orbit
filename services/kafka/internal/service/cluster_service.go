package service

import (
	"context"

	"github.com/drewpayment/orbit/services/kafka/internal/adapters"
	"github.com/drewpayment/orbit/services/kafka/internal/domain"
	"github.com/google/uuid"
)

// ClusterRepository defines persistence operations for clusters
type ClusterRepository interface {
	Create(ctx context.Context, cluster *domain.KafkaCluster) error
	GetByID(ctx context.Context, id uuid.UUID) (*domain.KafkaCluster, error)
	List(ctx context.Context) ([]*domain.KafkaCluster, error)
	Update(ctx context.Context, cluster *domain.KafkaCluster) error
	Delete(ctx context.Context, id uuid.UUID) error
}

// ProviderRepository defines persistence operations for providers
type ProviderRepository interface {
	GetByID(ctx context.Context, id string) (*domain.KafkaProvider, error)
	List(ctx context.Context) ([]*domain.KafkaProvider, error)
}

// EnvironmentMappingRepository defines persistence for environment mappings
type EnvironmentMappingRepository interface {
	Create(ctx context.Context, mapping *domain.KafkaEnvironmentMapping) error
	GetByID(ctx context.Context, id uuid.UUID) (*domain.KafkaEnvironmentMapping, error)
	List(ctx context.Context, environment string) ([]*domain.KafkaEnvironmentMapping, error)
	Delete(ctx context.Context, id uuid.UUID) error
	GetDefaultForEnvironment(ctx context.Context, environment string) (*domain.KafkaEnvironmentMapping, error)
}

// ClusterService handles cluster management operations
type ClusterService struct {
	clusterRepo    ClusterRepository
	providerRepo   ProviderRepository
	mappingRepo    EnvironmentMappingRepository
	adapterFactory adapters.AdapterFactory
}

// NewClusterService creates a new ClusterService
func NewClusterService(
	clusterRepo ClusterRepository,
	providerRepo ProviderRepository,
	mappingRepo EnvironmentMappingRepository,
	adapterFactory adapters.AdapterFactory,
) *ClusterService {
	return &ClusterService{
		clusterRepo:    clusterRepo,
		providerRepo:   providerRepo,
		mappingRepo:    mappingRepo,
		adapterFactory: adapterFactory,
	}
}

// ListProviders returns all available Kafka providers
func (s *ClusterService) ListProviders(ctx context.Context) ([]*domain.KafkaProvider, error) {
	return s.providerRepo.List(ctx)
}

// RegisterCluster registers a new Kafka cluster
func (s *ClusterService) RegisterCluster(ctx context.Context, req RegisterClusterRequest) (*domain.KafkaCluster, error) {
	// Validate provider exists
	provider, err := s.providerRepo.GetByID(ctx, req.ProviderID)
	if err != nil {
		return nil, err
	}
	if provider == nil {
		return nil, domain.ErrClusterProviderRequired
	}

	// Create cluster domain object
	cluster := domain.NewKafkaCluster(req.Name, req.ProviderID, req.ConnectionConfig)

	if err := cluster.Validate(); err != nil {
		return nil, err
	}

	// Validate connection
	adapter, err := s.adapterFactory.CreateKafkaAdapter(cluster, req.Credentials)
	if err != nil {
		cluster.MarkInvalid()
	} else {
		if err := adapter.ValidateConnection(ctx); err != nil {
			cluster.MarkInvalid()
		} else {
			cluster.MarkValid()
		}
		adapter.Close()
	}

	// Store cluster
	if err := s.clusterRepo.Create(ctx, cluster); err != nil {
		return nil, err
	}

	return cluster, nil
}

// ValidateCluster validates a cluster connection
func (s *ClusterService) ValidateCluster(ctx context.Context, clusterID uuid.UUID, credentials map[string]string) (bool, error) {
	cluster, err := s.clusterRepo.GetByID(ctx, clusterID)
	if err != nil {
		return false, err
	}
	if cluster == nil {
		return false, domain.ErrClusterNotFound
	}

	adapter, err := s.adapterFactory.CreateKafkaAdapter(cluster, credentials)
	if err != nil {
		return false, err
	}
	defer adapter.Close()

	if err := adapter.ValidateConnection(ctx); err != nil {
		return false, err
	}

	return true, nil
}

// ListClusters returns all registered clusters
func (s *ClusterService) ListClusters(ctx context.Context) ([]*domain.KafkaCluster, error) {
	return s.clusterRepo.List(ctx)
}

// DeleteCluster deletes a cluster
func (s *ClusterService) DeleteCluster(ctx context.Context, clusterID uuid.UUID) error {
	cluster, err := s.clusterRepo.GetByID(ctx, clusterID)
	if err != nil {
		return err
	}
	if cluster == nil {
		return domain.ErrClusterNotFound
	}

	return s.clusterRepo.Delete(ctx, clusterID)
}

// CreateEnvironmentMapping creates an environment to cluster mapping
func (s *ClusterService) CreateEnvironmentMapping(ctx context.Context, req CreateEnvironmentMappingRequest) (*domain.KafkaEnvironmentMapping, error) {
	// Validate cluster exists
	cluster, err := s.clusterRepo.GetByID(ctx, req.ClusterID)
	if err != nil {
		return nil, err
	}
	if cluster == nil {
		return nil, domain.ErrClusterNotFound
	}

	mapping := &domain.KafkaEnvironmentMapping{
		ID:          uuid.New(),
		Environment: req.Environment,
		ClusterID:   req.ClusterID,
		RoutingRule: req.RoutingRule,
		Priority:    req.Priority,
		IsDefault:   req.IsDefault,
	}

	if err := mapping.Validate(); err != nil {
		return nil, err
	}

	if err := s.mappingRepo.Create(ctx, mapping); err != nil {
		return nil, err
	}

	return mapping, nil
}

// ListEnvironmentMappings returns environment mappings, optionally filtered
func (s *ClusterService) ListEnvironmentMappings(ctx context.Context, environment string) ([]*domain.KafkaEnvironmentMapping, error) {
	return s.mappingRepo.List(ctx, environment)
}

// DeleteEnvironmentMapping deletes an environment mapping
func (s *ClusterService) DeleteEnvironmentMapping(ctx context.Context, mappingID uuid.UUID) error {
	mapping, err := s.mappingRepo.GetByID(ctx, mappingID)
	if err != nil {
		return err
	}
	if mapping == nil {
		return domain.ErrEnvironmentMappingNotFound
	}

	return s.mappingRepo.Delete(ctx, mappingID)
}

// GetClusterForEnvironment resolves the cluster for an environment
func (s *ClusterService) GetClusterForEnvironment(ctx context.Context, environment string, workspaceID uuid.UUID) (*domain.KafkaCluster, error) {
	mapping, err := s.mappingRepo.GetDefaultForEnvironment(ctx, environment)
	if err != nil {
		return nil, err
	}
	if mapping == nil {
		return nil, domain.ErrNoDefaultCluster
	}

	return s.clusterRepo.GetByID(ctx, mapping.ClusterID)
}

// RegisterClusterRequest contains parameters for cluster registration
type RegisterClusterRequest struct {
	Name             string
	ProviderID       string
	ConnectionConfig map[string]string
	Credentials      map[string]string
}

// CreateEnvironmentMappingRequest contains parameters for mapping creation
type CreateEnvironmentMappingRequest struct {
	Environment string
	ClusterID   uuid.UUID
	RoutingRule map[string]string
	Priority    int
	IsDefault   bool
}
