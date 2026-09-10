package activities

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/temporal"

	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

// --- fakes ------------------------------------------------------------------

// fakeAction is a configurable scaffolder.Action for the dispatch tests.
type fakeAction struct {
	name        string
	execute     func(rc scaffolder.ActionRunContext, input json.RawMessage) (json.RawMessage, error)
	plan        func(rc scaffolder.ActionRunContext, input json.RawMessage) ([]scaffolder.PlannedChange, error)
	gotWorkDirs []string
}

func (f *fakeAction) Name() string                  { return f.name }
func (f *fakeAction) InputSchema() json.RawMessage  { return json.RawMessage(`{"type":"object"}`) }
func (f *fakeAction) OutputSchema() json.RawMessage { return json.RawMessage(`{"type":"object"}`) }

func (f *fakeAction) Execute(_ context.Context, rc scaffolder.ActionRunContext, input json.RawMessage) (json.RawMessage, error) {
	f.gotWorkDirs = append(f.gotWorkDirs, rc.WorkDir)
	if f.execute == nil {
		return json.RawMessage(`{}`), nil
	}
	return f.execute(rc, input)
}

func (f *fakeAction) Plan(_ context.Context, rc scaffolder.ActionRunContext, input json.RawMessage) ([]scaffolder.PlannedChange, error) {
	f.gotWorkDirs = append(f.gotWorkDirs, rc.WorkDir)
	if f.plan == nil {
		return nil, scaffolder.ErrNoPlan
	}
	return f.plan(rc, input)
}

// fakePreviewAction implements scaffolder.PlanPreviewer by writing a fixed
// file tree into the destination directory.
type fakePreviewAction struct {
	fakeAction
	files       map[string]string
	previewErr  error
	gotDestDirs []string
}

func (f *fakePreviewAction) PlanPreview(_ context.Context, _ scaffolder.ActionRunContext, _ json.RawMessage, destDir string) ([]scaffolder.PlannedChange, error) {
	f.gotDestDirs = append(f.gotDestDirs, destDir)
	if f.previewErr != nil {
		return nil, f.previewErr
	}
	for rel, content := range f.files {
		full := filepath.Join(destDir, rel)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			return nil, err
		}
		if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
			return nil, err
		}
	}
	return []scaffolder.PlannedChange{{Kind: "file", Name: "README.md"}}, nil
}

// fakeStorage records uploads instead of talking to MinIO.
type fakeStorage struct {
	mu      sync.Mutex
	uploads map[string]any
	err     error
}

func newFakeStorage() *fakeStorage { return &fakeStorage{uploads: map[string]any{}} }

func (f *fakeStorage) UploadJSON(_ context.Context, path string, data any) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return 0, f.err
	}
	f.uploads[path] = data
	return 1, nil
}

// fakeRunWriter records status writebacks.
type fakeRunWriter struct {
	calls []struct {
		runID string
		in    services.ActionRunStatusInput
	}
	err error
}

func (f *fakeRunWriter) WriteStatus(_ context.Context, runID string, in services.ActionRunStatusInput) error {
	f.calls = append(f.calls, struct {
		runID string
		in    services.ActionRunStatusInput
	}{runID, in})
	return f.err
}

func newTestScaffolderActivities(t *testing.T, storage ScaffolderStorage, writer ActionRunStatusWriter, acts ...scaffolder.Action) *ScaffolderActivities {
	t.Helper()
	return NewScaffolderActivities(scaffolder.NewRegistry(acts...), writer, storage, t.TempDir(), nil)
}

// --- ExecuteStep ------------------------------------------------------------

