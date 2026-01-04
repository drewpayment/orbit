package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	kafkav1 "github.com/drewpayment/orbit/proto/gen/go/idp/kafka/v1"
	"github.com/drewpayment/orbit/services/kafka/internal/adapters"
	"github.com/drewpayment/orbit/services/kafka/internal/adapters/apache"
	"github.com/drewpayment/orbit/services/kafka/internal/domain"
	kafkagrpc "github.com/drewpayment/orbit/services/kafka/internal/grpc"
	"github.com/drewpayment/orbit/services/kafka/internal/service"
	"github.com/google/uuid"
	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	"google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/reflection"
)

// Config holds server configuration
type Config struct {
	GRPCPort    int
	Environment string
}

func main() {
	cfg := loadConfig()

	// Set up context with cancellation
	_, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Set up signal handling
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	// Initialize dependencies
	// TODO: Initialize actual repositories connected to Payload CMS
	// For now, we'll create placeholder implementations
	clusterRepo := newInMemoryClusterRepository()
	providerRepo := &inMemoryProviderRepository{}
	mappingRepo := &inMemoryMappingRepository{}
	topicRepo := &inMemoryTopicRepository{}
	policyRepo := &inMemoryPolicyRepository{}
	schemaRepo := &inMemorySchemaRepository{}
	registryRepo := &inMemoryRegistryRepository{}
	shareRepo := &inMemoryShareRepository{}
	sharePolicyRepo := &inMemorySharePolicyRepository{}
	serviceAccountRepo := &inMemoryServiceAccountRepository{}

	// Initialize adapter factory with real Kafka adapter
	adapterFactory := &kafkaAdapterFactory{}

	// Create services
	clusterService := service.NewClusterService(clusterRepo, providerRepo, mappingRepo, adapterFactory)
	topicService := service.NewTopicService(topicRepo, policyRepo, clusterService, adapterFactory)
	schemaService := service.NewSchemaService(schemaRepo, registryRepo, topicService, adapterFactory)
	shareService := service.NewShareService(shareRepo, sharePolicyRepo, serviceAccountRepo, topicService)

	// Create gRPC server
	grpcServer := grpc.NewServer(
		grpc.UnaryInterceptor(loggingInterceptor),
	)

	// Register services
	kafkaServer := kafkagrpc.NewKafkaServer(clusterService, topicService, schemaService, shareService)
	kafkav1.RegisterKafkaServiceServer(grpcServer, kafkaServer)

	// Register health service
	healthServer := health.NewServer()
	grpc_health_v1.RegisterHealthServer(grpcServer, healthServer)
	healthServer.SetServingStatus("", grpc_health_v1.HealthCheckResponse_SERVING)

	// Enable reflection for development
	if cfg.Environment != "production" {
		reflection.Register(grpcServer)
	}

	// Start gRPC server
	listener, err := net.Listen("tcp", fmt.Sprintf(":%d", cfg.GRPCPort))
	if err != nil {
		log.Fatalf("failed to listen: %v", err)
	}

	log.Printf("Starting Kafka service on port %d", cfg.GRPCPort)

	go func() {
		if err := grpcServer.Serve(listener); err != nil {
			log.Printf("gRPC server error: %v", err)
		}
	}()

	// Wait for shutdown signal
	<-sigChan
	log.Println("Shutting down...")

	// Graceful shutdown
	healthServer.SetServingStatus("", grpc_health_v1.HealthCheckResponse_NOT_SERVING)

	// Give time for health check to propagate
	time.Sleep(2 * time.Second)

	grpcServer.GracefulStop()
	cancel()

	log.Println("Server stopped")
}

func loadConfig() *Config {
	port := 50055 // Default Kafka service port
	if p := os.Getenv("GRPC_PORT"); p != "" {
		fmt.Sscanf(p, "%d", &port)
	}

	env := os.Getenv("ENVIRONMENT")
	if env == "" {
		env = "development"
	}

	return &Config{
		GRPCPort:    port,
		Environment: env,
	}
}

