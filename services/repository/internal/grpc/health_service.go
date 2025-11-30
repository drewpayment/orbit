package grpc

import (
	"context"
	"fmt"
	"time"

	"go.temporal.io/sdk/client"

	healthv1 "github.com/drewpayment/orbit/proto/gen/go/idp/health/v1"
)

// ScheduleClient interface for Temporal schedule operations
type ScheduleClient interface {
	CreateSchedule(ctx context.Context, appID string, interval int) (string, error)
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
func (c *TemporalScheduleClient) CreateSchedule(ctx context.Context, appID string, interval int) (string, error) {
	scheduleID := fmt.Sprintf("health-check-%s", appID)

	// Delete existing schedule if it exists
	handle := c.client.ScheduleClient().GetHandle(ctx, scheduleID)
	_ = handle.Delete(ctx) // Ignore error if doesn't exist

	// Create new schedule
	// Note: We use the workflow name as a string to avoid importing internal packages
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

// HealthService implements the HealthService gRPC service
type HealthService struct {
	healthv1.UnimplementedHealthServiceServer
	scheduleClient ScheduleClient
}

// NewHealthService creates a new HealthService
func NewHealthService(scheduleClient ScheduleClient) *HealthService {
	return &HealthService{
		scheduleClient: scheduleClient,
	}
}

// ManageSchedule creates or updates a health check schedule
func (s *HealthService) ManageSchedule(ctx context.Context, req *healthv1.ManageScheduleRequest) (*healthv1.ManageScheduleResponse, error) {
	if req.HealthConfig == nil || req.HealthConfig.Url == "" {
		// No health config - delete schedule if exists
		scheduleID := fmt.Sprintf("health-check-%s", req.AppId)
		_ = s.scheduleClient.DeleteSchedule(ctx, scheduleID)
		return &healthv1.ManageScheduleResponse{Success: true}, nil
	}

	interval := int(req.HealthConfig.Interval)
	if interval < 30 {
		interval = 60 // Default to 60s
	}

	scheduleID, err := s.scheduleClient.CreateSchedule(ctx, req.AppId, interval)
	if err != nil {
		return &healthv1.ManageScheduleResponse{
			Success: false,
			Error:   err.Error(),
		}, nil
	}

	return &healthv1.ManageScheduleResponse{
		Success:    true,
		ScheduleId: scheduleID,
	}, nil
}

// DeleteSchedule removes a health check schedule
func (s *HealthService) DeleteSchedule(ctx context.Context, req *healthv1.DeleteScheduleRequest) (*healthv1.DeleteScheduleResponse, error) {
	scheduleID := fmt.Sprintf("health-check-%s", req.AppId)
	err := s.scheduleClient.DeleteSchedule(ctx, scheduleID)
	if err != nil {
		return &healthv1.DeleteScheduleResponse{
			Success: false,
			Error:   err.Error(),
		}, nil
	}

	return &healthv1.DeleteScheduleResponse{Success: true}, nil
}
