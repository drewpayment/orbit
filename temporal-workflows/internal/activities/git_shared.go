package activities

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

// gitProtocolGuardArgs is prepended to every git invocation in this package.
// protocol.ext.allow=never blocks the "ext::" transport (which runs an
// arbitrary local command as the "remote"); protocol.file.allow=never
// blocks the "file" transport, which covers both an explicit file:// URL
// and a bare local filesystem path passed as a remote — either would let a
// hostile URL read or, via push, write somewhere else on the worker's
// filesystem instead of talking to an actual git server.
//
// This applies unconditionally, including to commands (init/config/add/
// commit) that never touch a transport: -c settings are inert for those, so
// there is no behavioral cost to applying it everywhere rather than
// threading a "does this command need it" decision through every call site.
var gitProtocolGuardArgs = []string{"-c", "protocol.ext.allow=never", "-c", "protocol.file.allow=never"}

// runGitCommand runs `git <args...>` with dir as the working directory.
// Output is sanitized before being embedded in an error so a token injected
// into a remote URL (see injectGitToken) never reaches a workflow history or
// log. Shared by every activity/action that shells out to git.
func runGitCommand(ctx context.Context, dir string, args ...string) error {
	fullArgs := append(append([]string{}, gitProtocolGuardArgs...), args...)
	cmd := exec.CommandContext(ctx, "git", fullArgs...)
	cmd.Dir = dir
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("git %v failed: %w (output: %s)", args, err, sanitizeGitOutput(string(output)))
	}
	return nil
}

// injectGitToken rewrites an https:// remote URL to carry an
// x-access-token basic-auth credential. Non-https URLs (ssh, git://) are
// returned unchanged: token auth only applies to HTTPS remotes.
func injectGitToken(rawURL, token string) string {
	if token == "" || !strings.HasPrefix(rawURL, "https://") {
		return rawURL
	}
	return strings.Replace(rawURL, "https://", fmt.Sprintf("https://x-access-token:%s@", token), 1)
}

// isSafeGitRef reports whether ref is safe to pass as a positional argument
// to a git subcommand. Refs are never routed through a shell, so this guards
// against ref being parsed as a flag (e.g. "--upload-pack=...") rather than
// against shell metacharacters.
func isSafeGitRef(ref string) bool {
	return ref != "" && !strings.HasPrefix(ref, "-")
}

