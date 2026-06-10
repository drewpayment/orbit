package agent

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"go.temporal.io/sdk/temporal"

	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/sandbox"
	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

// GitHubTokenClient is the contract the orbit_repo_clone activity needs
// for minting installation tokens. Implemented by services.PayloadGitHubClient.
// Tests substitute a fake.
type GitHubTokenClient interface {
	GetInstallationTokenForRepo(ctx context.Context, workspaceID, owner, repo string) (services.InstallationToken, error)
}

// OrbitRepoCloneActivities back the orbit_repo_clone agent tool. It
// resolves a private repo (either by Orbit app_id or raw URL), mints
// a short-lived GitHub App installation token from the workspace's
// connected installation, and runs `git clone --depth=1` inside the
// agent's sandbox with the token projected as a one-shot env var.
//
// The token is URL-injected for the clone command, then immediately
// scrubbed from .git/config via `git remote set-url`. The agent never
// sees the raw token — it only receives clone path + head sha + branch.
type OrbitRepoCloneActivities struct {
	executor    sandbox.SandboxExecutor
	tokenClient GitHubTokenClient
	contextClient OrbitContextClient
	logger      *slog.Logger
}

// NewOrbitRepoCloneActivities constructs the activity group.
func NewOrbitRepoCloneActivities(executor sandbox.SandboxExecutor, tokenClient GitHubTokenClient, contextClient OrbitContextClient, logger *slog.Logger) *OrbitRepoCloneActivities {
	if logger == nil {
		logger = slog.Default()
	}
	return &OrbitRepoCloneActivities{
		executor:      executor,
		tokenClient:   tokenClient,
		contextClient: contextClient,
		logger:        logger,
	}
}

// OrbitRepoCloneInput is the activity input. WorkflowID + WorkspaceID
// are injected by the workflow; AppID, RepoURL and Revision come from
// the LLM via the tool's JSON args (the workflow forwards them
// verbatim from ToolCall.Arguments).
type OrbitRepoCloneInput struct {
	WorkflowID  string
	WorkspaceID string

	// Exactly one of AppID or RepoURL is required. AppID is preferred —
	// Orbit resolves the URL from the Apps collection. RepoURL is the
	// fallback for repos not registered as Apps yet.
	AppID   string
	RepoURL string

	// Revision is the branch or tag to clone. Empty means the
	// repository's default branch.
	Revision string
}

// OrbitRepoCloneResult is what the agent sees. No token, no
// authenticated URL, no token-leaking error strings.
type OrbitRepoCloneResult struct {
	ClonePath      string `json:"clone_path"`
	Owner          string `json:"owner"`
	Repo           string `json:"repo"`
	Branch         string `json:"branch"`
	HeadSHA        string `json:"head_sha"`
	InstallationID int64  `json:"installation_id"`
	DurationMs     int64  `json:"duration_ms"`
}

