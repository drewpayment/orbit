package actions

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"

	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
)

//go:embed fetch_template.input.schema.json
var fetchTemplateInputSchema []byte

//go:embed fetch_template.output.schema.json
var fetchTemplateOutputSchema []byte

// FetchTemplate is registered ONLY so `fetch:template` has a schema and a
// descriptor: the authoring UI's "Add step" picker and static validation
// (scaffolder.Validate) both work off the registry's descriptors, not off
// any special-cased list. It is NEVER dispatched through the generic
// Execute/Plan path — ScaffolderWorkflow intercepts `fetch:template` in its
// step loop before generic dispatch (see
// internal/workflows/scaffolder_fetch_template.go) because composing in
// another template means resolving its version via an activity and running
// it as a child ScaffolderWorkflow, both workflow-context operations a
// Temporal activity cannot perform.
//
// Execute and Plan both return a hard, non-nil error as defense-in-depth,
// mirroring ApprovalRequest's doc comment.
type FetchTemplate struct{}

// NewFetchTemplate constructs the fetch:template registry-only action.
func NewFetchTemplate() *FetchTemplate { return &FetchTemplate{} }

// errFetchTemplateNotDispatchable is returned by both Execute and Plan.
var errFetchTemplateNotDispatchable = fmt.Errorf(
	"fetch:template: %w: this action is a workflow-level special case and must never reach generic dispatch",
	scaffolder.ErrInvalidInput,
)

// Name implements scaffolder.Action.
func (a *FetchTemplate) Name() string { return "fetch:template" }

// InputSchema implements scaffolder.Action.
func (a *FetchTemplate) InputSchema() json.RawMessage { return fetchTemplateInputSchema }

// OutputSchema implements scaffolder.Action.
func (a *FetchTemplate) OutputSchema() json.RawMessage { return fetchTemplateOutputSchema }

// Execute never runs in production; see the type doc comment.
func (a *FetchTemplate) Execute(context.Context, scaffolder.ActionRunContext, json.RawMessage) (json.RawMessage, error) {
	return nil, errFetchTemplateNotDispatchable
}

// Plan never runs in production; see the type doc comment. ScaffolderWorkflow
// handles the dry-run story for this action itself (it runs the nested
// template as a child workflow with DryRun inherited, merging its plan into
// the outer one), without ever calling this method.
func (a *FetchTemplate) Plan(context.Context, scaffolder.ActionRunContext, json.RawMessage) ([]scaffolder.PlannedChange, error) {
	return nil, errFetchTemplateNotDispatchable
}
