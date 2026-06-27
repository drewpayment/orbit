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

// ErrAgentEventsDropped signals a non-retryable rejection from the
// agent-events endpoint (404 run-not-found or 409 workspace-mismatch). The
// activity treats it as "log and drop" rather than retrying forever — the
// run row is gone or belongs to another workspace, so the batch can never
// land.
var ErrAgentEventsDropped = errors.New("agent-events batch dropped (run not found or workspace mismatch)")

// AgentEventWire is one durable event in the POST body. Field shapes match
// the orbit-www internal route contract exactly:
//
//	{ sequence, kind, payload, emittedAt }
type AgentEventWire struct {
	Sequence  uint64         `json:"sequence"`
	Kind      string         `json:"kind"`
	Payload   map[string]any `json:"payload"`
	EmittedAt string         `json:"emittedAt"` // RFC3339
}

// PersistAgentEventsInput is the wire body of POST /api/internal/agent-events.
type PersistAgentEventsInput struct {
	WorkflowID  string           `json:"workflowId"`
	WorkspaceID string           `json:"workspaceId"`
	Events      []AgentEventWire `json:"events"`
}

// PayloadAgentEventsClient POSTs durable agent transcript events to the
// orbit-www internal API so Mongo holds the system-of-record replica of the
// chat transcript (survives Temporal retention expiry + continue-as-new).
// Mirrors the PayloadAgentRunsClient X-API-Key HTTP pattern.
type PayloadAgentEventsClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	logger     *slog.Logger
}

// NewPayloadAgentEventsClient constructs the client.
func NewPayloadAgentEventsClient(baseURL, apiKey string, logger *slog.Logger) *PayloadAgentEventsClient {
	if logger == nil {
		logger = slog.Default()
	}
	return &PayloadAgentEventsClient{
		baseURL:    baseURL,
		apiKey:     apiKey,
		httpClient: &http.Client{Timeout: 15 * time.Second},
		logger:     logger,
	}
}

// Persist upserts a batch of events keyed on (workflowId, sequence). The
// route's upsert semantics make replays/retries no-ops. Returns
// ErrAgentEventsDropped on 404/409 (non-retryable); any other non-2xx is a
// plain error the activity surfaces as retryable.
func (c *PayloadAgentEventsClient) Persist(ctx context.Context, in PersistAgentEventsInput) error {
	if c.baseURL == "" {
		return fmt.Errorf("agent-events client: base URL not configured")
	}
	if in.WorkflowID == "" || in.WorkspaceID == "" {
		return fmt.Errorf("agent-events client: workflowId and workspaceId required")
	}
	if len(in.Events) == 0 {
		return nil
	}
	body, err := json.Marshal(in)
	if err != nil {
		return err
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/internal/agent-events", bytes.NewReader(body))
	req.Header.Set("X-API-Key", c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
	switch {
	case resp.StatusCode/100 == 2:
		return nil
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusConflict:
		c.logger.Warn("agent-events batch dropped",
			"workflowId", in.WorkflowID, "status", resp.StatusCode, "body", string(respBody))
		return ErrAgentEventsDropped
	default:
		return fmt.Errorf("agent-events persist: HTTP %d: %s", resp.StatusCode, string(respBody))
	}
}
