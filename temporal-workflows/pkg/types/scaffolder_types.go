package types

import "encoding/json"

// This file mirrors the v2 scaffolder's workflow input and query payload for
// callers outside the worker module (the repository service's gRPC handlers).
//
// The worker's own structs live in internal/workflows and internal/scaffolder,
// which are not importable across the module boundary. Temporal's JSON data
// converter matches by field name, so these must stay field-compatible with
// workflows.ScaffolderWorkflowInput and workflows.ScaffolderProgress — exactly
// the arrangement TemplateInstantiationInput above already uses.

// ScaffolderWorkflowName is the registered name of the v2 engine workflow.
const ScaffolderWorkflowName = "ScaffolderWorkflow"

// ScaffolderProgressQuery is the query the workflow answers with a
// ScaffolderProgress snapshot.
const ScaffolderProgressQuery = "progress"

// ScaffolderWorkflowInput is the input to ScaffolderWorkflow. Definition is the
// full v2 document, resolved by the caller before the workflow starts, so
// workflow code makes no Payload calls and history records exactly what ran.
type ScaffolderWorkflowInput struct {
	RunID               string `json:"runId"`
	DefinitionVersionID string `json:"definitionVersionId"`
	// DefinitionID is the template-definitions doc id, exposed to expressions
	// as `${{ template.id }}`.
	DefinitionID string          `json:"definitionId"`
	Definition   json.RawMessage `json:"definition"`
	Parameters   map[string]any  `json:"parameters"`
	WorkspaceID  string          `json:"workspaceId"`
	// WorkspaceSlug, WorkspaceName, UserEmail and UserName come from the run
	// record rather than the request, and populate the `${{ workspace.* }}`
	// and `${{ user.* }}` namespaces the engine's validator advertises.
	WorkspaceSlug string `json:"workspaceSlug,omitempty"`
	WorkspaceName string `json:"workspaceName,omitempty"`
	UserID        string `json:"userId"`
	UserEmail     string `json:"userEmail,omitempty"`
	UserName      string `json:"userName,omitempty"`
	DryRun        bool   `json:"dryRun"`
	// TemplateStack mirrors workflows.ScaffolderWorkflowInput.TemplateStack
	// (Phase 4 Task D, `fetch:template` composition). A top-level run never
	// sets it.
	TemplateStack []string `json:"templateStack,omitempty"`
}

// ScaffolderStepProgress is one step's state in a run.
type ScaffolderStepProgress struct {
	ID         string         `json:"id"`
	Name       string         `json:"name"`
	Status     string         `json:"status"` // pending|running|succeeded|failed|skipped
	StartedAt  string         `json:"startedAt,omitempty"`
	FinishedAt string         `json:"finishedAt,omitempty"`
	Output     map[string]any `json:"output,omitempty"`
	Error      string         `json:"error,omitempty"`
}

// ScaffolderPlannedChange is one side effect a dry run would cause.
type ScaffolderPlannedChange struct {
	Kind        string `json:"kind"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

// ScaffolderApprovalSignal is the signal name ResolveScaffolderApproval sends
// to resolve an `approval:request` step's human-in-the-loop gate (Phase 4
// Task C). Must stay field- and name-compatible with
// workflows.ScaffolderApprovalSignal / workflows.ScaffolderApprovalSignalInput
// — Temporal's data converter matches by field name, not by Go type identity.
const ScaffolderApprovalSignal = "ScaffolderApprovalSignal"

// ScaffolderApprovalSignalInput is the payload ResolveScaffolderApproval
// sends.
type ScaffolderApprovalSignalInput struct {
	ApprovalID string `json:"approvalId"`
	Approved   bool   `json:"approved"`
	ApproverID string `json:"approverId"`
	Comment    string `json:"comment"`
}

// ScaffolderProgress is the "progress" query payload.
type ScaffolderProgress struct {
	Status  string                    `json:"status"` // running|succeeded|failed|cancelled
	Steps   []ScaffolderStepProgress  `json:"steps"`
	Outputs map[string]any            `json:"outputs,omitempty"`
	Plan    []ScaffolderPlannedChange `json:"plan,omitempty"`
	Error   string                    `json:"errorMessage,omitempty"`
}
