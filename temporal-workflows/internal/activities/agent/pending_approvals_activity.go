package agent

import (
	"context"
	"errors"
	"log/slog"

	"go.temporal.io/sdk/temporal"

	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

// PendingApprovalsClient is the contract the queue activities depend on.
// services.PayloadPendingApprovalsClient implements it in production;
// tests substitute a fake.
type PendingApprovalsClient interface {
	Open(ctx context.Context, in services.OpenInput) (string, error)
	Resolve(ctx context.Context, id string, in services.ResolveInput) error
}

// PendingApprovalsActivities own the activities backing the
// PendingApprovals collection. The workflow calls them on every gate
// open/close in addition to its inline state mutations so a reviewer
// who isn't watching the chat can still see and resolve gates from
// /platform/approvals.
type PendingApprovalsActivities struct {
	client PendingApprovalsClient
	logger *slog.Logger
}

func NewPendingApprovalsActivities(client PendingApprovalsClient, logger *slog.Logger) *PendingApprovalsActivities {
	if logger == nil {
		logger = slog.Default()
	}
	return &PendingApprovalsActivities{client: client, logger: logger}
}

// OpenPendingApprovalInput is what the workflow passes to OpenPendingApproval.
type OpenPendingApprovalInput struct {
	WorkspaceID  string
	WorkflowID   string
	RunID        string
	AgentRunID   string
	ApprovalID   string
	Kind         string
	Title        string
	BodyMarkdown string
	Payload      map[string]any
}

// OpenPendingApprovalResult is intentionally minimal — the workflow only
// needs the row id for the eventual Resolve call.
type OpenPendingApprovalResult struct {
	ID string
}

// OpenPendingApproval inserts a pending row. Idempotent on
// (WorkflowID, ApprovalID): a continue-as-new replay safely re-emits.
func (a *PendingApprovalsActivities) OpenPendingApproval(ctx context.Context, in OpenPendingApprovalInput) (OpenPendingApprovalResult, error) {
	if a.client == nil {
		return OpenPendingApprovalResult{}, temporal.NewNonRetryableApplicationError("pending-approvals client not configured", "ConfigError", nil)
	}
	if in.WorkspaceID == "" || in.WorkflowID == "" || in.ApprovalID == "" {
		return OpenPendingApprovalResult{}, temporal.NewNonRetryableApplicationError(
			"workspaceId, workflowId, approvalId required", "InvalidInput",
			errors.New("missing required fields"))
	}
	id, err := a.client.Open(ctx, services.OpenInput{
		WorkspaceID:  in.WorkspaceID,
		WorkflowID:   in.WorkflowID,
		RunID:        in.RunID,
		AgentRunID:   in.AgentRunID,
		ApprovalID:   in.ApprovalID,
		Kind:         in.Kind,
		Title:        in.Title,
		BodyMarkdown: in.BodyMarkdown,
		Payload:      in.Payload,
	})
	if err != nil {
		a.logger.Warn("pending-approvals open failed", "err", err, "approvalId", in.ApprovalID)
		return OpenPendingApprovalResult{}, err
	}
	return OpenPendingApprovalResult{ID: id}, nil
}

// ResolvePendingApprovalInput is what the workflow passes to
// ResolvePendingApproval.
type ResolvePendingApprovalInput struct {
	ID             string
	Status         string // "resolved" | "aborted"
	Resolution     string // "approved" | "rejected"
	ResolvedBy     string
	Notes          string
	WorkspaceID    string // resolving workflow's workspace (ownership check)
	ReviewerRounds int
}

// ResolvePendingApproval flips a row to resolved/aborted. Errors are
// retried by Temporal's default retry policy; the workflow swallows the
// final error so a flaky internal API never blocks gate resolution.
func (a *PendingApprovalsActivities) ResolvePendingApproval(ctx context.Context, in ResolvePendingApprovalInput) error {
	if a.client == nil {
		return temporal.NewNonRetryableApplicationError("pending-approvals client not configured", "ConfigError", nil)
	}
	if in.ID == "" {
		// Tolerable: the gate may have been opened before the row landed
		// (e.g. transient open failure). Skip — the row will be
		// orphaned-pending until reaped, which is annoying but not unsafe.
		a.logger.Warn("pending-approvals resolve called with empty id; skipping")
		return nil
	}
	return a.client.Resolve(ctx, in.ID, services.ResolveInput{
		Status:         in.Status,
		Resolution:     in.Resolution,
		ResolvedBy:     in.ResolvedBy,
		Notes:          in.Notes,
		WorkspaceID:    in.WorkspaceID,
		ReviewerRounds: in.ReviewerRounds,
	})
}
