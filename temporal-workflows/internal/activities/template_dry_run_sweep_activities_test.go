package activities

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/temporal"

	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
	"github.com/drewpayment/orbit/temporal-workflows/pkg/types"
)

type fakeSweepPayloadClient struct {
	candidates    []services.DryRunSweepCandidate
	listErr       error
	triggerResult *services.TriggerDryRunResult
	triggerErr    error
	gotTrigger    services.TriggerDryRunInput
	gotDefID      string

	writeResult *services.DryRunSweepResultResponse
	writeErr    error
	gotWrite    services.DryRunSweepResultInput
	gotWriteDef string
}

func (f *fakeSweepPayloadClient) ListDryRunSweepCandidates(context.Context) ([]services.DryRunSweepCandidate, error) {
	return f.candidates, f.listErr
}

func (f *fakeSweepPayloadClient) TriggerDryRun(_ context.Context, definitionID string, in services.TriggerDryRunInput) (*services.TriggerDryRunResult, error) {
	f.gotDefID = definitionID
	f.gotTrigger = in
	return f.triggerResult, f.triggerErr
}

func (f *fakeSweepPayloadClient) WriteDryRunSweepResult(_ context.Context, definitionID string, in services.DryRunSweepResultInput) (*services.DryRunSweepResultResponse, error) {
	f.gotWriteDef = definitionID
	f.gotWrite = in
	return f.writeResult, f.writeErr
}

type fakeActionRunWriter struct {
	err       error
	calls     []services.ActionRunStatusInput
	gotRunIDs []string
}

func (f *fakeActionRunWriter) WriteStatus(_ context.Context, runID string, in services.ActionRunStatusInput) error {
	f.gotRunIDs = append(f.gotRunIDs, runID)
	f.calls = append(f.calls, in)
	return f.err
}

type fakeDispatcher struct {
	workflowID string
	err        error
	gotRunID   string
	gotWSID    string
	gotInput   types.ScaffolderWorkflowInput
}

func (f *fakeDispatcher) StartScaffolderWorkflow(_ context.Context, runID, workspaceID string, in types.ScaffolderWorkflowInput) (string, error) {
	f.gotRunID = runID
	f.gotWSID = workspaceID
	f.gotInput = in
	return f.workflowID, f.err
}

func TestListPublishedTemplatesWithFixtures_MapsCandidates(t *testing.T) {
	client := &fakeSweepPayloadClient{
		candidates: []services.DryRunSweepCandidate{
			{
				DefinitionID:     "def-1",
				Name:             "Service",
				WorkspaceID:      "ws-1",
				CurrentVersionID: "ver-1",
				Fixtures: []services.DryRunFixture{
					{ID: "fix-1", Name: "Basic", Values: map[string]any{"name": "orders"}},
				},
			},
			{DefinitionID: "def-2", Name: "No Fixtures", WorkspaceID: "ws-2", CurrentVersionID: "ver-2"},
		},
	}
	a := NewTemplateDryRunSweepActivities(client, nil, nil, nil)

	res, err := a.ListPublishedTemplatesWithFixtures(context.Background())
	require.NoError(t, err)
	require.Len(t, res.Templates, 2)
	assert.Equal(t, "def-1", res.Templates[0].DefinitionID)
	require.Len(t, res.Templates[0].Fixtures, 1)
	assert.Equal(t, "fix-1", res.Templates[0].Fixtures[0].ID)
	assert.Empty(t, res.Templates[1].Fixtures)
}

func TestListPublishedTemplatesWithFixtures_PropagatesTransientErrors(t *testing.T) {
	client := &fakeSweepPayloadClient{listErr: errors.New("connection refused")}
	a := NewTemplateDryRunSweepActivities(client, nil, nil, nil)

	_, err := a.ListPublishedTemplatesWithFixtures(context.Background())
	require.Error(t, err)
	// A transient HTTP failure must stay retryable, not be marked
	// non-retryable ScaffolderInvalid.
	var appErr *temporal.ApplicationError
	assert.False(t, errors.As(err, &appErr))
}

func TestTriggerTemplateDryRun_CreatesRunAndDispatchesWorkflow(t *testing.T) {
	client := &fakeSweepPayloadClient{
		triggerResult: &services.TriggerDryRunResult{
			RunID:          "run-1",
			WorkspaceID:    "ws-1",
			DefinitionJSON: json.RawMessage(`{"apiVersion":"orbit/v2"}`),
		},
	}
	dispatcher := &fakeDispatcher{workflowID: "scaffolder-run-run-1"}
	runs := &fakeActionRunWriter{}
	a := NewTemplateDryRunSweepActivities(client, dispatcher, runs, nil)

	res, err := a.TriggerTemplateDryRun(context.Background(), TriggerTemplateDryRunInput{
		DefinitionID:     "def-1",
		CurrentVersionID: "ver-1",
		WorkspaceID:      "ws-1",
		FixtureID:        "fix-1",
		FixtureName:      "Basic",
		Parameters:       map[string]any{"name": "orders"},
	})
	require.NoError(t, err)
	assert.Equal(t, "run-1", res.RunID)
	assert.Equal(t, "scaffolder-run-run-1", res.WorkflowID)

	assert.Equal(t, "def-1", client.gotDefID)
	assert.Equal(t, "ver-1", client.gotTrigger.TemplateVersionID)
	assert.Equal(t, "scheduled-sweep", client.gotTrigger.Trigger)
	assert.Equal(t, "orders", client.gotTrigger.Parameters["name"])

	assert.Equal(t, "run-1", dispatcher.gotRunID)
	assert.Equal(t, "ws-1", dispatcher.gotWSID)
	assert.True(t, dispatcher.gotInput.DryRun)
	assert.Equal(t, "scheduled-sweep", dispatcher.gotInput.Trigger)
	assert.Equal(t, "def-1", dispatcher.gotInput.DefinitionID)
	assert.Equal(t, "ver-1", dispatcher.gotInput.DefinitionVersionID)
	assert.JSONEq(t, `{"apiVersion":"orbit/v2"}`, string(dispatcher.gotInput.Definition))

	// The started Temporal workflowId must be written back onto the
	// action-runs row, exactly as lib/actions/run.ts's manual path does —
	// otherwise the run page has no way to query progress for a
	// sweep-triggered run.
	require.Len(t, runs.calls, 1)
	assert.Equal(t, "run-1", runs.gotRunIDs[0])
	require.NotNil(t, runs.calls[0].WorkflowID)
	assert.Equal(t, "scaffolder-run-run-1", *runs.calls[0].WorkflowID)
}

