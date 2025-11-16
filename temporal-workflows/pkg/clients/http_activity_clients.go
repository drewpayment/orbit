package clients

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/drewpayment/orbit/temporal-workflows/internal/workflows"
)

type HTTPActivityClients struct {
	baseURL    string
	httpClient *http.Client
}

func NewHTTPActivityClients(baseURL string) *HTTPActivityClients {
	return &HTTPActivityClients{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// RefreshGitHubInstallationTokenActivity calls the orbit-www API to refresh a GitHub token
func (c *HTTPActivityClients) RefreshGitHubInstallationTokenActivity(
	ctx context.Context,
	installationID string,
) (workflows.RefreshTokenResult, error) {
	url := fmt.Sprintf("%s/api/temporal/activities/refresh-github-token", c.baseURL)

	reqBody := map[string]string{
		"installationId": installationID,
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return workflows.RefreshTokenResult{
			Success:      false,
			ErrorMessage: fmt.Sprintf("failed to marshal request: %v", err),
		}, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(jsonBody))
	if err != nil {
		return workflows.RefreshTokenResult{
			Success:      false,
			ErrorMessage: fmt.Sprintf("failed to create request: %v", err),
		}, err
	}

	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return workflows.RefreshTokenResult{
			Success:      false,
			ErrorMessage: fmt.Sprintf("failed to send request: %v", err),
		}, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return workflows.RefreshTokenResult{
			Success:      false,
			ErrorMessage: fmt.Sprintf("failed to read response: %v", err),
		}, err
	}

	if resp.StatusCode != http.StatusOK {
		return workflows.RefreshTokenResult{
			Success:      false,
			ErrorMessage: fmt.Sprintf("API error: %s", string(body)),
		}, fmt.Errorf("API returned status %d: %s", resp.StatusCode, string(body))
	}

	var result workflows.RefreshTokenResult
	if err := json.Unmarshal(body, &result); err != nil {
		return workflows.RefreshTokenResult{
			Success:      false,
			ErrorMessage: fmt.Sprintf("failed to unmarshal response: %v", err),
		}, err
	}

	return result, nil
}

// UpdateInstallationStatusActivity calls the orbit-www API to update installation status
func (c *HTTPActivityClients) UpdateInstallationStatusActivity(
	ctx context.Context,
	installationID string,
	status string,
	reason string,
) error {
	url := fmt.Sprintf("%s/api/temporal/activities/update-installation-status", c.baseURL)

	reqBody := map[string]string{
		"installationId": installationID,
		"status":         status,
		"reason":         reason,
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(jsonBody))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API returned status %d: %s", resp.StatusCode, string(body))
	}

	return nil
}
