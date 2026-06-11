package grpc

import (
	"context"
	"errors"
	"testing"
	"time"

	"connectrpc.com/connect"
	"go.temporal.io/api/serviceerror"
	"go.temporal.io/sdk/converter"

	agentv1 "github.com/drewpayment/orbit/proto/gen/go/idp/agent/v1"
	"github.com/drewpayment/orbit/temporal-workflows/pkg/agentcontract"
)

// fakeQuerier stubs the workflow-query surface used by StreamAgentEvents /
// GetAgentRun. queryErr (when set) is returned for every QueryWorkflow call.
type fakeQuerier struct {
	queryErr error
	value    converter.EncodedValue
}

func (f *fakeQuerier) QueryWorkflow(_ context.Context, _, _, _ string, _ ...interface{}) (converter.EncodedValue, error) {
	if f.queryErr != nil {
		return nil, f.queryErr
	}
	return f.value, nil
}

func TestIsWorkflowNotFound(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"serviceerror NotFound", serviceerror.NewNotFound("workflow execution not found"), true},
		{"wrapped serviceerror NotFound", errors.New("query events: " + serviceerror.NewNotFound("x").Error()), false},
		{"string workflow not found", errors.New("sql: workflow not found"), true},
		{"unrelated", errors.New("connection refused"), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isWorkflowNotFound(tt.err); got != tt.want {
				t.Errorf("isWorkflowNotFound(%v) = %v, want %v", tt.err, got, tt.want)
			}
		})
	}
}

func TestStreamAgentEvents_NotFoundMapsToCodeNotFound(t *testing.T) {
	s := &AgentServer{querier: &fakeQuerier{queryErr: serviceerror.NewNotFound("workflow not found")}, pollEvery: time.Millisecond}
	err := s.StreamAgentEvents(
		context.Background(),
		connect.NewRequest(&agentv1.StreamAgentEventsRequest{WorkflowId: "agent-gone"}),
		&connect.ServerStream[agentv1.AgentEvent]{},
	)
	if err == nil {
		t.Fatal("expected error")
	}
	if got := connect.CodeOf(err); got != connect.CodeNotFound {
		t.Errorf("code = %v, want CodeNotFound", got)
	}
}

func TestStreamAgentEvents_OtherErrorMapsToCodeInternal(t *testing.T) {
	s := &AgentServer{querier: &fakeQuerier{queryErr: errors.New("temporal unavailable")}, pollEvery: time.Millisecond}
	err := s.StreamAgentEvents(
		context.Background(),
		connect.NewRequest(&agentv1.StreamAgentEventsRequest{WorkflowId: "agent-x"}),
		&connect.ServerStream[agentv1.AgentEvent]{},
	)
	if err == nil {
		t.Fatal("expected error")
	}
	if got := connect.CodeOf(err); got != connect.CodeInternal {
		t.Errorf("code = %v, want CodeInternal", got)
	}
}

func TestGetAgentRun_NotFoundMapsToCodeNotFound(t *testing.T) {
	s := &AgentServer{querier: &fakeQuerier{queryErr: serviceerror.NewNotFound("workflow not found")}}
	_, err := s.GetAgentRun(
		context.Background(),
		connect.NewRequest(&agentv1.GetAgentRunRequest{WorkflowId: "agent-gone"}),
	)
	if err == nil {
		t.Fatal("expected error")
	}
	if got := connect.CodeOf(err); got != connect.CodeNotFound {
		t.Errorf("code = %v, want CodeNotFound", got)
	}
}

func TestGetAgentRun_OtherErrorMapsToCodeInternal(t *testing.T) {
	s := &AgentServer{querier: &fakeQuerier{queryErr: errors.New("boom")}}
	_, err := s.GetAgentRun(
		context.Background(),
		connect.NewRequest(&agentv1.GetAgentRunRequest{WorkflowId: "agent-x"}),
	)
	if err == nil {
		t.Fatal("expected error")
	}
	if got := connect.CodeOf(err); got != connect.CodeInternal {
		t.Errorf("code = %v, want CodeInternal", got)
	}
}

var _ = agentcontract.QuerySnapshot
