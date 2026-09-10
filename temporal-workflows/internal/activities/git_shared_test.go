package activities

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// allowLocalGitProtocol lets a test's own local bare-path fixtures (a
// TempDir standing in for a real remote) pass the protocol.file.allow=never
// guard runGitCommand always sets. GIT_ALLOW_PROTOCOL, when set, overrides
// -c protocol.*.allow entirely — this is a test-only escape hatch, never set
// in production, so it does not weaken gitProtocolGuardArgs there.
func allowLocalGitProtocol(t *testing.T) {
	t.Helper()
	t.Setenv("GIT_ALLOW_PROTOCOL", "file:http:https:ssh")
}

func initBareRemote(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	remote := filepath.Join(dir, "remote.git")
	require.NoError(t, exec.Command("git", "init", "--bare", remote).Run())
	return remote
}

func initSourceRepo(t *testing.T) string {
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
	require.NoError(t, os.WriteFile(filepath.Join(src, "README.md"), []byte("hello"), 0644))
	run("add", ".")
	run("commit", "-m", "init")
	run("branch", "-m", "main")
	run("tag", "v1")
	return src
}

func TestCloneGitRepo_Success(t *testing.T) {
	allowLocalGitProtocol(t)
	src := initSourceRepo(t)
	dest := filepath.Join(t.TempDir(), "checkout")

	err := CloneGitRepo(context.Background(), dest, src, "", "")
	require.NoError(t, err)
	assert.FileExists(t, filepath.Join(dest, "README.md"))
	assert.DirExists(t, filepath.Join(dest, ".git"))
}

func TestCloneGitRepo_WithRef(t *testing.T) {
	allowLocalGitProtocol(t)
	src := initSourceRepo(t)
	dest := filepath.Join(t.TempDir(), "checkout")

	err := CloneGitRepo(context.Background(), dest, src, "v1", "")
	require.NoError(t, err)
	assert.FileExists(t, filepath.Join(dest, "README.md"))
}

func TestCloneGitRepo_EmptyURL(t *testing.T) {
	err := CloneGitRepo(context.Background(), t.TempDir(), "", "", "")
	assert.Error(t, err)
}

func TestCloneGitRepo_RejectsFlagLikeURL(t *testing.T) {
	err := CloneGitRepo(context.Background(), filepath.Join(t.TempDir(), "d"), "--upload-pack=evil", "", "")
	assert.Error(t, err)
}

func TestCloneGitRepo_RejectsFlagLikeRef(t *testing.T) {
	allowLocalGitProtocol(t)
	src := initSourceRepo(t)
	err := CloneGitRepo(context.Background(), filepath.Join(t.TempDir(), "d"), src, "--evil", "")
	assert.Error(t, err)
}

func TestCloneGitRepo_CleansUpOnFailure(t *testing.T) {
	allowLocalGitProtocol(t)
	dest := filepath.Join(t.TempDir(), "checkout")
	err := CloneGitRepo(context.Background(), dest, "/nonexistent/repo/path", "", "")
	require.Error(t, err)
	_, statErr := os.Stat(dest)
	assert.True(t, os.IsNotExist(statErr), "destination should be cleaned up on clone failure")
}

// TestCloneGitRepo_RejectsFileTransportByDefault is the regression test for
// the protocol guard itself: without allowLocalGitProtocol's override, a
// bare local path — indistinguishable at the git-transport level from
// file:// — must be refused, not silently cloned.
func TestCloneGitRepo_RejectsFileTransportByDefault(t *testing.T) {
	src := initSourceRepo(t)
	dest := filepath.Join(t.TempDir(), "checkout")

	err := CloneGitRepo(context.Background(), dest, src, "", "")
	require.Error(t, err)
	assert.ErrorContains(t, err, "not allowed")
	_, statErr := os.Stat(dest)
	assert.True(t, os.IsNotExist(statErr), "destination should be cleaned up on a refused clone")
}

func TestCloneGitRepo_RejectsExtTransport(t *testing.T) {
	dest := filepath.Join(t.TempDir(), "checkout")
	err := CloneGitRepo(context.Background(), dest, "ext::sh -c touch%20/tmp/pwned", "", "")
	require.Error(t, err)
	assert.ErrorContains(t, err, "not allowed")
}

