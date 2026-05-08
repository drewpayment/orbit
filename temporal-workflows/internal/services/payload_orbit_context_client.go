package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"time"
)

// PayloadOrbitContextClient backs the agent's orbit_* introspection tools.
// It calls the orbit-www internal API endpoints that return sanitized
// summaries of apps and cloud accounts in a workspace. Credentials are
// never carried over the wire — they reach the sandbox only as env vars
// projected at pod start.
type PayloadOrbitContextClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	logger     *slog.Logger
}

// NewPayloadOrbitContextClient constructs the client.
func NewPayloadOrbitContextClient(baseURL, apiKey string, logger *slog.Logger) *PayloadOrbitContextClient {
	if logger == nil {
		logger = slog.Default()
	}
	return &PayloadOrbitContextClient{
		baseURL:    baseURL,
		apiKey:     apiKey,
		httpClient: &http.Client{Timeout: 15 * time.Second},
		logger:     logger,
	}
}

// AppRepository mirrors the repository sub-shape the apps endpoint returns.
type AppRepository struct {
	URL    string `json:"url"`
	Owner  string `json:"owner"`
	Name   string `json:"name"`
	Branch string `json:"branch"`
}

// AppSummary is what GET /api/internal/workspaces/[id]/apps returns per row.
type AppSummary struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Status      string         `json:"status"`
	Repository  *AppRepository `json:"repository,omitempty"`
}

// AppDetails is what GET /api/internal/workspaces/[id]/apps/[appId] returns.
// healthConfig and buildConfig are intentionally untyped: they're nested
// JSON whose shape varies and the agent treats them as opaque structured
// data to render or feed back into a tool call.
type AppDetails struct {
	ID           string         `json:"id"`
	Name         string         `json:"name"`
	Description  string         `json:"description"`
	Status       string         `json:"status"`
	Repository   *AppRepository `json:"repository,omitempty"`
	HealthConfig map[string]any `json:"healthConfig,omitempty"`
	BuildConfig  map[string]any `json:"buildConfig,omitempty"`
}

// CloudAccountSummary is what GET /api/internal/workspaces/[id]/cloud-accounts
// returns per row. The API endpoint does NOT return credentials — by design.
type CloudAccountSummary struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Provider        string `json:"provider"`
	Region          string `json:"region"`
	Status          string `json:"status"`
	LastValidatedAt string `json:"lastValidatedAt,omitempty"`
}

// ErrAppNotFound is returned when GetApp gets a 404. Surfaced to the agent
// as a non-retryable error so the model can adapt rather than retry.
var ErrAppNotFound = errors.New("app not found in workspace")

// ListApps returns every app in the workspace.
func (c *PayloadOrbitContextClient) ListApps(ctx context.Context, workspaceID string) ([]AppSummary, error) {
	if workspaceID == "" {
		return nil, errors.New("orbit context client: workspace id required")
	}
	u := fmt.Sprintf("%s/api/internal/workspaces/%s/apps", c.baseURL, url.PathEscape(workspaceID))
	body, err := c.do(ctx, u)
	if err != nil {
		return nil, err
	}
	var out struct {
		Apps []AppSummary `json:"apps"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("orbit context client: parse apps: %w", err)
	}
	return out.Apps, nil
}

// GetApp returns the full details of a single app, scoped to the workspace.
// Returns ErrAppNotFound when the app isn't in the workspace (or doesn't
// exist).
func (c *PayloadOrbitContextClient) GetApp(ctx context.Context, workspaceID, appID string) (AppDetails, error) {
	if workspaceID == "" || appID == "" {
		return AppDetails{}, errors.New("orbit context client: workspace id and app id required")
	}
	u := fmt.Sprintf("%s/api/internal/workspaces/%s/apps/%s",
		c.baseURL, url.PathEscape(workspaceID), url.PathEscape(appID))
	body, err := c.do(ctx, u)
	if err != nil {
		if errors.Is(err, errNotFound) {
			return AppDetails{}, ErrAppNotFound
		}
		return AppDetails{}, err
	}
	var out AppDetails
	if err := json.Unmarshal(body, &out); err != nil {
		return AppDetails{}, fmt.Errorf("orbit context client: parse app: %w", err)
	}
	return out, nil
}

// ListCloudAccounts returns every cloud account connected to the workspace.
func (c *PayloadOrbitContextClient) ListCloudAccounts(ctx context.Context, workspaceID string) ([]CloudAccountSummary, error) {
	if workspaceID == "" {
		return nil, errors.New("orbit context client: workspace id required")
	}
	u := fmt.Sprintf("%s/api/internal/workspaces/%s/cloud-accounts", c.baseURL, url.PathEscape(workspaceID))
	body, err := c.do(ctx, u)
	if err != nil {
		return nil, err
	}
	var out struct {
		Accounts []CloudAccountSummary `json:"accounts"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("orbit context client: parse cloud accounts: %w", err)
	}
	return out.Accounts, nil
}

// errNotFound is the sentinel used internally to translate HTTP 404 into
// ErrAppNotFound at the call site that cares.
var errNotFound = errors.New("orbit context client: not found")

// do is the shared GET wrapper — auth header, status check, byte read.
func (c *PayloadOrbitContextClient) do(ctx context.Context, u string) ([]byte, error) {
	if c.baseURL == "" {
		return nil, errors.New("orbit context client: base URL not configured")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-API-Key", c.apiKey)
	req.Header.Set("Accept", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if resp.StatusCode == http.StatusNotFound {
		return nil, errNotFound
	}
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("orbit context client: HTTP %d: %s", resp.StatusCode, string(body))
	}
	return body, nil
}
