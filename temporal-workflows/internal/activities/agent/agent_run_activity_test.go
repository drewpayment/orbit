package agent

import (
	"context"
	"errors"
	"testing"

	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

type fakeAgentRunsClient struct {
	calls []services.PatchInput
	err   error
}

func (f *fakeAgentRunsClient) Patch(_ context.Context, _ string, in services.PatchInput) error {
	f.calls = append(f.calls, in)
	return f.err
}

func TestUpdateAgentRun_Patch(t *testing.T) {
	fc := &fakeAgentRunsClient{}
	a := NewAgentRunActivities(fc, nil)
	if err := a.UpdateAgentRun(context.Background(), UpdateAgentRunInput{
		WorkflowID: "wf-1",
		Status:     "completed",
		Summary:    "all done",
		EndedAt:    "2026-05-07T00:00:00Z",
	}); err != nil {
		t.Fatal(err)
	}
	if len(fc.calls) != 1 {
		t.Fatalf("calls = %d", len(fc.calls))
	}
	if fc.calls[0].Patch == nil || fc.calls[0].Patch.Status != "completed" {
		t.Errorf("patch = %+v", fc.calls[0].Patch)
	}
	if fc.calls[0].AppendApproval != nil {
		t.Errorf("expected no approval append")
	}
}

func TestUpdateAgentRun_AppendsApproval(t *testing.T) {
	fc := &fakeAgentRunsClient{}
	a := NewAgentRunActivities(fc, nil)
	if err := a.UpdateAgentRun(context.Background(), UpdateAgentRunInput{
		WorkflowID: "wf-1",
		ApprovalID: "ap-1",
		Kind:       "destructive_command",
		Title:      "drop table",
		Resolution: "rejected",
		ResolvedBy: "u-1",
		Notes:      "no",
	}); err != nil {
		t.Fatal(err)
	}
	if len(fc.calls) != 1 {
		t.Fatalf("calls = %d", len(fc.calls))
	}
	if fc.calls[0].AppendApproval == nil || fc.calls[0].AppendApproval.Resolution != "rejected" {
		t.Errorf("appendApproval = %+v", fc.calls[0].AppendApproval)
	}
}

func TestUpdateAgentRun_NoOpWhenAllEmpty(t *testing.T) {
	fc := &fakeAgentRunsClient{}
	a := NewAgentRunActivities(fc, nil)
	if err := a.UpdateAgentRun(context.Background(), UpdateAgentRunInput{
		WorkflowID: "wf-1",
	}); err != nil {
		t.Fatal(err)
	}
	if len(fc.calls) != 0 {
		t.Errorf("expected 0 calls, got %d", len(fc.calls))
	}
}

func TestUpdateAgentRun_RequiresWorkflowID(t *testing.T) {
	a := NewAgentRunActivities(&fakeAgentRunsClient{}, nil)
	if err := a.UpdateAgentRun(context.Background(), UpdateAgentRunInput{}); err == nil {
		t.Fatal("expected error")
	}
}

func TestUpdateAgentRun_PropagatesClientError(t *testing.T) {
	fc := &fakeAgentRunsClient{err: errors.New("boom")}
	a := NewAgentRunActivities(fc, nil)
	err := a.UpdateAgentRun(context.Background(), UpdateAgentRunInput{
		WorkflowID: "wf-1", Status: "running",
	})
	if err == nil {
		t.Fatal("expected error")
	}
}