func TestScaffolderActivities_ExecuteStep(t *testing.T) {
	t.Run("returns the action output as a map and creates the run work dir", func(t *testing.T) {
		action := &fakeAction{
			name: "test:ok",
			execute: func(_ scaffolder.ActionRunContext, input json.RawMessage) (json.RawMessage, error) {
				assert.JSONEq(t, `{"greeting":"hi"}`, string(input))
				return json.RawMessage(`{"repoUrl":"https://example.com/x","count":2}`), nil
			},
		}
		a := newTestScaffolderActivities(t, nil, nil, action)

		res, err := a.ExecuteStep(context.Background(), ScaffolderStepInput{
			RunID:  "run-1",
			StepID: "s1",
			Action: "test:ok",
			Input:  json.RawMessage(`{"greeting":"hi"}`),
		})
		require.NoError(t, err)
		assert.Equal(t, "https://example.com/x", res.Output["repoUrl"])
		assert.EqualValues(t, 2, res.Output["count"])

		require.Len(t, action.gotWorkDirs, 1)
		assert.DirExists(t, action.gotWorkDirs[0], "the run work dir must exist before the action runs")
		assert.Contains(t, action.gotWorkDirs[0], "run-1")
	})

	t.Run("shares one work dir across steps of the same run", func(t *testing.T) {
		action := &fakeAction{name: "test:ok"}
		a := newTestScaffolderActivities(t, nil, nil, action)

		for _, step := range []string{"s1", "s2"} {
			_, err := a.ExecuteStep(context.Background(), ScaffolderStepInput{RunID: "run-1", StepID: step, Action: "test:ok"})
			require.NoError(t, err)
		}
		require.Len(t, action.gotWorkDirs, 2)
		assert.Equal(t, action.gotWorkDirs[0], action.gotWorkDirs[1])
	})

	t.Run("keeps two runs in separate work dirs", func(t *testing.T) {
		action := &fakeAction{name: "test:ok"}
		a := newTestScaffolderActivities(t, nil, nil, action)

		for _, run := range []string{"run-1", "run-2"} {
			_, err := a.ExecuteStep(context.Background(), ScaffolderStepInput{RunID: run, StepID: "s1", Action: "test:ok"})
			require.NoError(t, err)
		}
		require.Len(t, action.gotWorkDirs, 2)
		assert.NotEqual(t, action.gotWorkDirs[0], action.gotWorkDirs[1])
	})

	t.Run("contains a hostile run id inside the base work dir", func(t *testing.T) {
		action := &fakeAction{name: "test:ok"}
		base := t.TempDir()
		a := NewScaffolderActivities(scaffolder.NewRegistry(action), nil, nil, base, nil)

		_, err := a.ExecuteStep(context.Background(), ScaffolderStepInput{RunID: "../../etc", StepID: "s1", Action: "test:ok"})
		require.NoError(t, err)
		require.Len(t, action.gotWorkDirs, 1)
		assert.True(t, strings.HasPrefix(action.gotWorkDirs[0], base+string(filepath.Separator)),
			"work dir %q escaped the base %q", action.gotWorkDirs[0], base)
	})

	t.Run("an unknown action is non-retryable", func(t *testing.T) {
		a := newTestScaffolderActivities(t, nil, nil)

		_, err := a.ExecuteStep(context.Background(), ScaffolderStepInput{RunID: "run-1", StepID: "s1", Action: "nope:missing"})
		require.Error(t, err)
		assertNonRetryable(t, err)
		assert.Contains(t, err.Error(), "nope:missing")
	})

	t.Run("a non-object action output is non-retryable", func(t *testing.T) {
		action := &fakeAction{
			name: "test:bad",
			execute: func(scaffolder.ActionRunContext, json.RawMessage) (json.RawMessage, error) {
				return json.RawMessage(`"nope"`), nil
			},
		}
		a := newTestScaffolderActivities(t, nil, nil, action)

		_, err := a.ExecuteStep(context.Background(), ScaffolderStepInput{RunID: "run-1", StepID: "s1", Action: "test:bad"})
		require.Error(t, err)
		assertNonRetryable(t, err)
	})

	t.Run("an action failure is returned as a retryable error", func(t *testing.T) {
		action := &fakeAction{
			name: "test:boom",
			execute: func(scaffolder.ActionRunContext, json.RawMessage) (json.RawMessage, error) {
				return nil, errors.New("upstream 503")
			},
		}
		a := newTestScaffolderActivities(t, nil, nil, action)

		_, err := a.ExecuteStep(context.Background(), ScaffolderStepInput{RunID: "run-1", StepID: "s1", Action: "test:boom"})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "upstream 503")
		var appErr *temporal.ApplicationError
		if errors.As(err, &appErr) {
			assert.False(t, appErr.NonRetryable(), "an action's own failure may be transient")
		}
	})

	t.Run("a nil or empty output becomes an empty map", func(t *testing.T) {
		action := &fakeAction{
			name:    "test:silent",
			execute: func(scaffolder.ActionRunContext, json.RawMessage) (json.RawMessage, error) { return nil, nil },
		}
		a := newTestScaffolderActivities(t, nil, nil, action)

		res, err := a.ExecuteStep(context.Background(), ScaffolderStepInput{RunID: "run-1", StepID: "s1", Action: "test:silent"})
		require.NoError(t, err)
		assert.NotNil(t, res.Output)
		assert.Empty(t, res.Output)
	})
}

