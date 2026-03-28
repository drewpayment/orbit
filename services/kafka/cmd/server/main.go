package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	kafkav1 "github.com/drewpayment/orbit/proto/gen/go/idp/kafka/v1"
	"github.com/drewpayment/orbit/services/kafka/internal/adapters"
	"github.com/drewpayment/orbit/services/kafka/internal/adapters/apache"
	bifrostadapter "github.com/drewpayment/orbit/services/kafka/internal/adapters/bifrost"
	"github.com/drewpayment/orbit/services/kafka/internal/domain"
	kafkagrpc "github.com/drewpayment/orbit/services/kafka/internal/grpc"
	"github.com/drewpayment/orbit/services/kafka/internal/repository/postgres"
	"github.com/drewpayment/orbit/services/kafka/internal/service"
	"github.com/drewpayment/orbit/services/kafka/migrations"
	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	"google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/reflection"
)

// Config holds server configuration
type Config struct {
	GRPCPort         int
	Environment      string
	DatabaseURL      string
	BifrostAdminAddr string
}

func main() {
	cfg := loadConfig()

	// Set up context with cancellation
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Set up signal handling
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	// Initialize PostgreSQL persistence
	// QA-001: Clean-slate migration — in-memory stubs were volatile, no data to migrate.
	pool, err := postgres.NewPool(ctx, cfg.DatabaseURL, migrations.FS)
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}
	defer pool.Close()
	log.Println("INFO: Using PostgreSQL persistence — in-memory stubs removed")

	// Initialize repositories backed by PostgreSQL
	clusterRepo := postgres.NewClusterRepository(pool)
	providerRepo := postgres.NewProviderRepository()
	mappingRepo := postgres.NewMappingRepository(pool)
	topicRepo := postgres.NewTopicRepository(pool)
	policyRepo := postgres.NewPolicyRepository(pool)
	schemaRepo := postgres.NewSchemaRepository(pool)
	registryRepo := postgres.NewRegistryRepository(pool)
	shareRepo := postgres.NewShareRepository(pool)
	sharePolicyRepo := postgres.NewSharePolicyRepository(pool)
	serviceAccountRepo := postgres.NewServiceAccountRepository(pool)

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

	// Create Bifrost adapter for message browse/produce
	var serverOpts []kafkagrpc.KafkaServerOption
	bifrostAdapter, err := bifrostadapter.NewClient(cfg.BifrostAdminAddr, "") // vcID resolved per-request
	if err != nil {
		log.Printf("Warning: Could not connect to Bifrost at %s: %v (message browsing disabled)", cfg.BifrostAdminAddr, err)
	} else {
		serverOpts = append(serverOpts, kafkagrpc.WithMessageAdapter(bifrostAdapter))
		log.Printf("Connected to Bifrost admin at %s", cfg.BifrostAdminAddr)
	}

	// Register services
	kafkaServer := kafkagrpc.NewKafkaServer(clusterService, topicService, schemaService, shareService, serverOpts...)
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
	pool.Close()
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

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://orbit:orbit@localhost:5433/kafka_service?sslmode=disable"
	}

	bifrostAddr := os.Getenv("BIFROST_ADMIN_ADDR")
	if bifrostAddr == "" {
		bifrostAddr = "localhost:50060"
	}

	return &Config{
		GRPCPort:         port,
		Environment:      env,
		DatabaseURL:      dbURL,
		BifrostAdminAddr: bifrostAddr,
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

// Real adapter factory using Apache Kafka adapter
type kafkaAdapterFactory struct{}

func (f *kafkaAdapterFactory) CreateKafkaAdapter(cluster *domain.KafkaCluster, credentials map[string]string) (adapters.KafkaAdapter, error) {
	bootstrapServers := cluster.ConnectionConfig["bootstrap.servers"]
	if bootstrapServers == "" {
		return nil, fmt.Errorf("bootstrap.servers not configured")
	}

	return apache.NewClientFromCluster(cluster.ConnectionConfig, credentials)
}

func (f *kafkaAdapterFactory) CreateSchemaRegistryAdapter(registry *domain.SchemaRegistry, credentials map[string]string) (adapters.SchemaRegistryAdapter, error) {
	return nil, fmt.Errorf("schema registry adapter not configured")
}
