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

// ADOTokenClient is the contract the orbit_repo_clone activity needs for
// resolving Azure DevOps connection credentials. Implemented by
// services.PayloadADOConnectionClient. Tests substitute a fake.
type ADOTokenClient interface {
	GetConnectionToken(ctx context.Context, connectionID string) (services.ADOConnectionToken, error)
}

// providerGitHub / providerADO are the canonical provider tags. They match
// git-connections.provider and the catalog workflow input — do NOT introduce
// azure_devops.
const (
	providerGitHub = "github"
	providerADO    = "azure-devops"
)

// OrbitRepoCloneActivities back the orbit_repo_clone agent tool. It
// resolves a private repo (either by Orbit app_id or raw URL), mints a
// short-lived credential from the workspace's connected provider (a GitHub
// App installation token, or an Azure DevOps connection PAT / bearer token),
// and runs `git clone --depth=1` inside the agent's sandbox with the token
// projected as a one-shot env var.
//
// The token is referenced only via an env var in the clone command (never
// interpolated literally) and, for the GitHub / ADO basic-pat URL-injected
// paths, immediately scrubbed from .git/config via `git remote set-url`. The
// agent never sees the raw token — it only receives clone path + head sha +
// branch.
type OrbitRepoCloneActivities struct {
	executor      sandbox.SandboxExecutor
	tokenClient   GitHubTokenClient
	adoClient     ADOTokenClient
	contextClient OrbitContextClient
	logger        *slog.Logger
}

// NewOrbitRepoCloneActivities constructs the activity group. adoClient may
// be nil in deployments without ADO support — an ADO clone then fails with a
// clear "not configured" error rather than panicking.
func NewOrbitRepoCloneActivities(executor sandbox.SandboxExecutor, tokenClient GitHubTokenClient, adoClient ADOTokenClient, contextClient OrbitContextClient, logger *slog.Logger) *OrbitRepoCloneActivities {
	if logger == nil {
		logger = slog.Default()
	}
	return &OrbitRepoCloneActivities{
		executor:      executor,
		tokenClient:   tokenClient,
		adoClient:     adoClient,
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
	Project        string `json:"project,omitempty"`
	Branch         string `json:"branch"`
	HeadSHA        string `json:"head_sha"`
	InstallationID int64  `json:"installation_id"`
	DurationMs     int64  `json:"duration_ms"`
}

// cloneSpec is the provider-resolved plan for a single clone: the bash
// command (which references the token only through an env var), the env var
// to project, the raw token (for defensive redaction of any surface output),
// and the coordinates echoed back to the agent.
type cloneSpec struct {
	command   string
	env       map[string]string
	token     string
	owner     string // GitHub owner or ADO organization
	repo      string
	project   string // ADO only
	slug      string
	installID int64 // GitHub only; 0 for ADO
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

	// Resolve repo URL and, for the app_id path, capture the app-doc
	// repository — its provider/connection linkage is the auth root for ADO.
	repoURL := strings.TrimSpace(in.RepoURL)
	var appRepo *services.AppRepository
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
		appRepo = details.Repository
		repoURL = strings.TrimSpace(details.Repository.URL)
	}

	parsed, err := parseRepoURL(repoURL)
	if err != nil {
		return OrbitRepoCloneResult{}, temporal.NewNonRetryableApplicationError(err.Error(), "InvalidRepoURL", err)
	}

	// Validate the revision once — it is interpolated into the command.
	revFlag := "--single-branch"
	if rev := strings.TrimSpace(in.Revision); rev != "" {
		if !isSafeGitRef(rev) {
			return OrbitRepoCloneResult{}, temporal.NewNonRetryableApplicationError(
				fmt.Sprintf("invalid revision %q (must match [A-Za-z0-9._/-]+)", rev), "InvalidRevision", nil)
		}
		revFlag = "--branch=" + rev + " --single-branch"
	}

	// Provider branch — build the credentialed clone plan.
	var spec cloneSpec
	switch parsed.Provider {
	case providerGitHub:
		spec, err = a.githubCloneSpec(ctx, in.WorkspaceID, parsed, revFlag)
	case providerADO:
		spec, err = a.adoCloneSpec(ctx, appRepo, parsed, revFlag)
	default:
		return OrbitRepoCloneResult{}, temporal.NewNonRetryableApplicationError(
			fmt.Sprintf("unsupported provider %q", parsed.Provider), "InvalidRepoURL", nil)
	}
	if err != nil {
		return OrbitRepoCloneResult{}, err
	}

	return a.runClone(ctx, in, spec)
}