// --- PlanStep ---------------------------------------------------------------

func TestScaffolderActivities_PlanStep(t *testing.T) {
	t.Run("returns the action's planned changes", func(t *testing.T) {
		action := &fakeAction{
			name: "test:plan",
			plan: func(scaffolder.ActionRunContext, json.RawMessage) ([]scaffolder.PlannedChange, error) {
				return []scaffolder.PlannedChange{{Kind: "repo", Name: "my-org/svc"}}, nil
			},
		}
		a := newTestScaffolderActivities(t, nil, nil, action)

		res, err := a.PlanStep(context.Background(), ScaffolderStepInput{RunID: "run-1", StepID: "s1", Action: "test:plan", DryRun: true})
		require.NoError(t, err)
		assert.False(t, res.Unsupported)
		require.Len(t, res.Changes, 1)
		assert.Equal(t, "repo", res.Changes[0].Kind)
	})

	t.Run("ErrNoPlan is reported as unsupported, not a failure", func(t *testing.T) {
		a := newTestScaffolderActivities(t, nil, nil, &fakeAction{name: "test:noplan"})

		res, err := a.PlanStep(context.Background(), ScaffolderStepInput{RunID: "run-1", StepID: "s1", Action: "test:noplan", DryRun: true})
		require.NoError(t, err)
		assert.True(t, res.Unsupported)
		assert.Empty(t, res.Changes)
	})

	t.Run("an unknown action is non-retryable", func(t *testing.T) {
		a := newTestScaffolderActivities(t, nil, nil)

		_, err := a.PlanStep(context.Background(), ScaffolderStepInput{RunID: "run-1", StepID: "s1", Action: "nope:missing", DryRun: true})
		require.Error(t, err)
		assertNonRetryable(t, err)
	})

	t.Run("persists a previewing action's rendered tree and cleans up the dest dir", func(t *testing.T) {
		action := &fakePreviewAction{
			fakeAction: fakeAction{name: "fs:render"},
			files:      map[string]string{"README.md": "# orders", "src/main.go": "package main"},
		}
		storage := newFakeStorage()
		a := newTestScaffolderActivities(t, storage, nil, action)

		res, err := a.PlanStep(context.Background(), ScaffolderStepInput{RunID: "run-9", StepID: "render", Action: "fs:render", DryRun: true})
		require.NoError(t, err)
		require.Len(t, res.Changes, 1)
		assert.Equal(t, "scaffolder-runs/run-9/render/preview.json", res.PreviewPath)

		uploaded, ok := storage.uploads["scaffolder-runs/run-9/render/preview.json"]
		require.True(t, ok, "uploads: %v", storage.uploads)
		preview, ok := uploaded.(scaffolderPreview)
		require.True(t, ok)
		assert.Equal(t, "run-9", preview.RunID)
		assert.Equal(t, "render", preview.StepID)
		require.Len(t, preview.Files, 2)
		// sorted by path, so the assertion does not depend on map order
		assert.Equal(t, "README.md", preview.Files[0].Path)
		assert.Equal(t, "# orders", preview.Files[0].Content)
		assert.Equal(t, "src/main.go", preview.Files[1].Path)

		require.Len(t, action.gotDestDirs, 1)
		assert.NoDirExists(t, action.gotDestDirs[0], "the preview dir must be removed after upload")
	})

	t.Run("a previewing action fails explicitly when storage is offline", func(t *testing.T) {
		action := &fakePreviewAction{fakeAction: fakeAction{name: "fs:render"}}
		a := newTestScaffolderActivities(t, nil, nil, action)

		_, err := a.PlanStep(context.Background(), ScaffolderStepInput{RunID: "run-9", StepID: "render", Action: "fs:render", DryRun: true})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "dry-run preview unavailable: storage offline")
		assertNonRetryable(t, err)
		assert.Empty(t, action.gotDestDirs, "the action must not run when the preview cannot be stored")
	})

	t.Run("a non-previewing action still plans while storage is offline", func(t *testing.T) {
		action := &fakeAction{
			name: "debug:log",
			plan: func(scaffolder.ActionRunContext, json.RawMessage) ([]scaffolder.PlannedChange, error) {
				return []scaffolder.PlannedChange{{Kind: "log", Name: "hello"}}, nil
			},
		}
		a := newTestScaffolderActivities(t, nil, nil, action)

		res, err := a.PlanStep(context.Background(), ScaffolderStepInput{RunID: "run-9", StepID: "s1", Action: "debug:log", DryRun: true})
		require.NoError(t, err)
		require.Len(t, res.Changes, 1)
	})

	t.Run("a preview upload failure fails the step and still cleans up", func(t *testing.T) {
		action := &fakePreviewAction{fakeAction: fakeAction{name: "fs:render"}, files: map[string]string{"a.txt": "a"}}
		storage := newFakeStorage()
		storage.err = errors.New("minio down")
		a := newTestScaffolderActivities(t, storage, nil, action)

		_, err := a.PlanStep(context.Background(), ScaffolderStepInput{RunID: "run-9", StepID: "render", Action: "fs:render", DryRun: true})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "minio down")
		require.Len(t, action.gotDestDirs, 1)
		assert.NoDirExists(t, action.gotDestDirs[0])
	})

	t.Run("a preview failure cleans up the dest dir", func(t *testing.T) {
		action := &fakePreviewAction{fakeAction: fakeAction{name: "fs:render"}, previewErr: errors.New("render exploded")}
		a := newTestScaffolderActivities(t, newFakeStorage(), nil, action)

		_, err := a.PlanStep(context.Background(), ScaffolderStepInput{RunID: "run-9", StepID: "render", Action: "fs:render", DryRun: true})
		require.Error(t, err)
		require.Len(t, action.gotDestDirs, 1)
		assert.NoDirExists(t, action.gotDestDirs[0])
	})
}

