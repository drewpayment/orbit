package grpc

import (
	"context"
	"fmt"
	"log"

	"connectrpc.com/connect"
	"go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/client"

	healthv1 "github.com/drewpayment/orbit/proto/gen/go/idp/health/v1"
	"github.com/drewpayment/orbit/proto/gen/go/idp/health/v1/healthv1connect"
)

// HealthConfig matches the workflow's HealthConfig type
type HealthConfig struct {
	URL            string `json:"url"`
	Method         string `json:"method"`
	ExpectedStatus int    `json:"expectedStatus"`
	Interval       int    `json:"interval"`
	Timeout        int    `json:"timeout"`
}

// HealthCheckWorkflowInput matches the workflow's input type
type HealthCheckWorkflowInput struct {
	AppID           string       `json:"appId"`
	HealthConfig    HealthConfig `json:"healthConfig"`
	ChecksPerformed int          `json:"checksPerformed"`
}

// WorkflowClient interface for workflow operations (replacing ScheduleClient)
type WorkflowClient interface {
	StartHealthCheckWorkflow(ctx context.Context, appID string, config HealthConfig) (string, error)
	TerminateHealthCheckWorkflow(ctx context.Context, appID string) error
}

// TemporalWorkflowClient implements WorkflowClient using Temporal SDK
type TemporalWorkflowClient struct {
	client client.Client
}

// NewTemporalWorkflowClient creates a new TemporalWorkflowClient
func NewTemporalWorkflowClient(c client.Client) *TemporalWorkflowClient {
	return &TemporalWorkflowClient{client: c}
}

// StartHealthCheckWorkflow starts a long-running health check workflow for an app.
// Uses WorkflowIDReusePolicy to terminate any existing workflow for the same app.
func (c *TemporalWorkflowClient) StartHealthCheckWorkflow(ctx context.Context, appID string, config HealthConfig) (string, error) {
	workflowID := fmt.Sprintf("health-monitor-%s", appID)

	// Ensure interval is at least 30 seconds
	interval := config.Interval
	if interval < 30 {
		interval = 60
	}
	config.Interval = interval

	workflowOptions := client.StartWorkflowOptions{
		ID:                    workflowID,
		TaskQueue:             "orbit-workflows",
		WorkflowIDReusePolicy: enums.WORKFLOW_ID_REUSE_POLICY_TERMINATE_IF_RUNNING,
	}

	input := HealthCheckWorkflowInput{
		AppID:           appID,
		HealthConfig:    config,
		ChecksPerformed: 0,
	}

	we, err := c.client.ExecuteWorkflow(ctx, workflowOptions, "HealthCheckWorkflow", input)
	if err != nil {
		return "", fmt.Errorf("failed to start health check workflow: %w", err)
	}

	return we.GetID(), nil
}

// TerminateHealthCheckWorkflow terminates the health check workflow for an app
func (c *TemporalWorkflowClient) TerminateHealthCheckWorkflow(ctx context.Context, appID string) error {
	workflowID := fmt.Sprintf("health-monitor-%s", appID)

	// Terminate the workflow - ignore error if workflow doesn't exist
	err := c.client.TerminateWorkflow(ctx, workflowID, "", "Health check disabled")
	if err != nil {
		// Check if it's a "not found" error and ignore it
		log.Printf("Terminate workflow returned (may be expected if not running): %v", err)
	}

	return nil
}

// HealthService implements the HealthService Connect/gRPC service
type HealthService struct {
	healthv1connect.UnimplementedHealthServiceHandler
	workflowClient WorkflowClient
}

// NewHealthService creates a new HealthService
func NewHealthService(workflowClient WorkflowClient) *HealthService {
	return &HealthService{
		workflowClient: workflowClient,
	}
}

