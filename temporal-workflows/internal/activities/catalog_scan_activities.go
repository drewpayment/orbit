package activities

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"path"
	"sort"
	"strings"
	"time"

	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"
)

// Catalog discovery scan activities — the "transport & enumeration" half of the
// Catalog Discovery feature (see docs/plans/2026-07-06-catalog-discovery.md).
//
// These activities are deliberately dumb: they list an installation's repos,
// walk each repo's git tree, fetch a bounded set of well-known files, and POST
// the evidence bundle to orbit-www's internal ingest route. All detection,
// scoring, and staging happens on the orbit-www side (the ingest route runs the
// pure detector functions). Keeping the brains in TypeScript means they stay
// unit-testable in Vitest and the Go worker never needs to understand catalog
// semantics.

const (
	// maxFilesPerRepo caps how many well-known files a single repo scan will
	// fetch and ship in the evidence bundle.
	maxFilesPerRepo = 40
	// maxFileBytes is the per-file size ceiling. Larger blobs are skipped
	// (their paths are noted in the bundle) rather than fetched.
	maxFileBytes int64 = 256 * 1024
	// maxTreeEntries bounds the flattened path listing shipped in the bundle
	// so a monorepo with tens of thousands of files can't produce an
	// unbounded POST body. Detection only needs directory-shape signal.
	maxTreeEntries = 5000
)

// RepoRef identifies a repository to scan. It is produced by
// ListInstallationReposActivity and consumed by ScanRepoActivity (and carried
// through the workflow's continue-as-new state).
type RepoRef struct {
	Owner         string `json:"owner"`
	Name          string `json:"name"`
	URL           string `json:"url"`
	DefaultBranch string `json:"defaultBranch"`
}

// ListInstallationReposInput drives ListInstallationReposActivity.
type ListInstallationReposInput struct {
	// InstallationID is the numeric GitHub App installation ID (as a string).
	// It is the key the orbit-www /api/internal/github/token route expects.
	InstallationID string `json:"installationId"`
	WorkspaceID    string `json:"workspaceId"`
}

// ScanRepoInput drives ScanRepoActivity.
type ScanRepoInput struct {
	InstallationID string  `json:"installationId"`
	WorkspaceID    string  `json:"workspaceId"`
	Repo           RepoRef `json:"repo"`
	ScanRunID      string  `json:"scanRunId"`
}

// ScanRepoResult is the aggregate the ingest route reports back for one repo.
type ScanRepoResult struct {
	Proposed       int `json:"proposed"`
	Imported       int `json:"imported"`
	SkippedIgnored int `json:"skippedIgnored"`
}

// CatalogScanActivities holds the shared HTTP dependencies for the scan
// activities. orbitBaseURL + apiKey point at orbit-www (the same values other
// worker activities use: ORBIT_API_URL / ORBIT_INTERNAL_API_KEY). githubAPIURL
// is overridable in tests.
type CatalogScanActivities struct {
	orbitBaseURL string
	apiKey       string
	githubAPIURL string
	httpClient   *http.Client
	logger       *slog.Logger
}

// NewCatalogScanActivities constructs the scan activities. orbitBaseURL is the
// orbit-www origin (e.g. http://localhost:3000); apiKey is ORBIT_INTERNAL_API_KEY.
func NewCatalogScanActivities(orbitBaseURL, apiKey string, logger *slog.Logger) *CatalogScanActivities {
	if logger == nil {
		logger = slog.Default()
	}
	return &CatalogScanActivities{
		orbitBaseURL: strings.TrimRight(orbitBaseURL, "/"),
		apiKey:       apiKey,
		githubAPIURL: "https://api.github.com",
		httpClient:   &http.Client{Timeout: 30 * time.Second},
		logger:       logger,
	}
}

// ---------------------------------------------------------------------------
// ListInstallationReposActivity
// ---------------------------------------------------------------------------

// ghRepo mirrors the fields we care about from GitHub's repository objects.
type ghRepo struct {
	Name  string `json:"name"`
	Owner struct {
		Login string `json:"login"`
	} `json:"owner"`
	HTMLURL       string `json:"html_url"`
	DefaultBranch string `json:"default_branch"`
	Archived      bool   `json:"archived"`
}

