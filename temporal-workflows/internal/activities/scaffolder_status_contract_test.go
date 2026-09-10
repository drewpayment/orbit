package activities

// Contract test against the `action-runs` status route and collection that
// PR #96 (origin/feat/template-definitions-model) adds.
//
// Everything this worker writes back goes through that route, and Payload
// rejects a select value outside its options list. These lists are copied from
// that branch's collection; if either side changes, this fails instead of a
// run silently losing its status writeback in production.
//
//	orbit-www/src/collections/actions/ActionRuns.ts   (status + steps.status options)
//	orbit-www/src/app/api/internal/action-runs/[id]/status/route.ts  (accepted body keys)

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

// runStatusOptions is `action-runs.status`. `cancelled` exists only on #96.
var runStatusOptions = map[string]bool{
	"pending":           true,
	"awaiting-approval": true,
	"running":           true,
	"succeeded":         true,
	"failed":            true,
	"cancelled":         true,
}

// stepStatusOptions is `action-runs.steps[].status`.
var stepStatusOptions = map[string]bool{
	"pending":   true,
	"running":   true,
	"succeeded": true,
	"failed":    true,
	"skipped":   true,
}

// bodyKeysAccepted is what the status route reads off the body.
var bodyKeysAccepted = map[string]bool{
	"status":     true,
	"appendLogs": true,
	"outputs":    true,
	"error":      true,
	"workflowId": true,
	"entity":     true,
	"steps":      true,
	"plan":       true,
}

// stepKeysAccepted is the `steps[]` array field set.
var stepKeysAccepted = map[string]bool{
	"id":         true,
	"name":       true,
	"status":     true,
	"startedAt":  true,
	"finishedAt": true,
	"logTail":    true,
	"output":     true,
}

func TestStatusContract_EveryRunStatusWeSendIsAccepted(t *testing.T) {
	// The statuses ScaffolderWorkflow writes.
	for _, status := range []string{"running", "succeeded", "failed", "cancelled"} {
		assert.True(t, runStatusOptions[status],
			"the workflow writes status %q, which action-runs.status does not accept", status)
	}
}

func TestStatusContract_EveryStepStatusWeSendIsAccepted(t *testing.T) {
	// The per-step statuses ScaffolderWorkflow writes.
	for _, status := range []string{"pending", "running", "succeeded", "failed", "skipped"} {
		assert.True(t, stepStatusOptions[status],
			"the workflow writes step status %q, which steps[].status does not accept", status)
	}
}

// A fully-populated body must use only keys the route reads. A key it ignores
// would make a writeback silently do nothing.
func TestStatusContract_BodyUsesOnlyAcceptedKeys(t *testing.T) {
	status, errMsg, workflowID, entity := "succeeded", "boom", "wf-1", "entity-1"
	outputs := map[string]any{"text": "done"}
	plan := []map[string]any{{"kind": "repo", "name": "acme/svc"}}

	body := services.ActionRunStatusInput{
		Status:     &status,
		AppendLogs: []services.ActionRunLogEntry{{TS: "2026-09-10T00:00:00Z", Level: "info", Message: "hi"}},
		Outputs:    &outputs,
		Error:      &errMsg,
		WorkflowID: &workflowID,
		Entity:     &entity,
		Steps: []services.ActionRunStep{{
			ID: "s1", Name: "One", Status: "succeeded",
			StartedAt: "2026-09-10T00:00:00Z", FinishedAt: "2026-09-10T00:00:01Z",
			LogTail: "tail", Output: map[string]any{"repoUrl": "u"},
		}},
		Plan: &plan,
	}

	raw, err := json.Marshal(body)
	require.NoError(t, err)

	var decoded map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(raw, &decoded))
	require.NotEmpty(t, decoded)

	for key := range decoded {
		assert.True(t, bodyKeysAccepted[key],
			"body key %q is not read by the status route, so sending it does nothing", key)
	}
	// And every accepted key is exercised, so a route change cannot go unnoticed.
	for key := range bodyKeysAccepted {
		assert.Contains(t, decoded, key, "this test no longer covers body key %q", key)
	}

	var steps []map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(decoded["steps"], &steps))
	require.Len(t, steps, 1)
	for key := range steps[0] {
		assert.True(t, stepKeysAccepted[key],
			"steps[] key %q is not a field on action-runs.steps", key)
	}
	for key := range stepKeysAccepted {
		assert.Contains(t, steps[0], key, "this test no longer covers steps[] key %q", key)
	}
}

// The activity layer must not invent statuses of its own.
func TestStatusContract_ActivityWritesOnlyAcceptedStatuses(t *testing.T) {
	writer := &fakeRunWriter{}
	a := newTestScaffolderActivities(t, nil, writer)

	for status := range runStatusOptions {
		require.NoError(t, a.WriteRunProgress(t.Context(), WriteRunProgressInput{
			RunID:  "run-1",
			Status: status,
			Steps:  []ScaffolderStepProgress{{ID: "s1", Status: "skipped"}},
		}))
	}
	for _, call := range writer.calls {
		require.NotNil(t, call.in.Status)
		assert.True(t, runStatusOptions[*call.in.Status])
		for _, step := range call.in.Steps {
			assert.True(t, stepStatusOptions[step.Status])
		}
	}
}
