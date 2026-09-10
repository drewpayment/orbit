package activities_test

// This file is an EXTERNAL test package on purpose: it drives the real
// fs:render action through the real dispatch activity, and
// internal/scaffolder/actions imports internal/activities, so an in-package
// test would be an import cycle.

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder/actions"
)

type recordingStorage struct {
	mu      sync.Mutex
	uploads map[string]any
}

func (s *recordingStorage) UploadJSON(_ context.Context, path string, data any) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.uploads[path] = data
	return 1, nil
}

// TestRegression_FSRenderDryRunOnWorkDirRootDoesNotRecurse reproduces the bug
// an adversarial review found: the dry-run preview directory used to live
// inside the run work dir, and fs:render's `path` is routinely that same work
// dir, so copyDir walked into its own output and recursed until the path
// length blew up. The preview now renders outside the work dir.
func TestRegression_FSRenderDryRunOnWorkDirRootDoesNotRecurse(t *testing.T) {
	base := t.TempDir()
	storage := &recordingStorage{uploads: map[string]any{}}
	a := activities.NewScaffolderActivities(
		scaffolder.NewRegistry(actions.NewFSRender()), nil, storage, base, nil)

	// Mirrors ScaffolderActivities.runWorkDir. If that layout ever changes,
	// fs:render rejects the path as outside the work dir and this test fails
	// loudly rather than silently passing.
	runDir := filepath.Join(base, "scaffolder-run-run-1")
	require.NoError(t, os.MkdirAll(runDir, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(runDir, "README.md"), []byte("# {{ .serviceName }}"), 0o644))

	input := json.RawMessage(`{"path":` + strconv.Quote(runDir) + `,"values":{"serviceName":"orders"}}`)
	res, err := a.PlanStep(context.Background(), activities.ScaffolderStepInput{
		RunID: "run-1", StepID: "render", Action: "fs:render", DryRun: true, Input: input,
	})
	require.NoError(t, err, "planning the work dir root must not recurse")
	require.NotEmpty(t, res.Changes)

	uploaded, ok := storage.uploads[res.PreviewPath]
	require.True(t, ok, "uploads: %v", storage.uploads)

	// The preview type is unexported, so inspect the serialized form.
	raw, err := json.Marshal(uploaded)
	require.NoError(t, err)
	var preview struct {
		Files []struct {
			Path    string `json:"path"`
			Content string `json:"content"`
		} `json:"files"`
	}
	require.NoError(t, json.Unmarshal(raw, &preview))

	require.Len(t, preview.Files, 1, "a recursive copy would produce many nested files")
	assert.Equal(t, "README.md", preview.Files[0].Path)
	assert.Equal(t, "# orders", preview.Files[0].Content)
	for _, f := range preview.Files {
		assert.NotContains(t, f.Path, "preview", "the preview must not contain its own output")
	}

	// Planning never mutates the real tree.
	original, err := os.ReadFile(filepath.Join(runDir, "README.md"))
	require.NoError(t, err)
	assert.Equal(t, "# {{ .serviceName }}", string(original))

	// Nothing is left behind inside the work dir.
	entries, err := os.ReadDir(runDir)
	require.NoError(t, err)
	require.Len(t, entries, 1)
	assert.Equal(t, "README.md", entries[0].Name())
}
