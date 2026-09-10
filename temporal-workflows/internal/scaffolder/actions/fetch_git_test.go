package actions

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"testing"

	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeClone returns a cloneFunc that records its arguments and, unless err
// is set, succeeds without touching the filesystem — Execute's
// orchestration is what's under test here, not git itself (that's covered
// directly against activities.CloneGitRepo).
func fakeClone(err error) (cloneFunc, *[]string) {
	var calls []string
	return func(_ context.Context, destDir, sourceURL, ref, token string) error {
		calls = append(calls, fmt.Sprintf("%s|%s|%s|%s", destDir, sourceURL, ref, token))
		return err
	}, &calls
}

func TestFetchGit_Execute_DefaultPath(t *testing.T) {
	clone, calls := fakeClone(nil)
	workDir := t.TempDir()

	a := NewFetchGit(nil)
	a.clone = clone
	raw, err := a.Execute(context.Background(), runCtxWithWorkDir(t, workDir), json.RawMessage(
		`{"url":"https://example.com/acme/orders.git"}`))
	require.NoError(t, err)

	var out fetchGitOutput
	require.NoError(t, json.Unmarshal(raw, &out))
	wantDest := filepath.Join(workDir, "orders")
	assert.Equal(t, wantDest, out.Path)
	require.Len(t, *calls, 1)
	assert.Contains(t, (*calls)[0], wantDest)
	assert.Contains(t, (*calls)[0], "https://example.com/acme/orders.git")
}

func TestFetchGit_Execute_CustomPathAndRef(t *testing.T) {
	clone, calls := fakeClone(nil)
	workDir := t.TempDir()

	a := NewFetchGit(nil)
	a.clone = clone
	raw, err := a.Execute(context.Background(), runCtxWithWorkDir(t, workDir), json.RawMessage(
		`{"url":"https://example.com/acme/orders.git","path":"nested/dest","ref":"v1"}`))
	require.NoError(t, err)

	var out fetchGitOutput
	require.NoError(t, json.Unmarshal(raw, &out))
	assert.Equal(t, filepath.Join(workDir, "nested", "dest"), out.Path)
	require.Len(t, *calls, 1)
	assert.Contains(t, (*calls)[0], "|v1|")
}

func TestFetchGit_Execute_RejectsPathEscape(t *testing.T) {
	clone, calls := fakeClone(nil)
	a := NewFetchGit(nil)
	a.clone = clone
	_, err := a.Execute(context.Background(), runCtxWithWorkDir(t, t.TempDir()), json.RawMessage(
		`{"url":"https://example.com/acme/orders.git","path":"../../etc"}`))
	assert.ErrorContains(t, err, "escapes")
	assert.Empty(t, *calls, "clone must not be attempted once the destination is rejected")
}

func TestFetchGit_Execute_RequiresWorkDir(t *testing.T) {
	clone, calls := fakeClone(nil)
	a := NewFetchGit(nil)
	a.clone = clone
	_, err := a.Execute(context.Background(), runCtx(), json.RawMessage(`{"url":"https://example.com/x.git"}`))
	assert.ErrorContains(t, err, "work directory")
	assert.Empty(t, *calls)
}

func TestFetchGit_Execute_InstallationIdWithoutTokenService(t *testing.T) {
	clone, calls := fakeClone(nil)
	a := NewFetchGit(nil)
	a.clone = clone
	_, err := a.Execute(context.Background(), runCtxWithWorkDir(t, t.TempDir()), json.RawMessage(
		`{"url":"https://example.com/x.git","installationId":"i"}`))
	assert.ErrorContains(t, err, "token service")
	assert.Empty(t, *calls)
}

func TestFetchGit_Execute_UsesToken(t *testing.T) {
	clone, calls := fakeClone(nil)
	tok := &fakeTokenService{token: "tok"}
	a := NewFetchGit(tok)
	a.clone = clone
	_, err := a.Execute(context.Background(), runCtxWithWorkDir(t, t.TempDir()), json.RawMessage(
		`{"url":"https://example.com/x.git","installationId":"inst-9"}`))
	require.NoError(t, err)
	assert.Equal(t, []string{"inst-9"}, tok.calls)
	require.Len(t, *calls, 1)
	assert.Contains(t, (*calls)[0], "|tok")
}

func TestFetchGit_Execute_CloneError(t *testing.T) {
	clone, _ := fakeClone(fmt.Errorf("clone exploded"))
	a := NewFetchGit(nil)
	a.clone = clone
	_, err := a.Execute(context.Background(), runCtxWithWorkDir(t, t.TempDir()), json.RawMessage(
		`{"url":"https://example.com/x.git"}`))
	assert.ErrorContains(t, err, "clone exploded")
}

func TestFetchGit_Execute_RejectsUnsafeURL(t *testing.T) {
	cases := []string{
		"/etc/passwd",
		"file:///etc/passwd",
		"ext::sh -c 'touch /tmp/pwned'",
		"../relative/path",
		"",
	}
	for _, url := range cases {
		t.Run(url, func(t *testing.T) {
			clone, calls := fakeClone(nil)
			a := NewFetchGit(nil)
			a.clone = clone
			_, err := a.Execute(context.Background(), runCtxWithWorkDir(t, t.TempDir()), json.RawMessage(
				`{"url":`+jsonStr(url)+`}`))
			assert.Error(t, err)
			assert.Empty(t, *calls, "clone must never be invoked for an unsafe url")
		})
	}
}

func jsonStr(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func TestFetchGit_Plan(t *testing.T) {
	a := NewFetchGit(nil)
	changes, err := a.Plan(context.Background(), runCtxWithWorkDir(t, "/work"), json.RawMessage(`{"url":"https://example.com/orders.git"}`))
	require.NoError(t, err)
	require.Len(t, changes, 1)
	assert.Equal(t, "fetch", changes[0].Kind)
}

func TestFetchGit_Plan_RejectsUnsafeURL(t *testing.T) {
	a := NewFetchGit(nil)
	_, err := a.Plan(context.Background(), runCtxWithWorkDir(t, "/work"), json.RawMessage(`{"url":"/etc/passwd"}`))
	assert.Error(t, err)
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
