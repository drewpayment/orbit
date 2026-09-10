package actions

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"

	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
)

//go:embed agent_run.input.schema.json
var agentRunInputSchema []byte

//go:embed agent_run.output.schema.json
var agentRunOutputSchema []byte

// AgentRun is registered ONLY so `agent:run` has a schema and a descriptor:
// the authoring UI's "Add step" picker and static validation
// (scaffolder.Validate) both work off the registry's descriptors, not off
// any special-cased list. It is NEVER dispatched through the generic
// Execute/Plan path — ScaffolderWorkflow intercepts `agent:run` in its step
// loop before generic dispatch (see internal/workflows/scaffolder_agent_run.go)
// because starting and awaiting a child workflow requires workflow-context
// APIs (ExecuteChildWorkflow, NewSelector) a Temporal activity cannot call.
//
// Execute and Plan both return a hard, non-nil error as defense-in-depth,
// mirroring ApprovalRequest's doc comment.
type AgentRun struct{}

// NewAgentRun constructs the agent:run registry-only action.
func NewAgentRun() *AgentRun { return &AgentRun{} }

// errAgentRunNotDispatchable is returned by both Execute and Plan.
var errAgentRunNotDispatchable = fmt.Errorf(
	"agent:run: %w: this action is a workflow-level special case and must never reach generic dispatch",
	scaffolder.ErrInvalidInput,
)

// Name implements scaffolder.Action.
func (a *AgentRun) Name() string { return "agent:run" }

// InputSchema implements scaffolder.Action.
func (a *AgentRun) InputSchema() json.RawMessage { return agentRunInputSchema }

// OutputSchema implements scaffolder.Action.
func (a *AgentRun) OutputSchema() json.RawMessage { return agentRunOutputSchema }

// Execute never runs in production; see the type doc comment.
func (a *AgentRun) Execute(context.Context, scaffolder.ActionRunContext, json.RawMessage) (json.RawMessage, error) {
	return nil, errAgentRunNotDispatchable
}

// Plan never runs in production; see the type doc comment. ScaffolderWorkflow
// handles the dry-run story for this action itself (an "unsupported"
// PlannedChange, no child workflow started), without ever calling this
// method.
func (a *AgentRun) Plan(context.Context, scaffolder.ActionRunContext, json.RawMessage) ([]scaffolder.PlannedChange, error) {
	return nil, errAgentRunNotDispatchable
}
