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
	updateAppStatusErr       error
	createHealthCheckErr     error
	updateAppHealthConfigErr error
	updateAppStatusCalls     []struct {
		appID  string
		status string
	}
	createHealthCheckCalls []struct {
		appID  string
		result HealthCheckResult
	}
	updateAppHealthConfigCalls []struct {
		appID string
		spec  HealthConfigSpec
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

func (m *mockPayloadHealthClient) UpdateAppHealthConfig(ctx context.Context, appID string, spec HealthConfigSpec) error {
	m.updateAppHealthConfigCalls = append(m.updateAppHealthConfigCalls, struct {
		appID string
		spec  HealthConfigSpec
	}{appID: appID, spec: spec})
	return m.updateAppHealthConfigErr
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

// --- ConfigureAppHealthCheckActivity (GitHub issue #44 — unification) ---

func TestConfigureAppHealthCheck_Success(t *testing.T) {
	mockClient := &mockPayloadHealthClient{}
	a := NewHealthCheckActivities(mockClient)

	input := ConfigureAppHealthCheckInput{
		AppID: "app-123",
		Spec: HealthConfigSpec{
			URL:            "https://app.example.com/healthz",
			Method:         "GET",
			ExpectedStatus: 200,
			Interval:       60,
			Timeout:        10,
		},
	}

	err := a.ConfigureAppHealthCheckActivity(context.Background(), input)
	require.NoError(t, err)

	require.Len(t, mockClient.updateAppHealthConfigCalls, 1)
	call := mockClient.updateAppHealthConfigCalls[0]
	assert.Equal(t, "app-123", call.appID)
	assert.Equal(t, "https://app.example.com/healthz", call.spec.URL)
	assert.Equal(t, "GET", call.spec.Method)
	assert.Equal(t, 200, call.spec.ExpectedStatus)
	assert.Equal(t, 60, call.spec.Interval)
	assert.Equal(t, 10, call.spec.Timeout)
}

func TestConfigureAppHealthCheck_NilClient(t *testing.T) {
	a := NewHealthCheckActivities(nil)
	err := a.ConfigureAppHealthCheckActivity(context.Background(), ConfigureAppHealthCheckInput{
		AppID: "app-1",
		Spec:  HealthConfigSpec{URL: "https://x"},
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "payload client not configured")
}

func TestConfigureAppHealthCheck_RejectsMissingAppID(t *testing.T) {
	a := NewHealthCheckActivities(&mockPayloadHealthClient{})
	err := a.ConfigureAppHealthCheckActivity(context.Background(), ConfigureAppHealthCheckInput{
		AppID: "",
		Spec:  HealthConfigSpec{URL: "https://x"},
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "appId is required")
}

func TestConfigureAppHealthCheck_RejectsMissingURL(t *testing.T) {
	a := NewHealthCheckActivities(&mockPayloadHealthClient{})
	err := a.ConfigureAppHealthCheckActivity(context.Background(), ConfigureAppHealthCheckInput{
		AppID: "app-1",
		Spec:  HealthConfigSpec{},
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "spec.url is required")
}

func TestConfigureAppHealthCheck_PropagatesPayloadError(t *testing.T) {
	mockClient := &mockPayloadHealthClient{
		updateAppHealthConfigErr: errors.New("422 schema validation"),
	}
	a := NewHealthCheckActivities(mockClient)

	err := a.ConfigureAppHealthCheckActivity(context.Background(), ConfigureAppHealthCheckInput{
		AppID: "app-1",
		Spec:  HealthConfigSpec{URL: "https://x", Method: "GET", ExpectedStatus: 200, Interval: 60, Timeout: 10},
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "422 schema validation")
}