// githubCloneSpec mints an installation token and builds the GitHub clone
// command. The token is URL-injected via the $GITHUB_TOKEN env var and
// scrubbed from .git/config after clone.
func (a *OrbitRepoCloneActivities) githubCloneSpec(ctx context.Context, workspaceID string, parsed parsedRepo, revFlag string) (cloneSpec, error) {
	token, err := a.tokenClient.GetInstallationTokenForRepo(ctx, workspaceID, parsed.Owner, parsed.Repo)
	if err != nil {
		if errors.Is(err, services.ErrInstallationNotFound) {
			return cloneSpec{}, temporal.NewNonRetryableApplicationError(
				fmt.Sprintf("no GitHub App installation connected for owner %q in this workspace — install or grant access to the Orbit GitHub App for the %s organization", parsed.Owner, parsed.Owner),
				"InstallationNotFound", err)
		}
		if errors.Is(err, services.ErrInstallationTokenExpired) {
			return cloneSpec{}, temporal.NewNonRetryableApplicationError(
				"the installation token is expired and Orbit's refresh workflow appears stalled — ask an admin to check the GitHubTokenRefreshWorkflow",
				"InstallationTokenExpired", err)
		}
		return cloneSpec{}, fmt.Errorf("orbit_repo_clone: mint token: %w", err)
	}

	slug := cloneRepoSlug(parsed.Owner + "-" + parsed.Repo)
	// $GITHUB_TOKEN is the projected env var; the host and ${OWNER}/${REPO}
	// are hard-coded from validated inputs so they can't be injected.
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
		slug, revFlag, parsed.Owner, parsed.Repo,
	)
	return cloneSpec{
		command:   cmd,
		env:       map[string]string{"GITHUB_TOKEN": token.Token},
		token:     token.Token,
		owner:     parsed.Owner,
		repo:      parsed.Repo,
		slug:      slug,
		installID: token.InstallationID,
	}, nil
}

// adoCloneSpec resolves ADO connection credentials and builds the clone
// command for the connection's auth mode. The connection id is the auth root
// and must come from the app doc — a raw ADO URL with no linked Orbit app
// cannot be cloned. For basic-pat the PAT is URL-injected via the $ADO_TOKEN
// env var (and scrubbed after clone); for bearer the token is presented via
// git -c http.extraheader and never touches the URL.
func (a *OrbitRepoCloneActivities) adoCloneSpec(ctx context.Context, appRepo *services.AppRepository, parsed parsedRepo, revFlag string) (cloneSpec, error) {
	if a.adoClient == nil {
		return cloneSpec{}, temporal.NewNonRetryableApplicationError(
			"orbit_repo_clone: Azure DevOps cloning is not configured on this worker", "ADONotConfigured", nil)
	}
	connectionID := ""
	if appRepo != nil {
		connectionID = strings.TrimSpace(appRepo.ConnectionID)
	}
	if connectionID == "" {
		return cloneSpec{}, temporal.NewNonRetryableApplicationError(
			"cloning an Azure DevOps repository requires importing it as an Orbit app with a linked git connection — a raw ADO URL has no credentials to clone with",
			"ADOConnectionMissing", nil)
	}

	conn, err := a.adoClient.GetConnectionToken(ctx, connectionID)
	if err != nil {
		if errors.Is(err, services.ErrConnectionNotFound) {
			return cloneSpec{}, temporal.NewNonRetryableApplicationError(
				"the Azure DevOps connection for this app no longer exists — reconnect it in workspace settings", "ADOConnectionNotFound", err)
		}
		if errors.Is(err, services.ErrConnectionNotConfigured) {
			return cloneSpec{}, temporal.NewNonRetryableApplicationError(
				"the Azure DevOps connection for this app has no usable credentials — re-authorize it in workspace settings", "ADOConnectionNotConfigured", err)
		}
		return cloneSpec{}, fmt.Errorf("orbit_repo_clone: resolve ado connection: %w", err)
	}

	// The connection is the authoritative source for host + org (decrypted
	// server-side); the specific project + repo come from the parsed app URL.
	base := strings.TrimRight(conn.BaseURL, "/")
	if !isSafeADOBaseURL(base) {
		return cloneSpec{}, temporal.NewNonRetryableApplicationError(
			fmt.Sprintf("azure devops connection has an unusable base URL %q", base), "ADOConfig", nil)
	}
	org := conn.Organization
	project := parsed.Project
	repo := parsed.Repo
	if !isSafeRepoSegment(org) || !isSafeRepoSegment(project) || !isSafeRepoSegment(repo) {
		return cloneSpec{}, temporal.NewNonRetryableApplicationError(
			"azure devops org/project/repo contains unsupported characters", "InvalidRepoURL", nil)
	}

	slug := cloneRepoSlug(org + "-" + project + "-" + repo)
	// Bare URL — no credentials. base already carries the https scheme.
	bareURL := fmt.Sprintf("%s/%s/%s/_git/%s", base, org, project, repo)

	var cmd string
	if conn.AuthMode == "bearer" {
		// Bearer: token presented via a per-invocation http.extraheader — it
		// never appears in the URL and (via ${ADO_TOKEN}) never appears
		// literally in the command string. `git -c` config is not persisted
		// to .git/config, so no scrub is needed.
		cmd = fmt.Sprintf(
			`set -eo pipefail
mkdir -p repo
cd repo
rm -rf %[1]q
git -c http.extraheader="AUTHORIZATION: Bearer ${ADO_TOKEN}" clone --depth=1 %[2]s %[3]q %[1]q
cd %[1]q
echo "ORBIT_HEAD_SHA=$(git rev-parse HEAD)"
echo "ORBIT_BRANCH=$(git rev-parse --abbrev-ref HEAD)"
`,
			slug, revFlag, bareURL,
		)
	} else {
		// basic-pat: PAT URL-injected via ${ADO_TOKEN} (username is arbitrary),
		// then scrubbed from .git/config via `git remote set-url`.
		authURL := strings.Replace(bareURL, "https://", "https://pat:${ADO_TOKEN}@", 1)
		cmd = fmt.Sprintf(
			`set -eo pipefail
mkdir -p repo
cd repo
rm -rf %[1]q
git clone --depth=1 %[2]s "%[3]s" %[1]q
cd %[1]q
git remote set-url origin %[4]q
echo "ORBIT_HEAD_SHA=$(git rev-parse HEAD)"
echo "ORBIT_BRANCH=$(git rev-parse --abbrev-ref HEAD)"
`,
			slug, revFlag, authURL, bareURL,
		)
	}

	return cloneSpec{
		command: cmd,
		env:     map[string]string{"ADO_TOKEN": conn.Token},
		token:   conn.Token,
		owner:   org,
		repo:    repo,
		project: project,
		slug:    slug,
	}, nil
}

