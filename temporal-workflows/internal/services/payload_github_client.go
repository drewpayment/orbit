package services

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"
)

// PayloadGitHubClient backs the agent's orbit_repo_clone tool. It calls
// orbit-www's internal token endpoints to mint a fresh GitHub App
// installation token for a given workspace + repo owner.
//
// The token returned here is short-lived (Orbit refreshes every 50 min
// via GitHubTokenRefreshWorkflow). The activity layer is responsible
// for projecting it into the sandbox via EnvOverrides on a single Exec
// call and never logging the raw value.
type PayloadGitHubClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	logger     *slog.Logger
}

// NewPayloadGitHubClient constructs the client. baseURL points at
// orbit-www (e.g. http://orbit-www:3000 in docker-compose or
// http://localhost:3000 in `make dev-local`); apiKey is the shared
// ORBIT_INTERNAL_API_KEY.
func NewPayloadGitHubClient(baseURL, apiKey string, logger *slog.Logger) *PayloadGitHubClient {
	if logger == nil {
		logger = slog.Default()
	}
	return &PayloadGitHubClient{
		baseURL:    baseURL,
		apiKey:     apiKey,
		httpClient: &http.Client{Timeout: 15 * time.Second},
		logger:     logger,
	}
}

// InstallationToken is the result of GetInstallationTokenForRepo. Token
// is the raw bearer string — the caller MUST scrub it from any logged
// surfaces (command lines, tool-result payloads, etc.).
type InstallationToken struct {
	Token          string `json:"token"`
	ExpiresAt      string `json:"expiresAt"`
	InstallationID int64  `json:"installationId"`
	AccountLogin   string `json:"accountLogin"`
}

// ErrInstallationNotFound is returned when no active github-installation
// matches the workspace + owner. The agent should surface this back to
// the user (so they can install/grant the GitHub App for that org)
// rather than retry.
var ErrInstallationNotFound = errors.New("no active GitHub installation for owner in this workspace")

// ErrInstallationTokenExpired is returned when the cached installation
// token is past its expiry. Means the token-refresh workflow is stalled
// — surface to the user, do not retry.
var ErrInstallationTokenExpired = errors.New("github installation token expired (refresh workflow may be stalled)")

// GetInstallationTokenForRepo mints (or returns the cached) installation
// token for {workspaceID, owner}. The "repo" name is forwarded for
// audit context only — installation tokens are install-scoped, not
// repo-scoped.
func (c *PayloadGitHubClient) GetInstallationTokenForRepo(ctx context.Context, workspaceID, owner, repo string) (InstallationToken, error) {
	if c.baseURL == "" {
		return InstallationToken{}, errors.New("github client: base URL not configured")
	}
	if workspaceID == "" || owner == "" {
		return InstallationToken{}, errors.New("github client: workspaceID and owner required")
	}

	reqBody := map[string]string{
		"workspaceId": workspaceID,
		"owner":       owner,
	}
	if repo != "" {
		reqBody["repo"] = repo
	}
	buf, err := json.Marshal(reqBody)
	if err != nil {
		return InstallationToken{}, fmt.Errorf("github client: marshal: %w", err)
	}

	u := c.baseURL + "/api/internal/github/token-for-repo"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(buf))
	if err != nil {
		return InstallationToken{}, err
	}
	req.Header.Set("X-API-Key", c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return InstallationToken{}, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))

	switch resp.StatusCode {
	case http.StatusOK:
		var out InstallationToken
		if err := json.Unmarshal(body, &out); err != nil {
			return InstallationToken{}, fmt.Errorf("github client: parse response: %w", err)
		}
		if out.Token == "" {
			return InstallationToken{}, errors.New("github client: empty token in response")
		}
		return out, nil
	case http.StatusNotFound:
		return InstallationToken{}, ErrInstallationNotFound
	case http.StatusGone:
		return InstallationToken{}, ErrInstallationTokenExpired
	default:
		return InstallationToken{}, fmt.Errorf("github client: HTTP %d: %s", resp.StatusCode, string(body))
	}
}
