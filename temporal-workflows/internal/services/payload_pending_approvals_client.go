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

// PendingApprovalRow is the wire shape of a PendingApprovals row used by
// the worker. The page layer reads through Payload locally.
type PendingApprovalRow struct {
	ID          string `json:"id"`
	WorkspaceID string `json:"workspaceId"`
	WorkflowID  string `json:"workflowId"`
	RunID       string `json:"runId"`
	ApprovalID  string `json:"approvalId"`
	Kind        string `json:"kind"`
	Title       string `json:"title"`
	Status      string `json:"status"`
	CreatedAt   string `json:"createdAt"`
}

// PayloadPendingApprovalsClient mirrors the agent-tools client but for
// the PendingApprovals collection. The worker calls Open when a gate
// opens and Resolve when it closes (commit γ).
type PayloadPendingApprovalsClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	logger     *slog.Logger
}

func NewPayloadPendingApprovalsClient(baseURL, apiKey string, logger *slog.Logger) *PayloadPendingApprovalsClient {
	if logger == nil {
		logger = slog.Default()
	}
	return &PayloadPendingApprovalsClient{
		baseURL:    baseURL,
		apiKey:     apiKey,
		httpClient: &http.Client{Timeout: 10 * time.Second},
		logger:     logger,
	}
}

// OpenInput is the body of POST /api/internal/pending-approvals.
type OpenInput struct {
	WorkspaceID  string         `json:"workspaceId"`
	WorkflowID   string         `json:"workflowId"`
	RunID        string         `json:"runId,omitempty"`
	AgentRunID   string         `json:"agentRunId,omitempty"`
	ApprovalID   string         `json:"approvalId"`
	Kind         string         `json:"kind"`
	Title        string         `json:"title"`
	BodyMarkdown string         `json:"bodyMarkdown,omitempty"`
	Payload      map[string]any `json:"payload,omitempty"`
}

// Open inserts (or finds) a pending row. Idempotent on (workflowId,
// approvalId): the route returns the existing id rather than 409. Returns
// the row id (which the worker can persist on AgentRuns for cross-linking).
func (c *PayloadPendingApprovalsClient) Open(ctx context.Context, in OpenInput) (string, error) {
	if in.WorkspaceID == "" || in.WorkflowID == "" || in.ApprovalID == "" {
		return "", errors.New("pending-approvals open: workspaceId, workflowId, approvalId required")
	}
	body, err := json.Marshal(in)
	if err != nil {
		return "", err
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/internal/pending-approvals", bytes.NewReader(body))
	req.Header.Set("X-API-Key", c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode/100 != 2 {
		return "", fmt.Errorf("pending-approvals open: HTTP %d: %s", resp.StatusCode, string(respBody))
	}
	var out struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(respBody, &out); err != nil {
		return "", err
	}
	return out.ID, nil
}

// ResolveInput is the body of POST /api/internal/pending-approvals/[id]/resolve.
type ResolveInput struct {
	Status         string `json:"status"`               // "resolved" | "aborted"
	Resolution     string `json:"resolution,omitempty"` // "approved" | "rejected"
	ResolvedBy     string `json:"resolvedBy,omitempty"`
	Notes          string `json:"notes,omitempty"`
	ReviewerRounds int    `json:"reviewerRounds,omitempty"`
}

// Resolve flips a row to resolved/aborted. Idempotent — re-posting on a
// closed row is a no-op for the workflow's purposes (the route updates
// timestamps but the activity treats any 2xx as success).
func (c *PayloadPendingApprovalsClient) Resolve(ctx context.Context, id string, in ResolveInput) error {
	if id == "" {
		return errors.New("pending-approvals resolve: id required")
	}
	body, err := json.Marshal(in)
	if err != nil {
		return err
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost,
		c.baseURL+"/api/internal/pending-approvals/"+url.PathEscape(id)+"/resolve",
		bytes.NewReader(body))
	req.Header.Set("X-API-Key", c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("pending-approvals resolve: HTTP %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}
