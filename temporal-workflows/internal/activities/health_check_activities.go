package activities

import (
	"context"
	"fmt"
	"net/http"
	"time"
)

// PerformHealthCheckInput contains parameters for the health check
type PerformHealthCheckInput struct {
	URL            string `json:"url"`
	Method         string `json:"method"`
	ExpectedStatus int    `json:"expectedStatus"`
	Timeout        int    `json:"timeout"`
}

// HealthCheckResult contains the result of a health check
type HealthCheckResult struct {
	Status       string `json:"status"` // healthy, degraded, down
	StatusCode   int    `json:"statusCode"`
	ResponseTime int64  `json:"responseTime"` // milliseconds
	Error        string `json:"error"`
}

// RecordHealthResultInput contains parameters for recording health check results
type RecordHealthResultInput struct {
	AppID  string            `json:"appId"`
	Result HealthCheckResult `json:"result"`
}

// PayloadHealthClient defines the interface for Payload API operations
type PayloadHealthClient interface {
	UpdateAppStatus(ctx context.Context, appID, status string) error
	CreateHealthCheck(ctx context.Context, appID string, result HealthCheckResult) error
}

// HealthCheckActivities holds dependencies for health check activities
type HealthCheckActivities struct {
	payloadClient PayloadHealthClient
}

// NewHealthCheckActivities creates a new instance of HealthCheckActivities
func NewHealthCheckActivities(payloadClient PayloadHealthClient) *HealthCheckActivities {
	return &HealthCheckActivities{
		payloadClient: payloadClient,
	}
}

// PerformHealthCheckActivity performs an HTTP health check
func (a *HealthCheckActivities) PerformHealthCheckActivity(ctx context.Context, input PerformHealthCheckInput) (HealthCheckResult, error) {
	// Set timeout
	timeout := time.Duration(input.Timeout) * time.Second
	if timeout == 0 {
		timeout = 10 * time.Second
	}

	client := &http.Client{
		Timeout: timeout,
	}

	// Create request
	method := input.Method
	if method == "" {
		method = "GET"
	}

	req, err := http.NewRequestWithContext(ctx, method, input.URL, nil)
	if err != nil {
		return HealthCheckResult{
			Status: "down",
			Error:  fmt.Sprintf("failed to create request: %v", err),
		}, nil
	}

	// Perform request and measure time
	start := time.Now()
	resp, err := client.Do(req)
	responseTime := time.Since(start).Milliseconds()

	if err != nil {
		return HealthCheckResult{
			Status:       "down",
			ResponseTime: responseTime,
			Error:        fmt.Sprintf("request failed: %v", err),
		}, nil
	}
	defer resp.Body.Close()

	// Determine status based on response
	expectedStatus := input.ExpectedStatus
	if expectedStatus == 0 {
		expectedStatus = 200
	}

	var status string
	if resp.StatusCode == expectedStatus {
		status = "healthy"
	} else if resp.StatusCode >= 500 {
		status = "down"
	} else {
		status = "degraded"
	}

	return HealthCheckResult{
		Status:       status,
		StatusCode:   resp.StatusCode,
		ResponseTime: responseTime,
	}, nil
}

// RecordHealthResultActivity records the health check result in Payload
func (a *HealthCheckActivities) RecordHealthResultActivity(ctx context.Context, input RecordHealthResultInput) error {
	if a.payloadClient == nil {
		return fmt.Errorf("payload client not configured")
	}

	// Update app status
	if err := a.payloadClient.UpdateAppStatus(ctx, input.AppID, input.Result.Status); err != nil {
		return fmt.Errorf("failed to update app status: %w", err)
	}

	// Create health check record
	if err := a.payloadClient.CreateHealthCheck(ctx, input.AppID, input.Result); err != nil {
		return fmt.Errorf("failed to create health check record: %w", err)
	}

	return nil
}