// OrbitRepoClone implements the orbit_repo_clone tool.
func (a *OrbitRepoCloneActivities) OrbitRepoClone(ctx context.Context, in OrbitRepoCloneInput) (OrbitRepoCloneResult, error) {
	if a.executor == nil {
		return OrbitRepoCloneResult{}, errors.New("orbit_repo_clone: sandbox executor not configured")
	}
	if a.tokenClient == nil {
		return OrbitRepoCloneResult{}, errors.New("orbit_repo_clone: github token client not configured")
	}
	if strings.TrimSpace(in.WorkflowID) == "" {
		return OrbitRepoCloneResult{}, temporal.NewNonRetryableApplicationError("workflow_id required", "InvalidInput", nil)
	}
	if strings.TrimSpace(in.WorkspaceID) == "" {
		return OrbitRepoCloneResult{}, temporal.NewNonRetryableApplicationError("workspace_id required", "InvalidInput", nil)
	}
	if strings.TrimSpace(in.AppID) == "" && strings.TrimSpace(in.RepoURL) == "" {
		return OrbitRepoCloneResult{}, temporal.NewNonRetryableApplicationError("one of app_id or repo_url required", "InvalidInput", nil)
	}

	// Resolve repo URL.
	repoURL := strings.TrimSpace(in.RepoURL)
	if appID := strings.TrimSpace(in.AppID); appID != "" {
		if a.contextClient == nil {
			return OrbitRepoCloneResult{}, errors.New("orbit_repo_clone: orbit context client not configured (required for app_id resolution)")
		}
		details, err := a.contextClient.GetApp(ctx, in.WorkspaceID, appID)
		if err != nil {
			if errors.Is(err, services.ErrAppNotFound) {
				return OrbitRepoCloneResult{}, temporal.NewNonRetryableApplicationError(
					fmt.Sprintf("app %q not found in workspace", appID), "AppNotFound", err)
			}
			return OrbitRepoCloneResult{}, fmt.Errorf("orbit_repo_clone: resolve app: %w", err)
		}
		if details.Repository == nil || strings.TrimSpace(details.Repository.URL) == "" {
			return OrbitRepoCloneResult{}, temporal.NewNonRetryableApplicationError(
				fmt.Sprintf("app %q has no repository URL configured", appID), "AppMissingRepo", nil)
		}
		repoURL = strings.TrimSpace(details.Repository.URL)
	}

	owner, repo, err := parseGitHubRepoURL(repoURL)
	if err != nil {
		return OrbitRepoCloneResult{}, temporal.NewNonRetryableApplicationError(err.Error(), "InvalidRepoURL", err)
	}

	// Mint a fresh installation token.
	token, err := a.tokenClient.GetInstallationTokenForRepo(ctx, in.WorkspaceID, owner, repo)
	if err != nil {
		if errors.Is(err, services.ErrInstallationNotFound) {
			return OrbitRepoCloneResult{}, temporal.NewNonRetryableApplicationError(
				fmt.Sprintf("no GitHub App installation connected for owner %q in this workspace — install or grant access to the Orbit GitHub App for the %s organization", owner, owner),
				"InstallationNotFound", err)
		}
		if errors.Is(err, services.ErrInstallationTokenExpired) {
			return OrbitRepoCloneResult{}, temporal.NewNonRetryableApplicationError(
				"the installation token is expired and Orbit's refresh workflow appears stalled — ask an admin to check the GitHubTokenRefreshWorkflow",
				"InstallationTokenExpired", err)
		}
		return OrbitRepoCloneResult{}, fmt.Errorf("orbit_repo_clone: mint token: %w", err)
	}

	// Clone inside the sandbox. The token is URL-injected for the
	// clone command only and immediately scrubbed from .git/config via
	// `git remote set-url`. The token also lives briefly in the
	// sandbox process args (visible via `ps` inside the pod) — fine
	// for the per-run isolated executor model.
	slug := cloneRepoSlug(owner + "-" + repo)
	clonePath := "repo/" + slug

	revFlag := ""
	if rev := strings.TrimSpace(in.Revision); rev != "" {
		if !isSafeGitRef(rev) {
			return OrbitRepoCloneResult{}, temporal.NewNonRetryableApplicationError(
				fmt.Sprintf("invalid revision %q (must match [A-Za-z0-9._/-]+)", rev), "InvalidRevision", nil)
		}
		revFlag = "--branch=" + rev + " --single-branch"
	} else {
		revFlag = "--single-branch"
	}

	// Command runs in `bash -lc`. $GITHUB_TOKEN is the projected env
	// var; the host URL and ${OWNER}/${REPO} are hard-coded into the
	// command from validated inputs so they can't be injected.
	cmd := fmt.Sprintf(
		`set -eo pipefail
mkdir -p repo
cd repo
rm -rf %[1]q
git clone --depth=1 %[2]s "https://x-access-token:${GITHUB_TOKEN}@github.com/%[3]s/%[4]s.git" %[1]q
cd %[1]q
git remote set-url origin "https://github.com/%[3]s/%[4]s.git"
echo "ORBIT_HEAD_SHA=$(git rev-parse HEAD)"
echo "ORBIT_BRANCH=$(git rev-parse --abbrev-ref HEAD)"
`,
		slug, revFlag, owner, repo,
	)

	start := time.Now()
	res, execErr := a.executor.Exec(ctx, sandbox.SandboxID(in.WorkflowID), sandbox.ExecOptions{
		Command: cmd,
		EnvOverrides: map[string]string{
			"GITHUB_TOKEN": token.Token,
		},
		Timeout: 5 * time.Minute,
	})
	duration := time.Since(start)

	// Redact the token defensively before we touch any error strings
	// or surface output. Even though we don't include stdout/stderr in
	// the result, the token could leak via the error string if git
	// echoes the URL.
	redact := func(s string) string {
		if token.Token == "" {
			return s
		}
		return strings.ReplaceAll(s, token.Token, "***REDACTED***")
	}

	if execErr != nil {
		return OrbitRepoCloneResult{}, fmt.Errorf("orbit_repo_clone: exec: %s", redact(execErr.Error()))
	}
	if res.ExitCode != 0 {
		stderr := redact(res.Stderr)
		// Keep the message bounded — the agent should see a useful
		// error, not a dump.
		if len(stderr) > 800 {
			stderr = stderr[len(stderr)-800:]
		}
		return OrbitRepoCloneResult{}, temporal.NewNonRetryableApplicationError(
			fmt.Sprintf("git clone failed (exit %d): %s", res.ExitCode, strings.TrimSpace(stderr)),
			"GitCloneFailed", nil)
	}

	headSHA, branch := extractCloneMarkers(redact(res.Stdout))

	a.logger.Info("orbit_repo_clone success",
		slog.String("workflow_id", in.WorkflowID),
		slog.String("workspace_id", in.WorkspaceID),
		slog.String("owner", owner),
		slog.String("repo", repo),
		slog.String("branch", branch),
		slog.Int64("installation_id", token.InstallationID),
		slog.Duration("duration", duration),
	)

	return OrbitRepoCloneResult{
		ClonePath:      clonePath,
		Owner:          owner,
		Repo:           repo,
		Branch:         branch,
		HeadSHA:        headSHA,
		InstallationID: token.InstallationID,
		DurationMs:     duration.Milliseconds(),
	}, nil
}