// runClone executes the resolved clone plan in the sandbox, redacts the
// token from any surfaced output, and maps the result. Shared by both
// providers.
func (a *OrbitRepoCloneActivities) runClone(ctx context.Context, in OrbitRepoCloneInput, spec cloneSpec) (OrbitRepoCloneResult, error) {
	start := time.Now()
	res, execErr := a.executor.Exec(ctx, sandbox.SandboxID(in.WorkflowID), sandbox.ExecOptions{
		Command:      spec.command,
		EnvOverrides: spec.env,
		Timeout:      5 * time.Minute,
	})
	duration := time.Since(start)

	// Redact the token defensively before touching any error strings or
	// surface output — even though we don't return stdout/stderr, the token
	// could leak via an error string if git echoes an injected URL.
	redact := func(s string) string {
		if spec.token == "" {
			return s
		}
		return strings.ReplaceAll(s, spec.token, "***REDACTED***")
	}

	if execErr != nil {
		return OrbitRepoCloneResult{}, fmt.Errorf("orbit_repo_clone: exec: %s", redact(execErr.Error()))
	}
	if res.ExitCode != 0 {
		stderr := redact(res.Stderr)
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
		slog.String("owner", spec.owner),
		slog.String("repo", spec.repo),
		slog.String("project", spec.project),
		slog.String("branch", branch),
		slog.Int64("installation_id", spec.installID),
		slog.Duration("duration", duration),
	)

	return OrbitRepoCloneResult{
		ClonePath:      "repo/" + spec.slug,
		Owner:          spec.owner,
		Repo:           spec.repo,
		Project:        spec.project,
		Branch:         branch,
		HeadSHA:        headSHA,
		InstallationID: spec.installID,
		DurationMs:     duration.Milliseconds(),
	}, nil
}

// parsedRepo is the provider-tagged result of parseRepoURL.
type parsedRepo struct {
	Provider string // providerGitHub | providerADO
	Host     string
	Owner    string // GitHub owner or ADO organization
	Project  string // ADO only
	Repo     string
}