// --- WriteRunProgress -------------------------------------------------------

func TestScaffolderActivities_WriteRunProgress(t *testing.T) {
	t.Run("maps every field onto the status route body", func(t *testing.T) {
		writer := &fakeRunWriter{}
		a := newTestScaffolderActivities(t, nil, writer)

		err := a.WriteRunProgress(context.Background(), WriteRunProgressInput{
			RunID:      "run-1",
			Status:     "running",
			WorkflowID: "wf-1",
			Steps: []ScaffolderStepProgress{
				{ID: "s1", Name: "One", Status: "succeeded", Output: map[string]any{"repoUrl": "u"}},
			},
			AppendLogs: []ScaffolderLogEntry{{Level: "info", Message: "step s1 succeeded"}},
		})
		require.NoError(t, err)

		require.Len(t, writer.calls, 1)
		call := writer.calls[0]
		assert.Equal(t, "run-1", call.runID)
		require.NotNil(t, call.in.Status)
		assert.Equal(t, "running", *call.in.Status)
		require.NotNil(t, call.in.WorkflowID)
		assert.Equal(t, "wf-1", *call.in.WorkflowID)
		require.Len(t, call.in.Steps, 1)
		assert.Equal(t, "s1", call.in.Steps[0].ID)
		assert.Equal(t, "u", call.in.Steps[0].Output["repoUrl"])
		require.Len(t, call.in.AppendLogs, 1)
		assert.NotEmpty(t, call.in.AppendLogs[0].TS, "a log entry must carry a timestamp")
		assert.Nil(t, call.in.Plan, "an absent plan must not clobber a stored one")
	})

	t.Run("sends an explicit empty plan when the dry run found no changes", func(t *testing.T) {
		writer := &fakeRunWriter{}
		a := newTestScaffolderActivities(t, nil, writer)

		require.NoError(t, a.WriteRunProgress(context.Background(), WriteRunProgressInput{
			RunID: "run-1", Status: "succeeded", HasPlan: true, Plan: nil,
		}))
		require.Len(t, writer.calls, 1)
		require.NotNil(t, writer.calls[0].in.Plan)
		assert.Empty(t, *writer.calls[0].in.Plan)
	})

	t.Run("redacts secret-looking keys from persisted step output", func(t *testing.T) {
		writer := &fakeRunWriter{}
		a := newTestScaffolderActivities(t, nil, writer)

		require.NoError(t, a.WriteRunProgress(context.Background(), WriteRunProgressInput{
			RunID: "run-1",
			Steps: []ScaffolderStepProgress{{
				ID:     "s1",
				Status: "succeeded",
				Output: map[string]any{
					"repoUrl":     "https://example.com/x",
					"accessToken": "ghs_supersecret",
					"nested":      map[string]any{"apiKey": "sk-live-123", "ok": "fine"},
				},
			}},
		}))

		out := writer.calls[0].in.Steps[0].Output
		assert.Equal(t, "https://example.com/x", out["repoUrl"])
		assert.Equal(t, redactedPlaceholder, out["accessToken"])
		nested, ok := out["nested"].(map[string]any)
		require.True(t, ok)
		assert.Equal(t, redactedPlaceholder, nested["apiKey"])
		assert.Equal(t, "fine", nested["ok"])
	})

	t.Run("is a no-op without a configured client", func(t *testing.T) {
		a := newTestScaffolderActivities(t, nil, nil)
		require.NoError(t, a.WriteRunProgress(context.Background(), WriteRunProgressInput{RunID: "run-1", Status: "running"}))
	})

	t.Run("a missing run is non-retryable", func(t *testing.T) {
		writer := &fakeRunWriter{err: services.ErrActionRunNotFound}
		a := newTestScaffolderActivities(t, nil, writer)

		err := a.WriteRunProgress(context.Background(), WriteRunProgressInput{RunID: "gone", Status: "running"})
		require.Error(t, err)
		assertNonRetryable(t, err)
	})

	t.Run("rejects an empty run id", func(t *testing.T) {
		a := newTestScaffolderActivities(t, nil, &fakeRunWriter{})
		err := a.WriteRunProgress(context.Background(), WriteRunProgressInput{Status: "running"})
		require.Error(t, err)
		assertNonRetryable(t, err)
	})
}

