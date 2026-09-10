package actions

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fsRenderTestDir returns a directory under a fresh run work dir, so
// requireWithinWorkDir accepts it.
func fsRenderTestDir(t *testing.T) (workDir, dir string) {
	t.Helper()
	workDir = t.TempDir()
	dir = filepath.Join(workDir, "src")
	require.NoError(t, os.MkdirAll(dir, 0755))
	return workDir, dir
}

func TestFSRender_Execute_RendersInPlace(t *testing.T) {
	workDir, dir := fsRenderTestDir(t)
	require.NoError(t, os.WriteFile(filepath.Join(dir, "{{SERVICE_NAME}}.go"), []byte("package {{SERVICE_NAME}}"), 0644))

	a := NewFSRender()
	raw, err := a.Execute(context.Background(), runCtxWithWorkDir(t, workDir), json.RawMessage(
		`{"path":"`+dir+`","values":{"SERVICE_NAME":"orders"}}`))
	require.NoError(t, err)

	var out fsRenderOutput
	require.NoError(t, json.Unmarshal(raw, &out))
	assert.Equal(t, dir, out.Path)
	assert.Empty(t, out.SkippedFiles)
	assert.FileExists(t, filepath.Join(dir, "orders.go"))
}

func TestFSRender_Execute_MissingFields(t *testing.T) {
	workDir, _ := fsRenderTestDir(t)
	a := NewFSRender()
	_, err := a.Execute(context.Background(), runCtxWithWorkDir(t, workDir), json.RawMessage(`{"path":""}`))
	assert.Error(t, err)
	_, err = a.Execute(context.Background(), runCtxWithWorkDir(t, workDir), json.RawMessage(`{"path":"`+workDir+`"}`))
	assert.Error(t, err, "empty values should be rejected")
}

func TestFSRender_Execute_RejectsPathOutsideWorkDir(t *testing.T) {
	outside := t.TempDir()
	a := NewFSRender()
	_, err := a.Execute(context.Background(), runCtxWithWorkDir(t, t.TempDir()), json.RawMessage(
		`{"path":"`+outside+`","values":{"X":"y"}}`))
	assert.ErrorContains(t, err, "work directory")
}

func TestFSRender_Execute_RequiresWorkDir(t *testing.T) {
	a := NewFSRender()
	_, err := a.Execute(context.Background(), runCtx(), json.RawMessage(`{"path":"/tmp/x","values":{"X":"y"}}`))
	assert.ErrorContains(t, err, "work directory")
}

func TestFSRender_Plan_DoesNotTouchSource(t *testing.T) {
	workDir, dir := fsRenderTestDir(t)
	require.NoError(t, os.WriteFile(filepath.Join(dir, "{{SERVICE_NAME}}.go"), []byte("package {{SERVICE_NAME}}"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "unchanged.go"), []byte("package main"), 0644))

	a := NewFSRender()
	changes, err := a.Plan(context.Background(), runCtxWithWorkDir(t, workDir), json.RawMessage(
		`{"path":"`+dir+`","values":{"SERVICE_NAME":"orders"}}`))
	require.NoError(t, err)

	// Source untouched.
	assert.NoFileExists(t, filepath.Join(dir, "orders.go"))
	assert.FileExists(t, filepath.Join(dir, "{{SERVICE_NAME}}.go"))

	require.Len(t, changes, 1)
	assert.Equal(t, "file", changes[0].Kind)
	assert.Equal(t, "orders.go", changes[0].Name)
	assert.Contains(t, changes[0].Description, "update content and rename")
}

func TestFSRender_Plan_RawFilesUntouched(t *testing.T) {
	workDir, dir := fsRenderTestDir(t)
	require.NoError(t, os.WriteFile(filepath.Join(dir, "chart.yaml"), []byte("{{SERVICE_NAME}}"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "orbit-template.yaml"), []byte("rawFiles:\n  - chart.yaml\n"), 0644))

	a := NewFSRender()
	changes, err := a.Plan(context.Background(), runCtxWithWorkDir(t, workDir), json.RawMessage(
		`{"path":"`+dir+`","values":{"SERVICE_NAME":"orders"}}`))
	require.NoError(t, err)
	assert.Empty(t, changes)
}

func TestFSRender_SchemasAndRegistration(t *testing.T) {
	a := NewFSRender()
	assert.Equal(t, "fs:render", a.Name())
	r := scaffolder.NewRegistry(a)
	require.NoError(t, r.ValidateSchemas())
	d, ok := r.Descriptor("fs:render")
	require.True(t, ok)
	assert.Equal(t, "fs", d.Family)
	assert.True(t, d.SupportsPlan)
}

func TestCopyDir(t *testing.T) {
	src := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(src, "nested"), 0755))
	require.NoError(t, os.WriteFile(filepath.Join(src, "nested", "a.txt"), []byte("a"), 0644))

	dst := filepath.Join(t.TempDir(), "copy")
	require.NoError(t, copyDir(src, dst))

	content, err := os.ReadFile(filepath.Join(dst, "nested", "a.txt"))
	require.NoError(t, err)
	assert.Equal(t, "a", string(content))
}

// TestFSRender_PlanPreview_LeavesRenderedTreeBehind pins the contract the
// dry-run dispatch activity depends on: PlanPreview must render into the
// caller's directory (so the tree can be uploaded for the diff viewer) and
// must leave the real work dir untouched.
func TestFSRender_PlanPreview_LeavesRenderedTreeBehind(t *testing.T) {
	workDir := t.TempDir()
	src := filepath.Join(workDir, "repo")
	require.NoError(t, os.MkdirAll(src, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(src, "README.md"), []byte("# {{ .serviceName }}"), 0o644))

	dest := filepath.Join(t.TempDir(), "preview")
	require.NoError(t, os.MkdirAll(dest, 0o755))

	a := NewFSRender()
	rc := scaffolder.NewActionRunContext(scaffolder.ActionRunContext{WorkDir: workDir})
	input := json.RawMessage(`{"path":` + strconv.Quote(src) + `,"values":{"serviceName":"orders"}}`)

	changes, err := a.PlanPreview(context.Background(), rc, input, dest)
	require.NoError(t, err)
	require.NotEmpty(t, changes)

	rendered, err := os.ReadFile(filepath.Join(dest, "README.md"))
	require.NoError(t, err)
	assert.Equal(t, "# orders", string(rendered))

	original, err := os.ReadFile(filepath.Join(src, "README.md"))
	require.NoError(t, err)
	assert.Equal(t, "# {{ .serviceName }}", string(original), "planning must not mutate the work dir")
}

func TestFSRender_PlanPreview_RequiresDestination(t *testing.T) {
	workDir := t.TempDir()
	src := filepath.Join(workDir, "repo")
	require.NoError(t, os.MkdirAll(src, 0o755))

	a := NewFSRender()
	rc := scaffolder.NewActionRunContext(scaffolder.ActionRunContext{WorkDir: workDir})
	input := json.RawMessage(`{"path":` + strconv.Quote(src) + `,"values":{"a":"b"}}`)

	_, err := a.PlanPreview(context.Background(), rc, input, "  ")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "preview destination directory is required")
}