// ListInstallationReposActivity enumerates every repository the GitHub App
// installation can access. It calls GET /installation/repositories with the
// installation token, which natively honours the installation's
// repositorySelection ("all" vs "selected") — GitHub only returns repos the
// installation is actually granted, so no extra filtering is required here.
func (a *CatalogScanActivities) ListInstallationReposActivity(ctx context.Context, in ListInstallationReposInput) ([]RepoRef, error) {
	if in.InstallationID == "" || in.WorkspaceID == "" {
		return nil, temporal.NewNonRetryableApplicationError("installationId and workspaceId required", "InvalidInput", nil)
	}

	token, err := a.installationToken(ctx, in.InstallationID)
	if err != nil {
		return nil, err
	}

	var repos []RepoRef
	for page := 1; ; page++ {
		u := fmt.Sprintf("%s/installation/repositories?per_page=100&page=%d", a.githubAPIURL, page)
		body, err := a.githubGetJSON(ctx, u, token)
		if err != nil {
			return nil, err
		}
		var resp struct {
			TotalCount   int      `json:"total_count"`
			Repositories []ghRepo `json:"repositories"`
		}
		if err := json.Unmarshal(body, &resp); err != nil {
			return nil, fmt.Errorf("parse installation repositories: %w", err)
		}
		for _, r := range resp.Repositories {
			if r.Archived {
				continue
			}
			owner := r.Owner.Login
			branch := r.DefaultBranch
			if branch == "" {
				branch = "main"
			}
			repos = append(repos, RepoRef{
				Owner:         owner,
				Name:          r.Name,
				URL:           r.HTMLURL,
				DefaultBranch: branch,
			})
		}
		activity.RecordHeartbeat(ctx, fmt.Sprintf("listed page %d (%d repos)", page, len(repos)))
		if len(resp.Repositories) < 100 {
			break
		}
	}

	a.logger.Info("listed installation repositories",
		slog.String("installationId", in.InstallationID),
		slog.Int("count", len(repos)),
	)
	return repos, nil
}

// ---------------------------------------------------------------------------
// ScanRepoActivity
// ---------------------------------------------------------------------------

// ScanRepoActivity walks one repo's default-branch git tree, fetches the
// well-known files, and POSTs the evidence bundle to orbit-www's ingest route.
// A repo the installation cannot read (deleted, permissions) fails with a
// non-retryable error so the workflow can record it and move on.
func (a *CatalogScanActivities) ScanRepoActivity(ctx context.Context, in ScanRepoInput) (ScanRepoResult, error) {
	if in.WorkspaceID == "" || in.Repo.Owner == "" || in.Repo.Name == "" {
		return ScanRepoResult{}, temporal.NewNonRetryableApplicationError("workspaceId and repo owner/name required", "InvalidInput", nil)
	}

	token, err := a.installationToken(ctx, in.InstallationID)
	if err != nil {
		return ScanRepoResult{}, err
	}

	branch := in.Repo.DefaultBranch
	if branch == "" {
		branch = "main"
	}

	// 1. Recursive git tree for the default branch.
	treeURL := fmt.Sprintf("%s/repos/%s/%s/git/trees/%s?recursive=1",
		a.githubAPIURL, in.Repo.Owner, in.Repo.Name, url.PathEscape(branch))
	treeBody, err := a.githubGetJSON(ctx, treeURL, token)
	if err != nil {
		return ScanRepoResult{}, err
	}
	var treeResp struct {
		Tree []struct {
			Path string `json:"path"`
			Type string `json:"type"`
			Size int64  `json:"size"`
		} `json:"tree"`
		Truncated bool `json:"truncated"`
	}
	if err := json.Unmarshal(treeBody, &treeResp); err != nil {
		return ScanRepoResult{}, fmt.Errorf("parse git tree: %w", err)
	}

	entries := make([]treeEntry, 0, len(treeResp.Tree))
	for _, e := range treeResp.Tree {
		entries = append(entries, treeEntry{Path: e.Path, Type: e.Type, Size: e.Size})
	}

	// 2. Select the bounded well-known file set.
	sel := selectWellKnownFiles(entries, maxFilesPerRepo, maxFileBytes)

	// 3. Fetch each selected file's content.
	files := map[string]string{}
	for _, p := range sel.Paths {
		content, ok, err := a.fetchFileContent(ctx, in.Repo.Owner, in.Repo.Name, branch, p, token)
		if err != nil {
			return ScanRepoResult{}, err
		}
		if !ok {
			continue
		}
		if int64(len(content)) > maxFileBytes {
			content = content[:maxFileBytes]
		}
		files[p] = content
		activity.RecordHeartbeat(ctx, fmt.Sprintf("%s/%s: fetched %s", in.Repo.Owner, in.Repo.Name, p))
	}

	// 4. Build the flattened tree path list (bounded).
	treePaths := make([]string, 0, len(entries))
	treeTruncated := treeResp.Truncated
	for _, e := range entries {
		if e.Type != "blob" && e.Type != "tree" {
			continue
		}
		if len(treePaths) >= maxTreeEntries {
			treeTruncated = true
			break
		}
		treePaths = append(treePaths, e.Path)
	}

	// 5. POST the evidence bundle to the ingest route.
	reqBody := ingestRequest{
		InstallationID: in.InstallationID,
		WorkspaceID:    in.WorkspaceID,
		Repo:           in.Repo,
		ScanRunID:      in.ScanRunID,
		Bundle: ingestBundle{
			Tree:               treePaths,
			Files:              files,
			SkippedLarge:       sel.SkippedLarge,
			TruncatedTree:      treeTruncated,
			TruncatedSelection: sel.Truncated,
		},
	}
	return a.postIngest(ctx, reqBody)
}

