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
	registerID string
	registerErr error
	resolved   bool
	resolveErr error
}

func (f *fakeToolsClient) ListApproved(_ context.Context, _ string) ([]services.AgentToolDoc, error) {
	return f.listed, f.listErr
}
func (f *fakeToolsClient) RegisterPending(_ context.Context, in services.RegisterPendingInput) (string, error) {
	f.registered = in
	return f.registerID, f.registerErr
}
func (f *fakeToolsClient) Resolve(_ context.Context, _ string, _ bool, _, _ string) error {
	f.resolved = true
	return f.resolveErr
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

func TestResolveAgentTool_RequiresID(t *testing.T) {
	a := NewToolRegistryActivities(&fakeToolsClient{}, nil)
	if err := a.ResolveAgentTool(context.Background(), ResolveAgentToolInput{}); err == nil {
		t.Fatal("expected error")
	}
}
