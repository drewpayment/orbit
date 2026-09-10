package actions

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeSkeletonClient is a services.SkeletonClient test double. manifest and
// bundle are returned verbatim (a real client would strip Content from the
// manifest response; callers set that up themselves) unless err is set, in
// which case every call fails with err.
type fakeSkeletonClient struct {
	manifest *services.SkeletonBundle
	bundle   *services.SkeletonBundle
	err      error

	manifestCalls [][2]string
	bundleCalls   [][2]string
}

func (f *fakeSkeletonClient) GetSkeletonManifest(_ context.Context, skeletonID, workspaceID string) (*services.SkeletonBundle, error) {
	f.manifestCalls = append(f.manifestCalls, [2]string{skeletonID, workspaceID})
	if f.err != nil {
		return nil, f.err
	}
	return f.manifest, nil
}

func (f *fakeSkeletonClient) GetSkeletonBundle(_ context.Context, skeletonID, workspaceID string) (*services.SkeletonBundle, error) {
	f.bundleCalls = append(f.bundleCalls, [2]string{skeletonID, workspaceID})
	if f.err != nil {
		return nil, f.err
	}
	return f.bundle, nil
}

func sampleBundle() *services.SkeletonBundle {
	return &services.SkeletonBundle{
		ID:        "skel-1",
		Name:      "Node service",
		Slug:      "node-service",
		Version:   1,
		TotalSize: 30,
		Files: []services.SkeletonFile{
			{Path: "package.json", Size: 20, Content: `{"name":"x"}`},
			{Path: "src/index.ts", Size: 10, Content: "console.log('hi')"},
		},
	}
}

func sampleManifest() *services.SkeletonBundle {
	b := sampleBundle()
	for i := range b.Files {
		b.Files[i].Content = ""
	}
	return b
}

func runCtxWithWorkspace(t *testing.T, dir, workspaceID string) scaffolder.ActionRunContext {
	t.Helper()
	return scaffolder.NewActionRunContext(scaffolder.ActionRunContext{
		RunID: "run-1", WorkDir: dir, WorkspaceID: workspaceID,
	})
}

func TestFetchOrbitSkeleton_Execute_DefaultPath(t *testing.T) {
	client := &fakeSkeletonClient{bundle: sampleBundle()}
	a := NewFetchOrbitSkeleton(client)
	workDir := t.TempDir()

	raw, err := a.Execute(context.Background(), runCtxWithWorkspace(t, workDir, "ws-1"),
		json.RawMessage(`{"skeletonId":"skel-1"}`))
	require.NoError(t, err)

	var out fetchOrbitSkeletonOutput
	require.NoError(t, json.Unmarshal(raw, &out))
	wantDest := filepath.Join(workDir, "skel-1")
	assert.Equal(t, wantDest, out.Path)
	assert.ElementsMatch(t, []string{"package.json", "src/index.ts"}, out.Files)

	content, err := os.ReadFile(filepath.Join(wantDest, "package.json"))
	require.NoError(t, err)
	assert.Equal(t, `{"name":"x"}`, string(content))

	content, err = os.ReadFile(filepath.Join(wantDest, "src", "index.ts"))
	require.NoError(t, err)
	assert.Equal(t, "console.log('hi')", string(content))

	require.Len(t, client.bundleCalls, 1)
	assert.Equal(t, [2]string{"skel-1", "ws-1"}, client.bundleCalls[0])
}

func TestFetchOrbitSkeleton_Execute_CustomPath(t *testing.T) {
	client := &fakeSkeletonClient{bundle: sampleBundle()}
	a := NewFetchOrbitSkeleton(client)
	workDir := t.TempDir()

	raw, err := a.Execute(context.Background(), runCtxWithWorkspace(t, workDir, "ws-1"),
		json.RawMessage(`{"skeletonId":"skel-1","path":"nested/dest"}`))
	require.NoError(t, err)

	var out fetchOrbitSkeletonOutput
	require.NoError(t, json.Unmarshal(raw, &out))
	assert.Equal(t, filepath.Join(workDir, "nested", "dest"), out.Path)
	assert.FileExists(t, filepath.Join(workDir, "nested", "dest", "package.json"))
}

func TestFetchOrbitSkeleton_Execute_RequiresWorkDir(t *testing.T) {
	client := &fakeSkeletonClient{bundle: sampleBundle()}
	a := NewFetchOrbitSkeleton(client)
	_, err := a.Execute(context.Background(), runCtxWithWorkspace(t, "", "ws-1"),
		json.RawMessage(`{"skeletonId":"skel-1"}`))
	assert.ErrorContains(t, err, "work directory")
	assert.Empty(t, client.bundleCalls, "must not fetch once the work dir check fails")
}

