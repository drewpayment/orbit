package services

import (
	"context"
	"log/slog"

	"go.temporal.io/sdk/client"

	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/contract"
)

// TemporalTokenSigniller pushes token-level partial completions back to a
// running InfrastructureAgentWorkflow via a Temporal signal so the gRPC
// streaming proxy can fan it out to chat UIs as SSE.
type TemporalTokenSigniller struct {
	client client.Client
	logger *slog.Logger
}

// NewTemporalTokenSigniller wraps a Temporal client for token-stream signals.
func NewTemporalTokenSigniller(c client.Client, logger *slog.Logger) *TemporalTokenSigniller {
	if logger == nil {
		logger = slog.Default()
	}
	return &TemporalTokenSigniller{client: c, logger: logger}
}

// SignalToken implements agentactivity.TokenSigniller.
func (s *TemporalTokenSigniller) SignalToken(ctx context.Context, workflowID, runID, turnID, delta string) error {
	if delta == "" {
		return nil
	}
	return s.client.SignalWorkflow(ctx, workflowID, runID, contract.SignalTokenStream, contract.TokenStreamSignalPayload{
		TurnID: turnID,
		Delta:  delta,
	})
}
