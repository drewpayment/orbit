package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"sort"
	"strings"
	"time"

	"go.temporal.io/sdk/temporal"

	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/sandbox"
)

// RepoInspectInput drives the repo_inspect tool. The agent uses it to learn
// what's in a repository before proposing a deployment plan.
type RepoInspectInput struct {
	WorkflowID string

	// RepoURL is e.g. https://github.com/owner/repo or git@github.com:owner/repo.
	RepoURL string

	// Revision defaults to "main". Other branches/tags are NOT supported in
	// Spike 2 — agents that want to inspect non-main branches must clone
	// explicitly with shell_exec.
	Revision string

	// MaxFiles caps the number of tree entries returned (defaults to 200).
	MaxFiles int

	// FilesToFetch is the explicit list of paths whose contents to include
	// in the result (e.g. "package.json", "README.md"). Empty falls back to
	// a built-in heuristic of common manifest files.
	FilesToFetch []string

	// GitHubToken is an optional bearer token forwarded as `Authorization:
	// Bearer …` to the GitHub API. Lets the agent inspect private repos for
	// which the workspace has stored a token (or where the activity has been
	// passed an installation token).
	GitHubToken string
}

// RepoInspectResult is what flows back to the agent.
type RepoInspectResult struct {
	Source      string                 // "github_api" | "shallow_clone"
	Revision    string
	TruncatedAt int                    // 0 if not truncated
	Tree        []RepoTreeEntry
	Files       map[string]string      // path -> content (truncated per-file)
	CloneRef    string                 // sandbox path (only set when Source=="shallow_clone")
}

// RepoTreeEntry is one path in the tree listing.
type RepoTreeEntry struct {
	Path string
	Type string // "blob" | "tree"
	Size int64  // 0 for trees
}

var defaultRepoInspectFiles = []string{
	"README.md",
	"README",
	"package.json",
	"go.mod",
	"pyproject.toml",
	"requirements.txt",
	"Dockerfile",
	"docker-compose.yml",
	"docker-compose.yaml",
	"next.config.js",
	"next.config.ts",
	"next.config.mjs",
	"vite.config.js",
	"vite.config.ts",
	"Cargo.toml",
	"build.gradle",
	"pom.xml",
	"deno.json",
}

// RepoInspect tries the host-specific API path first (no clone required), and
// falls back to a shallow git clone of main into the sandbox. See plan
// note: "only clone shallow repo main branch or just analyze public git
// repository if possible".
func (a *SandboxActivities) RepoInspect(ctx context.Context, in RepoInspectInput) (RepoInspectResult, error) {
	if in.WorkflowID == "" || in.RepoURL == "" {
		return RepoInspectResult{}, temporal.NewNonRetryableApplicationError("workflow_id and repo_url required", "InvalidInput", nil)
	}
	revision := strings.TrimSpace(in.Revision)
	if revision == "" {
		revision = "main"
	}
	maxFiles := in.MaxFiles
	if maxFiles <= 0 {
		maxFiles = 200
	}
	files := in.FilesToFetch
	if len(files) == 0 {
		files = defaultRepoInspectFiles
	}

	hbStop := make(chan struct{})
	defer close(hbStop)
	go heartbeatLoop(ctx, hbStop)

	// 1. GitHub fast path.
	if owner, repo, ok := parseGitHubURL(in.RepoURL); ok {
		if res, err := a.inspectGitHub(ctx, owner, repo, revision, files, maxFiles, in.GitHubToken); err == nil {
			return res, nil
		}
		// Fall through to shallow clone.
	}

	// 2. Shallow-clone fallback.
	return a.inspectViaShallowClone(ctx, in.WorkflowID, in.RepoURL, revision, files, maxFiles)
}

