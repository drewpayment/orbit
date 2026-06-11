package services

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAgentEventsClient_PostsContract(t *testing.T) {
	var gotBody PersistAgentEventsInput
	var gotKey string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/internal/agent-events" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		gotKey = r.Header.Get("X-API-Key")
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &gotBody)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"upserted":2}`))
	}))
	defer srv.Close()

	c := NewPayloadAgentEventsClient(srv.URL, "secret-key", nil)
	err := c.Persist(context.Background(), PersistAgentEventsInput{
		WorkflowID:  "agent-1",
		WorkspaceID: "ws-1",
		Events: []AgentEventWire{
			{Sequence: 5, Kind: "conversation_turn", Payload: map[string]any{"role": "assistant"}, EmittedAt: "2026-06-10T00:00:00Z"},
			{Sequence: 6, Kind: "status_update", Payload: map[string]any{"status": "completed"}, EmittedAt: "2026-06-10T00:00:01Z"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if gotKey != "secret-key" {
		t.Errorf("X-API-Key = %q", gotKey)
	}
	if gotBody.WorkflowID != "agent-1" || gotBody.WorkspaceID != "ws-1" {
		t.Errorf("body ids wrong: %+v", gotBody)
	}
	if len(gotBody.Events) != 2 || gotBody.Events[0].Sequence != 5 || gotBody.Events[1].Kind != "status_update" {
		t.Errorf("events wrong: %+v", gotBody.Events)
	}
}

func TestAgentEventsClient_DropsOn404And409(t *testing.T) {
	for _, status := range []int{http.StatusNotFound, http.StatusConflict} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(status)
		}))
		c := NewPayloadAgentEventsClient(srv.URL, "k", nil)
		err := c.Persist(context.Background(), PersistAgentEventsInput{
			WorkflowID: "agent-1", WorkspaceID: "ws-1",
			Events: []AgentEventWire{{Sequence: 1, Kind: "status_update"}},
		})
		if !errors.Is(err, ErrAgentEventsDropped) {
			t.Errorf("status %d: expected ErrAgentEventsDropped, got %v", status, err)
		}
		srv.Close()
	}
}

func TestAgentEventsClient_RetryableOn5xx(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()
	c := NewPayloadAgentEventsClient(srv.URL, "k", nil)
	err := c.Persist(context.Background(), PersistAgentEventsInput{
		WorkflowID: "agent-1", WorkspaceID: "ws-1",
		Events: []AgentEventWire{{Sequence: 1, Kind: "status_update"}},
	})
	if err == nil || errors.Is(err, ErrAgentEventsDropped) {
		t.Errorf("expected retryable error, got %v", err)
	}
}

func TestAgentEventsClient_EmptyEventsNoOp(t *testing.T) {
	called := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	c := NewPayloadAgentEventsClient(srv.URL, "k", nil)
	if err := c.Persist(context.Background(), PersistAgentEventsInput{
		WorkflowID: "agent-1", WorkspaceID: "ws-1",
	}); err != nil {
		t.Fatal(err)
	}
	if called {
		t.Error("expected no HTTP call for empty events")
	}
}

func TestAgentEventsClient_RequiresIDs(t *testing.T) {
	c := NewPayloadAgentEventsClient("http://x", "k", nil)
	if err := c.Persist(context.Background(), PersistAgentEventsInput{WorkspaceID: "ws-1", Events: []AgentEventWire{{Sequence: 1}}}); err == nil {
		t.Error("expected error for missing workflowId")
	}
	if err := c.Persist(context.Background(), PersistAgentEventsInput{WorkflowID: "agent-1", Events: []AgentEventWire{{Sequence: 1}}}); err == nil {
		t.Error("expected error for missing workspaceId")
	}
}