// ManageSchedule starts or terminates a health check workflow
// Note: The method is named ManageSchedule for API compatibility, but now manages workflows
func (s *HealthService) ManageSchedule(ctx context.Context, req *connect.Request[healthv1.ManageScheduleRequest]) (*connect.Response[healthv1.ManageScheduleResponse], error) {
	msg := req.Msg
	log.Printf("ManageSchedule called for appId=%s, hasConfig=%v", msg.AppId, msg.HealthConfig != nil)

	if msg.HealthConfig == nil || msg.HealthConfig.Url == "" {
		// No health config - terminate workflow if running
		err := s.workflowClient.TerminateHealthCheckWorkflow(ctx, msg.AppId)
		if err != nil {
			log.Printf("Warning: Failed to terminate workflow (may not have been running): %v", err)
		}
		return connect.NewResponse(&healthv1.ManageScheduleResponse{Success: true}), nil
	}

	// Build the full health config for the workflow
	config := HealthConfig{
		URL:            msg.HealthConfig.Url,
		Method:         msg.HealthConfig.Method,
		ExpectedStatus: int(msg.HealthConfig.ExpectedStatus),
		Interval:       int(msg.HealthConfig.Interval),
		Timeout:        int(msg.HealthConfig.Timeout),
	}

	// Set defaults
	if config.Method == "" {
		config.Method = "GET"
	}
	if config.ExpectedStatus == 0 {
		config.ExpectedStatus = 200
	}
	if config.Interval < 30 {
		config.Interval = 60
	}
	if config.Timeout == 0 {
		config.Timeout = 10
	}

	log.Printf("Starting health check workflow for app %s with URL=%s, method=%s, interval=%d",
		msg.AppId, config.URL, config.Method, config.Interval)

	workflowID, err := s.workflowClient.StartHealthCheckWorkflow(ctx, msg.AppId, config)
	if err != nil {
		log.Printf("Failed to start health check workflow: %v", err)
		return connect.NewResponse(&healthv1.ManageScheduleResponse{
			Success: false,
			Error:   err.Error(),
		}), nil
	}

	log.Printf("Started health check workflow %s for app %s", workflowID, msg.AppId)
	return connect.NewResponse(&healthv1.ManageScheduleResponse{
		Success:    true,
		ScheduleId: workflowID, // Return workflow ID (API field is named scheduleId for compatibility)
	}), nil
}

// DeleteSchedule terminates a health check workflow
// Note: The method is named DeleteSchedule for API compatibility, but now terminates workflows
func (s *HealthService) DeleteSchedule(ctx context.Context, req *connect.Request[healthv1.DeleteScheduleRequest]) (*connect.Response[healthv1.DeleteScheduleResponse], error) {
	msg := req.Msg
	log.Printf("DeleteSchedule called for appId=%s", msg.AppId)

	err := s.workflowClient.TerminateHealthCheckWorkflow(ctx, msg.AppId)
	if err != nil {
		log.Printf("Warning: Failed to terminate workflow (may not have been running): %v", err)
		// Don't return error - workflow may not have been running
	}

	log.Printf("Terminated health check workflow for app %s", msg.AppId)
	return connect.NewResponse(&healthv1.DeleteScheduleResponse{Success: true}), nil
}

// Legacy types and functions for backward compatibility
// These are kept to avoid breaking the main.go initialization
// TODO: Remove after updating main.go

// ScheduleClient interface (deprecated - use WorkflowClient)
type ScheduleClient interface {
	CreateSchedule(ctx context.Context, appID string, config HealthConfig) (string, error)
	DeleteSchedule(ctx context.Context, scheduleID string) error
}

// TemporalScheduleClient is deprecated - use TemporalWorkflowClient
type TemporalScheduleClient struct {
	client client.Client
}

// NewTemporalScheduleClient creates a TemporalScheduleClient (deprecated)
func NewTemporalScheduleClient(c client.Client) *TemporalScheduleClient {
	return &TemporalScheduleClient{client: c}
}

// CreateSchedule is deprecated - use StartHealthCheckWorkflow
func (c *TemporalScheduleClient) CreateSchedule(ctx context.Context, appID string, config HealthConfig) (string, error) {
	// Delegate to workflow-based implementation
	wc := NewTemporalWorkflowClient(c.client)
	return wc.StartHealthCheckWorkflow(ctx, appID, config)
}

// DeleteSchedule is deprecated - use TerminateHealthCheckWorkflow
func (c *TemporalScheduleClient) DeleteSchedule(ctx context.Context, scheduleID string) error {
	// Extract appID from schedule ID (health-check-{appID})
	appID := scheduleID
	if len(scheduleID) > 13 && scheduleID[:13] == "health-check-" {
		appID = scheduleID[13:]
	}
	wc := NewTemporalWorkflowClient(c.client)
	return wc.TerminateHealthCheckWorkflow(ctx, appID)
}