// parseGitHubRepoURL extracts owner/repo from a github.com URL. Accepts
// https://github.com/owner/repo[.git] forms; rejects SSH, other hosts,
// and shapes the agent shouldn't be able to supply.
func parseGitHubRepoURL(raw string) (owner, repo string, err error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", "", errors.New("repo URL is empty")
	}
	// Strip protocol. https-only — we URL-inject a bearer token and
	// can't send that over plaintext http.
	if !strings.HasPrefix(s, "https://") {
		return "", "", fmt.Errorf("only https github.com URLs are supported (got %q)", raw)
	}
	s = strings.TrimPrefix(s, "https://")
	// Strip any embedded credentials (the agent shouldn't be sending
	// these, but be defensive).
	if at := strings.LastIndex(s, "@"); at != -1 {
		s = s[at+1:]
	}
	if !strings.HasPrefix(s, "github.com/") {
		return "", "", fmt.Errorf("only github.com URLs are supported (got %q)", raw)
	}
	rest := strings.TrimPrefix(s, "github.com/")
	// Drop query/fragment.
	for _, sep := range []string{"?", "#"} {
		if i := strings.Index(rest, sep); i != -1 {
			rest = rest[:i]
		}
	}
	rest = strings.TrimSuffix(rest, "/")
	rest = strings.TrimSuffix(rest, ".git")
	parts := strings.Split(rest, "/")
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
		return "", "", fmt.Errorf("could not parse owner/repo from %q", raw)
	}
	owner, repo = parts[0], parts[1]
	if !isSafeRepoSegment(owner) || !isSafeRepoSegment(repo) {
		return "", "", fmt.Errorf("invalid characters in owner/repo from %q", raw)
	}
	return owner, repo, nil
}

// isSafeRepoSegment matches GitHub's owner/repo character rules
// loosely: alphanumerics, hyphens, dots, underscores. Used as a
// shell-injection guard since these values are interpolated into the
// command string.
var repoSegmentRE = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

func isSafeRepoSegment(s string) bool {
	return len(s) > 0 && len(s) <= 100 && repoSegmentRE.MatchString(s)
}

// isSafeGitRef restricts revisions to a shell-safe subset. Real git
// refs allow much more, but the agent only needs branch/tag names.
var gitRefRE = regexp.MustCompile(`^[A-Za-z0-9._/-]+$`)

func isSafeGitRef(s string) bool {
	return len(s) > 0 && len(s) <= 200 && gitRefRE.MatchString(s) && !strings.Contains(s, "..")
}

// cloneRepoSlug produces a filesystem-safe directory name for the
// clone target. Package already has a `slugify` helper in
// repo_inspect_activity.go but it has different semantics (URL-shaped
// input, underscores), so we have a separate one here for the
// owner-repo case.
var cloneRepoSlugRE = regexp.MustCompile(`[^a-z0-9-]+`)

func cloneRepoSlug(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = cloneRepoSlugRE.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if s == "" {
		s = "repo"
	}
	if len(s) > 80 {
		s = s[:80]
	}
	return s
}

// extractCloneMarkers parses the ORBIT_HEAD_SHA= and ORBIT_BRANCH=
// lines from the clone command's stdout. Marker prefixes are unique
// enough that they don't collide with regular git output.
func extractCloneMarkers(stdout string) (headSHA, branch string) {
	for _, line := range strings.Split(stdout, "\n") {
		line = strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(line, "ORBIT_HEAD_SHA="):
			headSHA = strings.TrimPrefix(line, "ORBIT_HEAD_SHA=")
		case strings.HasPrefix(line, "ORBIT_BRANCH="):
			branch = strings.TrimPrefix(line, "ORBIT_BRANCH=")
		}
	}
	return headSHA, branch
}
