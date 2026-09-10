package activities

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

type fakePendingApprovalsOpener struct {
	openIn     services.OpenInput
	openErr    error
	openID     string
	resolveID  string
	resolveIn  services.ResolveInput
	resolveErr error
}

func (f *fakePendingApprovalsOpener) Open(_ context.Context, in services.OpenInput) (string, error) {
	f.openIn = in
	if f.openErr != nil {
		return "", f.openErr
	}
	return f.openID, nil
}

func (f *fakePendingApprovalsOpener) Resolve(_ context.Context, id string, in services.ResolveInput) error {
	f.resolveID = id
	f.resolveIn = in
	return f.resolveErr
}

func TestScaffolderApprovalActivities_OpenApproval(t *testing.T) {
	t.Run("opens a row and returns its id", func(t *testing.T) {
		fake := &fakePendingApprovalsOpener{openID: "row-1"}
		a := NewScaffolderApprovalActivities(fake, nil)

		res, err := a.OpenApproval(context.Background(), ScaffolderOpenApprovalInput{
			WorkspaceID: "ws-1",
			WorkflowID:  "wf-1",
			RunID:       "run-1",
			ApprovalID:  "run-1:gate",
			StepID:      "gate",
			Message:     "please review",
			Approvers:   []string{"a@x.com"},
		})

		require.NoError(t, err)
		assert.Equal(t, "row-1", res.ID)
		assert.Equal(t, "ws-1", fake.openIn.WorkspaceID)
		assert.Equal(t, "run-1:gate", fake.openIn.ApprovalID)
		assert.Equal(t, "custom", fake.openIn.Kind)
	})

	t.Run("missing required fields is non-retryable", func(t *testing.T) {
		fake := &fakePendingApprovalsOpener{}
		a := NewScaffolderApprovalActivities(fake, nil)

		_, err := a.OpenApproval(context.Background(), ScaffolderOpenApprovalInput{ApprovalID: "x"})
		require.Error(t, err)
	})

	t.Run("nil client fails loudly rather than silently dropping the row", func(t *testing.T) {
		a := NewScaffolderApprovalActivities(nil, nil)
		_, err := a.OpenApproval(context.Background(), ScaffolderOpenApprovalInput{
			WorkspaceID: "ws-1", WorkflowID: "wf-1", ApprovalID: "run-1:gate",
		})
		require.Error(t, err)
	})

	t.Run("client error is wrapped, not swallowed", func(t *testing.T) {
		fake := &fakePendingApprovalsOpener{openErr: errors.New("boom")}
		a := NewScaffolderApprovalActivities(fake, nil)
		_, err := a.OpenApproval(context.Background(), ScaffolderOpenApprovalInput{
			WorkspaceID: "ws-1", WorkflowID: "wf-1", ApprovalID: "run-1:gate",
		})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "boom")
	})
}

func TestScaffolderApprovalActivities_ResolveApproval(t *testing.T) {
	t.Run("approved maps to resolved status", func(t *testing.T) {
		fake := &fakePendingApprovalsOpener{}
		a := NewScaffolderApprovalActivities(fake, nil)

		err := a.ResolveApproval(context.Background(), ScaffolderResolveApprovalInput{
			ID: "row-1", WorkspaceID: "ws-1", Resolution: "approved", ResolvedBy: "u1",
		})
		require.NoError(t, err)
		assert.Equal(t, "row-1", fake.resolveID)
		assert.Equal(t, "resolved", fake.resolveIn.Status)
		assert.Equal(t, "approved", fake.resolveIn.Resolution)
	})

	t.Run("rejected maps to aborted status", func(t *testing.T) {
		fake := &fakePendingApprovalsOpener{}
		a := NewScaffolderApprovalActivities(fake, nil)

		err := a.ResolveApproval(context.Background(), ScaffolderResolveApprovalInput{
			ID: "row-1", Resolution: "rejected",
		})
		require.NoError(t, err)
		assert.Equal(t, "aborted", fake.resolveIn.Status)
	})

	t.Run("empty id is a tolerated no-op", func(t *testing.T) {
		fake := &fakePendingApprovalsOpener{}
		a := NewScaffolderApprovalActivities(fake, nil)

		err := a.ResolveApproval(context.Background(), ScaffolderResolveApprovalInput{Resolution: "approved"})
		require.NoError(t, err)
		assert.Empty(t, fake.resolveID, "the fake must never have been called")
	})

	t.Run("nil client fails loudly", func(t *testing.T) {
		a := NewScaffolderApprovalActivities(nil, nil)
		err := a.ResolveApproval(context.Background(), ScaffolderResolveApprovalInput{ID: "row-1"})
		require.Error(t, err)
	})
}
