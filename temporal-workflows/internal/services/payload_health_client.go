package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// HealthCheckResult contains the result of a health check
// This is duplicated from activities to avoid circular dependency
type HealthCheckResult struct {
	Status       string `json:"status"` // healthy, degraded, down
	StatusCode   int    `json:"statusCode"`
	ResponseTime int64  `json:"responseTime"` // milliseconds
	Error        string `json:"error"`
}

// PayloadHealthClientImpl implements PayloadHealthClient for Payload CMS
type PayloadHealthClientImpl struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
}

// NewPayloadHealthClient creates a new PayloadHealthClient
func NewPayloadHealthClient(baseURL, apiKey string) *PayloadHealthClientImpl {
	return &PayloadHealthClientImpl{
		baseURL: baseURL,
		apiKey:  apiKey,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// UpdateAppStatus updates the status field on an App document
func (c *PayloadHealthClientImpl) UpdateAppStatus(ctx context.Context, appID, status string) error {
	url := fmt.Sprintf("%s/api/apps/%s", c.baseURL, appID)

	body := map[string]interface{}{
		"status": status,
	}
	jsonBody, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("failed to marshal body: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "PATCH", url, bytes.NewReader(jsonBody))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.apiKey))
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	return nil
}

// CreateHealthCheck creates a new health check record
// Accepts any struct with the same fields as HealthCheckResult
func (c *PayloadHealthClientImpl) CreateHealthCheck(ctx context.Context, appID string, result interface{}) error {
	url := fmt.Sprintf("%s/api/health-checks", c.baseURL)

	// Convert result to a map for flexible handling
	// This works with both services.HealthCheckResult and activities.HealthCheckResult
	resultBytes, err := json.Marshal(result)
	if err != nil {
		return fmt.Errorf("failed to marshal result: %w", err)
	}

	var resultMap map[string]interface{}
	if err := json.Unmarshal(resultBytes, &resultMap); err != nil {
		return fmt.Errorf("failed to unmarshal result: %w", err)
	}

	body := map[string]interface{}{
		"app":          appID,
		"status":       resultMap["status"],
		"statusCode":   resultMap["statusCode"],
		"responseTime": resultMap["responseTime"],
		"error":        resultMap["error"],
		"checkedAt":    time.Now().Format(time.RFC3339),
	}
	jsonBody, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("failed to marshal body: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(jsonBody))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.apiKey))
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	return nil
}
