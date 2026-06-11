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

// AgentToolDoc mirrors the wire shape of an AgentTools row returned by the
// orbit-www internal API.
type AgentToolDoc struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Description     string `json:"description"`
	InputSchemaJSON string `json:"inputSchemaJson"`
	TemplateKind    string `json:"templateKind"`
	TemplateJSON    string `json:"templateJson"`
	Status          string `json:"status"`
}

// PayloadAgentToolsClient talks to the orbit-www internal API for the
// AgentTools collection. The temporal worker uses it to:
//   - GET workspace's approved tools before each LLM step (catalog merge)
//   - POST a new pending registration when register_tool is dispatched
//   - POST resolve once the approval signal arrives
type PayloadAgentToolsClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	logger     *slog.Logger
}

func NewPayloadAgentToolsClient(baseURL, apiKey string, logger *slog.Logger) *PayloadAgentToolsClient {
	if logger == nil {
		logger = slog.Default()
	}
	return &PayloadAgentToolsClient{
		baseURL:    baseURL,
		apiKey:     apiKey,
		httpClient: &http.Client{Timeout: 15 * time.Second},
		logger:     logger,
	}
}

// ListApproved returns every approved AgentTool for the workspace.
func (c *PayloadAgentToolsClient) ListApproved(ctx context.Context, workspaceID string) ([]AgentToolDoc, error) {
	if workspaceID == "" {
		return nil, errors.New("agent tools client: workspace_id required")
	}
	u, err := url.Parse(c.baseURL + "/api/internal/agent-tools")
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("workspace_id", workspaceID)
	q.Set("status", "approved")
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
		return nil, fmt.Errorf("agent tools list: HTTP %d: %s", resp.StatusCode, string(body))
	}
	var out struct {
		Tools []AgentToolDoc `json:"tools"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, err
	}
	return out.Tools, nil
}

// RegisterPendingInput is the body of POST /api/internal/agent-tools.
type RegisterPendingInput struct {
	WorkspaceID     string `json:"workspaceId"`
	Name            string `json:"name"`
	Description     string `json:"description"`
	InputSchemaJSON string `json:"inputSchemaJson,omitempty"`
	TemplateKind    string `json:"templateKind"`
	TemplateJSON    string `json:"templateJson"`
	Reasoning       string `json:"reasoning,omitempty"`
	CreatedByRunID  string `json:"createdByRunId,omitempty"`
}

// ErrToolNameTaken is returned when the (workspace, name) pair is already in
// the registry. Surfaced to the agent so it can pick a different name.
var ErrToolNameTaken = errors.New("agent tool name already registered in this workspace")

// RegisterPending creates a pending row and returns its id.
func (c *PayloadAgentToolsClient) RegisterPending(ctx context.Context, in RegisterPendingInput) (string, error) {
	body, err := json.Marshal(in)
	if err != nil {
		return "", err
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/internal/agent-tools", bytes.NewReader(body))
	req.Header.Set("X-API-Key", c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))

	if resp.StatusCode == http.StatusConflict {
		return "", ErrToolNameTaken
	}
	if resp.StatusCode/100 != 2 {
		return "", fmt.Errorf("register pending: HTTP %d: %s", resp.StatusCode, string(respBody))
	}
	var out struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(respBody, &out); err != nil {
		return "", err
	}
	return out.ID, nil
}

// AgentToolEdits carries reviewer-supplied modifications to a tool
// registration. Empty fields mean "leave the agent's proposal unchanged."
// The orbit-www route validates which fields actually changed and writes
// the version history accordingly.
type AgentToolEdits struct {
	Name            string `json:"name,omitempty"`
	Description     string `json:"description,omitempty"`
	TemplateKind    string `json:"templateKind,omitempty"`
	TemplateJSON    string `json:"templateJson,omitempty"`
	InputSchemaJSON string `json:"inputSchemaJson,omitempty"`
}

// ResolveResult carries the route's response. AgentToolVersionID is
// populated only when an edited row was written. EditedFields lists which
// fields the route observed actually changed.
type ResolveResult struct {
	ID                  string   `json:"id"`
	Status              string   `json:"status"`
	AgentToolVersionID  string   `json:"agentToolVersionId,omitempty"`
	EditedFields        []string `json:"editedFields,omitempty"`
}

// Resolve flips a pending row to approved or rejected. When edits is
// non-nil the route writes an agent_proposed (v1) baseline plus, if any
// field actually changed, a reviewer_edited (v2) row, then patches the
// AgentTools row to the edited values.
func (c *PayloadAgentToolsClient) Resolve(ctx context.Context, id, workspaceID string, approved bool, resolvedBy, reason string, edits *AgentToolEdits) (ResolveResult, error) {
	payload := map[string]any{
		"approved":   approved,
		"resolvedBy": resolvedBy,
		"reason":     reason,
	}
	if workspaceID != "" {
		// The route cross-checks this against the tool's owning workspace
		// and returns 409 on mismatch (tenant isolation on resolve).
		payload["workspaceId"] = workspaceID
	}
	if edits != nil {
		payload["edited"] = true
		payload["editedFields"] = edits
	}
	body, _ := json.Marshal(payload)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost,
		c.baseURL+"/api/internal/agent-tools/"+url.PathEscape(id)+"/resolve",
		bytes.NewReader(body))
	req.Header.Set("X-API-Key", c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return ResolveResult{}, err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode/100 != 2 {
		return ResolveResult{}, fmt.Errorf("resolve agent tool: HTTP %d: %s", resp.StatusCode, string(respBody))
	}
	var out ResolveResult
	if err := json.Unmarshal(respBody, &out); err != nil {
		return ResolveResult{}, fmt.Errorf("resolve agent tool: parse response: %w", err)
	}
	return out, nil
}
