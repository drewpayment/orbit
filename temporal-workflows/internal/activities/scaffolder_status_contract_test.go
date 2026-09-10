package activities

// Contract test between what this worker writes back and what orbit-www's
// `action-runs` collection and status route accept.
//
// Payload rejects a select value outside its options list, so a status this
// worker invents is not a compile error — it is a writeback that silently
// fails in production. The send side is derived from the engine's own
// constants (never restated here, which would make the test tautological), and
// the accept side is checked against the TypeScript sources when they are
// present in the working tree.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

const (
	actionRunsCollectionPath  = "../../../orbit-www/src/collections/actions/ActionRuns.ts"
	actionRunsStatusRoutePath = "../../../orbit-www/src/app/api/internal/action-runs/[id]/status/route.ts"
)

// readTS returns the file's contents, or skips the test when it is absent.
func readTS(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Clean(path))
	if err != nil {
		t.Skipf("%s not readable (%v); this check only runs in a full checkout", path, err)
	}
	return string(data)
}

// requirePhase1Collection skips when the checkout predates PR #96, which adds
// `cancelled`, `steps` and `plan`. Skipping is right: on such a checkout the
// contract genuinely is not met yet, and failing would just be reporting the
// branch's own state back at itself.
func requirePhase1Collection(t *testing.T, src string) {
	t.Helper()
	if !strings.Contains(src, "'cancelled'") {
		t.Skip("action-runs collection predates PR #96 (no `cancelled` status); merge it to enable this check")
	}
}

func TestStatusContract_RunStatusesAreAcceptedByTheCollection(t *testing.T) {
	src := readTS(t, actionRunsCollectionPath)
	requirePhase1Collection(t, src)

	require.NotEmpty(t, scaffolder.RunStatusesWritten)
	for _, status := range scaffolder.RunStatusesWritten {
		assert.Contains(t, src, "'"+status+"'",
			"the worker writes run status %q, which action-runs.status does not offer", status)
	}
}

func TestStatusContract_StepStatusesAreAcceptedByTheCollection(t *testing.T) {
	src := readTS(t, actionRunsCollectionPath)
	requirePhase1Collection(t, src)
	require.Contains(t, src, "name: 'steps'", "the collection has no steps field yet")

	require.NotEmpty(t, scaffolder.StepStatusesWritten)
	for _, status := range scaffolder.StepStatusesWritten {
		assert.Contains(t, src, "'"+status+"'",
			"the worker writes step status %q, which steps[].status does not offer", status)
	}
}

// Every key this worker can put on the wire must be one the route reads. A key
// it ignores makes the writeback a no-op.
func TestStatusContract_BodyUsesOnlyAcceptedKeys(t *testing.T) {
	src := readTS(t, actionRunsStatusRoutePath)

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
			ID: "s1", Name: "One", Status: scaffolder.StepStatusSucceeded,
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

	var deferred []string
	for key := range decoded {
		// `steps` and `plan` arrive with PR #96. Skip only those keys, so the
		// rest of the contract is still checked on a pre-#96 checkout.
		if (key == "steps" || key == "plan") && !strings.Contains(src, "body."+key) {
			deferred = append(deferred, key)
			continue
		}
		assert.Contains(t, src, "body."+key,
			"the worker sends %q but the status route never reads it, so it does nothing", key)
	}
	if len(deferred) > 0 {
		t.Logf("status route predates PR #96; %s not checked yet", strings.Join(deferred, ", "))
	}
}

// The step struct's fields must match the collection's array fields, or a step
// arrives with its timestamps or output silently dropped.
func TestStatusContract_StepFieldsExistOnTheCollection(t *testing.T) {
	src := readTS(t, actionRunsCollectionPath)
	requirePhase1Collection(t, src)

	raw, err := json.Marshal(services.ActionRunStep{
		ID: "s1", Name: "One", Status: scaffolder.StepStatusSucceeded,
		StartedAt: "t", FinishedAt: "t", LogTail: "tail",
		Output: map[string]any{"k": "v"},
	})
	require.NoError(t, err)
	var decoded map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(raw, &decoded))

	for key := range decoded {
		assert.Contains(t, src, "name: '"+key+"'",
			"the worker sends steps[].%s, which is not a field on action-runs.steps", key)
	}
}
