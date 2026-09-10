package actions

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFetchGit_Execute_DefaultPath(t *testing.T) {
	src := initSourceGitRepoForFetch(t)
	workDir := t.TempDir()

	a := NewFetchGit(nil)
	raw, err := a.Execute(context.Background(), runCtxWithWorkDir(t, workDir), json.RawMessage(`{"url":"`+src+`"}`))
	require.NoError(t, err)

	var out fetchGitOutput
	require.NoError(t, json.Unmarshal(raw, &out))
	assert.Equal(t, filepath.Join(workDir, filepath.Base(src)), out.Path)
	assert.FileExists(t, filepath.Join(out.Path, "README.md"))
}

func TestFetchGit_Execute_CustomPathAndRef(t *testing.T) {
	src := initSourceGitRepoForFetch(t)
	workDir := t.TempDir()

	a := NewFetchGit(nil)
	raw, err := a.Execute(context.Background(), runCtxWithWorkDir(t, workDir), json.RawMessage(
		`{"url":"`+src+`","path":"nested/dest","ref":"v1"}`))
	require.NoError(t, err)

	var out fetchGitOutput
	require.NoError(t, json.Unmarshal(raw, &out))
	assert.Equal(t, filepath.Join(workDir, "nested", "dest"), out.Path)
	assert.FileExists(t, filepath.Join(out.Path, "README.md"))
}

func TestFetchGit_Execute_RejectsPathEscape(t *testing.T) {
	src := initSourceGitRepoForFetch(t)
	a := NewFetchGit(nil)
	_, err := a.Execute(context.Background(), runCtxWithWorkDir(t, t.TempDir()), json.RawMessage(
		`{"url":"`+src+`","path":"../../etc"}`))
	assert.ErrorContains(t, err, "escapes")
}

func TestFetchGit_Execute_RequiresWorkDir(t *testing.T) {
	a := NewFetchGit(nil)
	_, err := a.Execute(context.Background(), runCtx(), json.RawMessage(`{"url":"https://example.com/x.git"}`))
	assert.ErrorContains(t, err, "work directory")
}

func TestFetchGit_Execute_InstallationIdWithoutTokenService(t *testing.T) {
	a := NewFetchGit(nil)
	_, err := a.Execute(context.Background(), runCtxWithWorkDir(t, t.TempDir()), json.RawMessage(
		`{"url":"https://example.com/x.git","installationId":"i"}`))
	assert.ErrorContains(t, err, "token service")
}

func TestFetchGit_Execute_UsesToken(t *testing.T) {
	src := initSourceGitRepoForFetch(t)
	tok := &fakeTokenService{token: "tok"}
	a := NewFetchGit(tok)
	_, err := a.Execute(context.Background(), runCtxWithWorkDir(t, t.TempDir()), json.RawMessage(
		`{"url":"`+src+`","installationId":"inst-9"}`))
	require.NoError(t, err)
	assert.Equal(t, []string{"inst-9"}, tok.calls)
}

func TestFetchGit_Plan(t *testing.T) {
	a := NewFetchGit(nil)
	changes, err := a.Plan(context.Background(), runCtxWithWorkDir(t, "/work"), json.RawMessage(`{"url":"https://example.com/orders.git"}`))
	require.NoError(t, err)
	require.Len(t, changes, 1)
	assert.Equal(t, "fetch", changes[0].Kind)
}

func TestDeriveRepoDirName(t *testing.T) {
	cases := map[string]string{
		"https://github.com/acme/orders.git": "orders",
		"https://github.com/acme/orders":     "orders",
		"git@github.com:acme/orders.git":     "orders",
		"https://example.com/x/":             "x",
	}
	for url, want := range cases {
		assert.Equal(t, want, deriveRepoDirName(url), url)
	}
}

func TestFetchGit_SchemasAndRegistration(t *testing.T) {
	a := NewFetchGit(nil)
	r := scaffolder.NewRegistry(a)
	require.NoError(t, r.ValidateSchemas())
	d, ok := r.Descriptor("fetch:git")
	require.True(t, ok)
	assert.Equal(t, "fetch", d.Family)
}

func initSourceGitRepoForFetch(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	require.NoError(t, os.MkdirAll(src, 0755))
	run := func(args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = src
		out, err := cmd.CombinedOutput()
		require.NoError(t, err, string(out))
	}
	run("init")
	run("config", "user.name", "Test")
	run("config", "user.email", "test@example.com")
	require.NoError(t, os.WriteFile(filepath.Join(src, "README.md"), []byte("hi"), 0644))
	run("add", ".")
	run("commit", "-m", "init")
	run("tag", "v1")
	return src
}
