package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"go.temporal.io/sdk/client"
	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	"google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/reflection"

	templatev1 "github.com/drewpayment/orbit/proto/gen/go/idp/template/v1"
	grpcserver "github.com/drewpayment/orbit/services/repository/internal/grpc"
	"github.com/drewpayment/orbit/temporal-workflows/pkg/types"
)

// Config holds service configuration
type Config struct {
	GRPCPort     int
	HTTPPort     int
	TemporalHost string
}

func loadConfig() *Config {
	grpcPort := 50051
	if p := os.Getenv("GRPC_PORT"); p != "" {
		fmt.Sscanf(p, "%d", &grpcPort)
	}

	httpPort := 8081
	if p := os.Getenv("HTTP_PORT"); p != "" {
		fmt.Sscanf(p, "%d", &httpPort)
	}

	temporalHost := os.Getenv("TEMPORAL_HOST")
	if temporalHost == "" {
		temporalHost = "localhost:7233"
	}

	return &Config{
		GRPCPort:     grpcPort,
		HTTPPort:     httpPort,
		TemporalHost: temporalHost,
	}
}

// TemporalClient wraps the Temporal SDK client
type TemporalClient struct {
	client client.Client
}

// NewTemporalClient creates a new Temporal client wrapper
func NewTemporalClient(hostPort string) (*TemporalClient, error) {
	c, err := client.Dial(client.Options{
		HostPort: hostPort,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to connect to Temporal: %w", err)
	}
	return &TemporalClient{client: c}, nil
}

// Close closes the Temporal client
func (tc *TemporalClient) Close() {
	tc.client.Close()
}

// StartTemplateWorkflow starts a template instantiation workflow
func (tc *TemporalClient) StartTemplateWorkflow(ctx context.Context, input interface{}) (string, error) {
	req, ok := input.(*templatev1.StartInstantiationRequest)
	if !ok {
		return "", fmt.Errorf("invalid input type")
	}

	workflowInput := types.TemplateInstantiationInput{
		TemplateID:       req.TemplateId,
		WorkspaceID:      req.WorkspaceId,
		TargetOrg:        req.TargetOrg,
		RepositoryName:   req.RepositoryName,
		Description:      req.Description,
		IsPrivate:        req.IsPrivate,
		Variables:        req.Variables,
		UserID:           req.UserId,
		// Template source info from request
		IsGitHubTemplate: req.IsGithubTemplate,
		SourceRepoOwner:  req.SourceRepoOwner,
		SourceRepoName:   req.SourceRepoName,
		SourceRepoURL:    req.SourceRepoUrl,
		// GitHub authentication
		InstallationID:   req.GithubInstallationId,
	}

	workflowID := fmt.Sprintf("template-instantiation-%s-%d", req.RepositoryName, time.Now().Unix())

	we, err := tc.client.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		ID:        workflowID,
		TaskQueue: "orbit-workflows",
	}, "TemplateInstantiationWorkflow", workflowInput)

	if err != nil {
		return "", fmt.Errorf("failed to start workflow: %w", err)
	}

	return we.GetID(), nil
}

// QueryWorkflow queries a workflow for progress
func (tc *TemporalClient) QueryWorkflow(ctx context.Context, workflowID, queryType string) (interface{}, error) {
	resp, err := tc.client.QueryWorkflow(ctx, workflowID, "", queryType)
	if err != nil {
		return nil, fmt.Errorf("failed to query workflow: %w", err)
	}

	var progress types.InstantiationProgress
	if err := resp.Get(&progress); err != nil {
		return nil, fmt.Errorf("failed to decode progress: %w", err)
	}

	// Convert to map for the server to parse
	return map[string]interface{}{
		"currentStep":     progress.CurrentStep,
		"progressPercent": int32(progress.StepsCurrent * 100 / max(progress.StepsTotal, 1)),
		"status":          getStatusString(progress),
		"message":         progress.Message,
	}, nil
}

func getStatusString(progress types.InstantiationProgress) string {
	if progress.CurrentStep == "completed" {
		return "completed"
	}
	if progress.CurrentStep == "" {
		return "pending"
	}
	return "running"
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// CancelWorkflow cancels a running workflow
func (tc *TemporalClient) CancelWorkflow(ctx context.Context, workflowID string) error {
	return tc.client.CancelWorkflow(ctx, workflowID, "")
}

// StubPayloadClient is a placeholder for Payload CMS operations
// TODO: Implement real Payload client
type StubPayloadClient struct{}

func (s *StubPayloadClient) GetTemplate(ctx context.Context, templateID string) (*grpcserver.TemplateData, error) {
	// TODO: Implement Payload API call
	return &grpcserver.TemplateData{
		ID:          templateID,
		Name:        "Template",
		Description: "A template",
	}, nil
}

func (s *StubPayloadClient) ListWorkspaceInstallations(ctx context.Context, workspaceID string) ([]*grpcserver.InstallationData, error) {
	// TODO: Implement Payload API call
	return []*grpcserver.InstallationData{}, nil
}

func main() {
	log.Println("Starting Orbit Repository gRPC Service...")

	cfg := loadConfig()
	log.Printf("Configuration: gRPC Port=%d, HTTP Port=%d, Temporal=%s", cfg.GRPCPort, cfg.HTTPPort, cfg.TemporalHost)

	// Create Temporal client
	temporalClient, err := NewTemporalClient(cfg.TemporalHost)
	if err != nil {
		log.Printf("Warning: Could not connect to Temporal: %v (template instantiation will not work)", err)
		temporalClient = nil
	} else {
		defer temporalClient.Close()
		log.Println("Connected to Temporal")
	}

	// Create stub Payload client (TODO: implement real client)
	payloadClient := &StubPayloadClient{}

	// Create gRPC server
	grpcSrv := grpc.NewServer()

	// Register TemplateService
	var templateTemporal grpcserver.TemporalClientInterface
	if temporalClient != nil {
		templateTemporal = temporalClient
	}
	templateServer := grpcserver.NewTemplateServer(templateTemporal, payloadClient)
	templatev1.RegisterTemplateServiceServer(grpcSrv, templateServer)
	log.Println("TemplateService registered")

	// Register health check
	healthServer := health.NewServer()
	grpc_health_v1.RegisterHealthServer(grpcSrv, healthServer)
	healthServer.SetServingStatus("", grpc_health_v1.HealthCheckResponse_SERVING)
	log.Println("Health check service registered")

	// Enable reflection
	reflection.Register(grpcSrv)
	log.Println("gRPC reflection enabled")

	// Start gRPC server
	lis, err := net.Listen("tcp", fmt.Sprintf(":%d", cfg.GRPCPort))
	if err != nil {
		log.Fatalf("Failed to listen on port %d: %v", cfg.GRPCPort, err)
	}

	// Start HTTP health server
	go startHTTPServer(cfg.HTTPPort)

	// Start gRPC server
	go func() {
		log.Printf("gRPC server listening on :%d", cfg.GRPCPort)
		if err := grpcSrv.Serve(lis); err != nil {
			log.Fatalf("Failed to serve gRPC: %v", err)
		}
	}()

	// Wait for shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")
	grpcSrv.GracefulStop()
	log.Println("Server stopped")
}

func startHTTPServer(port int) {
	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	mux.HandleFunc("/ready", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("READY"))
	})

	log.Printf("HTTP server listening on :%d", port)
	if err := http.ListenAndServe(fmt.Sprintf(":%d", port), mux); err != nil {
		log.Fatalf("Failed to start HTTP server: %v", err)
	}
}