func loggingInterceptor(
	ctx context.Context,
	req interface{},
	info *grpc.UnaryServerInfo,
	handler grpc.UnaryHandler,
) (interface{}, error) {
	start := time.Now()
	resp, err := handler(ctx, req)
	log.Printf("method=%s duration=%v err=%v", info.FullMethod, time.Since(start), err)
	return resp, err
}

// Placeholder repository implementations
// TODO: Replace with actual implementations connected to Payload CMS

type inMemoryClusterRepository struct {
	clusters map[uuid.UUID]*domain.KafkaCluster
	mu       sync.RWMutex
}

func newInMemoryClusterRepository() *inMemoryClusterRepository {
	return &inMemoryClusterRepository{
		clusters: make(map[uuid.UUID]*domain.KafkaCluster),
	}
}

func (r *inMemoryClusterRepository) Create(ctx context.Context, cluster *domain.KafkaCluster) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.clusters[cluster.ID] = cluster
	return nil
}
func (r *inMemoryClusterRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.KafkaCluster, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if cluster, ok := r.clusters[id]; ok {
		return cluster, nil
	}
	return nil, nil
}
func (r *inMemoryClusterRepository) List(ctx context.Context) ([]*domain.KafkaCluster, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]*domain.KafkaCluster, 0, len(r.clusters))
	for _, cluster := range r.clusters {
		result = append(result, cluster)
	}
	return result, nil
}
func (r *inMemoryClusterRepository) Update(ctx context.Context, cluster *domain.KafkaCluster) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.clusters[cluster.ID]; ok {
		r.clusters[cluster.ID] = cluster
		return nil
	}
	return domain.ErrClusterNotFound
}
func (r *inMemoryClusterRepository) Delete(ctx context.Context, id uuid.UUID) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.clusters[id]; ok {
		delete(r.clusters, id)
		return nil
	}
	return domain.ErrClusterNotFound
}

type inMemoryProviderRepository struct{}

func (r *inMemoryProviderRepository) GetByID(ctx context.Context, id string) (*domain.KafkaProvider, error) {
	providers := domain.DefaultProviders()
	for i := range providers {
		if providers[i].ID == id {
			return &providers[i], nil
		}
	}
	return nil, nil
}
func (r *inMemoryProviderRepository) List(ctx context.Context) ([]*domain.KafkaProvider, error) {
	providers := domain.DefaultProviders()
	result := make([]*domain.KafkaProvider, len(providers))
	for i := range providers {
		result[i] = &providers[i]
	}
	return result, nil
}

type inMemoryMappingRepository struct{}

func (r *inMemoryMappingRepository) Create(ctx context.Context, mapping *domain.KafkaEnvironmentMapping) error {
	return nil
}
func (r *inMemoryMappingRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.KafkaEnvironmentMapping, error) {
	return nil, nil
}
func (r *inMemoryMappingRepository) List(ctx context.Context, environment string) ([]*domain.KafkaEnvironmentMapping, error) {
	return nil, nil
}
func (r *inMemoryMappingRepository) Delete(ctx context.Context, id uuid.UUID) error {
	return nil
}
func (r *inMemoryMappingRepository) GetDefaultForEnvironment(ctx context.Context, environment string) (*domain.KafkaEnvironmentMapping, error) {
	return nil, nil
}

type inMemoryTopicRepository struct{}

func (r *inMemoryTopicRepository) Create(ctx context.Context, topic *domain.KafkaTopic) error {
	return nil
}
func (r *inMemoryTopicRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.KafkaTopic, error) {
	return nil, nil
}
func (r *inMemoryTopicRepository) GetByName(ctx context.Context, workspaceID uuid.UUID, environment, name string) (*domain.KafkaTopic, error) {
	return nil, domain.ErrTopicNotFound
}
func (r *inMemoryTopicRepository) List(ctx context.Context, workspaceID uuid.UUID, environment string) ([]*domain.KafkaTopic, error) {
	return nil, nil
}
func (r *inMemoryTopicRepository) Update(ctx context.Context, topic *domain.KafkaTopic) error {
	return nil
}
func (r *inMemoryTopicRepository) Delete(ctx context.Context, id uuid.UUID) error {
	return nil
}

type inMemoryPolicyRepository struct{}