func TestFetchOrbitSkeleton_Execute_RequiresSkeletonID(t *testing.T) {
	client := &fakeSkeletonClient{bundle: sampleBundle()}
	a := NewFetchOrbitSkeleton(client)
	_, err := a.Execute(context.Background(), runCtxWithWorkspace(t, t.TempDir(), "ws-1"),
		json.RawMessage(`{}`))
	assert.ErrorIs(t, err, scaffolder.ErrInvalidInput)
	assert.Empty(t, client.bundleCalls)
}

func TestFetchOrbitSkeleton_Execute_RejectsPathEscape(t *testing.T) {
	client := &fakeSkeletonClient{bundle: sampleBundle()}
	a := NewFetchOrbitSkeleton(client)
	_, err := a.Execute(context.Background(), runCtxWithWorkspace(t, t.TempDir(), "ws-1"),
		json.RawMessage(`{"skeletonId":"skel-1","path":"../../etc"}`))
	assert.ErrorContains(t, err, "escapes")
	assert.Empty(t, client.bundleCalls, "must not fetch once the destination is rejected")
}

func TestFetchOrbitSkeleton_Execute_NoClientConfigured(t *testing.T) {
	a := NewFetchOrbitSkeleton(nil)
	_, err := a.Execute(context.Background(), runCtxWithWorkspace(t, t.TempDir(), "ws-1"),
		json.RawMessage(`{"skeletonId":"skel-1"}`))
	assert.ErrorContains(t, err, "no skeleton client configured")
}

func TestFetchOrbitSkeleton_Execute_MapsNotFoundToInvalidInput(t *testing.T) {
	client := &fakeSkeletonClient{err: services.ErrSkeletonNotFound}
	a := NewFetchOrbitSkeleton(client)
	_, err := a.Execute(context.Background(), runCtxWithWorkspace(t, t.TempDir(), "ws-1"),
		json.RawMessage(`{"skeletonId":"skel-1"}`))
	require.Error(t, err)
	assert.ErrorIs(t, err, scaffolder.ErrInvalidInput)
}

func TestFetchOrbitSkeleton_Execute_OtherClientErrorNotInvalidInput(t *testing.T) {
	client := &fakeSkeletonClient{err: errors.New("network exploded")}
	a := NewFetchOrbitSkeleton(client)
	_, err := a.Execute(context.Background(), runCtxWithWorkspace(t, t.TempDir(), "ws-1"),
		json.RawMessage(`{"skeletonId":"skel-1"}`))
	require.Error(t, err)
	assert.NotErrorIs(t, err, scaffolder.ErrInvalidInput)
	assert.ErrorContains(t, err, "network exploded")
}

func TestFetchOrbitSkeleton_Execute_RejectsMaliciousManifest(t *testing.T) {
	cases := map[string][]services.SkeletonFile{
		"absolute path": {{Path: "/etc/passwd", Content: "pwned"}},
		"parent escape": {{Path: "../../etc/passwd", Content: "pwned"}},
		"nested escape": {{Path: "a/../../etc/passwd", Content: "pwned"}},
		"backslash":     {{Path: `..\..\evil`, Content: "pwned"}},
		"empty path":    {{Path: "", Content: "pwned"}},
	}
	for name, files := range cases {
		t.Run(name, func(t *testing.T) {
			workDir := t.TempDir()
			client := &fakeSkeletonClient{bundle: &services.SkeletonBundle{
				ID: "skel-1", Name: "evil", Files: files,
			}}
			a := NewFetchOrbitSkeleton(client)
			_, err := a.Execute(context.Background(), runCtxWithWorkspace(t, workDir, "ws-1"),
				json.RawMessage(`{"skeletonId":"skel-1"}`))
			require.Error(t, err)
			assert.ErrorIs(t, err, scaffolder.ErrInvalidInput)

			// Nothing must be written outside the run's work dir.
			_, statErr := os.Stat("/etc/passwd-orbit-fetch-skeleton-test-marker")
			assert.True(t, os.IsNotExist(statErr))
		})
	}
}

func TestFetchOrbitSkeleton_Execute_RejectsMaliciousManifest_NoPartialWrite(t *testing.T) {
	// A malicious file later in the list must not leave earlier files
	// written: validate every path before writing any of them.
	workDir := t.TempDir()
	client := &fakeSkeletonClient{bundle: &services.SkeletonBundle{
		ID: "skel-1",
		Files: []services.SkeletonFile{
			{Path: "good.txt", Content: "fine"},
			{Path: "../escape.txt", Content: "pwned"},
		},
	}}
	a := NewFetchOrbitSkeleton(client)
	_, err := a.Execute(context.Background(), runCtxWithWorkspace(t, workDir, "ws-1"),
		json.RawMessage(`{"skeletonId":"skel-1"}`))
	require.Error(t, err)

	dest := filepath.Join(workDir, "skel-1")
	_, statErr := os.Stat(filepath.Join(dest, "good.txt"))
	assert.True(t, os.IsNotExist(statErr), "no file should be written when any file in the bundle is rejected")
	_, statErr = os.Stat(filepath.Join(workDir, "escape.txt"))
	assert.True(t, os.IsNotExist(statErr))
}