// gitSCPLikeURL matches git's scp-like remote syntax, "[user@]host:path",
// e.g. "git@github.com:acme/orders.git". A bare local path never matches
// this (it has no "user@host:" prefix) — that is exactly what distinguishes
// a remote-shaped string from a local filesystem path here.
var gitSCPLikeURL = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_.-]*@[A-Za-z0-9_.-]+:.+$`)

// IsSafeGitURL reports whether url is an acceptable git remote for a
// template-authored fetch:git/git:push step: http(s)://, ssh://, or the
// scp-like "user@host:path" form. Every other git transport is rejected —
// most importantly "ext::" (runs an arbitrary local command as the
// "remote") and "file://" or a bare local path (reads, or via push writes,
// somewhere else on the worker's filesystem instead of an actual git
// server).
//
// This is a fast, clear-error check at the point a URL enters the system
// from a template author's `${{ }}` expression. It backs up, but does not
// replace, gitProtocolGuardArgs: that -c flag pair is the guarantee that
// still holds even if some future caller forgets to call IsSafeGitURL.
func IsSafeGitURL(url string) bool {
	url = strings.TrimSpace(url)
	switch {
	case strings.HasPrefix(url, "https://"), strings.HasPrefix(url, "http://"), strings.HasPrefix(url, "ssh://"):
		return true
	case gitSCPLikeURL.MatchString(url):
		return true
	default:
		return false
	}
}

// CloneGitRepo clones sourceURL into destDir (created if it does not exist)
// and, when ref is non-empty, checks it out. token, when non-empty,
// authenticates the clone for an https:// remote and is never logged: on
// failure the git output is sanitized before being wrapped in the returned
// error.
//
// Shared by the v1 CloneTemplateRepo activity and the scaffolder fetch:git
// action, so both clone exactly one way.
func CloneGitRepo(ctx context.Context, destDir, sourceURL, ref, token string) error {
	if strings.TrimSpace(sourceURL) == "" {
		return fmt.Errorf("clone: source URL is required")
	}
	if !isSafeGitRef(sourceURL) {
		return fmt.Errorf("clone: source URL must not start with '-'")
	}
	if ref != "" && !isSafeGitRef(ref) {
		return fmt.Errorf("clone: ref must not start with '-'")
	}
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return fmt.Errorf("clone: create destination dir: %w", err)
	}

	cloneURL := injectGitToken(sourceURL, token)
	// "--" ends option parsing so a hostile sourceURL cannot be read as a
	// git-clone flag.
	if err := runGitCommand(ctx, "", "clone", "--", cloneURL, destDir); err != nil {
		_ = os.RemoveAll(destDir)
		return fmt.Errorf("clone: %w", err)
	}

	if ref != "" {
		if err := runGitCommand(ctx, destDir, "checkout", ref, "--"); err != nil {
			_ = os.RemoveAll(destDir)
			return fmt.Errorf("clone: checkout %q: %w", ref, err)
		}
	}
	return nil
}

// PushRepoInput parameterizes PushRepo.
type PushRepoInput struct {
	// WorkDir is the directory to push. It is git-init'd if it has no .git
	// directory yet.
	WorkDir string
	// RepoURL is the remote to push to.
	RepoURL string
	// Branch defaults to "main".
	Branch string
	// CommitMessage defaults to "Initial commit from template".
	CommitMessage string
	// Token authenticates an https:// RepoURL. Never logged.
	Token string
}

// PushRepo initializes git in WorkDir if needed, commits everything present,
// and pushes to RepoURL on Branch. Shared by the v1 PushToNewRepo activity
// and the scaffolder git:push action, generalized from "push a freshly
// rendered template" to "push whatever is at WorkDir".
func PushRepo(ctx context.Context, in PushRepoInput) error {
	if strings.TrimSpace(in.WorkDir) == "" {
		return fmt.Errorf("push: work dir is required")
	}
	if strings.TrimSpace(in.RepoURL) == "" {
		return fmt.Errorf("push: repo URL is required")
	}
	branch := in.Branch
	if branch == "" {
		branch = "main"
	}
	if !isSafeGitRef(branch) {
		return fmt.Errorf("push: branch must not start with '-'")
	}
	commitMsg := in.CommitMessage
	if commitMsg == "" {
		commitMsg = "Initial commit from template"
	}

	if _, err := os.Stat(filepath.Join(in.WorkDir, ".git")); err != nil {
		if err := runGitCommand(ctx, in.WorkDir, "init"); err != nil {
			return fmt.Errorf("push: initialize git: %w", err)
		}
	}

	_ = runGitCommand(ctx, in.WorkDir, "config", "user.name", "Orbit IDP")
	_ = runGitCommand(ctx, in.WorkDir, "config", "user.email", "bot@orbit.dev")

	if err := runGitCommand(ctx, in.WorkDir, "add", "."); err != nil {
		return fmt.Errorf("push: add files: %w", err)
	}

	// A commit is a no-op error when the tree is already clean (e.g. a
	// re-run pushing an unchanged checkout); that is not a push failure.
	if err := runGitCommand(ctx, in.WorkDir, "commit", "-m", commitMsg); err != nil {
		if !strings.Contains(err.Error(), "nothing to commit") {
			return fmt.Errorf("push: commit: %w", err)
		}
	}

	remoteURL := injectGitToken(in.RepoURL, in.Token)
	if err := runGitCommand(ctx, in.WorkDir, "remote", "add", "origin", remoteURL); err != nil {
		// The remote may already exist (e.g. a re-run); fall back to
		// updating its URL rather than failing outright.
		if err := runGitCommand(ctx, in.WorkDir, "remote", "set-url", "origin", remoteURL); err != nil {
			return fmt.Errorf("push: set remote: %w", err)
		}
	}

	if err := runGitCommand(ctx, in.WorkDir, "push", "-u", "origin", "HEAD:"+branch); err != nil {
		return fmt.Errorf("push: %w", err)
	}
	return nil
}