// --- CleanupRun -------------------------------------------------------------

func TestScaffolderActivities_CleanupRun(t *testing.T) {
	t.Run("removes the run work dir and is idempotent", func(t *testing.T) {
		action := &fakeAction{name: "test:ok"}
		base := t.TempDir()
		a := NewScaffolderActivities(scaffolder.NewRegistry(action), nil, nil, base, nil)

		_, err := a.ExecuteStep(context.Background(), ScaffolderStepInput{RunID: "run-1", StepID: "s1", Action: "test:ok"})
		require.NoError(t, err)
		runDir := action.gotWorkDirs[0]
		require.DirExists(t, runDir)

		require.NoError(t, a.CleanupRun(context.Background(), CleanupScaffolderRunInput{RunID: "run-1"}))
		assert.NoDirExists(t, runDir)
		require.NoError(t, a.CleanupRun(context.Background(), CleanupScaffolderRunInput{RunID: "run-1"}))
		assert.DirExists(t, base, "cleanup must never remove the shared base dir")
	})

	t.Run("rejects an empty run id rather than removing the base dir", func(t *testing.T) {
		base := t.TempDir()
		a := NewScaffolderActivities(scaffolder.NewRegistry(), nil, nil, base, nil)

		require.Error(t, a.CleanupRun(context.Background(), CleanupScaffolderRunInput{RunID: ""}))
		assert.DirExists(t, base)
	})
}

// --- helpers ----------------------------------------------------------------

func assertNonRetryable(t *testing.T, err error) {
	t.Helper()
	var appErr *temporal.ApplicationError
	require.True(t, errors.As(err, &appErr), "expected a temporal.ApplicationError, got %T: %v", err, err)
	assert.True(t, appErr.NonRetryable(), "expected a non-retryable error, got %v", err)
}

