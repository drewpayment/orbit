package actions

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakePush returns a pushFunc that records its input and, unless err is
// set, succeeds without touching the filesystem — Execute's orchestration
// is what's under test here, not git itself (that's covered directly
// against activities.PushRepo).
func fakePush(err error) (pushFunc, *[]activities.PushRepoInput) {
	var calls []activities.PushRepoInput
	return func(_ context.Context, in activities.PushRepoInput) error {
		calls = append(calls, in)
		return err
	}, &calls
}

func TestGitPush_Execute(t *testing.T) {
	push, calls := fakePush(nil)
	workDir := t.TempDir()

	a := NewGitPush(nil)
	a.push = push
	raw, err := a.Execute(context.Background(), runCtxWithWorkDir(t, workDir), json.RawMessage(
		`{"path":"`+workDir+`","repoUrl":"https://example.com/acme/orders.git"}`))
	require.NoError(t, err)

	var out gitPushOutput
	require.NoError(t, json.Unmarshal(raw, &out))
	assert.Equal(t, "https://example.com/acme/orders.git", out.RepoURL)
	assert.Equal(t, "main", out.Branch)

	require.Len(t, *calls, 1)
	assert.Equal(t, workDir, (*calls)[0].WorkDir)
	assert.Equal(t, "https://example.com/acme/orders.git", (*calls)[0].RepoURL)
	assert.Equal(t, "main", (*calls)[0].Branch)
}

func TestGitPush_MissingFields(t *testing.T) {
	workDir := t.TempDir()
	push, calls := fakePush(nil)
	a := NewGitPush(nil)
	a.push = push
	_, err := a.Execute(context.Background(), runCtxWithWorkDir(t, workDir), json.RawMessage(`{"repoUrl":"https://example.com/x.git"}`))
	assert.Error(t, err)
	_, err = a.Execute(context.Background(), runCtxWithWorkDir(t, workDir), json.RawMessage(`{"path":"`+workDir+`"}`))
	assert.Error(t, err)
	assert.Empty(t, *calls)
}

func TestGitPush_RejectsPathOutsideWorkDir(t *testing.T) {
	outside := t.TempDir()
	push, calls := fakePush(nil)
	a := NewGitPush(nil)
	a.push = push
	_, err := a.Execute(context.Background(), runCtxWithWorkDir(t, t.TempDir()), json.RawMessage(
		`{"path":"`+outside+`","repoUrl":"https://example.com/x.git"}`))
	assert.ErrorContains(t, err, "work directory")
	assert.Empty(t, *calls)
}

func TestGitPush_InstallationIdWithoutTokenService(t *testing.T) {
	workDir := t.TempDir()
	push, calls := fakePush(nil)
	a := NewGitPush(nil)
	a.push = push
	_, err := a.Execute(context.Background(), runCtxWithWorkDir(t, workDir), json.RawMessage(
		`{"path":"`+workDir+`","repoUrl":"https://example.com/x.git","installationId":"i"}`))
	assert.ErrorContains(t, err, "token service")
	assert.Empty(t, *calls)
}

func TestGitPush_UsesToken(t *testing.T) {
	workDir := t.TempDir()
	push, calls := fakePush(nil)
	tok := &fakeTokenService{token: "tok"}
	a := NewGitPush(tok)
	a.push = push
	_, err := a.Execute(context.Background(), runCtxWithWorkDir(t, workDir), json.RawMessage(
		`{"path":"`+workDir+`","repoUrl":"https://example.com/x.git","installationId":"inst-1"}`))
	require.NoError(t, err)
	assert.Equal(t, []string{"inst-1"}, tok.calls)
	require.Len(t, *calls, 1)
	assert.Equal(t, "tok", (*calls)[0].Token)
}

func TestGitPush_PushError(t *testing.T) {
	workDir := t.TempDir()
	push, _ := fakePush(fmt.Errorf("push exploded"))
	a := NewGitPush(nil)
	a.push = push
	_, err := a.Execute(context.Background(), runCtxWithWorkDir(t, workDir), json.RawMessage(
		`{"path":"`+workDir+`","repoUrl":"https://example.com/x.git"}`))
	assert.ErrorContains(t, err, "push exploded")
}

func TestGitPush_Execute_RejectsUnsafeRepoURL(t *testing.T) {
	cases := []string{
		"/etc/passwd",
		"file:///etc/passwd",
		"ext::sh -c 'touch /tmp/pwned'",
		"../relative/path",
	}
	for _, url := range cases {
		t.Run(url, func(t *testing.T) {
			workDir := t.TempDir()
			push, calls := fakePush(nil)
			a := NewGitPush(nil)
			a.push = push
			_, err := a.Execute(context.Background(), runCtxWithWorkDir(t, workDir), json.RawMessage(
				`{"path":"`+workDir+`","repoUrl":`+jsonStr(url)+`}`))
			assert.Error(t, err)
			assert.Empty(t, *calls, "push must never be invoked for an unsafe repoUrl")
		})
	}
}

func TestGitPush_Plan(t *testing.T) {
	workDir := t.TempDir()
	a := NewGitPush(nil)
	changes, err := a.Plan(context.Background(), runCtxWithWorkDir(t, workDir), json.RawMessage(
		`{"path":"`+workDir+`","repoUrl":"https://example.com/orders.git"}`))
	require.NoError(t, err)
	require.Len(t, changes, 1)
	assert.Equal(t, "push", changes[0].Kind)
}

func TestGitPush_Plan_RejectsUnsafeRepoURL(t *testing.T) {
	workDir := t.TempDir()
	a := NewGitPush(nil)
	_, err := a.Plan(context.Background(), runCtxWithWorkDir(t, workDir), json.RawMessage(
		`{"path":"`+workDir+`","repoUrl":"/etc/passwd"}`))
	assert.Error(t, err)
}

func TestGitPush_SchemasAndRegistration(t *testing.T) {
	a := NewGitPush(nil)
	assert.Equal(t, "git:push", a.Name())
	r := scaffolder.NewRegistry(a)
	require.NoError(t, r.ValidateSchemas())
	d, ok := r.Descriptor("git:push")
	require.True(t, ok)
	assert.Equal(t, "git", d.Family)
}
