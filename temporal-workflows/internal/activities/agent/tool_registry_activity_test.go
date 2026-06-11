package agent

import (
	"context"
	"errors"
	"testing"

	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

type fakeToolsClient struct {
	listed     []services.AgentToolDoc
	listErr    error
	registered services.RegisterPendingInput
	registerID    string
	registerErr   error
	resolved      bool
	resolveErr    error
	resolvedEdits *services.AgentToolEdits
	resolvedWorkspaceID string
}

func (f *fakeToolsClient) ListApproved(_ context.Context, _ string) ([]services.AgentToolDoc, error) {
	return f.listed, f.listErr
}
func (f *fakeToolsClient) RegisterPending(_ context.Context, in services.RegisterPendingInput) (string, error) {
	f.registered = in
	return f.registerID, f.registerErr
}
func (f *fakeToolsClient) Resolve(_ context.Context, id, workspaceID string, _ bool, _, _ string, edits *services.AgentToolEdits) (services.ResolveResult, error) {
	f.resolved = true
	f.resolvedEdits = edits
	f.resolvedWorkspaceID = workspaceID
	if f.resolveErr != nil {
		return services.ResolveResult{}, f.resolveErr
	}
	return services.ResolveResult{ID: id, Status: "approved"}, nil
}

func TestListApprovedTools_PassThrough(t *testing.T) {
	fc := &fakeToolsClient{
		listed: []services.AgentToolDoc{
			{ID: "1", Name: "deploy_thing", TemplateKind: "shell", TemplateJSON: `{"command":"echo hi"}`, Description: "do it"},
		},
	}
	a := NewToolRegistryActivities(fc, nil)
	res, err := a.ListApprovedTools(context.Background(), ListApprovedToolsInput{WorkspaceID: "ws"})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Tools) != 1 || res.Tools[0].Name != "deploy_thing" {
		t.Errorf("tools = %+v", res.Tools)
	}
}

func TestRegisterPendingTool_NameTakenIsNonRetryable(t *testing.T) {
	fc := &fakeToolsClient{registerErr: services.ErrToolNameTaken}
	a := NewToolRegistryActivities(fc, nil)
	_, err := a.RegisterPendingTool(context.Background(), RegisterPendingToolInput{
		WorkspaceID: "ws", Name: "x", TemplateKind: "shell", TemplateJSON: `{"command":"true"}`,
	})
	if err == nil || !errors.Is(err, services.ErrToolNameTaken) {
		// temporal.NewNonRetryableApplicationError wraps the error; we
		// can't directly errors.Is it through that, but the message must
		// mention the original.
		if err == nil || err.Error() == "" {
			t.Fatalf("expected name-taken error, got %v", err)
		}
	}
}

func TestRegisterPendingTool_ValidatesInputs(t *testing.T) {
	a := NewToolRegistryActivities(&fakeToolsClient{}, nil)
	_, err := a.RegisterPendingTool(context.Background(), RegisterPendingToolInput{})
	if err == nil {
		t.Fatal("expected validation error")
	}
}

func TestResolveAgentTool_PassesEditsToClient(t *testing.T) {
	fc := &fakeToolsClient{}
	a := NewToolRegistryActivities(fc, nil)
	res, err := a.ResolveAgentTool(context.Background(), ResolveAgentToolInput{
		ID:                 "row-1",
		Approved:           true,
		ResolvedBy:         "u-1",
		Edited:             true,
		EditedTemplateJSON: `{"command":"vercel deploy --target=preview"}`,
		EditedDescription:  "tightened scope",
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != "approved" {
		t.Errorf("status = %q", res.Status)
	}
	if fc.resolvedEdits == nil {
		t.Fatal("expected edits to be passed through to the client")
	}
	if fc.resolvedEdits.TemplateJSON != `{"command":"vercel deploy --target=preview"}` {
		t.Errorf("edits.TemplateJSON = %q", fc.resolvedEdits.TemplateJSON)
	}
	if fc.resolvedEdits.Description != "tightened scope" {
		t.Errorf("edits.Description = %q", fc.resolvedEdits.Description)
	}
}

func TestResolveAgentTool_NoEditsMeansNilPayload(t *testing.T) {
	fc := &fakeToolsClient{}
	a := NewToolRegistryActivities(fc, nil)
	if _, err := a.ResolveAgentTool(context.Background(), ResolveAgentToolInput{
		ID: "row-1", Approved: true,
	}); err != nil {
		t.Fatal(err)
	}
	if fc.resolvedEdits != nil {
		t.Errorf("expected nil edits when Edited=false; got %+v", fc.resolvedEdits)
	}
}

func TestResolveAgentTool_RequiresID(t *testing.T) {
	a := NewToolRegistryActivities(&fakeToolsClient{}, nil)
	if _, err := a.ResolveAgentTool(context.Background(), ResolveAgentToolInput{}); err == nil {
		t.Fatal("expected error")
	}
}

func TestResolveAgentTool_PassesWorkspaceID(t *testing.T) {
	fc := &fakeToolsClient{}
	a := NewToolRegistryActivities(fc, nil)
	if _, err := a.ResolveAgentTool(context.Background(), ResolveAgentToolInput{
		ID: "row-1", WorkspaceID: "ws-42", Approved: true,
	}); err != nil {
		t.Fatal(err)
	}
	if fc.resolvedWorkspaceID != "ws-42" {
		t.Errorf("workspaceID passed to client = %q, want ws-42", fc.resolvedWorkspaceID)
	}
}
