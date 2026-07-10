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

// PayloadADOConnectionClient backs the agent's orbit_repo_clone tool for
// Azure DevOps apps. It calls orbit-www's internal git-connections token
// endpoint to resolve a connection id into the decrypted credentials and
// coordinates needed to clone an ADO repo.
//
// This is the ADO twin of PayloadGitHubClient: same X-API-Key auth, same
// short-lived-token contract. The token it returns is sensitive — the
// activity layer MUST project it into the sandbox via EnvOverrides on a
// single Exec call and never log the raw value or embed it (bearer mode)
// in a clone URL.
type PayloadADOConnectionClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	logger     *slog.Logger
}

// NewPayloadADOConnectionClient constructs the client. baseURL points at
// orbit-www (ORBIT_API_URL); apiKey is ORBIT_INTERNAL_API_KEY — the same
// origin/secret the GitHub token client uses.
func NewPayloadADOConnectionClient(baseURL, apiKey string, logger *slog.Logger) *PayloadADOConnectionClient {
	if logger == nil {
		logger = slog.Default()
	}
	return &PayloadADOConnectionClient{
		baseURL:    baseURL,
		apiKey:     apiKey,
		httpClient: &http.Client{Timeout: 15 * time.Second},
		logger:     logger,
	}
}

// ADOConnectionToken is the decrypted connection detail returned by the
// /api/internal/git-connections/token route. Token is sensitive — callers
// MUST keep it out of logs, error strings, and clone URLs (bearer mode).
type ADOConnectionToken struct {
	Provider     string `json:"provider"`
	Organization string `json:"organization"`
	// Project is empty when the connection is org-wide (scans all projects).
	// The specific repo's project comes from the app/URL, not this field.
	Project string `json:"project"`
	BaseURL string `json:"baseUrl"`
	// AuthMode is how the token must be presented: "basic-pat" (HTTP Basic,
	// PAT as password) or "bearer" (a short-lived Microsoft Entra access
	// token presented via http.extraheader for service-principal connections).
	AuthMode string `json:"authMode"`
	Token    string `json:"token"`
}

// ErrConnectionNotFound is returned when no git-connections doc matches the
// id (404 from the token route). Surface to the user, do not retry.
var ErrConnectionNotFound = errors.New("git connection not found")

// ErrConnectionNotConfigured is returned when the connection exists but has
// no usable credentials (410 from the token route). Surface, do not retry.
var ErrConnectionNotConfigured = errors.New("git connection has no usable credentials")

// GetConnectionToken resolves a git-connections doc id to its decrypted
// credentials + ADO coordinates. Each call re-reads the connection (no
// caching). The token it returns is sensitive.
func (c *PayloadADOConnectionClient) GetConnectionToken(ctx context.Context, connectionID string) (ADOConnectionToken, error) {
	if c.baseURL == "" {
		return ADOConnectionToken{}, errors.New("ado connection client: base URL not configured")
	}
	if connectionID == "" {
		return ADOConnectionToken{}, errors.New("ado connection client: connectionID required")
	}

	buf, err := json.Marshal(map[string]string{"connectionId": connectionID})
	if err != nil {
		return ADOConnectionToken{}, fmt.Errorf("ado connection client: marshal: %w", err)
	}

	u := c.baseURL + "/api/internal/git-connections/token"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(buf))
	if err != nil {
		return ADOConnectionToken{}, err
	}
	req.Header.Set("X-API-Key", c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return ADOConnectionToken{}, err
	}
	defer resp.Body.Close()
	// The success body carries the token; never echo it into an error string.
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))

	switch resp.StatusCode {
	case http.StatusOK:
		var out ADOConnectionToken
		if err := json.Unmarshal(body, &out); err != nil {
			return ADOConnectionToken{}, fmt.Errorf("ado connection client: parse response: %w", err)
		}
		if out.Token == "" {
			return ADOConnectionToken{}, errors.New("ado connection client: empty token in response")
		}
		if out.BaseURL == "" {
			return ADOConnectionToken{}, errors.New("ado connection client: empty baseUrl in response")
		}
		if out.Organization == "" {
			return ADOConnectionToken{}, errors.New("ado connection client: empty organization in response")
		}
		return out, nil
	case http.StatusNotFound:
		return ADOConnectionToken{}, ErrConnectionNotFound
	case http.StatusGone:
		return ADOConnectionToken{}, ErrConnectionNotConfigured
	default:
		// Status only — never risk leaking a token echoed back in the body.
		return ADOConnectionToken{}, fmt.Errorf("ado connection client: HTTP %d", resp.StatusCode)
	}
}
