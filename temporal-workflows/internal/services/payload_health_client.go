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

// HealthConfigSpec is the wire payload for PATCH /api/internal/apps/{id}/health-config.
// Fields mirror the Apps collection's healthConfig group.
type HealthConfigSpec struct {
	URL            string `json:"url"`
	Method         string `json:"method"`
	ExpectedStatus int    `json:"expectedStatus"`
	Interval       int    `json:"interval"`
	Timeout        int    `json:"timeout"`
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

// UpdateAppStatus updates the status field on an App document via internal API
func (c *PayloadHealthClientImpl) UpdateAppStatus(ctx context.Context, appID, status string) error {
	url := fmt.Sprintf("%s/api/internal/apps/%s/status", c.baseURL, appID)

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
		req.Header.Set("X-API-Key", c.apiKey)
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

// UpdateAppHealthConfig sets the healthConfig group on an App via the
// internal API. The Apps.afterChange hook then calls manageSchedule to
// start (or restart, via TERMINATE_IF_RUNNING) the canonical
// HealthCheckWorkflow under the stable id `health-check-{appId}`. See
// GitHub issue #44 — this replaces the agent's separate child-workflow
// spawn so app.status and app.healthConfig stay in sync.
func (c *PayloadHealthClientImpl) UpdateAppHealthConfig(ctx context.Context, appID string, spec HealthConfigSpec) error {
	url := fmt.Sprintf("%s/api/internal/apps/%s/health-config", c.baseURL, appID)

	jsonBody, err := json.Marshal(spec)
	if err != nil {
		return fmt.Errorf("failed to marshal body: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "PATCH", url, bytes.NewReader(jsonBody))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		req.Header.Set("X-API-Key", c.apiKey)
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

// CreateHealthCheck creates a new health check record via internal API
func (c *PayloadHealthClientImpl) CreateHealthCheck(ctx context.Context, appID string, result HealthCheckResult) error {
	url := fmt.Sprintf("%s/api/internal/health-checks", c.baseURL)

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
		req.Header.Set("X-API-Key", c.apiKey)
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
