package workflows

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
	"github.com/drewpayment/orbit/temporal-workflows/pkg/types"
)

// The repository service cannot import internal/workflows, so pkg/types holds
// hand-written mirrors of the workflow's input and query payload. Temporal's
// JSON converter matches by field name, so a rename on either side would break
// dispatch silently at runtime. These tests are the guard.

func TestScaffolderWorkflowInput_MatchesSharedType(t *testing.T) {
	def := scaffolder.Definition{
		APIVersion: scaffolder.APIVersionV2,
		Kind:       scaffolder.KindTemplate,
		Metadata:   scaffolder.Metadata{Name: "svc", Title: "Service", Owner: "platform", TargetKind: "service"},
		Spec: scaffolder.Spec{
			Steps: []scaffolder.Step{{ID: "s1", Name: "One", Action: "debug:log", Input: json.RawMessage(`{"message":"hi"}`)}},
		},
	}
	rawDef, err := json.Marshal(def)
	require.NoError(t, err)

	// What the repository service would send.
	sent := types.ScaffolderWorkflowInput{
		RunID:               "run-1",
		DefinitionVersionID: "ver-1",
		DefinitionID:        "def-1",
		Definition:          rawDef,
		Parameters:          map[string]any{"name": "orders", "count": float64(2), "nested": map[string]any{"a": true}},
		WorkspaceID:         "ws-1",
		WorkspaceSlug:       "acme",
		WorkspaceName:       "Acme Inc",
		UserID:              "user-1",
		UserEmail:           "dev@acme.test",
		UserName:            "Dev",
		DryRun:              true,
	}
	wire, err := json.Marshal(sent)
	require.NoError(t, err)

	// What the workflow would receive.
	var got ScaffolderWorkflowInput
	require.NoError(t, json.Unmarshal(wire, &got))

	assert.Equal(t, sent.RunID, got.RunID)
	assert.Equal(t, sent.DefinitionVersionID, got.DefinitionVersionID)
	assert.Equal(t, sent.DefinitionID, got.DefinitionID)
	assert.Equal(t, sent.WorkspaceID, got.WorkspaceID)
	assert.Equal(t, sent.WorkspaceSlug, got.WorkspaceSlug)
	assert.Equal(t, sent.WorkspaceName, got.WorkspaceName)
	assert.Equal(t, sent.UserID, got.UserID)
	assert.Equal(t, sent.UserEmail, got.UserEmail)
	assert.Equal(t, sent.UserName, got.UserName)
	assert.Equal(t, sent.DryRun, got.DryRun)
	assert.Equal(t, sent.Parameters, got.Parameters)
	assert.Equal(t, def.APIVersion, got.Definition.APIVersion)
	assert.Equal(t, def.Metadata.Name, got.Definition.Metadata.Name)
	require.Len(t, got.Definition.Spec.Steps, 1)
	assert.Equal(t, "debug:log", got.Definition.Spec.Steps[0].Action)
}

func TestScaffolderProgress_MatchesSharedType(t *testing.T) {
	produced := ScaffolderProgress{
		Status: ScaffolderStatusFailed,
		Steps: []activities.ScaffolderStepProgress{{
			ID: "s1", Name: "One", Status: "failed",
			StartedAt: "2026-09-09T00:00:00Z", FinishedAt: "2026-09-09T00:00:01Z",
			Output: map[string]any{"repoUrl": "u"}, Error: "boom",
		}},
		Outputs: map[string]any{"text": "done"},
		Plan:    []scaffolder.PlannedChange{{Kind: "repo", Name: "my-org/svc", Description: "create"}},
		Error:   "step failed",
	}
	wire, err := json.Marshal(produced)
	require.NoError(t, err)

	var got types.ScaffolderProgress
	require.NoError(t, json.Unmarshal(wire, &got))

	assert.Equal(t, produced.Status, got.Status)
	assert.Equal(t, produced.Error, got.Error)
	assert.Equal(t, produced.Outputs, got.Outputs)
	require.Len(t, got.Steps, 1)
	assert.Equal(t, "s1", got.Steps[0].ID)
	assert.Equal(t, "One", got.Steps[0].Name)
	assert.Equal(t, "failed", got.Steps[0].Status)
	assert.Equal(t, "boom", got.Steps[0].Error)
	assert.Equal(t, "u", got.Steps[0].Output["repoUrl"])
	require.Len(t, got.Plan, 1)
	assert.Equal(t, "repo", got.Plan[0].Kind)
	assert.Equal(t, "my-org/svc", got.Plan[0].Name)
	assert.Equal(t, "create", got.Plan[0].Description)
}

func TestScaffolderWorkflowName_MatchesRegisteredFunction(t *testing.T) {
	// The repository service starts the workflow by this name string.
	assert.Equal(t, "ScaffolderWorkflow", types.ScaffolderWorkflowName)
	assert.Equal(t, ScaffolderProgressQuery, types.ScaffolderProgressQuery)
}
