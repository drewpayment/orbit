package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"go.temporal.io/sdk/client"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"

	"github.com/drewpayment/orbit/proto/gen/go/idp/deployment/v1/deploymentv1connect"
	"github.com/drewpayment/orbit/proto/gen/go/idp/health/v1/healthv1connect"
	templatev1 "github.com/drewpayment/orbit/proto/gen/go/idp/template/v1"
	"github.com/drewpayment/orbit/proto/gen/go/idp/template/v1/templatev1connect"
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

// StartDeploymentWorkflow starts a deployment workflow
func (tc *TemporalClient) StartDeploymentWorkflow(ctx context.Context, input *types.DeploymentWorkflowInput) (string, error) {
	workflowID := fmt.Sprintf("deployment-%s", input.DeploymentID)

	we, err := tc.client.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		ID:        workflowID,
		TaskQueue: "orbit-workflows",
	}, "DeploymentWorkflow", input)

	if err != nil {
		return "", fmt.Errorf("failed to start deployment workflow: %w", err)
	}

	return we.GetID(), nil
}

// QueryDeploymentWorkflow queries a deployment workflow for progress
func (tc *TemporalClient) QueryDeploymentWorkflow(ctx context.Context, workflowID, queryType string) (*types.DeploymentProgress, error) {
	resp, err := tc.client.QueryWorkflow(ctx, workflowID, "", queryType)
	if err != nil {
		return nil, fmt.Errorf("failed to query deployment workflow: %w", err)
	}

	var progress types.DeploymentProgress
	if err := resp.Get(&progress); err != nil {
		return nil, fmt.Errorf("failed to decode deployment progress: %w", err)
	}

	return &progress, nil
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
	log.Println("Starting Orbit Repository Service (Connect + gRPC)...")

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

	// Create HTTP mux for Connect handlers
	mux := http.NewServeMux()

	// Register TemplateService (Connect handler)
	var templateTemporal grpcserver.TemporalClientInterface
	if temporalClient != nil {
		templateTemporal = temporalClient
	}
	templateServer := grpcserver.NewTemplateServer(templateTemporal, payloadClient)
	templatePath, templateHandler := templatev1connect.NewTemplateServiceHandler(templateServer)
	mux.Handle(templatePath, templateHandler)
	log.Println("TemplateService registered (Connect)")

	// Register DeploymentService (Connect handler)
	if temporalClient != nil {
		var deploymentTemporal grpcserver.DeploymentClientInterface = temporalClient
		deploymentServer := grpcserver.NewDeploymentServer(deploymentTemporal)
		deploymentPath, deploymentHandler := deploymentv1connect.NewDeploymentServiceHandler(deploymentServer)
		mux.Handle(deploymentPath, deploymentHandler)
		log.Println("DeploymentService registered (Connect)")
	} else {
		log.Println("DeploymentService not registered (Temporal client unavailable)")
	}

	// Register HealthService (Connect handler)
	if temporalClient != nil {
		temporalScheduleClient := grpcserver.NewTemporalScheduleClient(temporalClient.client)
		healthService := grpcserver.NewHealthService(temporalScheduleClient)
		healthPath, healthHandler := healthv1connect.NewHealthServiceHandler(healthService)
		mux.Handle(healthPath, healthHandler)
		log.Println("HealthService registered (Connect)")
	} else {
		log.Println("HealthService not registered (Temporal client unavailable)")
	}

	// Start HTTP health server on separate port
	go startHTTPServer(cfg.HTTPPort)

	// Create HTTP server with h2c support (HTTP/2 cleartext for gRPC compatibility)
	srv := &http.Server{
		Addr:    fmt.Sprintf(":%d", cfg.GRPCPort),
		Handler: h2c.NewHandler(mux, &http2.Server{}),
	}

	// Start Connect server
	go func() {
		log.Printf("Connect/gRPC server listening on :%d", cfg.GRPCPort)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Failed to serve: %v", err)
		}
	}()

	// Wait for shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
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
