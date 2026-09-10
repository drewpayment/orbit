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

func runCtxWithWorkDir(t *testing.T, dir string) scaffolder.ActionRunContext {
	t.Helper()
	return scaffolder.NewActionRunContext(scaffolder.ActionRunContext{RunID: "run-1", WorkDir: dir})
}

func TestGitHubRepoCreateFromTemplate_Execute(t *testing.T) {
	// The "created repository" is a real local git repo so CloneGitRepo has
	// something to clone.
	srcDir := t.TempDir()
	repo := filepath.Join(srcDir, "repo")
	require.NoError(t, os.MkdirAll(repo, 0755))
	run := func(args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = repo
		out, err := cmd.CombinedOutput()
		require.NoError(t, err, string(out))
	}
	run("init")
	run("config", "user.name", "Test")
	run("config", "user.email", "test@example.com")
	require.NoError(t, os.WriteFile(filepath.Join(repo, "README.md"), []byte("hi"), 0644))
	run("add", ".")
	run("commit", "-m", "init")

	tok := &fakeTokenService{token: "tok-123"}
	client := &fakeGitHubRepoClient{fromTemplateURL: repo}
	a := NewGitHubRepoCreateFromTemplate(tok, func(token string) GitHubRepoClient {
		client.lastToken = token
		return client
	})

	workDir := t.TempDir()
	raw, err := a.Execute(context.Background(), runCtxWithWorkDir(t, workDir), json.RawMessage(
		`{"sourceOwner":"acme","sourceRepo":"tmpl","targetOrg":"acme","name":"orders","installationId":"inst-1"}`))
	require.NoError(t, err)

	var out githubRepoCreateFromTemplateOutput
	require.NoError(t, json.Unmarshal(raw, &out))
	assert.Equal(t, repo, out.RepoURL)
	assert.Equal(t, "orders", out.RepoName)
	assert.Equal(t, filepath.Join(workDir, "checkout"), out.Checkout)
	assert.FileExists(t, filepath.Join(out.Checkout, "README.md"))
	assert.Equal(t, "acme", client.gotSourceOwner)
	assert.Equal(t, "tmpl", client.gotSourceRepo)
}

func TestGitHubRepoCreateFromTemplate_RequiresWorkDir(t *testing.T) {
	a := NewGitHubRepoCreateFromTemplate(&fakeTokenService{token: "t"}, func(string) GitHubRepoClient {
		return &fakeGitHubRepoClient{}
	})
	_, err := a.Execute(context.Background(), runCtx(), json.RawMessage(
		`{"sourceOwner":"a","sourceRepo":"b","targetOrg":"c","name":"d","installationId":"i"}`))
	assert.ErrorContains(t, err, "work directory")
}

func TestGitHubRepoCreateFromTemplate_MissingFields(t *testing.T) {
	a := NewGitHubRepoCreateFromTemplate(&fakeTokenService{}, nil)
	_, err := a.Execute(context.Background(), runCtxWithWorkDir(t, t.TempDir()), json.RawMessage(`{}`))
	assert.Error(t, err)
}

func TestGitHubRepoCreateFromTemplate_Plan(t *testing.T) {
	a := NewGitHubRepoCreateFromTemplate(&fakeTokenService{}, nil)
	changes, err := a.Plan(context.Background(), runCtx(), json.RawMessage(
		`{"sourceOwner":"a","sourceRepo":"b","targetOrg":"c","name":"orders","installationId":"i"}`))
	require.NoError(t, err)
	require.Len(t, changes, 1)
	assert.Equal(t, "repo", changes[0].Kind)
	assert.Equal(t, "orders", changes[0].Name)
}

func TestGitHubRepoCreateFromTemplate_SchemasAndRegistration(t *testing.T) {
	a := NewGitHubRepoCreateFromTemplate(&fakeTokenService{}, nil)
	assert.Equal(t, "github:repo:create-from-template", a.Name())

	r := scaffolder.NewRegistry(a)
	require.NoError(t, r.ValidateSchemas())
	keys, err := r.OutputKeys("github:repo:create-from-template")
	require.NoError(t, err)
	assert.ElementsMatch(t, []string{"repoUrl", "repoName", "checkout"}, keys)
}
