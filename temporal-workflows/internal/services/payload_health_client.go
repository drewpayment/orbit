package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// HealthCheckResult is a local type matching activities.HealthCheckResult
// to avoid circular dependency
type HealthCheckResult struct {
	Status       string `json:"status"`
	StatusCode   int    `json:"statusCode"`
	ResponseTime int64  `json:"responseTime"`
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
func (c *PayloadHealthClientImpl) CreateHealthCheck(ctx context.Context, appID string, result HealthCheckResult) error {
	url := fmt.Sprintf("%s/api/health-checks", c.baseURL)

	body := map[string]interface{}{
		"app":          appID,
		"status":       result.Status,
		"statusCode":   result.StatusCode,
		"responseTime": result.ResponseTime,
		"error":        result.Error,
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
