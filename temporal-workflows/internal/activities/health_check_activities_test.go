package activities

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPerformHealthCheckActivity_Healthy(t *testing.T) {
	// Setup test server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	activities := NewHealthCheckActivities(nil)

	input := PerformHealthCheckInput{
		URL:            server.URL,
		Method:         "GET",
		ExpectedStatus: 200,
		Timeout:        10,
	}

	result, err := activities.PerformHealthCheckActivity(context.Background(), input)

	require.NoError(t, err)
	assert.Equal(t, "healthy", result.Status)
	assert.Equal(t, 200, result.StatusCode)
	assert.Greater(t, result.ResponseTime, int64(0))
}

func TestPerformHealthCheckActivity_Down(t *testing.T) {
	// Setup test server that returns 500
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	activities := NewHealthCheckActivities(nil)

	input := PerformHealthCheckInput{
		URL:            server.URL,
		Method:         "GET",
		ExpectedStatus: 200,
		Timeout:        10,
	}

	result, err := activities.PerformHealthCheckActivity(context.Background(), input)

	require.NoError(t, err)
	assert.Equal(t, "down", result.Status)
	assert.Equal(t, 500, result.StatusCode)
}

func TestPerformHealthCheckActivity_Degraded(t *testing.T) {
	// Setup test server that returns 404
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	activities := NewHealthCheckActivities(nil)

	input := PerformHealthCheckInput{
		URL:            server.URL,
		Method:         "GET",
		ExpectedStatus: 200,
		Timeout:        10,
	}

	result, err := activities.PerformHealthCheckActivity(context.Background(), input)

	require.NoError(t, err)
	assert.Equal(t, "degraded", result.Status)
	assert.Equal(t, 404, result.StatusCode)
}

// mockPayloadHealthClient is a mock implementation of PayloadHealthClient for testing
type mockPayloadHealthClient struct {
	updateAppStatusErr   error
	createHealthCheckErr error
	updateAppStatusCalls []struct {
		appID  string
		status string
	}
	createHealthCheckCalls []struct {
		appID  string
		result HealthCheckResult
	}
}

func (m *mockPayloadHealthClient) UpdateAppStatus(ctx context.Context, appID, status string) error {
	m.updateAppStatusCalls = append(m.updateAppStatusCalls, struct {
		appID  string
		status string
	}{appID: appID, status: status})
	return m.updateAppStatusErr
}

func (m *mockPayloadHealthClient) CreateHealthCheck(ctx context.Context, appID string, result HealthCheckResult) error {
	m.createHealthCheckCalls = append(m.createHealthCheckCalls, struct {
		appID  string
		result HealthCheckResult
	}{appID: appID, result: result})
	return m.createHealthCheckErr
}

func TestRecordHealthResultActivity_Success(t *testing.T) {
	mockClient := &mockPayloadHealthClient{}
	activities := NewHealthCheckActivities(mockClient)

	input := RecordHealthResultInput{
		AppID: "test-app-123",
		Result: HealthCheckResult{
			Status:       "healthy",
			StatusCode:   200,
			ResponseTime: 150,
		},
	}

	err := activities.RecordHealthResultActivity(context.Background(), input)

	require.NoError(t, err)

	// Verify UpdateAppStatus was called with correct parameters
	require.Len(t, mockClient.updateAppStatusCalls, 1)
	assert.Equal(t, "test-app-123", mockClient.updateAppStatusCalls[0].appID)
	assert.Equal(t, "healthy", mockClient.updateAppStatusCalls[0].status)

	// Verify CreateHealthCheck was called with correct parameters
	require.Len(t, mockClient.createHealthCheckCalls, 1)
	assert.Equal(t, "test-app-123", mockClient.createHealthCheckCalls[0].appID)
	assert.Equal(t, "healthy", mockClient.createHealthCheckCalls[0].result.Status)
	assert.Equal(t, 200, mockClient.createHealthCheckCalls[0].result.StatusCode)
	assert.Equal(t, int64(150), mockClient.createHealthCheckCalls[0].result.ResponseTime)
}

func TestRecordHealthResultActivity_NilClient(t *testing.T) {
	activities := NewHealthCheckActivities(nil)

	input := RecordHealthResultInput{
		AppID: "test-app-123",
		Result: HealthCheckResult{
			Status:       "healthy",
			StatusCode:   200,
			ResponseTime: 150,
		},
	}

	err := activities.RecordHealthResultActivity(context.Background(), input)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "payload client not configured")
}

func TestRecordHealthResultActivity_UpdateAppStatusFailure(t *testing.T) {
	mockClient := &mockPayloadHealthClient{
		updateAppStatusErr: errors.New("failed to update app status"),
	}
	activities := NewHealthCheckActivities(mockClient)

	input := RecordHealthResultInput{
		AppID: "test-app-123",
		Result: HealthCheckResult{
			Status:       "healthy",
			StatusCode:   200,
			ResponseTime: 150,
		},
	}

	err := activities.RecordHealthResultActivity(context.Background(), input)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to update app status")

	// Verify UpdateAppStatus was called
	require.Len(t, mockClient.updateAppStatusCalls, 1)

	// Verify CreateHealthCheck was NOT called because UpdateAppStatus failed
	assert.Len(t, mockClient.createHealthCheckCalls, 0)
}

func TestRecordHealthResultActivity_CreateHealthCheckFailure(t *testing.T) {
	mockClient := &mockPayloadHealthClient{
		createHealthCheckErr: errors.New("failed to create health check"),
	}
	activities := NewHealthCheckActivities(mockClient)

	input := RecordHealthResultInput{
		AppID: "test-app-123",
		Result: HealthCheckResult{
			Status:       "healthy",
			StatusCode:   200,
			ResponseTime: 150,
		},
	}

	err := activities.RecordHealthResultActivity(context.Background(), input)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to create health check record")

	// Verify both methods were called
	require.Len(t, mockClient.updateAppStatusCalls, 1)
	require.Len(t, mockClient.createHealthCheckCalls, 1)
}
