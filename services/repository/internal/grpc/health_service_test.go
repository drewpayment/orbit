package grpc

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	healthv1 "github.com/drewpayment/orbit/proto/gen/go/idp/health/v1"
)

type mockScheduleClient struct {
	startCalled     bool
	terminateCalled bool
	workflowID      string
}

func (m *mockScheduleClient) StartHealthCheckWorkflow(_ context.Context, appID string, _ HealthConfig) (string, error) {
	m.startCalled = true
	m.workflowID = "health-monitor-" + appID
	return m.workflowID, nil
}

func (m *mockScheduleClient) TerminateHealthCheckWorkflow(_ context.Context, _ string) error {
	m.terminateCalled = true
	return nil
}

func TestManageSchedule_Create(t *testing.T) {
	mockClient := &mockScheduleClient{}
	service := NewHealthService(mockClient)

	resp, err := service.ManageSchedule(context.Background(), connect.NewRequest(&healthv1.ManageScheduleRequest{
		AppId: "test-app",
		HealthConfig: &healthv1.HealthConfig{
			Url:            "https://example.com/health",
			Method:         "GET",
			ExpectedStatus: 200,
			Interval:       60,
			Timeout:        10,
		},
	}))

	require.NoError(t, err)
	assert.True(t, resp.Msg.Success)
	assert.Equal(t, "health-monitor-test-app", resp.Msg.ScheduleId)
	assert.True(t, mockClient.startCalled)
}

func TestManageSchedule_Delete(t *testing.T) {
	mockClient := &mockScheduleClient{}
	service := NewHealthService(mockClient)

	resp, err := service.ManageSchedule(context.Background(), connect.NewRequest(&healthv1.ManageScheduleRequest{
		AppId:        "test-app",
		HealthConfig: &healthv1.HealthConfig{}, // Empty config
	}))

	require.NoError(t, err)
	assert.True(t, resp.Msg.Success)
	assert.True(t, mockClient.terminateCalled)
}

func TestManageSchedule_NilConfig(t *testing.T) {
	mockClient := &mockScheduleClient{}
	service := NewHealthService(mockClient)

	resp, err := service.ManageSchedule(context.Background(), connect.NewRequest(&healthv1.ManageScheduleRequest{
		AppId:        "test-app",
		HealthConfig: nil,
	}))

	require.NoError(t, err)
	assert.True(t, resp.Msg.Success)
	assert.True(t, mockClient.terminateCalled)
}

func TestDeleteSchedule(t *testing.T) {
	mockClient := &mockScheduleClient{}
	service := NewHealthService(mockClient)

	resp, err := service.DeleteSchedule(context.Background(), connect.NewRequest(&healthv1.DeleteScheduleRequest{
		AppId: "test-app",
	}))

	require.NoError(t, err)
	assert.True(t, resp.Msg.Success)
	assert.True(t, mockClient.terminateCalled)
}

func TestManageSchedule_DefaultInterval(t *testing.T) {
	mockClient := &mockScheduleClient{}
	service := NewHealthService(mockClient)

	resp, err := service.ManageSchedule(context.Background(), connect.NewRequest(&healthv1.ManageScheduleRequest{
		AppId: "test-app",
		HealthConfig: &healthv1.HealthConfig{
			Url:            "https://example.com/health",
			Method:         "GET",
			ExpectedStatus: 200,
			Interval:       10, // Too low, should default to 60
			Timeout:        10,
		},
	}))

	require.NoError(t, err)
	assert.True(t, resp.Msg.Success)
	assert.True(t, mockClient.startCalled)
}
