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

// ErrNoDefaultLLMProvider is returned by Create when the route could not
// resolve a single LLM provider for the target workspace, so an `agent:run`
// template step cannot start the infra agent (Phase 4 Task D). Two distinct
// server-side conditions map to it: no provider configured at all
// (NO_LLM_PROVIDER), or more than one with none marked `isDefault`
// (AMBIGUOUS_LLM_PROVIDER) — Create wraps the server's actual message so
// callers see which one occurred, not a generic "no provider" that would be
// misleading for the ambiguous case.
var ErrNoDefaultLLMProvider = errors.New("could not resolve an LLM provider for this workspace")

// PayloadAgentRunsClient PATCHes the orbit-www AgentRuns row for a workflow
// id. Used by the workflow's UpdateAgentRun activity to keep the audit
// trail in sync with live state (status transitions, approval resolutions,
// final summary on done).
type PayloadAgentRunsClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	logger     *slog.Logger
}

// NewPayloadAgentRunsClient constructs the client.
func NewPayloadAgentRunsClient(baseURL, apiKey string, logger *slog.Logger) *PayloadAgentRunsClient {
	if logger == nil {
		logger = slog.Default()
	}
	return &PayloadAgentRunsClient{
		baseURL:    baseURL,
		apiKey:     apiKey,
		httpClient: &http.Client{Timeout: 10 * time.Second},
		logger:     logger,
	}
}

// AgentRunPatch carries partial updates to the row's scalar fields.
type AgentRunPatch struct {
	Status  string `json:"status,omitempty"`
	Summary string `json:"summary,omitempty"`
	EndedAt string `json:"endedAt,omitempty"`
}

// AgentRunApprovalEntry is one row to append to the audit array.
type AgentRunApprovalEntry struct {
	ApprovalID string `json:"approvalId"`
	Kind       string `json:"kind"`
	Title      string `json:"title"`
	Resolution string `json:"resolution"` // "approved" | "rejected"
	ResolvedBy string `json:"resolvedBy,omitempty"`
	ResolvedAt string `json:"resolvedAt,omitempty"`
	Notes      string `json:"notes,omitempty"`
}

// PatchInput is the wire body of PATCH /api/internal/agent-runs/[workflowId].
type PatchInput struct {
	Patch          *AgentRunPatch         `json:"patch,omitempty"`
	AppendApproval *AgentRunApprovalEntry `json:"appendApproval,omitempty"`
}

// Patch applies the update. Returns nil when the row doesn't exist (404)
// since the workflow can outrun the row creation under some startup paths.
// Other 4xx/5xx errors are surfaced as the activity's retryable error.
func (c *PayloadAgentRunsClient) Patch(ctx context.Context, workflowID string, in PatchInput) error {
	if c.baseURL == "" {
		return fmt.Errorf("agent-runs client: base URL not configured")
	}
	if workflowID == "" {
		return fmt.Errorf("agent-runs client: workflow id required")
	}
	body, err := json.Marshal(in)
	if err != nil {
		return err
	}
	u := fmt.Sprintf("%s/api/internal/agent-runs/%s", c.baseURL, url.PathEscape(workflowID))
	req, _ := http.NewRequestWithContext(ctx, http.MethodPatch, u, bytes.NewReader(body))
	req.Header.Set("X-API-Key", c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		// Row not yet written; not an error.
		c.logger.Debug("agent-run patch: row not found", "workflowId", workflowID)
		return nil
	}
	if resp.StatusCode/100 != 2 {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("agent-runs patch: HTTP %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

// CreateAgentRunInput is the body of POST /api/internal/agent-runs.
type CreateAgentRunInput struct {
	WorkspaceID   string `json:"workspaceId"`
	UserID        string `json:"userId,omitempty"`
	WorkflowID    string `json:"workflowId"`
	Title         string `json:"title,omitempty"`
	InitialPrompt string `json:"initialPrompt"`
}

// CreateAgentRunResult is the response of POST /api/internal/agent-runs.
type CreateAgentRunResult struct {
	AgentRunID    string `json:"agentRunId"`
	LLMProviderID string `json:"llmProviderId"`
}

// Create inserts the AgentRuns row for an `agent:run` template step's child
// InfrastructureAgentWorkflow (Phase 4 Task D). Unlike the normal chat UI
// flow, which starts the agent workflow via the AgentService gRPC unary and
// then writes the row from orbit-www itself, ScaffolderWorkflow starts the
// child workflow directly — so it needs a headless way to both create the
// row and resolve which LLM provider to use, since a template step supplies
// neither. Idempotent on workflowId (unique-indexed on the collection): a
// retried activity attempt returns the existing row rather than erroring on
// a duplicate key.
func (c *PayloadAgentRunsClient) Create(ctx context.Context, in CreateAgentRunInput) (CreateAgentRunResult, error) {
	if c.baseURL == "" {
		return CreateAgentRunResult{}, fmt.Errorf("agent-runs client: base URL not configured")
	}
	if in.WorkspaceID == "" || in.WorkflowID == "" || in.InitialPrompt == "" {
		return CreateAgentRunResult{}, errors.New("agent-runs client: workspaceId, workflowId, initialPrompt required")
	}
	body, err := json.Marshal(in)
	if err != nil {
		return CreateAgentRunResult{}, err
	}
	u := fmt.Sprintf("%s/api/internal/agent-runs", c.baseURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(body))
	if err != nil {
		return CreateAgentRunResult{}, err
	}
	req.Header.Set("X-API-Key", c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return CreateAgentRunResult{}, err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode == http.StatusUnprocessableEntity {
		var errBody struct {
			Error string `json:"error"`
			Code  string `json:"code"`
		}
		_ = json.Unmarshal(respBody, &errBody)
		msg := errBody.Error
		if msg == "" {
			msg = string(respBody)
		}
		return CreateAgentRunResult{}, fmt.Errorf("%s: %w", msg, ErrNoDefaultLLMProvider)
	}
	if resp.StatusCode/100 != 2 {
		return CreateAgentRunResult{}, fmt.Errorf("agent-runs create: HTTP %d: %s", resp.StatusCode, string(respBody))
	}
	var out CreateAgentRunResult
	if err := json.Unmarshal(respBody, &out); err != nil {
		return CreateAgentRunResult{}, err
	}
	return out, nil
}
