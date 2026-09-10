package templating

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRenderDir_TracksChangedAndRenamedFiles(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "{{SERVICE_NAME}}.go"), []byte("package {{SERVICE_NAME}}"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "unchanged.go"), []byte("package main"), 0644))

	res, err := RenderDir(dir, map[string]string{"SERVICE_NAME": "orders"}, nil, nil)
	require.NoError(t, err)

	assert.Empty(t, res.SkippedFiles)
	assert.Equal(t, map[string]string{"{{SERVICE_NAME}}.go": "orders.go"}, res.RenamedFiles)
	assert.Contains(t, res.ChangedFiles, "{{SERVICE_NAME}}.go", "content was rendered before the rename pass, so it is recorded under the pre-rename relative path")

	content, err := os.ReadFile(filepath.Join(dir, "orders.go"))
	require.NoError(t, err)
	assert.Equal(t, "package orders", string(content))
}

func TestRenderDir_NoVariablesIsNoop(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "a.txt"), []byte("{{X}}"), 0644))

	res, err := RenderDir(dir, nil, nil, nil)
	require.NoError(t, err)
	assert.Empty(t, res.SkippedFiles)
	assert.Empty(t, res.ChangedFiles)
	assert.Empty(t, res.RenamedFiles)

	content, err := os.ReadFile(filepath.Join(dir, "a.txt"))
	require.NoError(t, err)
	assert.Equal(t, "{{X}}", string(content))
}

func TestRenderDir_RawFilesOptOut(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "chart.yaml"), []byte("{{SERVICE_NAME}}"), 0644))

	res, err := RenderDir(dir, map[string]string{"SERVICE_NAME": "orders"}, []string{"chart.yaml"}, nil)
	require.NoError(t, err)
	assert.Empty(t, res.SkippedFiles)
	assert.Empty(t, res.ChangedFiles)

	content, err := os.ReadFile(filepath.Join(dir, "chart.yaml"))
	require.NoError(t, err)
	assert.Equal(t, "{{SERVICE_NAME}}", string(content), "raw-pattern-matched files are left byte-for-byte unmodified")
}
