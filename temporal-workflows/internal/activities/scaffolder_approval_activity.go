package activities

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

// Activity names for the approval:request special case (Phase 4 Task C).
const (
	ActivityScaffolderOpenApproval    = "ScaffolderOpenApproval"
	ActivityScaffolderResolveApproval = "ScaffolderResolveApproval"
)

// PendingApprovalsOpener is the subset of services.PayloadPendingApprovalsClient
// the scaffolder approval activities need. Satisfied by
// *services.PayloadPendingApprovalsClient — the same client the agent's own
// pending-approvals activities use (internal/activities/agent), so both
// systems write to the one `pending-approvals` collection through the one
// HTTP client shape.
type PendingApprovalsOpener interface {
	Open(ctx context.Context, in services.OpenInput) (string, error)
	Resolve(ctx context.Context, id string, in services.ResolveInput) error
}

// ScaffolderApprovalActivities backs the `approval:request` step's
// PendingApprovals row (visibility on /platform/approvals). The actual
// wait-for-signal happens in workflow code
// (internal/workflows/scaffolder_approval.go); these activities only open and
// close the row.
type ScaffolderApprovalActivities struct {
	client PendingApprovalsOpener
	logger *slog.Logger
}

// NewScaffolderApprovalActivities wires the activities. client may be nil in
// tests that never call Open/Resolve; a nil client fails loudly rather than
// silently dropping the row, since a workflow with no visible approval row is
// a run parked forever with no way for a human to find it.
func NewScaffolderApprovalActivities(client PendingApprovalsOpener, logger *slog.Logger) *ScaffolderApprovalActivities {
	if logger == nil {
		logger = slog.Default()
	}
	return &ScaffolderApprovalActivities{client: client, logger: logger}
}

// ScaffolderOpenApprovalInput is the activity input for OpenApproval.
type ScaffolderOpenApprovalInput struct {
	WorkspaceID string `json:"workspaceId"`
	WorkflowID  string `json:"workflowId"`
	RunID       string `json:"runId"`
	ApprovalID  string `json:"approvalId"`
	StepID      string `json:"stepId"`
	Message     string `json:"message"`
	// TemplateDefinitionID is the scaffolder template definition this run
	// executed. Carried in the row's payload so /platform/approvals can build
	// a deep link to the run page (/self-service/templates/<id>/run/<runId>)
	// without a second lookup from the approvals list.
	TemplateDefinitionID string   `json:"templateDefinitionId"`
	Approvers            []string `json:"approvers,omitempty"`
}

// ScaffolderOpenApprovalResult carries the created row's id, needed by
// ResolveApproval.
type ScaffolderOpenApprovalResult struct {
	ID string `json:"id"`
}

// OpenApproval inserts a pending-approvals row for one approval:request step.
func (a *ScaffolderApprovalActivities) OpenApproval(ctx context.Context, in ScaffolderOpenApprovalInput) (*ScaffolderOpenApprovalResult, error) {
	if a.client == nil {
		return nil, nonRetryable(errors.New("scaffolder open approval: pending-approvals client not configured"))
	}
	if strings.TrimSpace(in.WorkspaceID) == "" || strings.TrimSpace(in.WorkflowID) == "" || strings.TrimSpace(in.ApprovalID) == "" {
		return nil, nonRetryable(errors.New("scaffolder open approval: workspaceId, workflowId, approvalId required"))
	}

	id, err := a.client.Open(ctx, services.OpenInput{
		WorkspaceID:  in.WorkspaceID,
		WorkflowID:   in.WorkflowID,
		RunID:        in.RunID,
		ApprovalID:   in.ApprovalID,
		Kind:         "custom",
		Title:        fmt.Sprintf("Template run approval: %s", in.StepID),
		BodyMarkdown: in.Message,
		Payload: map[string]any{
			"message":              in.Message,
			"approvers":            in.Approvers,
			"stepId":               in.StepID,
			"templateDefinitionId": in.TemplateDefinitionID,
		},
	})
	if err != nil {
		return nil, fmt.Errorf("scaffolder open approval: %w", err)
	}
	return &ScaffolderOpenApprovalResult{ID: id}, nil
}

// ScaffolderResolveApprovalInput is the activity input for ResolveApproval.
type ScaffolderResolveApprovalInput struct {
	// ID is the pending-approvals row id OpenApproval returned. Empty is
	// tolerated (mirrors agent's ResolvePendingApproval): an OpenApproval
	// that never completed leaves nothing to resolve.
	ID          string `json:"id"`
	WorkspaceID string `json:"workspaceId"`
	// Resolution is "approved" | "rejected".
	Resolution string `json:"resolution"`
	ResolvedBy string `json:"resolvedBy,omitempty"`
	Notes      string `json:"notes,omitempty"`
}

// ResolveApproval flips a pending-approvals row to resolved/aborted on every
// exit path of the approval:request step, including workflow cancellation.
func (a *ScaffolderApprovalActivities) ResolveApproval(ctx context.Context, in ScaffolderResolveApprovalInput) error {
	if a.client == nil {
		return nonRetryable(errors.New("scaffolder resolve approval: pending-approvals client not configured"))
	}
	if strings.TrimSpace(in.ID) == "" {
		a.logger.Warn("scaffolder resolve approval called with empty id; skipping")
		return nil
	}

	status := "resolved"
	if in.Resolution == "rejected" {
		status = "aborted"
	}

	if err := a.client.Resolve(ctx, in.ID, services.ResolveInput{
		Status:      status,
		Resolution:  in.Resolution,
		ResolvedBy:  in.ResolvedBy,
		Notes:       in.Notes,
		WorkspaceID: in.WorkspaceID,
	}); err != nil {
		return fmt.Errorf("scaffolder resolve approval: %w", err)
	}
	return nil
}