// parseRepoURL recognizes two shapes:
//
//	https://github.com/{owner}/{repo}[.git]           → github
//	https://{host}/{org}/{project}/_git/{repo}[.git]  → azure-devops (dev.azure.com or on-prem)
//
// Everything else (SSH, http, other hosts, malformed paths) is rejected. All
// coordinate segments are validated against the shell-injection guard since
// they are interpolated into the clone command.
func parseRepoURL(raw string) (parsedRepo, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return parsedRepo{}, errors.New("repo URL is empty")
	}
	// https-only — we URL-inject / bearer-auth and can't send that over plaintext.
	if !strings.HasPrefix(s, "https://") {
		return parsedRepo{}, fmt.Errorf("only https URLs are supported (got %q)", raw)
	}
	s = strings.TrimPrefix(s, "https://")
	// Strip any embedded credentials (be defensive — the agent shouldn't send these).
	if at := strings.LastIndex(s, "@"); at != -1 {
		s = s[at+1:]
	}
	slash := strings.Index(s, "/")
	if slash == -1 {
		return parsedRepo{}, fmt.Errorf("could not parse repo path from %q", raw)
	}
	host := s[:slash]
	rest := s[slash+1:]
	// Drop query/fragment.
	for _, sep := range []string{"?", "#"} {
		if i := strings.Index(rest, sep); i != -1 {
			rest = rest[:i]
		}
	}
	rest = strings.TrimSuffix(rest, "/")

	if host == "github.com" {
		rest = strings.TrimSuffix(rest, ".git")
		parts := strings.Split(rest, "/")
		if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
			return parsedRepo{}, fmt.Errorf("could not parse owner/repo from %q", raw)
		}
		owner, repo := parts[0], parts[1]
		if !isSafeRepoSegment(owner) || !isSafeRepoSegment(repo) {
			return parsedRepo{}, fmt.Errorf("invalid characters in owner/repo from %q", raw)
		}
		return parsedRepo{Provider: providerGitHub, Host: host, Owner: owner, Repo: repo}, nil
	}

	// Azure DevOps: {org}/{project}/_git/{repo}. The `_git` marker must sit at
	// index 2 with a repo segment after it.
	parts := strings.Split(rest, "/")
	if len(parts) >= 4 && parts[2] == "_git" {
		org, project, repo := parts[0], parts[1], strings.TrimSuffix(parts[3], ".git")
		if org == "" || project == "" || repo == "" {
			return parsedRepo{}, fmt.Errorf("could not parse org/project/repo from %q", raw)
		}
		if !isSafeRepoSegment(org) || !isSafeRepoSegment(project) || !isSafeRepoSegment(repo) {
			return parsedRepo{}, fmt.Errorf("invalid characters in org/project/repo from %q", raw)
		}
		return parsedRepo{Provider: providerADO, Host: host, Owner: org, Project: project, Repo: repo}, nil
	}

	return parsedRepo{}, fmt.Errorf(
		"unsupported repo URL %q (expected https://github.com/{owner}/{repo} or https://{host}/{org}/{project}/_git/{repo})", raw)
}

// parseGitHubRepoURL extracts owner/repo from a github.com URL. Retained as a
// thin wrapper over parseRepoURL so existing callers/tests keep their
// contract; rejects any non-github shape.
func parseGitHubRepoURL(raw string) (owner, repo string, err error) {
	p, err := parseRepoURL(raw)
	if err != nil {
		return "", "", err
	}
	if p.Provider != providerGitHub {
		return "", "", fmt.Errorf("only github.com URLs are supported (got %q)", raw)
	}
	return p.Owner, p.Repo, nil
}

// isSafeRepoSegment matches GitHub/ADO owner/repo/project character rules
// loosely: alphanumerics, hyphens, dots, underscores. Used as a
// shell-injection guard since these values are interpolated into the
// command string.
var repoSegmentRE = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

func isSafeRepoSegment(s string) bool {
	return len(s) > 0 && len(s) <= 100 && repoSegmentRE.MatchString(s)
}

// isSafeADOBaseURL guards the connection-supplied base URL before it is
// interpolated into the clone command. Must be an https origin with a
// host (and optional port) — no path, no credentials, no metacharacters.
var adoBaseURLRE = regexp.MustCompile(`^https://[A-Za-z0-9.-]+(:[0-9]+)?$`)

func isSafeADOBaseURL(s string) bool {
	return len(s) > 0 && len(s) <= 253 && adoBaseURLRE.MatchString(s)
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
