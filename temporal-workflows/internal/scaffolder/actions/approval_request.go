package actions

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"

	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
)

//go:embed approval_request.input.schema.json
var approvalRequestInputSchema []byte

//go:embed approval_request.output.schema.json
var approvalRequestOutputSchema []byte

// ApprovalRequest is registered ONLY so `approval:request` has a schema and a
// descriptor: the authoring UI's "Add step" picker and static validation
// (scaffolder.Validate) both work off the registry's descriptors, not off any
// special-cased list. It is NEVER dispatched through the generic
// Execute/Plan path — ScaffolderWorkflow intercepts `approval:request` in its
// step loop before generic dispatch (see
// internal/workflows/scaffolder_approval.go) because pausing a workflow on a
// human signal requires workflow-context APIs (GetSignalChannel,
// NewSelector) that a Temporal activity cannot call.
//
// Execute and Plan both return a hard, non-nil error as defense-in-depth: a
// regression that lets `approval:request` reach ScaffolderExecuteStep or
// ScaffolderPlanStep fails loudly and immediately (a step that fails fast)
// instead of an activity hanging forever waiting on a signal only the
// workflow can receive.
type ApprovalRequest struct{}

// NewApprovalRequest constructs the approval:request registry-only action.
func NewApprovalRequest() *ApprovalRequest { return &ApprovalRequest{} }

// errApprovalRequestNotDispatchable is returned by both Execute and Plan.
var errApprovalRequestNotDispatchable = fmt.Errorf(
	"approval:request: %w: this action is a workflow-level special case and must never reach generic dispatch",
	scaffolder.ErrInvalidInput,
)

// Name implements scaffolder.Action.
func (a *ApprovalRequest) Name() string { return "approval:request" }

// InputSchema implements scaffolder.Action.
func (a *ApprovalRequest) InputSchema() json.RawMessage { return approvalRequestInputSchema }

// OutputSchema implements scaffolder.Action.
func (a *ApprovalRequest) OutputSchema() json.RawMessage { return approvalRequestOutputSchema }

// Execute never runs in production; see the type doc comment.
func (a *ApprovalRequest) Execute(context.Context, scaffolder.ActionRunContext, json.RawMessage) (json.RawMessage, error) {
	return nil, errApprovalRequestNotDispatchable
}

// Plan never runs in production; see the type doc comment. ScaffolderWorkflow
// handles the dry-run story for this action itself (an "unsupported"
// PlannedChange, no signal wait), without ever calling this method.
func (a *ApprovalRequest) Plan(context.Context, scaffolder.ActionRunContext, json.RawMessage) ([]scaffolder.PlannedChange, error) {
	return nil, errApprovalRequestNotDispatchable
}