func TestTriggerTemplateDryRun_WorkflowIDWriteBackFailureDoesNotFailTheTrigger(t *testing.T) {
	client := &fakeSweepPayloadClient{
		triggerResult: &services.TriggerDryRunResult{RunID: "run-1", WorkspaceID: "ws-1"},
	}
	dispatcher := &fakeDispatcher{workflowID: "scaffolder-run-run-1"}
	runs := &fakeActionRunWriter{err: errors.New("orbit-www unavailable")}
	a := NewTemplateDryRunSweepActivities(client, dispatcher, runs, nil)

	res, err := a.TriggerTemplateDryRun(context.Background(), TriggerTemplateDryRunInput{
		DefinitionID: "def-1", CurrentVersionID: "ver-1",
	})
	require.NoError(t, err, "a best-effort write-back failure must not fail the trigger — the dry run already dispatched")
	assert.Equal(t, "run-1", res.RunID)
	assert.Equal(t, "scaffolder-run-run-1", res.WorkflowID)
	require.Len(t, runs.calls, 1, "the write-back must still have been attempted")
}

func TestTriggerTemplateDryRun_RequiresDefinitionAndVersion(t *testing.T) {
	client := &fakeSweepPayloadClient{}
	dispatcher := &fakeDispatcher{}
	a := NewTemplateDryRunSweepActivities(client, dispatcher, nil, nil)

	_, err := a.TriggerTemplateDryRun(context.Background(), TriggerTemplateDryRunInput{})
	require.Error(t, err)
	var appErr *temporal.ApplicationError
	require.True(t, errors.As(err, &appErr), "a bad input must be non-retryable")
	assert.Equal(t, ErrTypeScaffolderInvalid, appErr.Type())
	assert.Zero(t, dispatcher.gotRunID, "must not dispatch on invalid input")
}

func TestTriggerTemplateDryRun_DefinitionNotFoundIsNonRetryable(t *testing.T) {
	client := &fakeSweepPayloadClient{triggerErr: services.ErrTemplateDefinitionNotFound}
	dispatcher := &fakeDispatcher{}
	a := NewTemplateDryRunSweepActivities(client, dispatcher, nil, nil)

	_, err := a.TriggerTemplateDryRun(context.Background(), TriggerTemplateDryRunInput{
		DefinitionID: "def-1", CurrentVersionID: "ver-1",
	})
	require.Error(t, err)
	var appErr *temporal.ApplicationError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, ErrTypeScaffolderInvalid, appErr.Type())
}

func TestTriggerTemplateDryRun_TransientCreateErrorIsRetryable(t *testing.T) {
	client := &fakeSweepPayloadClient{triggerErr: errors.New("connection refused")}
	dispatcher := &fakeDispatcher{}
	a := NewTemplateDryRunSweepActivities(client, dispatcher, nil, nil)

	_, err := a.TriggerTemplateDryRun(context.Background(), TriggerTemplateDryRunInput{
		DefinitionID: "def-1", CurrentVersionID: "ver-1",
	})
	require.Error(t, err)
	var appErr *temporal.ApplicationError
	assert.False(t, errors.As(err, &appErr))
}

func TestTriggerTemplateDryRun_DispatchFailurePropagates(t *testing.T) {
	client := &fakeSweepPayloadClient{
		triggerResult: &services.TriggerDryRunResult{RunID: "run-1", WorkspaceID: "ws-1"},
	}
	dispatcher := &fakeDispatcher{err: errors.New("temporal unavailable")}
	a := NewTemplateDryRunSweepActivities(client, dispatcher, nil, nil)

	_, err := a.TriggerTemplateDryRun(context.Background(), TriggerTemplateDryRunInput{
		DefinitionID: "def-1", CurrentVersionID: "ver-1",
	})
	require.Error(t, err)
}

func TestRecordSweepResult_ForwardsToClient(t *testing.T) {
	client := &fakeSweepPayloadClient{writeResult: &services.DryRunSweepResultResponse{Status: "drifted"}}
	a := NewTemplateDryRunSweepActivities(client, nil, nil, nil)

	err := a.RecordSweepResult(context.Background(), RecordSweepResultInput{
		DefinitionID: "def-1",
		Failed:       false,
		PlanHash:     "hash-1",
	})
	require.NoError(t, err)
	assert.Equal(t, "def-1", client.gotWriteDef)
	assert.False(t, client.gotWrite.Failed)
	assert.Equal(t, "hash-1", client.gotWrite.PlanHash)
}

func TestRecordSweepResult_RequiresDefinitionID(t *testing.T) {
	client := &fakeSweepPayloadClient{}
	a := NewTemplateDryRunSweepActivities(client, nil, nil, nil)

	err := a.RecordSweepResult(context.Background(), RecordSweepResultInput{})
	require.Error(t, err)
	var appErr *temporal.ApplicationError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, ErrTypeScaffolderInvalid, appErr.Type())
}
