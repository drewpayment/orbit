package openai_compat

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/providers"
)

const sampleStream = `data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"Hi "}}]}

data: {"choices":[{"index":0,"delta":{"content":"there"}}]}

data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"shell_exec","arguments":""}}]}}]}

data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"command\":"}}]}}]}

data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"ls /\"}"}}]}}]}

data: {"choices":[{"index":0,"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":11,"completion_tokens":22}}

data: [DONE]

`

func TestStreamComplete_TextAndToolCall(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
			t.Errorf("Authorization header = %q", got)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(200)
		_, _ = w.Write([]byte(sampleStream))
	}))
	defer srv.Close()

	p, err := New(providers.Config{APIKey: "test-key", BaseURL: srv.URL, Model: "gpt-test"})
	if err != nil {
		t.Fatal(err)
	}

	var textDeltas []string
	var toolStartCount, toolEndCount, stopCount int
	resp, err := p.StreamComplete(context.Background(), providers.CompletionRequest{
		Messages: []providers.Message{{Role: providers.RoleUser, Content: "hi"}},
	}, func(d providers.Delta) error {
		switch d.Kind {
		case providers.DeltaText:
			textDeltas = append(textDeltas, d.Text)
		case providers.DeltaToolCallStart:
			toolStartCount++
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

	if got := strings.Join(textDeltas, ""); got != "Hi there" {
		t.Errorf("text = %q, want %q", got, "Hi there")
	}
	if resp.Text != "Hi there" {
		t.Errorf("resp.Text = %q", resp.Text)
	}
	if toolStartCount != 1 {
		t.Errorf("tool start = %d, want 1", toolStartCount)
	}
	if toolEndCount != 1 {
		t.Errorf("tool end = %d, want 1", toolEndCount)
	}
	if stopCount != 1 {
		t.Errorf("stop = %d, want 1", stopCount)
	}
	if len(resp.ToolCalls) != 1 {
		t.Fatalf("tool calls = %d, want 1", len(resp.ToolCalls))
	}
	tc := resp.ToolCalls[0]
	if tc.ID != "call_1" || tc.Name != "shell_exec" {
		t.Errorf("tool call id/name = %q/%q", tc.ID, tc.Name)
	}
	if cmd, _ := tc.Arguments["command"].(string); cmd != "ls /" {
		t.Errorf("tool call command = %q, want %q", cmd, "ls /")
	}
	if resp.StopReason != "tool_calls" {
		t.Errorf("stop_reason = %q", resp.StopReason)
	}
	if resp.Usage.InputTokens != 11 || resp.Usage.OutputTokens != 22 {
		t.Errorf("usage = %+v", resp.Usage)
	}
}

func TestStreamComplete_NoAuthHeaderWhenKeyEmpty(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			t.Errorf("expected no Authorization header for empty APIKey")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer srv.Close()

	p, _ := New(providers.Config{BaseURL: srv.URL, Model: "ollama-llama3"})
	_, err := p.StreamComplete(context.Background(), providers.CompletionRequest{
		Messages: []providers.Message{{Role: providers.RoleUser, Content: "hi"}},
	}, func(providers.Delta) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
}

func TestNew_RequiresModel(t *testing.T) {
	_, err := New(providers.Config{APIKey: "k"})
	if err == nil {
		t.Fatal("expected error when Model is empty")
	}
}
