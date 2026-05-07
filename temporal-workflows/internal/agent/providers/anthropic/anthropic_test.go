package anthropic

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/providers"
)

const sampleStream = `event: message_start
data: {"type":"message_start","message":{"id":"msg_1","role":"assistant","usage":{"input_tokens":17}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello "}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"world"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"shell_exec","input":{}}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"command\":"}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\"ls /\"}"}}

event: content_block_stop
data: {"type":"content_block_stop","index":1}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":42}}

event: message_stop
data: {"type":"message_stop"}

`

func TestStreamComplete_TextAndToolCall(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != "test-key" {
			t.Errorf("expected x-api-key header")
		}
		if r.Header.Get("anthropic-version") == "" {
			t.Errorf("expected anthropic-version header")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(200)
		_, _ = w.Write([]byte(sampleStream))
	}))
	defer srv.Close()

	p, err := New(providers.Config{APIKey: "test-key", BaseURL: srv.URL, Model: "claude-test"})
	if err != nil {
		t.Fatal(err)
	}

	var textDeltas []string
	var toolStartCount, toolEndCount, stopCount int
	var argFragments []string
	resp, err := p.StreamComplete(context.Background(), providers.CompletionRequest{
		Messages: []providers.Message{{Role: providers.RoleUser, Content: "hi"}},
	}, func(d providers.Delta) error {
		switch d.Kind {
		case providers.DeltaText:
			textDeltas = append(textDeltas, d.Text)
		case providers.DeltaToolCallStart:
			toolStartCount++
		case providers.DeltaToolCallArgs:
			argFragments = append(argFragments, d.PartialJSON)
		case providers.DeltaToolCallEnd:
			toolEndCount++
		case providers.DeltaStop:
			stopCount++
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	if got := strings.Join(textDeltas, ""); got != "Hello world" {
		t.Errorf("text deltas joined = %q, want %q", got, "Hello world")
	}
	if resp.Text != "Hello world" {
		t.Errorf("resp.Text = %q, want Hello world", resp.Text)
	}
	if toolStartCount != 1 || toolEndCount != 1 {
		t.Errorf("tool start/end = %d/%d, want 1/1", toolStartCount, toolEndCount)
	}
	if stopCount != 1 {
		t.Errorf("stop count = %d, want 1", stopCount)
	}
	if len(resp.ToolCalls) != 1 {
		t.Fatalf("tool calls = %d, want 1", len(resp.ToolCalls))
	}
	tc := resp.ToolCalls[0]
	if tc.ID != "toolu_1" || tc.Name != "shell_exec" {
		t.Errorf("tool call id/name = %q/%q", tc.ID, tc.Name)
	}
	if cmd, _ := tc.Arguments["command"].(string); cmd != "ls /" {
		t.Errorf("tool call command = %q, want %q", cmd, "ls /")
	}
	if resp.StopReason != "tool_use" {
		t.Errorf("stop_reason = %q, want tool_use", resp.StopReason)
	}
	if resp.Usage.InputTokens != 17 || resp.Usage.OutputTokens != 42 {
		t.Errorf("usage = %+v", resp.Usage)
	}
	if want := strings.Join(argFragments, ""); want != `{"command":"ls /"}` {
		t.Errorf("arg fragments concat = %q", want)
	}
}

func TestStreamComplete_NonRetryableErrorOn401(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
		_, _ = w.Write([]byte(`{"error":{"type":"authentication_error","message":"invalid key"}}`))
	}))
	defer srv.Close()

	p, _ := New(providers.Config{APIKey: "bad", BaseURL: srv.URL, Model: "claude-test"})
	_, err := p.StreamComplete(context.Background(), providers.CompletionRequest{
		Messages: []providers.Message{{Role: providers.RoleUser, Content: "hi"}},
	}, func(providers.Delta) error { return nil })
	if err == nil {
		t.Fatal("expected error")
	}
	apiErr, ok := err.(*APIError)
	if !ok {
		t.Fatalf("err is %T, want *APIError", err)
	}
	if apiErr.Retryable() {
		t.Error("401 should not be retryable")
	}
}

func TestStreamComplete_RetryableOn429(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(429)
	}))
	defer srv.Close()

	p, _ := New(providers.Config{APIKey: "k", BaseURL: srv.URL, Model: "m"})
	_, err := p.StreamComplete(context.Background(), providers.CompletionRequest{}, func(providers.Delta) error { return nil })
	apiErr, ok := err.(*APIError)
	if !ok {
		t.Fatalf("err = %T, want *APIError", err)
	}
	if !apiErr.Retryable() {
		t.Error("429 should be retryable")
	}
}

func TestNew_RequiresAPIKey(t *testing.T) {
	_, err := New(providers.Config{})
	if err == nil {
		t.Fatal("expected error when APIKey is empty")
	}
}
