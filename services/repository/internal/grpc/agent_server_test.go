package grpc

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"connectrpc.com/connect"
	enums "go.temporal.io/api/enums/v1"
	"go.temporal.io/api/serviceerror"
	"go.temporal.io/api/workflow/v1"
	"go.temporal.io/api/workflowservice/v1"
	"go.temporal.io/sdk/converter"

	agentv1 "github.com/drewpayment/orbit/proto/gen/go/idp/agent/v1"
	"github.com/drewpayment/orbit/temporal-workflows/pkg/agentcontract"
)

// jsonEncodedValue is a minimal converter.EncodedValue for tests: it holds a
// Go value and Get() copies it into the caller's pointer via a JSON round
// trip (matching the default JSON payload converter's behavior).
type jsonEncodedValue struct{ v any }

func (e jsonEncodedValue) HasValue() bool { return e.v != nil }
func (e jsonEncodedValue) Get(out any) error {
	b, err := json.Marshal(e.v)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, out)
}

// fakeQuerier stubs the workflow-query surface used by StreamAgentEvents /
// GetAgentRun. queryErr (when set) is returned for every QueryWorkflow call;
// otherwise per-queryType values are served (eventsValue / finishedValue).
type fakeQuerier struct {
	queryErr error
	value    converter.EncodedValue // legacy single-value path (NotFound tests)

	eventsValue   any // decoded for QueryEventsSince
	finishedValue any // decoded for QueryHasFinished

	// describeStatus drives the externally-terminated gap test: the status
	// DescribeWorkflowExecution reports. describeErr forces a describe error.
	describeStatus enums.WorkflowExecutionStatus
	describeErr    error
	describeCalls  int
}

func (f *fakeQuerier) QueryWorkflow(_ context.Context, _, _, queryType string, _ ...interface{}) (converter.EncodedValue, error) {
	if f.queryErr != nil {
		return nil, f.queryErr
	}
	switch queryType {
	case agentcontract.QueryEventsSince:
		return jsonEncodedValue{v: f.eventsValue}, nil
	case agentcontract.QueryHasFinished:
		return jsonEncodedValue{v: f.finishedValue}, nil
	}
	return f.value, nil
}

func (f *fakeQuerier) DescribeWorkflowExecution(_ context.Context, _, _ string) (*workflowservice.DescribeWorkflowExecutionResponse, error) {
	f.describeCalls++
	if f.describeErr != nil {
		return nil, f.describeErr
	}
	return &workflowservice.DescribeWorkflowExecutionResponse{
		WorkflowExecutionInfo: &workflow.WorkflowExecutionInfo{Status: f.describeStatus},
	}, nil
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

// Externally-terminated workflow gap: QueryHasFinished returns the internal
// flag (false — `temporal workflow terminate` never sets state.terminated),
// but the execution IS closed. fetchNewEvents must cross-check the actual
// status via DescribeWorkflowExecution and report finished so the stream
// sends done instead of polling a dead run forever.
func TestFetchNewEvents_ExternalTerminationReportsFinished(t *testing.T) {
	fq := &fakeQuerier{
		eventsValue:    []agentcontract.AgentEvent{{Sequence: 1, Kind: "status_update"}},
		finishedValue:  false, // internal flag never flipped
		describeStatus: enums.WORKFLOW_EXECUTION_STATUS_TERMINATED,
	}
	s := &AgentServer{querier: fq}
	events, finished, err := s.fetchNewEvents(context.Background(), "agent-x", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 {
		t.Errorf("expected events drained before finishing, got %d", len(events))
	}
	if !finished {
		t.Error("expected finished=true for an externally-terminated workflow")
	}
	if fq.describeCalls == 0 {
		t.Error("expected DescribeWorkflowExecution cross-check to run")
	}
}

func TestFetchNewEvents_InternalFinishedSkipsDescribe(t *testing.T) {
	fq := &fakeQuerier{
		eventsValue:   []agentcontract.AgentEvent{},
		finishedValue: true, // workflow set its own terminated flag
	}
	s := &AgentServer{querier: fq}
	_, finished, err := s.fetchNewEvents(context.Background(), "agent-x", 0)
	if err != nil {
		t.Fatal(err)
	}
	if !finished {
		t.Error("expected finished=true")
	}
	if fq.describeCalls != 0 {
		t.Error("describe should be skipped when QueryHasFinished already true")
	}
}

func TestFetchNewEvents_RunningStaysUnfinished(t *testing.T) {
	fq := &fakeQuerier{
		eventsValue:    []agentcontract.AgentEvent{},
		finishedValue:  false,
		describeStatus: enums.WORKFLOW_EXECUTION_STATUS_RUNNING,
	}
	s := &AgentServer{querier: fq}
	_, finished, err := s.fetchNewEvents(context.Background(), "agent-x", 0)
	if err != nil {
		t.Fatal(err)
	}
	if finished {
		t.Error("a running workflow must not be reported finished")
	}
}

func TestFetchNewEvents_DescribeErrorKeepsStreaming(t *testing.T) {
	fq := &fakeQuerier{
		eventsValue:   []agentcontract.AgentEvent{},
		finishedValue: false,
		describeErr:   errors.New("temporal unavailable"),
	}
	s := &AgentServer{querier: fq}
	_, finished, err := s.fetchNewEvents(context.Background(), "agent-x", 0)
	if err != nil {
		t.Fatal(err)
	}
	if finished {
		t.Error("a describe error must not prematurely finish the stream")
	}
}

func TestIsClosedExecutionStatus(t *testing.T) {
	closed := []enums.WorkflowExecutionStatus{
		enums.WORKFLOW_EXECUTION_STATUS_COMPLETED,
		enums.WORKFLOW_EXECUTION_STATUS_FAILED,
		enums.WORKFLOW_EXECUTION_STATUS_CANCELED,
		enums.WORKFLOW_EXECUTION_STATUS_TERMINATED,
		enums.WORKFLOW_EXECUTION_STATUS_TIMED_OUT,
	}
	for _, st := range closed {
		if !isClosedExecutionStatus(st) {
			t.Errorf("status %v should be closed", st)
		}
	}
	notClosed := []enums.WorkflowExecutionStatus{
		enums.WORKFLOW_EXECUTION_STATUS_UNSPECIFIED,
		enums.WORKFLOW_EXECUTION_STATUS_RUNNING,
		enums.WORKFLOW_EXECUTION_STATUS_CONTINUED_AS_NEW,
	}
	for _, st := range notClosed {
		if isClosedExecutionStatus(st) {
			t.Errorf("status %v should NOT be closed", st)
		}
	}
}

var _ = agentcontract.QuerySnapshot
