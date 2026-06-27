package agent

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"go.temporal.io/sdk/temporal"

	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

// AgentEventsClient is the contract the persistence activity depends on.
// services.PayloadAgentEventsClient implements it in production; tests
// substitute a fake.
type AgentEventsClient interface {
	Persist(ctx context.Context, in services.PersistAgentEventsInput) error
}

// AgentEventWire is the workflow-facing shape of one durable event. It
// mirrors services.AgentEventWire but lives in this package so the workflow
// builds batches without importing services directly.
type AgentEventWire struct {
	Sequence  uint64         `json:"sequence"`
	Kind      string         `json:"kind"`
	Payload   map[string]any `json:"payload"`
	EmittedAt string         `json:"emitted_at"` // RFC3339
}

// AgentEventsActivities owns the durable-transcript persistence activity.
// Kept separate from the audit (AgentRuns) group so a degraded events
// backend doesn't take down the status-patch path and vice versa.
type AgentEventsActivities struct {
	client AgentEventsClient
	logger *slog.Logger
}

// NewAgentEventsActivities constructs the group.
func NewAgentEventsActivities(client AgentEventsClient, logger *slog.Logger) *AgentEventsActivities {
	if logger == nil {
		logger = slog.Default()
	}
	return &AgentEventsActivities{client: client, logger: logger}
}

// PersistAgentEventsInput carries one batch of durable events for a run.
type PersistAgentEventsInput struct {
	WorkflowID  string
	WorkspaceID string
	Events      []AgentEventWire
}

// PersistAgentEvents upserts a batch of durable transcript events into the
// orbit-www agent-events collection. Idempotent on (workflowId, sequence):
// continue-as-new replays and Temporal activity retries are safe no-ops.
//
// Error contract:
//   - validation failures and a "dropped" rejection (run not found /
//     workspace mismatch) are returned as NON-retryable application errors
//     so the workflow's flush logic logs once and discards the batch.
//   - any other failure (5xx, network) is returned as a plain (retryable)
//     error so Temporal's retry policy gets a chance before the workflow
//     keeps the buffer for the next flush.
func (a *AgentEventsActivities) PersistAgentEvents(ctx context.Context, in PersistAgentEventsInput) error {
	if in.WorkflowID == "" {
		return temporal.NewNonRetryableApplicationError("workflow_id required", "InvalidInput", nil)
	}
	if in.WorkspaceID == "" {
		return temporal.NewNonRetryableApplicationError("workspace_id required", "InvalidInput", nil)
	}
	if len(in.Events) == 0 {
		return nil
	}

	wire := make([]services.AgentEventWire, 0, len(in.Events))
	for _, e := range in.Events {
		wire = append(wire, services.AgentEventWire{
			Sequence:  e.Sequence,
			Kind:      e.Kind,
			Payload:   e.Payload,
			EmittedAt: e.EmittedAt,
		})
	}

	err := a.client.Persist(ctx, services.PersistAgentEventsInput{
		WorkflowID:  in.WorkflowID,
		WorkspaceID: in.WorkspaceID,
		Events:      wire,
	})
	if err != nil {
		if errors.Is(err, services.ErrAgentEventsDropped) {
			return temporal.NewNonRetryableApplicationError(err.Error(), "AgentEventsDropped", err)
		}
		return fmt.Errorf("persist agent events: %w", err)
	}
	return nil
}
