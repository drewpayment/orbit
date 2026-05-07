// Package agent contains Temporal activities driving the infrastructure agent
// loop: LLM completion, token-stream signal-back, sandbox execution, etc.
package agent

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"

	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/providers"
)

// ProviderLoader resolves a workspace-scoped LLM provider config (decrypts the
// API key, picks the correct backend, returns a constructed Provider). The
// activity calls this once per invocation and never logs or returns the key.
type ProviderLoader interface {
	LoadProvider(ctx context.Context, workspaceID, providerID string) (providers.Provider, ProviderConfigSummary, error)
}

// ProviderConfigSummary is the non-sensitive subset returned alongside a
// Provider; useful for telemetry and audit.
type ProviderConfigSummary struct {
	Backend string // "anthropic" | "openai_compat"
	Model   string
}

// TokenSigniller pushes token-level partial output back to the parent workflow
// as a signal so chat UIs can render streaming text. Implementations typically
// wrap a Temporal client.SignalWorkflow call.
type TokenSigniller interface {
	SignalToken(ctx context.Context, workflowID, runID, turnID, delta string) error
}

// noopSigniller is the zero-value Signiller used when token-streaming is
// disabled (useful for tests and degraded operation).
type noopSigniller struct{}

func (noopSigniller) SignalToken(context.Context, string, string, string, string) error { return nil }

// LLMNextStepInput is the activity input. WorkflowID/RunID let the activity
// signal back to the right execution; TurnID identifies the in-flight
// assistant turn so the workflow can attribute partial deltas.
type LLMNextStepInput struct {
	WorkflowID  string
	RunID       string
	TurnID      string
	WorkspaceID string
	ProviderID  string

	System    string
	Messages  []providers.Message
	Tools     []providers.ToolSchema
	MaxTokens int
	Temperature float64
}

// LLMNextStepResult is the activity output. The workflow consumes this to
// drive the next iteration of the agent loop.
type LLMNextStepResult struct {
	Text       string
	ToolCalls  []providers.ToolCall
	StopReason string
	Usage      providers.Usage
	Backend    string
	Model      string
}

// AgentActivities groups the agent-related activities. Construct via
// NewAgentActivities and register on a Temporal worker.
type AgentActivities struct {
	loader     ProviderLoader
	signiller  TokenSigniller
	logger     *slog.Logger
	throttle   time.Duration
	flushChars int
	clock      func() time.Time
}

// AgentActivitiesOptions tunes signal-throttling behavior.
type AgentActivitiesOptions struct {
	// Throttle is the minimum interval between token-stream signals.
	// Defaults to 250ms.
	Throttle time.Duration
	// FlushChars forces a signal flush when the buffered delta reaches this
	// length, even if Throttle hasn't elapsed. Defaults to 80.
	FlushChars int
}

// NewAgentActivities constructs the activity struct. signiller may be nil to
// disable token streaming.
func NewAgentActivities(loader ProviderLoader, signiller TokenSigniller, logger *slog.Logger, opts AgentActivitiesOptions) *AgentActivities {
	if signiller == nil {
		signiller = noopSigniller{}
	}
	if logger == nil {
		logger = slog.Default()
	}
	if opts.Throttle <= 0 {
		opts.Throttle = 250 * time.Millisecond
	}
	if opts.FlushChars <= 0 {
		opts.FlushChars = 80
	}
	return &AgentActivities{
		loader:     loader,
		signiller:  signiller,
		logger:     logger,
		throttle:   opts.Throttle,
		flushChars: opts.FlushChars,
		clock:      time.Now,
	}
}

// LLMNextStep executes one LLM completion and returns the next action. It
// streams partial text deltas back to the parent workflow via TokenSigniller.
func (a *AgentActivities) LLMNextStep(ctx context.Context, in LLMNextStepInput) (LLMNextStepResult, error) {
	if in.WorkspaceID == "" {
		return LLMNextStepResult{}, temporal.NewNonRetryableApplicationError("workspace_id is required", "InvalidInput", nil)
	}
	if in.ProviderID == "" {
		return LLMNextStepResult{}, temporal.NewNonRetryableApplicationError("provider_id is required", "InvalidInput", nil)
	}

	provider, summary, err := a.loader.LoadProvider(ctx, in.WorkspaceID, in.ProviderID)
	if err != nil {
		return LLMNextStepResult{}, fmt.Errorf("load provider: %w", err)
	}

	// Heartbeat ticker so long generations don't trip the heartbeat timeout.
	hbStop := make(chan struct{})
	defer close(hbStop)
	go a.heartbeatLoop(ctx, hbStop)

	var (
		buf       strings.Builder
		lastFlush = a.clock()
		flushErr  error
	)

	flush := func() {
		if buf.Len() == 0 {
			return
		}
		if err := a.signiller.SignalToken(ctx, in.WorkflowID, in.RunID, in.TurnID, buf.String()); err != nil {
			flushErr = err
			return
		}
		buf.Reset()
		lastFlush = a.clock()
	}

	resp, err := provider.StreamComplete(ctx, providers.CompletionRequest{
		Model:       summary.Model,
		System:      in.System,
		Messages:    in.Messages,
		Tools:       in.Tools,
		MaxTokens:   in.MaxTokens,
		Temperature: in.Temperature,
	}, func(d providers.Delta) error {
		if flushErr != nil {
			return flushErr
		}
		switch d.Kind {
		case providers.DeltaText:
			buf.WriteString(d.Text)
			if buf.Len() >= a.flushChars || a.clock().Sub(lastFlush) >= a.throttle {
				flush()
			}
		case providers.DeltaStop, providers.DeltaToolCallStart, providers.DeltaToolCallEnd:
			flush()
		}
		return nil
	})
	flush()
	if flushErr != nil {
		a.logger.Warn("token signal failed", "err", flushErr)
	}
	if err != nil {
		if isProviderRetryable(err) {
			return LLMNextStepResult{}, fmt.Errorf("llm completion: %w", err)
		}
		return LLMNextStepResult{}, temporal.NewNonRetryableApplicationError(err.Error(), "LLMNonRetryable", err)
	}

	return LLMNextStepResult{
		Text:       resp.Text,
		ToolCalls:  resp.ToolCalls,
		StopReason: resp.StopReason,
		Usage:      resp.Usage,
		Backend:    summary.Backend,
		Model:      summary.Model,
	}, nil
}

// heartbeatLoop records a heartbeat every 5s so the activity heartbeat timeout
// does not fire during long streaming generations.
func (a *AgentActivities) heartbeatLoop(ctx context.Context, stop <-chan struct{}) {
	t := time.NewTicker(5 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ctx.Done():
			return
		case <-t.C:
			activity.RecordHeartbeat(ctx)
		}
	}
}

// retryableErr is the interface implemented by provider APIError types.
type retryableErr interface {
	error
	Retryable() bool
}

func isProviderRetryable(err error) bool {
	var re retryableErr
	if errors.As(err, &re) {
		return re.Retryable()
	}
	// Network errors and unknowns are retryable by default.
	return true
}