func (a *SandboxActivities) inspectGitHub(ctx context.Context, owner, repo, revision string, files []string, maxFiles int, token string) (RepoInspectResult, error) {
	apiURL := fmt.Sprintf("https://api.github.com/repos/%s/%s/git/trees/%s?recursive=1", owner, repo, revision)
	body, err := a.fetchJSON(ctx, apiURL, token)
	if err != nil {
		return RepoInspectResult{}, err
	}
	var resp struct {
		Tree []struct {
			Path string `json:"path"`
			Type string `json:"type"`
			Size int64  `json:"size"`
		} `json:"tree"`
		Truncated bool `json:"truncated"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return RepoInspectResult{}, fmt.Errorf("parse trees response: %w", err)
	}

	tree := make([]RepoTreeEntry, 0, len(resp.Tree))
	for _, e := range resp.Tree {
		tree = append(tree, RepoTreeEntry{Path: e.Path, Type: e.Type, Size: e.Size})
	}
	if len(tree) > maxFiles {
		tree = tree[:maxFiles]
	}

	contents := map[string]string{}
	for _, p := range files {
		raw, err := a.fetchGitHubRaw(ctx, owner, repo, revision, p, token)
		if err != nil || raw == "" {
			continue
		}
		out, _ := truncate(raw, a.MaxOutputBytes)
		contents[p] = out
	}

	out := RepoInspectResult{
		Source:   "github_api",
		Revision: revision,
		Tree:     tree,
		Files:    contents,
	}
	if resp.Truncated {
		out.TruncatedAt = len(tree)
	}
	return out, nil
}

func (a *SandboxActivities) fetchJSON(ctx context.Context, u, token string) ([]byte, error) {
	cctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(cctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		_, _ = io.ReadAll(resp.Body)
		return nil, fmt.Errorf("github api: HTTP %d for %s", resp.StatusCode, u)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 8<<20))
}

func (a *SandboxActivities) fetchGitHubRaw(ctx context.Context, owner, repo, ref, p, token string) (string, error) {
	rawURL := fmt.Sprintf("https://raw.githubusercontent.com/%s/%s/%s/%s", owner, repo, ref, url.PathEscape(p))
	cctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(cctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return "", err
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return "", nil
	}
	if resp.StatusCode/100 != 2 {
		return "", fmt.Errorf("raw fetch: HTTP %d for %s", resp.StatusCode, rawURL)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, int64(a.MaxOutputBytes)+1))
	if err != nil {
		return "", err
	}
	return string(body), nil
}

func (a *SandboxActivities) inspectViaShallowClone(ctx context.Context, workflowID, repoURL, revision string, files []string, maxFiles int) (RepoInspectResult, error) {
	// Slug for the clone path.
	slug := slugify(repoURL)
	cloneDir := path.Join("repo", slug)

	// Ensure sandbox exists (the workflow should already have called
	// EnsureSandbox before any tool, but be defensive).
	if _, err := a.executor.Ensure(ctx, sandbox.SandboxID(workflowID), sandbox.EnsureOptions{}); err != nil {
		return RepoInspectResult{}, fmt.Errorf("ensure sandbox: %w", err)
	}

	cmd := fmt.Sprintf(
		"rm -rf %q && git clone --depth=1 --single-branch --branch=%s %q %q",
		cloneDir, shellQuote(revision), repoURL, cloneDir,
	)
	res, err := a.executor.Exec(ctx, sandbox.SandboxID(workflowID), sandbox.ExecOptions{
		Command: cmd,
		Timeout: 5 * time.Minute,
	})
	if err != nil {
		return RepoInspectResult{}, fmt.Errorf("clone: %w", err)
	}
	if res.ExitCode != 0 {
		return RepoInspectResult{}, fmt.Errorf("git clone exit %d: %s", res.ExitCode, res.Stderr)
	}

	// Walk the clone listing one level at a time and flatten.
	tree, err := walkSandboxTree(ctx, a.executor, sandbox.SandboxID(workflowID), cloneDir, maxFiles)
	if err != nil {
		return RepoInspectResult{}, err
	}

	contents := map[string]string{}
	for _, p := range files {
		full := path.Join(cloneDir, p)
		data, err := a.executor.ReadFile(ctx, sandbox.SandboxID(workflowID), full)
		if err != nil {
			continue
		}
		out, _ := truncate(string(data), a.MaxOutputBytes)
		contents[p] = out
	}

	return RepoInspectResult{
		Source:   "shallow_clone",
		Revision: revision,
		Tree:     tree,
		Files:    contents,
		CloneRef: cloneDir,
	}, nil
}

// walkSandboxTree returns a flat path listing (relative to cloneDir) up to
// maxFiles entries, walking depth-first.
func walkSandboxTree(ctx context.Context, exec sandbox.SandboxExecutor, id sandbox.SandboxID, root string, maxFiles int) ([]RepoTreeEntry, error) {
	out := []RepoTreeEntry{}
	queue := []string{""}

	for len(queue) > 0 && len(out) < maxFiles {
		cur := queue[0]
		queue = queue[1:]
		full := root
		if cur != "" {
			full = path.Join(root, cur)
		}
		entries, err := exec.ListDir(ctx, id, full)
		if err != nil {
			if errors.Is(err, sandbox.ErrPathEscape) {
				continue
			}
			return out, err
		}
		// Sort for determinism.
		sort.Slice(entries, func(i, j int) bool { return entries[i].Name < entries[j].Name })
		for _, e := range entries {
			if e.Name == ".git" {
				continue
			}
			rel := path.Join(cur, e.Name)
			ent := RepoTreeEntry{Path: rel, Size: e.Size}
			if e.IsDir {
				ent.Type = "tree"
				queue = append(queue, rel)
			} else {
				ent.Type = "blob"
			}
			out = append(out, ent)
			if len(out) >= maxFiles {
				return out, nil
			}
		}
	}
	return out, nil
}

// parseGitHubURL accepts the common forms (https, git+ssh) and returns
// owner/repo.
func parseGitHubURL(repoURL string) (owner, repo string, ok bool) {
	repoURL = strings.TrimSuffix(repoURL, ".git")
	if strings.HasPrefix(repoURL, "git@github.com:") {
		rest := strings.TrimPrefix(repoURL, "git@github.com:")
		parts := strings.SplitN(rest, "/", 2)
		if len(parts) == 2 {
			return parts[0], parts[1], true
		}
		return "", "", false
	}
	u, err := url.Parse(repoURL)
	if err != nil {
		return "", "", false
	}
	if !strings.HasSuffix(strings.ToLower(u.Host), "github.com") {
		return "", "", false
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(parts) < 2 {
		return "", "", false
	}
	return parts[0], parts[1], true
}

func slugify(s string) string {
	s = strings.TrimSuffix(s, ".git")
	s = strings.NewReplacer("https://", "", "http://", "", "git@", "", ":", "/", " ", "-").Replace(s)
	s = strings.Trim(s, "/")
	s = strings.ReplaceAll(s, "/", "_")
	if len(s) > 100 {
		s = s[:100]
	}
	return s
}

// shellQuote wraps s for safe inclusion in a `bash -lc` command. Single-quote
// the value and escape any embedded single quotes.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}
