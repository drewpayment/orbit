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

func TestGitPush_Execute(t *testing.T) {
	remoteDir := t.TempDir()
	remote := filepath.Join(remoteDir, "remote.git")
	require.NoError(t, exec.Command("git", "init", "--bare", remote).Run())

	workDir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(workDir, "file.txt"), []byte("hi"), 0644))

	a := NewGitPush(nil)
	raw, err := a.Execute(context.Background(), runCtxWithWorkDir(t, workDir), json.RawMessage(
		`{"path":"`+workDir+`","repoUrl":"`+remote+`"}`))
	require.NoError(t, err)

	var out gitPushOutput
	require.NoError(t, json.Unmarshal(raw, &out))
	assert.Equal(t, remote, out.RepoURL)
	assert.Equal(t, "main", out.Branch)

	clone := filepath.Join(t.TempDir(), "verify")
	require.NoError(t, exec.Command("git", "clone", remote, clone).Run())
	assert.FileExists(t, filepath.Join(clone, "file.txt"))
}

func TestGitPush_MissingFields(t *testing.T) {
	workDir := t.TempDir()
	a := NewGitPush(nil)
	_, err := a.Execute(context.Background(), runCtxWithWorkDir(t, workDir), json.RawMessage(`{"repoUrl":"x"}`))
	assert.Error(t, err)
	_, err = a.Execute(context.Background(), runCtxWithWorkDir(t, workDir), json.RawMessage(`{"path":"x"}`))
	assert.Error(t, err)
}

func TestGitPush_RejectsPathOutsideWorkDir(t *testing.T) {
	outside := t.TempDir()
	a := NewGitPush(nil)
	_, err := a.Execute(context.Background(), runCtxWithWorkDir(t, t.TempDir()), json.RawMessage(
		`{"path":"`+outside+`","repoUrl":"https://example.com/x.git"}`))
	assert.ErrorContains(t, err, "work directory")
}

func TestGitPush_InstallationIdWithoutTokenService(t *testing.T) {
	workDir := t.TempDir()
	a := NewGitPush(nil)
	_, err := a.Execute(context.Background(), runCtxWithWorkDir(t, workDir), json.RawMessage(
		`{"path":"`+workDir+`","repoUrl":"https://example.com/x.git","installationId":"i"}`))
	assert.ErrorContains(t, err, "token service")
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

func TestGitPush_SchemasAndRegistration(t *testing.T) {
	a := NewGitPush(nil)
	assert.Equal(t, "git:push", a.Name())
	r := scaffolder.NewRegistry(a)
	require.NoError(t, r.ValidateSchemas())
	d, ok := r.Descriptor("git:push")
	require.True(t, ok)
	assert.Equal(t, "git", d.Family)
}
