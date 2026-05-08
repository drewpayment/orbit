package services

import (
	"context"
	"log/slog"

	"go.temporal.io/sdk/client"

	"github.com/drewpayment/orbit/temporal-workflows/pkg/agentcontract"
)

// TemporalToolOutputSigniller pushes shell command stdout / stderr lines
// back to a running InfrastructureAgentWorkflow via a Temporal signal so
// the chat UI can render output progressively. The sandbox activity calls
// SignalToolOutput once per line (with light throttling); the workflow's
// drain goroutine emits a corresponding tool_call_output_chunk event the
// gRPC StreamAgentEvents proxy fans out as SSE.
//
// Real-time output isn't cosmetic — interactive CLIs like
// `az login --use-device-code` print a code+URL then block waiting for the
// user. Without streaming, the user can't see the code until after they've
// already entered it (i.e. never).
type TemporalToolOutputSigniller struct {
	client client.Client
	logger *slog.Logger
}

// NewTemporalToolOutputSigniller wraps a Temporal client for tool-output
// signals.
func NewTemporalToolOutputSigniller(c client.Client, logger *slog.Logger) *TemporalToolOutputSigniller {
	if logger == nil {
		logger = slog.Default()
	}
	return &TemporalToolOutputSigniller{client: c, logger: logger}
}

// SignalToolOutput implements agentactivity.ToolOutputSigniller.
func (s *TemporalToolOutputSigniller) SignalToolOutput(ctx context.Context, workflowID, runID, callID, stream, chunk string) error {
	if chunk == "" || callID == "" {
		return nil
	}
	return s.client.SignalWorkflow(ctx, workflowID, runID, agentcontract.SignalToolOutput, agentcontract.ToolOutputSignalPayload{
		CallID: callID,
		Stream: stream,
		Chunk:  chunk,
	})
}
