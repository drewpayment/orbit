package clients

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"go.temporal.io/sdk/temporal"

	"github.com/drewpayment/orbit/temporal-workflows/internal/workflows"
)

// terminalInstallationErrorType marks a refresh failure that a human must fix
// (reconnect). The workflow keys escalation off this error type.
const terminalInstallationErrorType = workflows.TerminalInstallationErrorType

// isTerminalRefreshStatus reports whether an HTTP status from the refresh route
// represents a non-retryable, human-actionable failure.
func isTerminalRefreshStatus(status int) bool {
	switch status {
	case http.StatusBadRequest, // 400 malformed request
		http.StatusUnauthorized,        // 401 bad credentials / deauthorized
		http.StatusNotFound,            // 404 installation gone
		http.StatusUnprocessableEntity: // 422 encryption/config failure
		return true
	default:
		return false
	}
}

type HTTPActivityClients struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
}

func NewHTTPActivityClients(baseURL string) *HTTPActivityClients {
	return NewHTTPActivityClientsWithAuth(baseURL, "")
}

// NewHTTPActivityClientsWithAuth includes the internal API key used by routes
// under /api/internal (e.g. reconciliation).
func NewHTTPActivityClientsWithAuth(baseURL, apiKey string) *HTTPActivityClients {
	return &HTTPActivityClients{
		baseURL: baseURL,
		apiKey:  apiKey,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// GitHubReconcileResult is the summary returned by the reconcile route.
type GitHubReconcileResult struct {
	Checked  int `json:"checked"`
	Started  int `json:"started"`
	Signaled int `json:"signaled"`
	Failed   int `json:"failed"`
}

// ReconcileGitHubInstallationsActivity asks orbit-www to ensure a refresh
// workflow is running for every active installation (the backstop/backfill).
func (c *HTTPActivityClients) ReconcileGitHubInstallationsActivity(ctx context.Context) (GitHubReconcileResult, error) {
	url := fmt.Sprintf("%s/api/internal/github/installations/reconcile", c.baseURL)

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer([]byte("{}")))
	if err != nil {
		return GitHubReconcileResult{}, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return GitHubReconcileResult{}, fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return GitHubReconcileResult{}, fmt.Errorf("failed to read response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return GitHubReconcileResult{}, fmt.Errorf("reconcile returned status %d: %s", resp.StatusCode, string(body))
	}

	var result GitHubReconcileResult
	if err := json.Unmarshal(body, &result); err != nil {
		return GitHubReconcileResult{}, fmt.Errorf("failed to unmarshal response: %w", err)
	}
	return result, nil
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
		errMsg := fmt.Sprintf("API returned status %d: %s", resp.StatusCode, string(body))
		// Terminal HTTP codes (installation gone, bad credentials, encryption failure,
		// bad request) cannot be fixed by retrying. Mark them non-retryable so the
		// workflow escalates the installation to needs_reconnect instead of looping.
		if isTerminalRefreshStatus(resp.StatusCode) {
			return workflows.RefreshTokenResult{
					Success:      false,
					ErrorMessage: errMsg,
				}, temporal.NewNonRetryableApplicationError(
					errMsg, terminalInstallationErrorType, nil,
				)
		}
		return workflows.RefreshTokenResult{
			Success:      false,
			ErrorMessage: errMsg,
		}, fmt.Errorf("%s", errMsg)
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
