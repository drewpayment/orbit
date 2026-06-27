package agent

import (
	"context"
	"errors"
	"testing"

	"go.temporal.io/sdk/temporal"

	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

type fakeAgentEventsClient struct {
	calls []services.PersistAgentEventsInput
	err   error
}

func (f *fakeAgentEventsClient) Persist(_ context.Context, in services.PersistAgentEventsInput) error {
	f.calls = append(f.calls, in)
	return f.err
}

func sampleEvents() []AgentEventWire {
	return []AgentEventWire{
		{Sequence: 1, Kind: "conversation_turn", Payload: map[string]any{"role": "user"}, EmittedAt: "2026-06-10T00:00:00Z"},
		{Sequence: 2, Kind: "status_update", Payload: map[string]any{"status": "running"}, EmittedAt: "2026-06-10T00:00:01Z"},
	}
}

func TestPersistAgentEvents_HappyPath(t *testing.T) {
	fc := &fakeAgentEventsClient{}
	a := NewAgentEventsActivities(fc, nil)
	err := a.PersistAgentEvents(context.Background(), PersistAgentEventsInput{
		WorkflowID:  "agent-1",
		WorkspaceID: "ws-1",
		Events:      sampleEvents(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(fc.calls) != 1 {
		t.Fatalf("calls = %d", len(fc.calls))
	}
	if fc.calls[0].WorkspaceID != "ws-1" || len(fc.calls[0].Events) != 2 {
		t.Errorf("unexpected call: %+v", fc.calls[0])
	}
	if fc.calls[0].Events[0].Sequence != 1 || fc.calls[0].Events[0].Kind != "conversation_turn" {
		t.Errorf("event mapping wrong: %+v", fc.calls[0].Events[0])
	}
}

func TestPersistAgentEvents_RequiresWorkflowID(t *testing.T) {
	a := NewAgentEventsActivities(&fakeAgentEventsClient{}, nil)
	err := a.PersistAgentEvents(context.Background(), PersistAgentEventsInput{
		WorkspaceID: "ws-1", Events: sampleEvents(),
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestPersistAgentEvents_RequiresWorkspaceID(t *testing.T) {
	a := NewAgentEventsActivities(&fakeAgentEventsClient{}, nil)
	err := a.PersistAgentEvents(context.Background(), PersistAgentEventsInput{
		WorkflowID: "agent-1", Events: sampleEvents(),
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestPersistAgentEvents_EmptyEventsNoOp(t *testing.T) {
	fc := &fakeAgentEventsClient{}
	a := NewAgentEventsActivities(fc, nil)
	if err := a.PersistAgentEvents(context.Background(), PersistAgentEventsInput{
		WorkflowID: "agent-1", WorkspaceID: "ws-1",
	}); err != nil {
		t.Fatal(err)
	}
	if len(fc.calls) != 0 {
		t.Errorf("expected no client call, got %d", len(fc.calls))
	}
}

func TestPersistAgentEvents_DroppedIsNonRetryable(t *testing.T) {
	fc := &fakeAgentEventsClient{err: services.ErrAgentEventsDropped}
	a := NewAgentEventsActivities(fc, nil)
	err := a.PersistAgentEvents(context.Background(), PersistAgentEventsInput{
		WorkflowID: "agent-1", WorkspaceID: "ws-1", Events: sampleEvents(),
	})
	if err == nil {
		t.Fatal("expected error")
	}
	var appErr *temporal.ApplicationError
	if !errors.As(err, &appErr) || !appErr.NonRetryable() {
		t.Errorf("expected non-retryable application error, got %v", err)
	}
}

func TestPersistAgentEvents_OtherErrorIsRetryable(t *testing.T) {
	fc := &fakeAgentEventsClient{err: errors.New("HTTP 503")}
	a := NewAgentEventsActivities(fc, nil)
	err := a.PersistAgentEvents(context.Background(), PersistAgentEventsInput{
		WorkflowID: "agent-1", WorkspaceID: "ws-1", Events: sampleEvents(),
	})
	if err == nil {
		t.Fatal("expected error")
	}
	var appErr *temporal.ApplicationError
	if errors.As(err, &appErr) && appErr.NonRetryable() {
		t.Errorf("expected retryable error, got non-retryable: %v", err)
	}
}