// --- ValidateDefinition -----------------------------------------------------

func TestScaffolderActivities_ValidateDefinition(t *testing.T) {
	def := func(stepAction string) scaffolder.Definition {
		return scaffolder.Definition{
			APIVersion: scaffolder.APIVersionV2,
			Kind:       scaffolder.KindTemplate,
			Metadata:   scaffolder.Metadata{Name: "svc", Title: "Service", Owner: "platform"},
			Spec: scaffolder.Spec{
				Steps: []scaffolder.Step{{ID: "s1", Name: "One", Action: stepAction, Input: json.RawMessage(`{}`)}},
			},
		}
	}

	t.Run("reports no findings for a valid definition", func(t *testing.T) {
		a := newTestScaffolderActivities(t, nil, nil, &fakeAction{name: "test:ok"})
		res, err := a.ValidateDefinition(context.Background(), ValidateDefinitionInput{Definition: def("test:ok")})
		require.NoError(t, err)
		assert.Empty(t, res.Errors)
	})

	t.Run("reports an unknown action as a finding, not an error", func(t *testing.T) {
		a := newTestScaffolderActivities(t, nil, nil, &fakeAction{name: "test:ok"})
		res, err := a.ValidateDefinition(context.Background(), ValidateDefinitionInput{Definition: def("nope:missing")})
		require.NoError(t, err, "an invalid definition is a finding, never an activity failure")
		require.NotEmpty(t, res.Errors)
		assert.Contains(t, strings.Join(res.Errors, "\n"), "nope:missing")
	})

	t.Run("returns findings in a stable order", func(t *testing.T) {
		a := newTestScaffolderActivities(t, nil, nil)
		bad := def("nope:one")
		bad.Spec.Steps = append(bad.Spec.Steps, scaffolder.Step{ID: "s2", Name: "Two", Action: "nope:two", Input: json.RawMessage(`{}`)})

		first, err := a.ValidateDefinition(context.Background(), ValidateDefinitionInput{Definition: bad})
		require.NoError(t, err)
		for i := 0; i < 5; i++ {
			again, err := a.ValidateDefinition(context.Background(), ValidateDefinitionInput{Definition: bad})
			require.NoError(t, err)
			assert.Equal(t, first.Errors, again.Errors, "findings must be replay-stable")
		}
	})
}

// --- regression guards for the adversarial review ---------------------------

// TestScaffolderActivities_PlanStep_PreviewDirIsOutsideTheWorkDir pins the fix
// for a self-recursion bug: fs:render's source is routinely the work dir root,
// so a preview destination inside it made copyDir walk into its own output and
// recurse until the path length blew up.
func TestScaffolderActivities_PlanStep_PreviewDirIsOutsideTheWorkDir(t *testing.T) {
	action := &fakePreviewAction{fakeAction: fakeAction{name: "fs:render"}, files: map[string]string{"a.txt": "a"}}
	base := t.TempDir()
	a := NewScaffolderActivities(scaffolder.NewRegistry(action), nil, newFakeStorage(), base, nil)

	_, err := a.PlanStep(context.Background(), ScaffolderStepInput{RunID: "run-1", StepID: "render", Action: "fs:render", DryRun: true})
	require.NoError(t, err)

	require.Len(t, action.gotDestDirs, 1)
	assert.False(t, strings.HasPrefix(action.gotDestDirs[0], base+string(filepath.Separator)),
		"preview dir %q must not be inside the run work dir %q", action.gotDestDirs[0], base)
	assert.NoDirExists(t, action.gotDestDirs[0])
}

func TestScaffolderActivities_ExecuteStep_InvalidInputIsNonRetryable(t *testing.T) {
	action := &fakeAction{
		name: "test:picky",
		execute: func(scaffolder.ActionRunContext, json.RawMessage) (json.RawMessage, error) {
			return nil, fmt.Errorf("test:picky: %w: `path` is required", scaffolder.ErrInvalidInput)
		},
	}
	a := newTestScaffolderActivities(t, nil, nil, action)

	_, err := a.ExecuteStep(context.Background(), ScaffolderStepInput{RunID: "run-1", StepID: "s1", Action: "test:picky"})
	require.Error(t, err)
	assertNonRetryable(t, err)
	assert.Contains(t, err.Error(), "`path` is required")
}

