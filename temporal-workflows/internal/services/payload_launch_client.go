package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// PayloadLaunchClientImpl implements activities.PayloadLaunchClient for Payload CMS
type PayloadLaunchClientImpl struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
}

// NewPayloadLaunchClient creates a new PayloadLaunchClient
func NewPayloadLaunchClient(baseURL, apiKey string) *PayloadLaunchClientImpl {
	return &PayloadLaunchClientImpl{
		baseURL: baseURL,
		apiKey:  apiKey,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// UpdateLaunchStatus updates the status of a launch via internal API
func (c *PayloadLaunchClientImpl) UpdateLaunchStatus(ctx context.Context, launchID string, status string, errMsg string) error {
	url := fmt.Sprintf("%s/api/internal/launches/%s/status", c.baseURL, launchID)

	body := map[string]interface{}{
		"status": status,
	}
	if errMsg != "" {
		body["error"] = errMsg
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

// StoreLaunchOutputs stores infrastructure outputs for a launch via internal API
func (c *PayloadLaunchClientImpl) StoreLaunchOutputs(ctx context.Context, launchID string, outputs map[string]interface{}) error {
	url := fmt.Sprintf("%s/api/internal/launches/%s/outputs", c.baseURL, launchID)

	body := map[string]interface{}{
		"outputs": outputs,
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

// GetCloudAccountCredentials retrieves cloud account credentials via internal API
func (c *PayloadLaunchClientImpl) GetCloudAccountCredentials(ctx context.Context, cloudAccountID string) (map[string]interface{}, error) {
	// TODO: Implement when cloud account credential retrieval API is ready
	// For now, return empty credentials — the launches worker handles credentials via env vars
	return map[string]interface{}{}, nil
}