// ---------------------------------------------------------------------------
// Pure file-selection logic (unit-tested directly)
// ---------------------------------------------------------------------------

// treeEntry is one entry in a repo's git tree.
type treeEntry struct {
	Path string
	Type string // "blob" | "tree"
	Size int64
}

// fileSelection is the result of selectWellKnownFiles.
type fileSelection struct {
	// Paths are the blob paths to fetch, ordered by detection priority then
	// lexically, capped at maxFiles.
	Paths []string
	// SkippedLarge are well-known paths skipped because they exceed the
	// per-file size cap. Noted in the bundle, never fetched.
	SkippedLarge []string
	// Truncated is true when more matching files existed than the cap allowed.
	Truncated bool
}

// selectWellKnownFiles picks the discovery-relevant files out of a repo tree.
// It is the Go mirror of orbit-www's DISCOVERY_FETCH_PATTERNS — keep the two in
// sync (see lib/discovery/detectors.ts). Higher-signal files (Tier 1 manifests,
// API specs) sort ahead of lower-signal ones so the cap never crowds out an
// .orbit.yaml.
func selectWellKnownFiles(entries []treeEntry, maxFiles int, maxBytes int64) fileSelection {
	type candidate struct {
		path     string
		priority int
	}
	var cands []candidate
	var skippedLarge []string

	for _, e := range entries {
		if e.Type != "blob" {
			continue
		}
		prio, ok := classifyWellKnown(e.Path)
		if !ok {
			continue
		}
		if maxBytes > 0 && e.Size > maxBytes {
			skippedLarge = append(skippedLarge, e.Path)
			continue
		}
		cands = append(cands, candidate{path: e.Path, priority: prio})
	}

	sort.SliceStable(cands, func(i, j int) bool {
		if cands[i].priority != cands[j].priority {
			return cands[i].priority < cands[j].priority
		}
		return cands[i].path < cands[j].path
	})

	truncated := false
	if maxFiles > 0 && len(cands) > maxFiles {
		cands = cands[:maxFiles]
		truncated = true
	}

	paths := make([]string, 0, len(cands))
	for _, c := range cands {
		paths = append(paths, c.path)
	}
	sort.Strings(skippedLarge)

	return fileSelection{Paths: paths, SkippedLarge: skippedLarge, Truncated: truncated}
}

// Detection priorities (lower = higher signal, fetched first).
const (
	prioManifest = iota // .orbit.yaml / catalog-info.yaml
	prioAPISpec         // openapi/swagger/asyncapi/graphql
	prioService         // Dockerfile, compose, build manifests, CODEOWNERS
	prioK8s             // yaml under k8s manifest dirs
)

