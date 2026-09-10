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

// ActionRunLogEntry is one appended log line. The status route appends these to
// the run's existing log array; it never replaces them.
type ActionRunLogEntry struct {
	TS      string `json:"ts,omitempty"`
	Level   string `json:"level,omitempty"` // info | warn | error
	Message string `json:"message"`
}

// ActionRunStep mirrors one element of `action-runs.steps`. The scaffolder
// always sends the full current snapshot of the array, matching the route's
// replace semantics.
type ActionRunStep struct {
	ID         string         `json:"id"`
	Name       string         `json:"name,omitempty"`
	Status     string         `json:"status"` // pending|running|succeeded|failed|skipped
	StartedAt  string         `json:"startedAt,omitempty"`
	FinishedAt string         `json:"finishedAt,omitempty"`
	LogTail    string         `json:"logTail,omitempty"`
	Output     map[string]any `json:"output,omitempty"`
}

// ActionRunStatusInput is the body of POST /api/internal/action-runs/{id}/status.
//
// Every field is optional and the route requires at least one; pointer and
// slice fields are omitted from the wire when unset so a partial update can
// never clobber a field this caller did not mean to touch. Plan is a pointer to
// a slice specifically so a dry run can send an explicit empty plan (a run that
// would change nothing) distinctly from "don't touch the plan".
type ActionRunStatusInput struct {
	Status     *string             `json:"status,omitempty"`
	AppendLogs []ActionRunLogEntry `json:"appendLogs,omitempty"`
	// Outputs is a pointer for the same reason as Plan: a run that produced no
	// outputs must be able to send an empty object and CLEAR the stored value.
	// A plain map would be dropped by omitempty, arriving indistinguishable
	// from "don't touch the outputs".
	Outputs    *map[string]any   `json:"outputs,omitempty"`
	Error      *string           `json:"error,omitempty"`
	WorkflowID *string           `json:"workflowId,omitempty"`
	Entity     *string           `json:"entity,omitempty"`
	Steps      []ActionRunStep   `json:"steps,omitempty"`
	Plan       *[]map[string]any `json:"plan,omitempty"`
}

// IsEmpty reports whether the update would send nothing the route can act on.
func (in ActionRunStatusInput) IsEmpty() bool {
	return in.Status == nil &&
		len(in.AppendLogs) == 0 &&
		in.Outputs == nil &&
		in.Error == nil &&
		in.WorkflowID == nil &&
		in.Entity == nil &&
		in.Steps == nil &&
		in.Plan == nil
}

// ErrActionRunNotFound is returned when an action-run id doesn't resolve.
var ErrActionRunNotFound = errors.New("action run not found")

// PayloadActionRunClient writes run progress back to orbit-www's internal API.
// Mirrors PayloadTemplateClient's shape and conventions.
type PayloadActionRunClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	logger     *slog.Logger
}

// NewPayloadActionRunClient builds a client against orbit-www's base URL.
func NewPayloadActionRunClient(baseURL, apiKey string, logger *slog.Logger) *PayloadActionRunClient {
	if logger == nil {
		logger = slog.Default()
	}
	return &PayloadActionRunClient{
		baseURL:    baseURL,
		apiKey:     apiKey,
		httpClient: &http.Client{Timeout: 15 * time.Second},
		logger:     logger,
	}
}

// WriteStatus calls POST {baseURL}/api/internal/action-runs/{runID}/status.
func (c *PayloadActionRunClient) WriteStatus(ctx context.Context, runID string, in ActionRunStatusInput) error {
	if runID == "" {
		return errors.New("action run id required")
	}
	if in.IsEmpty() {
		return errors.New("nothing to update")
	}

	body, err := json.Marshal(in)
	if err != nil {
		return err
	}

	u := c.baseURL + "/api/internal/action-runs/" + url.PathEscape(runID) + "/status"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("X-API-Key", c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))

	if resp.StatusCode == http.StatusNotFound {
		return ErrActionRunNotFound
	}
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("write action run status: HTTP %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}