func (r *inMemoryPolicyRepository) GetEffectivePolicy(ctx context.Context, workspaceID uuid.UUID, environment string) (*domain.KafkaTopicPolicy, error) {
	return nil, domain.ErrPolicyNotFound
}

type inMemorySchemaRepository struct{}

func (r *inMemorySchemaRepository) Create(ctx context.Context, schema *domain.KafkaSchema) error {
	return nil
}
func (r *inMemorySchemaRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.KafkaSchema, error) {
	return nil, nil
}
func (r *inMemorySchemaRepository) GetBySubject(ctx context.Context, topicID uuid.UUID, schemaType string) (*domain.KafkaSchema, error) {
	return nil, domain.ErrSchemaNotFound
}
func (r *inMemorySchemaRepository) List(ctx context.Context, topicID uuid.UUID) ([]*domain.KafkaSchema, error) {
	return nil, nil
}
func (r *inMemorySchemaRepository) Update(ctx context.Context, schema *domain.KafkaSchema) error {
	return nil
}
func (r *inMemorySchemaRepository) Delete(ctx context.Context, id uuid.UUID) error {
	return nil
}

type inMemoryRegistryRepository struct{}

func (r *inMemoryRegistryRepository) GetByClusterID(ctx context.Context, clusterID uuid.UUID) (*domain.SchemaRegistry, error) {
	return nil, nil
}

type inMemoryShareRepository struct{}

func (r *inMemoryShareRepository) Create(ctx context.Context, share *domain.KafkaTopicShare) error {
	return nil
}
func (r *inMemoryShareRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.KafkaTopicShare, error) {
	return nil, nil
}
func (r *inMemoryShareRepository) List(ctx context.Context, filter service.ShareFilter) ([]*domain.KafkaTopicShare, error) {
	return nil, nil
}
func (r *inMemoryShareRepository) Update(ctx context.Context, share *domain.KafkaTopicShare) error {
	return nil
}
func (r *inMemoryShareRepository) Delete(ctx context.Context, id uuid.UUID) error {
	return nil
}
func (r *inMemoryShareRepository) GetExisting(ctx context.Context, topicID, workspaceID uuid.UUID) (*domain.KafkaTopicShare, error) {
	return nil, domain.ErrShareNotFound
}

type inMemorySharePolicyRepository struct{}

func (r *inMemorySharePolicyRepository) GetEffectivePolicy(ctx context.Context, workspaceID uuid.UUID, topicID uuid.UUID) (*domain.KafkaTopicSharePolicy, error) {
	return nil, domain.ErrPolicyNotFound
}

type inMemoryServiceAccountRepository struct{}

func (r *inMemoryServiceAccountRepository) Create(ctx context.Context, account *domain.KafkaServiceAccount) error {
	return nil
}
func (r *inMemoryServiceAccountRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.KafkaServiceAccount, error) {
	return nil, nil
}
func (r *inMemoryServiceAccountRepository) List(ctx context.Context, workspaceID uuid.UUID) ([]*domain.KafkaServiceAccount, error) {
	return nil, nil
}
func (r *inMemoryServiceAccountRepository) Update(ctx context.Context, account *domain.KafkaServiceAccount) error {
	return nil
}

// Real adapter factory using Apache Kafka adapter
type kafkaAdapterFactory struct{}

func (f *kafkaAdapterFactory) CreateKafkaAdapter(cluster *domain.KafkaCluster, credentials map[string]string) (adapters.KafkaAdapter, error) {
	// Get bootstrap servers from connection config
	bootstrapServers := cluster.ConnectionConfig["bootstrap.servers"]
	if bootstrapServers == "" {
		return nil, fmt.Errorf("bootstrap.servers not configured")
	}

	return apache.NewClientFromCluster(cluster.ConnectionConfig, credentials)
}

func (f *kafkaAdapterFactory) CreateSchemaRegistryAdapter(registry *domain.SchemaRegistry, credentials map[string]string) (adapters.SchemaRegistryAdapter, error) {
	// Schema registry adapter not yet implemented
	return nil, fmt.Errorf("schema registry adapter not configured")
}