func TestPushRepo_InitsCommitsAndPushes(t *testing.T) {
	allowLocalGitProtocol(t)
	remote := initBareRemote(t)
	workDir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(workDir, "file.txt"), []byte("content"), 0644))

	err := PushRepo(context.Background(), PushRepoInput{
		WorkDir: workDir,
		RepoURL: remote,
		Branch:  "main",
	})
	require.NoError(t, err)

	// Verify by cloning the remote back out.
	clone := filepath.Join(t.TempDir(), "verify")
	require.NoError(t, exec.Command("git", "clone", remote, clone).Run())
	assert.FileExists(t, filepath.Join(clone, "file.txt"))
}

func TestPushRepo_ReusesExistingGitDir(t *testing.T) {
	allowLocalGitProtocol(t)
	remote := initBareRemote(t)
	workDir := t.TempDir()
	run := func(args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = workDir
		out, err := cmd.CombinedOutput()
		require.NoError(t, err, string(out))
	}
	run("init")
	run("config", "user.name", "Test")
	run("config", "user.email", "test@example.com")
	require.NoError(t, os.WriteFile(filepath.Join(workDir, "a.txt"), []byte("a"), 0644))
	run("add", ".")
	run("commit", "-m", "first")

	err := PushRepo(context.Background(), PushRepoInput{WorkDir: workDir, RepoURL: remote, Branch: "main"})
	require.NoError(t, err)
}

func TestPushRepo_RequiresWorkDirAndRepoURL(t *testing.T) {
	assert.Error(t, PushRepo(context.Background(), PushRepoInput{RepoURL: "x"}))
	assert.Error(t, PushRepo(context.Background(), PushRepoInput{WorkDir: "x"}))
}

func TestPushRepo_RejectsFlagLikeBranch(t *testing.T) {
	allowLocalGitProtocol(t)
	remote := initBareRemote(t)
	workDir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(workDir, "file.txt"), []byte("content"), 0644))
	err := PushRepo(context.Background(), PushRepoInput{WorkDir: workDir, RepoURL: remote, Branch: "--evil"})
	assert.Error(t, err)
}

// TestPushRepo_RejectsFileTransportByDefault is the push-side regression
// test mirroring TestCloneGitRepo_RejectsFileTransportByDefault.
func TestPushRepo_RejectsFileTransportByDefault(t *testing.T) {
	remote := initBareRemote(t)
	workDir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(workDir, "file.txt"), []byte("content"), 0644))

	err := PushRepo(context.Background(), PushRepoInput{WorkDir: workDir, RepoURL: remote, Branch: "main"})
	require.Error(t, err)
	assert.ErrorContains(t, err, "not allowed")
}

func TestInjectGitToken(t *testing.T) {
	assert.Equal(t, "https://x-access-token:tok@github.com/o/r.git", injectGitToken("https://github.com/o/r.git", "tok"))
	assert.Equal(t, "https://github.com/o/r.git", injectGitToken("https://github.com/o/r.git", ""))
	assert.Equal(t, "git@github.com:o/r.git", injectGitToken("git@github.com:o/r.git", "tok"), "non-https remotes are left unchanged")
}

func TestIsSafeGitURL(t *testing.T) {
	tests := []struct {
		name string
		url  string
		want bool
	}{
		{"https", "https://github.com/acme/orders.git", true},
		{"http", "http://internal-git.example.com/acme/orders.git", true},
		{"ssh scheme", "ssh://git@github.com/acme/orders.git", true},
		{"scp-like", "git@github.com:acme/orders.git", true},
		{"scp-like with dots and dashes", "deploy-bot@git.example.co:team/repo.git", true},
		{"file scheme", "file:///etc/passwd", false},
		{"ext transport", "ext::sh -c touch%20/tmp/pwned", false},
		{"bare absolute path", "/etc/passwd", false},
		{"bare relative path", "../../etc/passwd", false},
		{"empty", "", false},
		{"ftp scheme", "ftp://example.com/repo.git", false},
		{"whitespace padded https", "  https://github.com/acme/orders.git  ", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, IsSafeGitURL(tt.url))
		})
	}
}