func TestScaffolderActivities_PlanStep_InvalidInputIsNonRetryable(t *testing.T) {
	action := &fakeAction{
		name: "test:picky",
		plan: func(scaffolder.ActionRunContext, json.RawMessage) ([]scaffolder.PlannedChange, error) {
			return nil, fmt.Errorf("test:picky: %w: `path` is required", scaffolder.ErrInvalidInput)
		},
	}
	a := newTestScaffolderActivities(t, nil, nil, action)

	_, err := a.PlanStep(context.Background(), ScaffolderStepInput{RunID: "run-1", StepID: "s1", Action: "test:picky", DryRun: true})
	require.Error(t, err)
	assertNonRetryable(t, err)
}

func TestScaffolderActivities_WriteRunProgress_RedactsRunOutputs(t *testing.T) {
	writer := &fakeRunWriter{}
	a := newTestScaffolderActivities(t, nil, writer)

	require.NoError(t, a.WriteRunProgress(context.Background(), WriteRunProgressInput{
		RunID:  "run-1",
		Status: "succeeded",
		Outputs: map[string]any{
			"text":        "created https://example.com/x",
			"accessToken": "ghs_supersecret",
		},
	}))

	out := writer.calls[0].in.Outputs
	assert.Equal(t, "created https://example.com/x", out["text"])
	assert.Equal(t, redactedPlaceholder, out["accessToken"],
		"spec.output is author-written and can name a credential-bearing step output")
}

func TestScaffolderActivities_WriteRunProgress_RedactsSecretsInStepErrors(t *testing.T) {
	writer := &fakeRunWriter{}
	a := newTestScaffolderActivities(t, nil, writer)

	require.NoError(t, a.WriteRunProgress(context.Background(), WriteRunProgressInput{
		RunID: "run-1",
		Steps: []ScaffolderStepProgress{{
			ID:     "s1",
			Status: "failed",
			Error:  "GET https://api.example.com/x?access_token=ghp_abcdefghij0123456789 failed: 401",
		}},
	}))

	tail := writer.calls[0].in.Steps[0].LogTail
	assert.NotContains(t, tail, "ghp_abcdefghij0123456789")
	assert.Contains(t, tail, redactedPlaceholder)
	assert.Contains(t, tail, "failed: 401", "the useful part of the message must survive")
}

func TestRedactSecretsInText(t *testing.T) {
	tests := []struct {
		name       string
		in         string
		wantAbsent string
		wantSame   bool
	}{
		{name: "leaves ordinary text alone", in: "clone failed: repository not found", wantSame: true},
		{name: "leaves an empty string alone", in: "", wantSame: true},
		{name: "scrubs a token query parameter", in: "url?access_token=ghp_abcdefghij0123456789", wantAbsent: "ghp_abcdefghij0123456789"},
		{name: "scrubs an assignment", in: `password: "hunter2hunter2"`, wantAbsent: "hunter2hunter2"},
		{name: "scrubs a bare github token", in: "auth failed for ghs_abcdefghij0123456789", wantAbsent: "ghs_abcdefghij0123456789"},
		{name: "scrubs an api key", in: "apiKey=sk-live-0123456789", wantAbsent: "sk-live-0123456789"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := redactSecretsInText(tt.in)
			if tt.wantSame {
				assert.Equal(t, tt.in, got)
				return
			}
			assert.NotContains(t, got, tt.wantAbsent)
			assert.Contains(t, got, redactedPlaceholder)
		})
	}
}

func TestCollectPreview_BoundsFileCount(t *testing.T) {
	dir := t.TempDir()
	for i := 0; i < previewMaxFiles+50; i++ {
		require.NoError(t, os.WriteFile(filepath.Join(dir, fmt.Sprintf("f%05d.txt", i)), nil, 0o644))
	}

	preview, err := collectPreview("run-1", "s1", dir)
	require.NoError(t, err)
	assert.Len(t, preview.Files, previewMaxFiles)
	assert.True(t, preview.Truncated)
}
