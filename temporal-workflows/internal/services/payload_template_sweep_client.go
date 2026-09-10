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

// ErrTemplateDefinitionNotFound is returned when a template-definitions id
// doesn't resolve. Distinct from ErrTemplateNotFound, which names the legacy
// v1 `templates` collection PayloadTemplateClient talks to.
var ErrTemplateDefinitionNotFound = errors.New("template definition not found")

// DryRunFixture mirrors one element of a template-definitions doc's
// `fixtures` array.
type DryRunFixture struct {
	ID     string         `json:"id"`
	Name   string         `json:"name"`
	Values map[string]any `json:"values"`
}

// DryRunSweepCandidate is one published template-definition eligible for the
// scheduled re-dry-run sweep (Phase 4 Task G). Fixtures may be empty — the
// sweep workflow logs those rather than skipping them silently.
type DryRunSweepCandidate struct {
	DefinitionID     string          `json:"id"`
	Name             string          `json:"name"`
	WorkspaceID      string          `json:"workspaceId"`
	CurrentVersionID string          `json:"currentVersionId"`
	Fixtures         []DryRunFixture `json:"fixtures"`
}

// TriggerDryRunInput is the body of
// POST /api/internal/template-definitions/{id}/trigger-dry-run.
type TriggerDryRunInput struct {
	TemplateVersionID string         `json:"templateVersionId"`
	Parameters        map[string]any `json:"parameters"`
	Trigger           string         `json:"trigger,omitempty"`
}

// TriggerDryRunResult is the response of
// POST /api/internal/template-definitions/{id}/trigger-dry-run.
type TriggerDryRunResult struct {
	RunID          string          `json:"runId"`
	WorkspaceID    string          `json:"workspaceId"`
	DefinitionJSON json.RawMessage `json:"definitionJson"`
}

// DryRunSweepResultInput is the body of
// POST /api/internal/template-definitions/{id}/dry-run-sweep-result.
type DryRunSweepResultInput struct {
	Failed   bool   `json:"failed"`
	PlanHash string `json:"planHash"`
}

// DryRunSweepResultResponse is the response of
// POST /api/internal/template-definitions/{id}/dry-run-sweep-result.
type DryRunSweepResultResponse struct {
	Status string `json:"status"` // ok | drifted | failed
}

// PayloadTemplateSweepClient talks to the orbit-www internal API for the
// scheduled re-dry-run sweep (Phase 4 Task G): listing sweep-eligible
// definitions, creating+dispatching one dry run, and recording its drift
// outcome. A sibling of PayloadTemplateClient (which talks to the legacy v1
// `templates` collection) — kept separate because these three routes are
// v2 `template-definitions`-specific and unrelated to instantiation.
type PayloadTemplateSweepClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	logger     *slog.Logger
}

func NewPayloadTemplateSweepClient(baseURL, apiKey string, logger *slog.Logger) *PayloadTemplateSweepClient {
	if logger == nil {
		logger = slog.Default()
	}
	return &PayloadTemplateSweepClient{
		baseURL:    baseURL,
		apiKey:     apiKey,
		httpClient: &http.Client{Timeout: 15 * time.Second},
		logger:     logger,
	}
}

func (c *PayloadTemplateSweepClient) newRequest(ctx context.Context, method, path string, body any) (*http.Request, error) {
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-API-Key", c.apiKey)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return req, nil
}

// ListDryRunSweepCandidates calls
// GET {baseURL}/api/internal/template-definitions/dry-run-sweep-candidates.
func (c *PayloadTemplateSweepClient) ListDryRunSweepCandidates(ctx context.Context) ([]DryRunSweepCandidate, error) {
	req, err := c.newRequest(ctx, http.MethodGet, "/api/internal/template-definitions/dry-run-sweep-candidates", nil)
	if err != nil {
		return nil, err
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("list dry-run sweep candidates: HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	var out struct {
		Templates []DryRunSweepCandidate `json:"templates"`
	}
	if err := json.Unmarshal(respBody, &out); err != nil {
		return nil, err
	}
	return out.Templates, nil
}

// TriggerDryRun calls
// POST {baseURL}/api/internal/template-definitions/{definitionID}/trigger-dry-run.
func (c *PayloadTemplateSweepClient) TriggerDryRun(ctx context.Context, definitionID string, in TriggerDryRunInput) (*TriggerDryRunResult, error) {
	if definitionID == "" {
		return nil, errors.New("definition id required")
	}

	req, err := c.newRequest(ctx, http.MethodPost,
		"/api/internal/template-definitions/"+url.PathEscape(definitionID)+"/trigger-dry-run", in)
	if err != nil {
		return nil, err
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode == http.StatusNotFound {
		return nil, ErrTemplateDefinitionNotFound
	}
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("trigger dry run: HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	var out TriggerDryRunResult
	if err := json.Unmarshal(respBody, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// WriteDryRunSweepResult calls
// POST {baseURL}/api/internal/template-definitions/{definitionID}/dry-run-sweep-result.
func (c *PayloadTemplateSweepClient) WriteDryRunSweepResult(ctx context.Context, definitionID string, in DryRunSweepResultInput) (*DryRunSweepResultResponse, error) {
	if definitionID == "" {
		return nil, errors.New("definition id required")
	}

	req, err := c.newRequest(ctx, http.MethodPost,
		"/api/internal/template-definitions/"+url.PathEscape(definitionID)+"/dry-run-sweep-result", in)
	if err != nil {
		return nil, err
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode == http.StatusNotFound {
		return nil, ErrTemplateDefinitionNotFound
	}
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("write dry-run sweep result: HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	var out DryRunSweepResultResponse
	if err := json.Unmarshal(respBody, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
