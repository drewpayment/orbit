package grpc

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	healthv1 "github.com/drewpayment/orbit/proto/gen/go/idp/health/v1"
)

type mockScheduleClient struct {
	createCalled bool
	deleteCalled bool
	scheduleID   string
}

func (m *mockScheduleClient) CreateSchedule(ctx context.Context, appID string, interval int) (string, error) {
	m.createCalled = true
	m.scheduleID = "health-check-" + appID
	return m.scheduleID, nil
}

func (m *mockScheduleClient) DeleteSchedule(ctx context.Context, scheduleID string) error {
	m.deleteCalled = true
	return nil
}

func TestManageSchedule_Create(t *testing.T) {
	mockClient := &mockScheduleClient{}
	service := NewHealthService(mockClient)

	req := &healthv1.ManageScheduleRequest{
		AppId: "test-app",
		HealthConfig: &healthv1.HealthConfig{
			Url:            "https://example.com/health",
			Method:         "GET",
			ExpectedStatus: 200,
			Interval:       60,
			Timeout:        10,
		},
	}

	resp, err := service.ManageSchedule(context.Background(), req)

	require.NoError(t, err)
	assert.True(t, resp.Success)
	assert.Equal(t, "health-check-test-app", resp.ScheduleId)
	assert.True(t, mockClient.createCalled)
}

func TestManageSchedule_Delete(t *testing.T) {
	mockClient := &mockScheduleClient{}
	service := NewHealthService(mockClient)

	// Request with empty URL should delete the schedule
	req := &healthv1.ManageScheduleRequest{
		AppId:        "test-app",
		HealthConfig: &healthv1.HealthConfig{}, // Empty config
	}

	resp, err := service.ManageSchedule(context.Background(), req)

	require.NoError(t, err)
	assert.True(t, resp.Success)
	assert.True(t, mockClient.deleteCalled)
}

func TestManageSchedule_NilConfig(t *testing.T) {
	mockClient := &mockScheduleClient{}
	service := NewHealthService(mockClient)

	// Request with nil config should delete the schedule
	req := &healthv1.ManageScheduleRequest{
		AppId:        "test-app",
		HealthConfig: nil,
	}

	resp, err := service.ManageSchedule(context.Background(), req)

	require.NoError(t, err)
	assert.True(t, resp.Success)
	assert.True(t, mockClient.deleteCalled)
}

func TestDeleteSchedule(t *testing.T) {
	mockClient := &mockScheduleClient{}
	service := NewHealthService(mockClient)

	req := &healthv1.DeleteScheduleRequest{
		AppId: "test-app",
	}

	resp, err := service.DeleteSchedule(context.Background(), req)

	require.NoError(t, err)
	assert.True(t, resp.Success)
	assert.True(t, mockClient.deleteCalled)
}

func TestManageSchedule_DefaultInterval(t *testing.T) {
	mockClient := &mockScheduleClient{}
	service := NewHealthService(mockClient)

	// Request with interval < 30 should default to 60
	req := &healthv1.ManageScheduleRequest{
		AppId: "test-app",
		HealthConfig: &healthv1.HealthConfig{
			Url:            "https://example.com/health",
			Method:         "GET",
			ExpectedStatus: 200,
			Interval:       10, // Too low, should default to 60
			Timeout:        10,
		},
	}

	resp, err := service.ManageSchedule(context.Background(), req)

	require.NoError(t, err)
	assert.True(t, resp.Success)
	assert.True(t, mockClient.createCalled)
}
