// Package main provides the entry point for the Bifrost Callback Service.
// This service receives callbacks from the Bifrost gateway when topics are
// created, deleted, or have their configuration updated via passthrough mode.
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

	gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
	"github.com/drewpayment/orbit/services/bifrost-callback/internal/service"
	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	"google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/reflection"
)

// Config holds server configuration.
type Config struct {
	CallbackPort   int
	TemporalHost   string
	TemporalPort   int
	Environment    string
}

func main() {
	cfg := loadConfig()

	// Set up context with cancellation
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Set up signal handling
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	// Initialize Temporal client
	// TODO: Replace with actual Temporal client when implementing workflow integration
	temporalClient := &stubTemporalClient{
		host: cfg.TemporalHost,
		port: cfg.TemporalPort,
	}

	// Create callback service
	callbackService := service.NewCallbackService(temporalClient)

	// Create gRPC server
	grpcServer := grpc.NewServer(
		grpc.UnaryInterceptor(loggingInterceptor),
	)

	// Register services
	gatewayv1.RegisterBifrostCallbackServiceServer(grpcServer, callbackService)

	// Register health service
	healthServer := health.NewServer()
	grpc_health_v1.RegisterHealthServer(grpcServer, healthServer)
	healthServer.SetServingStatus("", grpc_health_v1.HealthCheckResponse_SERVING)
	healthServer.SetServingStatus("idp.gateway.v1.BifrostCallbackService", grpc_health_v1.HealthCheckResponse_SERVING)

	// Enable reflection for development
	if cfg.Environment != "production" {
		reflection.Register(grpcServer)
	}

	// Start gRPC server
	listener, err := net.Listen("tcp", fmt.Sprintf(":%d", cfg.CallbackPort))
	if err != nil {
		log.Fatalf("failed to listen: %v", err)
	}

	log.Printf("Starting Bifrost Callback service on port %d", cfg.CallbackPort)
	log.Printf("Temporal endpoint: %s:%d", cfg.TemporalHost, cfg.TemporalPort)

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
	healthServer.SetServingStatus("idp.gateway.v1.BifrostCallbackService", grpc_health_v1.HealthCheckResponse_NOT_SERVING)

	// Give time for health check to propagate
	time.Sleep(2 * time.Second)

	grpcServer.GracefulStop()
	cancel()

	// Suppress unused variable warning
	_ = ctx

	log.Println("Server stopped")
}

func loadConfig() *Config {
	port := 50061 // Default Bifrost Callback service port
	if p := os.Getenv("CALLBACK_PORT"); p != "" {
		fmt.Sscanf(p, "%d", &port)
	}

	temporalHost := os.Getenv("TEMPORAL_HOST")
	if temporalHost == "" {
		temporalHost = "localhost"
	}

	temporalPort := 7233 // Default Temporal port
	if p := os.Getenv("TEMPORAL_PORT"); p != "" {
		fmt.Sscanf(p, "%d", &temporalPort)
	}

	env := os.Getenv("ENVIRONMENT")
	if env == "" {
		env = "development"
	}

	return &Config{
		CallbackPort:   port,
		TemporalHost:   temporalHost,
		TemporalPort:   temporalPort,
		Environment:    env,
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

// stubTemporalClient is a placeholder implementation of the TemporalClient interface.
// TODO: Replace with actual Temporal SDK client implementation.
type stubTemporalClient struct {
	host string
	port int
}

// StartWorkflow is a stub implementation that logs the workflow start request.
// In production, this will actually start a Temporal workflow.
func (c *stubTemporalClient) StartWorkflow(ctx context.Context, workflowType string, workflowID string, input interface{}) error {
	log.Printf("Starting workflow: type=%s, id=%s, temporal=%s:%d", workflowType, workflowID, c.host, c.port)
	// TODO: Implement actual Temporal workflow start
	// client, err := temporal.Dial(temporal.Options{HostPort: fmt.Sprintf("%s:%d", c.host, c.port)})
	// if err != nil {
	//     return err
	// }
	// _, err = client.ExecuteWorkflow(ctx, temporal.StartWorkflowOptions{
	//     ID:        workflowID,
	//     TaskQueue: "bifrost-callback-queue",
	// }, workflowType, input)
	// return err
	return nil
}
