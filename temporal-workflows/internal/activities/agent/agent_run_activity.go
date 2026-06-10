package agent

import (
	"context"
	"fmt"
	"log/slog"

	"go.temporal.io/sdk/temporal"

	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

// AgentRunsClient is the contract the audit activity depends on.
// Implemented by services.PayloadAgentRunsClient in production; tests
// substitute a fake.
type AgentRunsClient interface {
	Patch(ctx context.Context, workflowID string, in services.PatchInput) error
}

// AgentRunActivities owns the audit-trail update activity. Kept separate
// from the sandbox / tool-registry activity groups so the worker can wire
// them independently and a degraded run-history backend doesn't take down
// the sandbox path.
type AgentRunActivities struct {
	client AgentRunsClient
	logger *slog.Logger
}

// NewAgentRunActivities constructs the group.
func NewAgentRunActivities(client AgentRunsClient, logger *slog.Logger) *AgentRunActivities {
	if logger == nil {
		logger = slog.Default()
	}
	return &AgentRunActivities{client: client, logger: logger}
}

// UpdateAgentRunInput patches scalar fields and / or appends one approval
// audit entry. The workflow calls this on every meaningful state change so
// the run history page reflects live progress.
type UpdateAgentRunInput struct {
	WorkflowID string

	// Scalar patch.
	Status  string
	Summary string
	EndedAt string

	// Optional approval audit row.
	ApprovalID string
	Kind       string
	Title      string
	Resolution string // "approved" | "rejected"
	ResolvedBy string
	ResolvedAt string
	Notes      string
}

// UpdateAgentRun is fire-and-forget from the workflow's perspective: errors
// are non-retryable application errors so the activity completes quickly
// without consuming retry budget when, e.g., the row hasn't been written
// yet.
func (a *AgentRunActivities) UpdateAgentRun(ctx context.Context, in UpdateAgentRunInput) error {
	if in.WorkflowID == "" {
		return temporal.NewNonRetryableApplicationError("workflow_id required", "InvalidInput", nil)
	}

	patchIn := services.PatchInput{}
	if in.Status != "" || in.Summary != "" || in.EndedAt != "" {
		patchIn.Patch = &services.AgentRunPatch{
			Status:  in.Status,
			Summary: in.Summary,
			EndedAt: in.EndedAt,
		}
	}
	if in.ApprovalID != "" {
		patchIn.AppendApproval = &services.AgentRunApprovalEntry{
			ApprovalID: in.ApprovalID,
			Kind:       in.Kind,
			Title:      in.Title,
			Resolution: in.Resolution,
			ResolvedBy: in.ResolvedBy,
			ResolvedAt: in.ResolvedAt,
			Notes:      in.Notes,
		}
	}

	if patchIn.Patch == nil && patchIn.AppendApproval == nil {
		return nil
	}

	if err := a.client.Patch(ctx, in.WorkflowID, patchIn); err != nil {
		// Don't blow up the workflow on transient audit failures; the next
		// state transition will retry the patch.
		return fmt.Errorf("agent run patch: %w", err)
	}
	return nil
}
