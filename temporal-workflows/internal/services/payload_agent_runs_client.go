package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"time"
)

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
