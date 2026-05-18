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
	"net/url"
	"time"
)

// PatternDoc mirrors the wire shape of a Patterns row returned by the
// orbit-www internal API.
type PatternDoc struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	DisplayName     string `json:"displayName"`
	Description     string `json:"description"`
	Category        string `json:"category"`
	TemplateKind    string `json:"templateKind"`
	TemplateJSON    string `json:"templateJson"`
	InputSchemaJSON string `json:"inputSchemaJson"`
	Status          string `json:"status"`
	CurrentVersion  int    `json:"currentVersion"`
}

// PayloadPatternClient talks to the orbit-www internal API for the
// platform-wide Patterns + PatternVersions collections. The temporal
// worker uses it to:
//   - GET the approved catalog before each agent LLM step (catalog merge)
//   - POST a new pending registration when propose_pattern is dispatched
//   - POST resolve once the approval signal arrives
type PayloadPatternClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	logger     *slog.Logger
}

func NewPayloadPatternClient(baseURL, apiKey string, logger *slog.Logger) *PayloadPatternClient {
	if logger == nil {
		logger = slog.Default()
	}
	return &PayloadPatternClient{
		baseURL:    baseURL,
		apiKey:     apiKey,
		httpClient: &http.Client{Timeout: 15 * time.Second},
		logger:     logger,
	}
}

// ListApproved returns every approved Pattern in the platform-wide
// catalog. Optional category filter narrows by category slug.
func (c *PayloadPatternClient) ListApproved(ctx context.Context, category string) ([]PatternDoc, error) {
	u, err := url.Parse(c.baseURL + "/api/internal/patterns")
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("status", "approved")
	if category != "" {
		q.Set("category", category)
	}
	u.RawQuery = q.Encode()

	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	req.Header.Set("X-API-Key", c.apiKey)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("patterns list: HTTP %d: %s", resp.StatusCode, string(body))
	}
	var out struct {
		Patterns []PatternDoc `json:"patterns"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, err
	}
	return out.Patterns, nil
}

// RegisterPendingPatternInput is the body of POST /api/internal/patterns.
type RegisterPendingPatternInput struct {
	Name            string `json:"name"`
	DisplayName     string `json:"displayName"`
	Description     string `json:"description"`
	Category        string `json:"category"`
	TemplateKind    string `json:"templateKind"`
	TemplateJSON    string `json:"templateJson"`
	InputSchemaJSON string `json:"inputSchemaJson"`
	Reasoning       string `json:"reasoning,omitempty"`
	CreatedByRunID  string `json:"createdByRunId,omitempty"`
	CreatedByUser   string `json:"createdByUser,omitempty"`
}

// ErrPatternNameTaken is returned when a pattern with the proposed name
// already exists. Surfaced to the agent so it can pick a different name.
var ErrPatternNameTaken = errors.New("pattern name already registered")

// RegisterPending creates a pending row and returns its id.
func (c *PayloadPatternClient) RegisterPending(ctx context.Context, in RegisterPendingPatternInput) (string, error) {
	body, err := json.Marshal(in)
	if err != nil {
		return "", err
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/internal/patterns", bytes.NewReader(body))
	req.Header.Set("X-API-Key", c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))

	if resp.StatusCode == http.StatusConflict {
		return "", ErrPatternNameTaken
	}
	if resp.StatusCode/100 != 2 {
		return "", fmt.Errorf("register pending pattern: HTTP %d: %s", resp.StatusCode, string(respBody))
	}
	var out struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(respBody, &out); err != nil {
		return "", err
	}
	return out.ID, nil
}

// PatternEdits carries admin-supplied modifications to a pattern
// registration. Empty fields mean "leave the agent's proposal unchanged."
// The orbit-www route validates which fields actually changed and writes
// the version history accordingly.
type PatternEdits struct {
	Name            string `json:"name,omitempty"`
	DisplayName     string `json:"displayName,omitempty"`
	Description     string `json:"description,omitempty"`
	Category        string `json:"category,omitempty"`
	TemplateKind    string `json:"templateKind,omitempty"`
	TemplateJSON    string `json:"templateJson,omitempty"`
	InputSchemaJSON string `json:"inputSchemaJson,omitempty"`
}

// ResolvePatternResult carries the route's response. PatternVersionID is
// populated only when an edited row was written. EditedFields lists which
// fields the route observed actually changed.
type ResolvePatternResult struct {
	ID               string   `json:"id"`
	Status           string   `json:"status"`
	PatternVersionID string   `json:"patternVersionId,omitempty"`
	EditedFields     []string `json:"editedFields,omitempty"`
}

// Resolve flips a pending row to approved or rejected. When edits is
// non-nil the route writes an agent_proposed (v1) baseline plus, if any
// field actually changed, a reviewer_edited (v2) row, then patches the
// Patterns row to the edited values.
func (c *PayloadPatternClient) Resolve(ctx context.Context, id string, approved bool, resolvedBy, reason string, edits *PatternEdits) (ResolvePatternResult, error) {
	payload := map[string]any{
		"approved":   approved,
		"resolvedBy": resolvedBy,
		"reason":     reason,
	}
	if edits != nil {
		payload["edited"] = true
		payload["editedFields"] = edits
	}
	body, _ := json.Marshal(payload)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost,
		c.baseURL+"/api/internal/patterns/"+url.PathEscape(id)+"/resolve",
		bytes.NewReader(body))
	req.Header.Set("X-API-Key", c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return ResolvePatternResult{}, err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode/100 != 2 {
		return ResolvePatternResult{}, fmt.Errorf("resolve pattern: HTTP %d: %s", resp.StatusCode, string(respBody))
	}
	var out ResolvePatternResult
	if err := json.Unmarshal(respBody, &out); err != nil {
		return ResolvePatternResult{}, fmt.Errorf("resolve pattern: parse response: %w", err)
	}
	return out, nil
}