func TestFetchOrbitSkeleton_Plan(t *testing.T) {
	client := &fakeSkeletonClient{manifest: sampleManifest()}
	a := NewFetchOrbitSkeleton(client)
	changes, err := a.Plan(context.Background(), runCtxWithWorkspace(t, "/work", "ws-1"),
		json.RawMessage(`{"skeletonId":"skel-1"}`))
	require.NoError(t, err)
	require.Len(t, changes, 1)
	assert.Equal(t, "fetch", changes[0].Kind)
	assert.Equal(t, "Node service", changes[0].Name)

	require.Len(t, client.manifestCalls, 1)
	assert.Equal(t, [2]string{"skel-1", "ws-1"}, client.manifestCalls[0])
	assert.Empty(t, client.bundleCalls, "Plan must use the manifest, not the full bundle")
}

func TestFetchOrbitSkeleton_Plan_RequiresSkeletonID(t *testing.T) {
	a := NewFetchOrbitSkeleton(&fakeSkeletonClient{})
	_, err := a.Plan(context.Background(), runCtxWithWorkspace(t, "/work", "ws-1"), json.RawMessage(`{}`))
	assert.ErrorIs(t, err, scaffolder.ErrInvalidInput)
}

func TestFetchOrbitSkeleton_Plan_MapsNotFound(t *testing.T) {
	client := &fakeSkeletonClient{err: services.ErrSkeletonNotFound}
	a := NewFetchOrbitSkeleton(client)
	_, err := a.Plan(context.Background(), runCtxWithWorkspace(t, "/work", "ws-1"),
		json.RawMessage(`{"skeletonId":"skel-1"}`))
	assert.ErrorIs(t, err, scaffolder.ErrInvalidInput)
}

func TestFetchOrbitSkeleton_PlanPreview(t *testing.T) {
	client := &fakeSkeletonClient{bundle: sampleBundle()}
	a := NewFetchOrbitSkeleton(client)
	destDir := t.TempDir()

	changes, err := a.PlanPreview(context.Background(), runCtxWithWorkspace(t, "/work", "ws-1"),
		json.RawMessage(`{"skeletonId":"skel-1"}`), destDir)
	require.NoError(t, err)
	require.Len(t, changes, 2)
	for _, c := range changes {
		assert.Equal(t, "file", c.Kind)
	}

	content, err := os.ReadFile(filepath.Join(destDir, "package.json"))
	require.NoError(t, err)
	assert.Equal(t, `{"name":"x"}`, string(content))

	require.Len(t, client.bundleCalls, 1)
	assert.Equal(t, [2]string{"skel-1", "ws-1"}, client.bundleCalls[0])
	assert.Empty(t, client.manifestCalls, "PlanPreview must fetch the full bundle, not just the manifest")
}

func TestFetchOrbitSkeleton_PlanPreview_RequiresDestDir(t *testing.T) {
	a := NewFetchOrbitSkeleton(&fakeSkeletonClient{bundle: sampleBundle()})
	_, err := a.PlanPreview(context.Background(), runCtxWithWorkspace(t, "/work", "ws-1"),
		json.RawMessage(`{"skeletonId":"skel-1"}`), "")
	assert.Error(t, err)
}

func TestFetchOrbitSkeleton_PlanPreview_RejectsMaliciousManifest(t *testing.T) {
	destDir := t.TempDir()
	client := &fakeSkeletonClient{bundle: &services.SkeletonBundle{
		ID:    "skel-1",
		Files: []services.SkeletonFile{{Path: "../../escape.txt", Content: "pwned"}},
	}}
	a := NewFetchOrbitSkeleton(client)
	_, err := a.PlanPreview(context.Background(), runCtxWithWorkspace(t, "/work", "ws-1"),
		json.RawMessage(`{"skeletonId":"skel-1"}`), destDir)
	require.Error(t, err)
	assert.ErrorIs(t, err, scaffolder.ErrInvalidInput)

	entries, readErr := os.ReadDir(destDir)
	require.NoError(t, readErr)
	assert.Empty(t, entries, "no file should be written when the manifest is rejected")
}

func TestFetchOrbitSkeleton_SchemasAndRegistration(t *testing.T) {
	a := NewFetchOrbitSkeleton(nil)
	r := scaffolder.NewRegistry(a)
	require.NoError(t, r.ValidateSchemas())
	d, ok := r.Descriptor("fetch:orbit-skeleton")
	require.True(t, ok)
	assert.Equal(t, "fetch", d.Family)
}