// classifyWellKnown reports whether a path is a discovery-relevant file and, if
// so, its fetch priority. Build manifests and container files are matched at the
// repo root only (to avoid node_modules / vendored noise); API specs and k8s
// manifests are matched anywhere in the tree.
func classifyWellKnown(p string) (int, bool) {
	lower := strings.ToLower(p)
	base := path.Base(p)
	lowerBase := strings.ToLower(base)
	dir := path.Dir(p) // "." at the repo root
	isRoot := dir == "."
	ext := strings.ToLower(path.Ext(p))

	// Tier 1 self-declaring manifests (root only).
	if isRoot {
		switch base {
		case ".orbit.yaml", ".orbit.yml", "catalog-info.yaml", "catalog-info.yml":
			return prioManifest, true
		}
	}

	// API specs (anywhere in the tree).
	if ext == ".graphql" || ext == ".graphqls" {
		return prioAPISpec, true
	}
	if ext == ".json" || ext == ".yaml" || ext == ".yml" {
		if strings.Contains(lowerBase, "openapi") ||
			strings.Contains(lowerBase, "swagger") ||
			strings.Contains(lowerBase, "asyncapi") {
			return prioAPISpec, true
		}
	}

	// Build manifests + container files (root only).
	if isRoot {
		switch base {
		case "Dockerfile", "package.json", "go.mod", "pom.xml", "Cargo.toml", "pyproject.toml", "requirements.txt":
			return prioService, true
		}
		if strings.HasPrefix(lowerBase, "docker-compose") && (ext == ".yml" || ext == ".yaml") {
			return prioService, true
		}
	}

	// CODEOWNERS in the conventional locations.
	if base == "CODEOWNERS" && (isRoot || dir == ".github" || dir == "docs") {
		return prioService, true
	}

	// Kubernetes/Helm manifests under a recognised top-level directory.
	if ext == ".yaml" || ext == ".yml" {
		top := lower
		if i := strings.IndexByte(lower, '/'); i >= 0 {
			top = lower[:i]
		}
		switch top {
		case "k8s", "kubernetes", "manifests", "deploy", "deployments", "charts":
			return prioK8s, true
		}
	}

	return 0, false
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

// installationToken mints (reads) the current installation token from
// orbit-www's internal token route, keyed by numeric GitHub installation ID.
func (a *CatalogScanActivities) installationToken(ctx context.Context, installationID string) (string, error) {
	if a.orbitBaseURL == "" {
		return "", temporal.NewNonRetryableApplicationError("orbit base URL not configured", "Config", nil)
	}
	buf, _ := json.Marshal(map[string]string{"installationId": installationID})
	u := a.orbitBaseURL + "/api/internal/github/token"

	cctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(cctx, http.MethodPost, u, bytes.NewReader(buf))
	if err != nil {
		return "", err
	}
	req.Header.Set("X-API-Key", a.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return "", err // network error — retryable
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))

	switch resp.StatusCode {
	case http.StatusOK:
		var out struct {
			Token string `json:"token"`
		}
		if err := json.Unmarshal(body, &out); err != nil {
			return "", fmt.Errorf("parse token response: %w", err)
		}
		if out.Token == "" {
			return "", temporal.NewNonRetryableApplicationError("empty installation token", "GitHubAuth", nil)
		}
		return out.Token, nil
	case http.StatusNotFound:
		return "", temporal.NewNonRetryableApplicationError(
			fmt.Sprintf("github installation %s not found", installationID), "InstallationNotFound", nil)
	case http.StatusGone:
		// Token near/expired; refresh was nudged. Retry lets the next attempt
		// pick up the refreshed token.
		return "", fmt.Errorf("installation token expired (refresh nudged): HTTP 410")
	default:
		return "", fmt.Errorf("token route HTTP %d: %s", resp.StatusCode, string(body))
	}
}

