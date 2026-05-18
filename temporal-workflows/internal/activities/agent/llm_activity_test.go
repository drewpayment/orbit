package agent

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/providers"
)

type fakeProvider struct {
	deltas []providers.Delta
	resp   providers.Response
	err    error
}

func (f *fakeProvider) Name() string { return "fake" }
func (f *fakeProvider) StreamComplete(_ context.Context, _ providers.CompletionRequest, onDelta func(providers.Delta) error) (providers.Response, error) {
	for _, d := range f.deltas {
		if err := onDelta(d); err != nil {
			return providers.Response{}, err
		}
	}
	return f.resp, f.err
}

type fakeLoader struct {
	provider providers.Provider
	summary  ProviderConfigSummary
	err      error
}

func (f *fakeLoader) LoadProvider(_ context.Context, _, _ string) (providers.Provider, ProviderConfigSummary, error) {
	return f.provider, f.summary, f.err
}

type recordingSigniller struct {
	mu   sync.Mutex
	sent []string
	err  error
}

func (r *recordingSigniller) SignalToken(_ context.Context, _, _, _, delta string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.err != nil {
		return r.err
	}
	r.sent = append(r.sent, delta)
	return nil
}

func (r *recordingSigniller) snapshot() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]string, len(r.sent))
	copy(out, r.sent)
	return out
}

func TestLLMNextStep_FlushesByCharCount(t *testing.T) {
	prov := &fakeProvider{
		deltas: []providers.Delta{
			{Kind: providers.DeltaText, Text: "hello "},
			{Kind: providers.DeltaText, Text: "world this is a long delta past 80 chars 1234567890123456789012345678901234567890"},
			{Kind: providers.DeltaStop},
		},
		resp: providers.Response{Text: "hello world this is a long delta past 80 chars 1234567890123456789012345678901234567890", StopReason: "end_turn"},
	}
	loader := &fakeLoader{provider: prov, summary: ProviderConfigSummary{Backend: "fake", Model: "x"}}
	sig := &recordingSigniller{}

	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	a := NewAgentActivities(loader, sig, nil, AgentActivitiesOptions{
		Throttle:   time.Hour, // disable time-based flush
		FlushChars: 50,
	})
	a.clock = func() time.Time { return now }

	res, err := a.LLMNextStep(context.Background(), LLMNextStepInput{
		WorkflowID:  "wf",
		RunID:       "run",
		TurnID:      "turn",
		WorkspaceID: "ws",
		ProviderID:  "prov",
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.StopReason != "end_turn" {
		t.Errorf("stop reason = %q", res.StopReason)
	}
	sent := sig.snapshot()
	if len(sent) < 1 {
		t.Fatalf("expected at least 1 signal, got 0")
	}
	joined := ""
	for _, s := range sent {
		joined += s
	}
	if joined != res.Text {
		t.Errorf("joined signals %q != response text %q", joined, res.Text)
	}
}

func TestLLMNextStep_FlushOnStopAndToolCall(t *testing.T) {
	prov := &fakeProvider{
		deltas: []providers.Delta{
			{Kind: providers.DeltaText, Text: "thinking"},
			{Kind: providers.DeltaToolCallStart, ToolID: "t1", ToolName: "shell_exec"},
			{Kind: providers.DeltaToolCallEnd, ToolID: "t1"},
			{Kind: providers.DeltaStop},
		},
		resp: providers.Response{
			Text:       "thinking",
			StopReason: "tool_use",
			ToolCalls:  []providers.ToolCall{{ID: "t1", Name: "shell_exec", Arguments: map[string]any{"command": "ls"}}},
		},
	}
	loader := &fakeLoader{provider: prov, summary: ProviderConfigSummary{Backend: "fake", Model: "x"}}
	sig := &recordingSigniller{}

	a := NewAgentActivities(loader, sig, nil, AgentActivitiesOptions{Throttle: time.Hour, FlushChars: 1000})
	now := time.Now()
	a.clock = func() time.Time { return now }

	res, err := a.LLMNextStep(context.Background(), LLMNextStepInput{
		WorkflowID: "wf", RunID: "run", TurnID: "turn",
		WorkspaceID: "ws", ProviderID: "prov",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.ToolCalls) != 1 {
		t.Fatalf("expected 1 tool call, got %d", len(res.ToolCalls))
	}
	if got := sig.snapshot(); len(got) != 1 || got[0] != "thinking" {
		t.Errorf("expected one signal 'thinking', got %v", got)
	}
}

func TestLLMNextStep_RequiresWorkspaceAndProvider(t *testing.T) {
	a := NewAgentActivities(&fakeLoader{}, nil, nil, AgentActivitiesOptions{})
	_, err := a.LLMNextStep(context.Background(), LLMNextStepInput{ProviderID: "p"})
	if err == nil {
		t.Error("expected error for empty workspace_id")
	}
	_, err = a.LLMNextStep(context.Background(), LLMNextStepInput{WorkspaceID: "w"})
	if err == nil {
		t.Error("expected error for empty provider_id")
	}
}

type retryableTestErr struct{ retryable bool }

func (e *retryableTestErr) Error() string   { return "test" }
func (e *retryableTestErr) Retryable() bool { return e.retryable }

func TestIsProviderRetryable(t *testing.T) {
	if !isProviderRetryable(errors.New("network glitch")) {
		t.Error("plain errors should be retryable")
	}
	if isProviderRetryable(&retryableTestErr{retryable: false}) {
		t.Error("retryable=false should be non-retryable")
	}
	if !isProviderRetryable(&retryableTestErr{retryable: true}) {
		t.Error("retryable=true should be retryable")
	}
}

func TestLLMNextStep_NoSignillerNoOp(t *testing.T) {
	prov := &fakeProvider{
		deltas: []providers.Delta{{Kind: providers.DeltaText, Text: "ok"}, {Kind: providers.DeltaStop}},
		resp:   providers.Response{Text: "ok"},
	}
	a := NewAgentActivities(&fakeLoader{provider: prov, summary: ProviderConfigSummary{Backend: "fake", Model: "x"}}, nil, nil, AgentActivitiesOptions{})
	_, err := a.LLMNextStep(context.Background(), LLMNextStepInput{
		WorkflowID: "w", RunID: "r", TurnID: "t",
		WorkspaceID: "ws", ProviderID: "p",
	})
	if err != nil {
		t.Fatal(err)
	}
}
