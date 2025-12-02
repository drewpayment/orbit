package grpc

import (
	"context"
	"fmt"
	"log"
	"time"

	"connectrpc.com/connect"
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

// ScheduleClient interface for Temporal schedule operations
type ScheduleClient interface {
	CreateSchedule(ctx context.Context, appID string, config HealthConfig) (string, error)
	DeleteSchedule(ctx context.Context, scheduleID string) error
}

// TemporalScheduleClient implements ScheduleClient using Temporal SDK
type TemporalScheduleClient struct {
	client client.Client
}

// NewTemporalScheduleClient creates a new TemporalScheduleClient
func NewTemporalScheduleClient(c client.Client) *TemporalScheduleClient {
	return &TemporalScheduleClient{client: c}
}

// CreateSchedule creates a Temporal schedule for health checks
func (c *TemporalScheduleClient) CreateSchedule(ctx context.Context, appID string, config HealthConfig) (string, error) {
	scheduleID := fmt.Sprintf("health-check-%s", appID)

	// Delete existing schedule if it exists
	handle := c.client.ScheduleClient().GetHandle(ctx, scheduleID)
	_ = handle.Delete(ctx) // Ignore error if doesn't exist

	// Ensure interval is at least 30 seconds
	interval := config.Interval
	if interval < 30 {
		interval = 60
	}

	// Create new schedule with full workflow input
	_, err := c.client.ScheduleClient().Create(ctx, client.ScheduleOptions{
		ID: scheduleID,
		Spec: client.ScheduleSpec{
			Intervals: []client.ScheduleIntervalSpec{{
				Every: time.Duration(interval) * time.Second,
			}},
		},
		Action: &client.ScheduleWorkflowAction{
			ID:        fmt.Sprintf("health-check-workflow-%s", appID),
			Workflow:  "HealthCheckWorkflow",
			TaskQueue: "orbit-workflows",
			Args: []interface{}{
				map[string]interface{}{
					"appId": appID,
					"healthConfig": map[string]interface{}{
						"url":            config.URL,
						"method":         config.Method,
						"expectedStatus": config.ExpectedStatus,
						"interval":       config.Interval,
						"timeout":        config.Timeout,
					},
				},
			},
		},
	})
	if err != nil {
		return "", fmt.Errorf("failed to create schedule: %w", err)
	}

	return scheduleID, nil
}

// DeleteSchedule deletes a Temporal schedule
func (c *TemporalScheduleClient) DeleteSchedule(ctx context.Context, scheduleID string) error {
	handle := c.client.ScheduleClient().GetHandle(ctx, scheduleID)
	return handle.Delete(ctx)
}

// HealthService implements the HealthService Connect/gRPC service
type HealthService struct {
	healthv1connect.UnimplementedHealthServiceHandler
	scheduleClient ScheduleClient
}

// NewHealthService creates a new HealthService
func NewHealthService(scheduleClient ScheduleClient) *HealthService {
	return &HealthService{
		scheduleClient: scheduleClient,
	}
}

// ManageSchedule creates or updates a health check schedule
func (s *HealthService) ManageSchedule(ctx context.Context, req *connect.Request[healthv1.ManageScheduleRequest]) (*connect.Response[healthv1.ManageScheduleResponse], error) {
	msg := req.Msg
	log.Printf("ManageSchedule called for appId=%s, hasConfig=%v", msg.AppId, msg.HealthConfig != nil)

	if msg.HealthConfig == nil || msg.HealthConfig.Url == "" {
		// No health config - delete schedule if exists
		scheduleID := fmt.Sprintf("health-check-%s", msg.AppId)
		_ = s.scheduleClient.DeleteSchedule(ctx, scheduleID)
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

	log.Printf("Creating schedule for app %s with URL=%s, method=%s, interval=%d",
		msg.AppId, config.URL, config.Method, config.Interval)

	scheduleID, err := s.scheduleClient.CreateSchedule(ctx, msg.AppId, config)
	if err != nil {
		log.Printf("Failed to create schedule: %v", err)
		return connect.NewResponse(&healthv1.ManageScheduleResponse{
			Success: false,
			Error:   err.Error(),
		}), nil
	}

	log.Printf("Created schedule %s for app %s", scheduleID, msg.AppId)
	return connect.NewResponse(&healthv1.ManageScheduleResponse{
		Success:    true,
		ScheduleId: scheduleID,
	}), nil
}

// DeleteSchedule removes a health check schedule
func (s *HealthService) DeleteSchedule(ctx context.Context, req *connect.Request[healthv1.DeleteScheduleRequest]) (*connect.Response[healthv1.DeleteScheduleResponse], error) {
	msg := req.Msg
	log.Printf("DeleteSchedule called for appId=%s", msg.AppId)

	scheduleID := fmt.Sprintf("health-check-%s", msg.AppId)
	err := s.scheduleClient.DeleteSchedule(ctx, scheduleID)
	if err != nil {
		log.Printf("Failed to delete schedule: %v", err)
		return connect.NewResponse(&healthv1.DeleteScheduleResponse{
			Success: false,
			Error:   err.Error(),
		}), nil
	}

	log.Printf("Deleted schedule %s", scheduleID)
	return connect.NewResponse(&healthv1.DeleteScheduleResponse{Success: true}), nil
}