// githubGetJSON performs an authenticated GitHub API GET. 404/403/451 map to
// non-retryable errors (deleted repo, revoked access); everything else
// (5xx, 429, network) is retryable.
func (a *CatalogScanActivities) githubGetJSON(ctx context.Context, u, token string) ([]byte, error) {
	cctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(cctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 16<<20))

	if resp.StatusCode/100 == 2 {
		return body, nil
	}
	switch resp.StatusCode {
	case http.StatusNotFound, http.StatusForbidden, http.StatusUnavailableForLegalReasons, http.StatusConflict:
		// 404 deleted, 403 access revoked, 451 DMCA, 409 empty repo — none
		// recover on retry; let the workflow skip this repo.
		return nil, temporal.NewNonRetryableApplicationError(
			fmt.Sprintf("github GET %s: HTTP %d", u, resp.StatusCode), "GitHubUnreadable", nil)
	default:
		return nil, fmt.Errorf("github GET %s: HTTP %d: %s", u, resp.StatusCode, string(body))
	}
}

// fetchFileContent reads one file's raw content via the GitHub contents API
// (Accept: raw). Returns ok=false for a missing/too-large file (which is
// skipped, not fatal).
func (a *CatalogScanActivities) fetchFileContent(ctx context.Context, owner, repo, ref, p, token string) (string, bool, error) {
	u := fmt.Sprintf("%s/repos/%s/%s/contents/%s?ref=%s",
		a.githubAPIURL, owner, repo, encodePath(p), url.QueryEscape(ref))

	cctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(cctx, http.MethodGet, u, nil)
	if err != nil {
		return "", false, err
	}
	req.Header.Set("Accept", "application/vnd.github.raw")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return "", false, err
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode/100 == 2:
		body, err := io.ReadAll(io.LimitReader(resp.Body, maxFileBytes+1))
		if err != nil {
			return "", false, err
		}
		return string(body), true, nil
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusForbidden:
		// Missing file, or contents API "too large" (>1MB) — skip it.
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
		return "", false, nil
	default:
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		return "", false, fmt.Errorf("github contents GET %s: HTTP %d: %s", p, resp.StatusCode, string(body))
	}
}

// ingestRequest is the body POSTed to /api/internal/discovery/ingest.
// Keep this contract in sync with the ingest route (orbit-www side).
type ingestRequest struct {
	InstallationID string       `json:"installationId"`
	WorkspaceID    string       `json:"workspaceId"`
	Repo           RepoRef      `json:"repo"`
	ScanRunID      string       `json:"scanRunId"`
	Bundle         ingestBundle `json:"bundle"`
}

type ingestBundle struct {
	Tree               []string          `json:"tree"`
	Files              map[string]string `json:"files"`
	SkippedLarge       []string          `json:"skippedLarge,omitempty"`
	TruncatedTree      bool              `json:"truncatedTree,omitempty"`
	TruncatedSelection bool              `json:"truncatedSelection,omitempty"`
}

// postIngest ships the evidence bundle to orbit-www. Any non-2xx is a retryable
// activity error (the ingest route is idempotent by dedupeKey, so retries are
// safe).
func (a *CatalogScanActivities) postIngest(ctx context.Context, reqBody ingestRequest) (ScanRepoResult, error) {
	if a.orbitBaseURL == "" {
		return ScanRepoResult{}, temporal.NewNonRetryableApplicationError("orbit base URL not configured", "Config", nil)
	}
	buf, err := json.Marshal(reqBody)
	if err != nil {
		return ScanRepoResult{}, fmt.Errorf("marshal ingest body: %w", err)
	}
	u := a.orbitBaseURL + "/api/internal/discovery/ingest"

	cctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(cctx, http.MethodPost, u, bytes.NewReader(buf))
	if err != nil {
		return ScanRepoResult{}, err
	}
	req.Header.Set("X-API-Key", a.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return ScanRepoResult{}, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))

	if resp.StatusCode/100 != 2 {
		return ScanRepoResult{}, fmt.Errorf("ingest route HTTP %d: %s", resp.StatusCode, string(body))
	}

	var out ScanRepoResult
	if err := json.Unmarshal(body, &out); err != nil {
		return ScanRepoResult{}, fmt.Errorf("parse ingest response: %w", err)
	}
	return out, nil
}

// encodePath percent-encodes each path segment while preserving the slashes, so
// a path like "docs/api/openapi.yaml" stays a valid contents-API path.
func encodePath(p string) string {
	segs := strings.Split(p, "/")
	for i, s := range segs {
		segs[i] = url.PathEscape(s)
	}
	return strings.Join(segs, "/")
}
