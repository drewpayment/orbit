package activities

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"
)

// Azure DevOps catalog-discovery scan activities — the ADO half of the scanner
// (see docs/plans/2026-07-06-catalog-discovery.md, Phase 1.6 / WP11). They are
// the structural twin of the GitHub CatalogScanActivities: list an ADO
// connection's repositories, walk each repo's default-branch tree, fetch a
// bounded well-known file set, and POST the evidence bundle to orbit-www's
// ingest route. All detection/scoring/staging still happens on the orbit-www
// side; these activities only transport evidence.
//
// The file-selection helpers (selectWellKnownFiles / classifyWellKnown /
// isVendoredPath), the size/tree caps, the RepoRef / ScanRepoResult shapes, the
// bundle tree flattener (buildBundleTreePaths), and the ingest POST
// (postIngestBundle) are SHARED with the GitHub scanner in
// catalog_scan_activities.go — the two providers differ only in transport
// (REST 7.1 + PAT basic auth) and tree/content mapping.
//
// Azure DevOps REST endpoints used (all api-version=7.1):
//   - projects:  GET {baseUrl}/{org}/_apis/projects
//                (org-wide enumeration; paginated via the x-ms-continuationtoken
//                 response header echoed back as ?continuationToken=)
//   - repos:     GET {baseUrl}/{org}/{project}/_apis/git/repositories
//   - tree:      GET {baseUrl}/{org}/{project}/_apis/git/repositories/{repo}/items
//                    ?recursionLevel=Full&versionDescriptor.versionType=branch
//                    &versionDescriptor.version={branch}
//   - content:   GET {baseUrl}/{org}/{project}/_apis/git/repositories/{repo}/items
//                    ?path={/path}&versionDescriptor.versionType=branch
//                    &versionDescriptor.version={branch}&$format=text
//                (raw file bytes; $format=text + Accept: text/plain returns the
//                 file body verbatim rather than the JSON item envelope)
//
// {repo} accepts the repository name in the {repositoryId} slot, so RepoRef.Name
// is used directly (no GUID lookup). Auth is HTTP Basic with an empty username
// and the PAT as the password: base64(":" + pat).
//
// SECURITY: the PAT must never appear in a log line, error string, or heartbeat.
// It lives only in the Authorization header. adoConnectionInfo is never logged.

// adoAPIVersion pins every ADO REST call to a single, stable API version.
const adoAPIVersion = "7.1"

// adoConnectionInfo is the decrypted connection detail returned by orbit-www's
// /api/internal/git-connections/token route. PAT is sensitive — never log it.
type adoConnectionInfo struct {
	Provider     string `json:"provider"`
	Organization string `json:"organization"`
	Project      string `json:"project"`
	BaseURL      string `json:"baseUrl"`
	// AuthMode is how the token must be presented: "basic-pat" (HTTP Basic,
	// empty username) or "bearer" (a short-lived Microsoft Entra access token
	// minted server-side for service-principal connections — WP12).
	AuthMode string `json:"authMode"`
	Token    string `json:"token"`
}

// authorizationHeader builds the provider Authorization header for the
// connection's auth mode. The token is sensitive — never log the result.
func (c adoConnectionInfo) authorizationHeader() string {
	if c.AuthMode == "bearer" {
		return "Bearer " + c.Token
	}
	return adoBasicAuth(c.Token)
}

// ADOScanActivities holds the shared HTTP dependencies for the Azure DevOps scan
// activities. orbitBaseURL + apiKey point at orbit-www (ORBIT_API_URL /
// ORBIT_INTERNAL_API_KEY) — the ADO base URL and PAT come per-scan from the
// token route, not from construction.
type ADOScanActivities struct {
	orbitBaseURL string
	apiKey       string
	httpClient   *http.Client
	logger       *slog.Logger
}

// NewADOScanActivities constructs the ADO scan activities. orbitBaseURL is the
// orbit-www origin (e.g. http://localhost:3000); apiKey is ORBIT_INTERNAL_API_KEY.
func NewADOScanActivities(orbitBaseURL, apiKey string, logger *slog.Logger) *ADOScanActivities {
	if logger == nil {
		logger = slog.Default()
	}
	return &ADOScanActivities{
		orbitBaseURL: strings.TrimRight(orbitBaseURL, "/"),
		apiKey:       apiKey,
		httpClient:   &http.Client{Timeout: 30 * time.Second},
		logger:       logger,
	}
}

// ListADOReposInput drives ListADOReposActivity.
type ListADOReposInput struct {
	// ConnectionID is the git-connections doc id. The token route resolves it to
	// { organization, project?, baseUrl, pat }.
	ConnectionID string `json:"connectionId"`
}

// ScanADORepoInput drives ScanADORepoActivity.
type ScanADORepoInput struct {
	ConnectionID string `json:"connectionId"`
	// WorkspaceID is empty for a global scan; omitempty keeps it out of the ingest
	// POST so the ingest route sees an absent workspaceId (mirrors the GitHub path).
	WorkspaceID string  `json:"workspaceId,omitempty"`
	Repo        RepoRef `json:"repo"`
	ScanRunID   string  `json:"scanRunId"`
}

// ---------------------------------------------------------------------------
// ListADOReposActivity
// ---------------------------------------------------------------------------

// ListADOReposActivity enumerates the repositories reachable through an Azure
// DevOps connection. When the connection pins a project, only that project's
// repos are listed; otherwise every project in the org is enumerated (paginated)
// and its repos collected. Disabled repos are skipped. RepoRef.Owner carries the
// project name (ADO's repo coordinate is org/project/repo).
func (a *ADOScanActivities) ListADOReposActivity(ctx context.Context, in ListADOReposInput) ([]RepoRef, error) {
	if in.ConnectionID == "" {
		return nil, temporal.NewNonRetryableApplicationError("connectionId required", "InvalidInput", nil)
	}

	conn, err := a.adoConnection(ctx, in.ConnectionID)
	if err != nil {
		return nil, err
	}
	base := strings.TrimRight(conn.BaseURL, "/")
	auth := conn.authorizationHeader()

	var projects []string
	if conn.Project != "" {
		projects = []string{conn.Project}
	} else {
		projects, err = a.listADOProjects(ctx, base, conn.Organization, auth)
		if err != nil {
			return nil, err
		}
	}

	var repos []RepoRef
	for _, project := range projects {
		rs, err := a.listADOReposForProject(ctx, base, conn.Organization, project, auth)
		if err != nil {
			return nil, err
		}
		repos = append(repos, rs...)
		activity.RecordHeartbeat(ctx, fmt.Sprintf("project %s: %d repos so far", project, len(repos)))
	}

	a.logger.Info("listed ADO repositories",
		slog.String("organization", conn.Organization),
		slog.Int("projects", len(projects)),
		slog.Int("repos", len(repos)),
	)
	return repos, nil
}

// listADOProjects enumerates every project in an org, following the
// x-ms-continuationtoken response header (echoed back as ?continuationToken=)
// until it is absent.
func (a *ADOScanActivities) listADOProjects(ctx context.Context, base, org, auth string) ([]string, error) {
	var names []string
	continuation := ""
	for {
		u := fmt.Sprintf("%s/%s/_apis/projects?api-version=%s",
			base, url.PathEscape(org), adoAPIVersion)
		if continuation != "" {
			u += "&continuationToken=" + url.QueryEscape(continuation)
		}
		body, header, err := a.adoGet(ctx, u, auth)
		if err != nil {
			return nil, err
		}
		var resp struct {
			Value []struct {
				Name string `json:"name"`
			} `json:"value"`
		}
		if err := json.Unmarshal(body, &resp); err != nil {
			return nil, fmt.Errorf("parse ado projects: %w", err)
		}
		for _, p := range resp.Value {
			names = append(names, p.Name)
		}
		activity.RecordHeartbeat(ctx, fmt.Sprintf("enumerated %d projects", len(names)))
		continuation = header.Get("x-ms-continuationtoken")
		if continuation == "" {
			break
		}
	}
	return names, nil
}

// listADOReposForProject lists the git repositories in one project. Disabled
// repos are dropped and the default branch is normalised (refs/heads/ stripped,
// empty → main).
func (a *ADOScanActivities) listADOReposForProject(ctx context.Context, base, org, project, auth string) ([]RepoRef, error) {
	u := fmt.Sprintf("%s/%s/%s/_apis/git/repositories?api-version=%s",
		base, url.PathEscape(org), url.PathEscape(project), adoAPIVersion)
	body, _, err := a.adoGet(ctx, u, auth)
	if err != nil {
		return nil, err
	}
	var resp struct {
		Value []struct {
			Name          string `json:"name"`
			DefaultBranch string `json:"defaultBranch"`
			WebURL        string `json:"webUrl"`
			IsDisabled    bool   `json:"isDisabled"`
			Project       struct {
				Name string `json:"name"`
			} `json:"project"`
		} `json:"value"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("parse ado repositories: %w", err)
	}

	repos := make([]RepoRef, 0, len(resp.Value))
	for _, r := range resp.Value {
		if r.IsDisabled {
			continue
		}
		owner := r.Project.Name
		if owner == "" {
			owner = project
		}
		branch := strings.TrimPrefix(r.DefaultBranch, "refs/heads/")
		if branch == "" {
			branch = "main"
		}
		repos = append(repos, RepoRef{
			Owner:         owner,
			Name:          r.Name,
			URL:           r.WebURL,
			DefaultBranch: branch,
		})
	}
	return repos, nil
}

// ---------------------------------------------------------------------------
// ScanADORepoActivity
// ---------------------------------------------------------------------------

// ScanADORepoActivity walks one ADO repo's default-branch tree, fetches the
// well-known files, and POSTs the evidence bundle to orbit-www's ingest route
// with installationId == connectionId (verbatim, so the ingest dedupeKey is
// stable) and connectionId set. A repo the connection cannot read fails
// non-retryably so the workflow records it and continues.
func (a *ADOScanActivities) ScanADORepoActivity(ctx context.Context, in ScanADORepoInput) (ScanRepoResult, error) {
	if in.Repo.Owner == "" || in.Repo.Name == "" {
		return ScanRepoResult{}, temporal.NewNonRetryableApplicationError("repo owner/name required", "InvalidInput", nil)
	}

	conn, err := a.adoConnection(ctx, in.ConnectionID)
	if err != nil {
		return ScanRepoResult{}, err
	}
	base := strings.TrimRight(conn.BaseURL, "/")
	auth := conn.authorizationHeader()
	org := conn.Organization
	project := in.Repo.Owner
	repo := in.Repo.Name
	branch := in.Repo.DefaultBranch
	if branch == "" {
		branch = "main"
	}

	// 1. Full recursive item listing for the default branch.
	itemsURL := fmt.Sprintf(
		"%s/%s/%s/_apis/git/repositories/%s/items?recursionLevel=Full&versionDescriptor.versionType=branch&versionDescriptor.version=%s&api-version=%s",
		base, url.PathEscape(org), url.PathEscape(project), url.PathEscape(repo),
		url.QueryEscape(branch), adoAPIVersion)
	body, _, err := a.adoGet(ctx, itemsURL, auth)
	if err != nil {
		return ScanRepoResult{}, err
	}
	var itemsResp struct {
		Value []adoItem `json:"value"`
	}
	if err := json.Unmarshal(body, &itemsResp); err != nil {
		return ScanRepoResult{}, fmt.Errorf("parse ado items: %w", err)
	}
	entries := adoItemsToEntries(itemsResp.Value)

	// 2. Select the bounded well-known file set (shared with the GitHub scanner).
	//    ADO's item listing carries no per-file size, so entries report Size 0 and
	//    the pre-fetch large-skip never fires; oversized content is instead capped
	//    at fetch time (see step 3), matching maxFileBytes exactly.
	sel := selectWellKnownFiles(entries, maxFilesPerRepo, maxFileBytes)

	// 3. Fetch each selected file's raw content.
	files := map[string]string{}
	for _, p := range sel.Paths {
		content, ok, err := a.fetchADOFileContent(ctx, base, org, project, repo, branch, p, auth)
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
		activity.RecordHeartbeat(ctx, fmt.Sprintf("%s/%s: fetched %s", project, repo, p))
	}

	// 4. Flatten the tree (bounded, vendored-filtered) — shared helper. ADO always
	//    returns the full listing, so no provider-side truncation flag.
	treePaths, treeTruncated := buildBundleTreePaths(entries, false)

	// 5. POST the evidence bundle. installationId carries the connection id
	//    verbatim (dedupeKey), connectionId is the additive hint.
	reqBody := ingestRequest{
		InstallationID: in.ConnectionID,
		ConnectionID:   in.ConnectionID,
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
	return postIngestBundle(ctx, a.httpClient, a.orbitBaseURL, a.apiKey, reqBody)
}

// ---------------------------------------------------------------------------
// Pure ADO item → tree mapping (unit-tested directly)
// ---------------------------------------------------------------------------

// adoItem mirrors the fields we care about from an ADO git item.
type adoItem struct {
	Path          string `json:"path"`
	IsFolder      bool   `json:"isFolder"`
	GitObjectType string `json:"gitObjectType"`
}

// adoItemsToEntries converts ADO git items into the provider-agnostic treeEntry
// shape consumed by selectWellKnownFiles / buildBundleTreePaths. ADO paths have a
// leading '/', which is stripped; the empty root path is dropped. isFolder maps to
// tree, otherwise blob. Size is unknown from the listing, so it is 0 (the
// per-file cap is enforced at fetch time instead).
func adoItemsToEntries(items []adoItem) []treeEntry {
	entries := make([]treeEntry, 0, len(items))
	for _, it := range items {
		p := strings.TrimPrefix(it.Path, "/")
		if p == "" {
			continue
		}
		typ := "blob"
		if it.IsFolder {
			typ = "tree"
		}
		entries = append(entries, treeEntry{Path: p, Type: typ, Size: 0})
	}
	return entries
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

// adoBasicAuth builds the HTTP Basic Authorization header value for a PAT: an
// empty username and the PAT as password, i.e. base64(":" + pat).
func adoBasicAuth(pat string) string {
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(":"+pat))
}

// adoConnection resolves a connection id to its decrypted detail via orbit-www's
// internal token route. It caches nothing across calls (each activity invocation
// re-reads the connection). The PAT it returns is sensitive — callers must keep
// it out of logs/errors.
func (a *ADOScanActivities) adoConnection(ctx context.Context, connectionID string) (adoConnectionInfo, error) {
	if a.orbitBaseURL == "" {
		return adoConnectionInfo{}, temporal.NewNonRetryableApplicationError("orbit base URL not configured", "Config", nil)
	}
	if connectionID == "" {
		return adoConnectionInfo{}, temporal.NewNonRetryableApplicationError("connectionId required", "InvalidInput", nil)
	}
	buf, _ := json.Marshal(map[string]string{"connectionId": connectionID})
	u := a.orbitBaseURL + "/api/internal/git-connections/token"

	cctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(cctx, http.MethodPost, u, bytes.NewReader(buf))
	if err != nil {
		return adoConnectionInfo{}, err
	}
	req.Header.Set("X-API-Key", a.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return adoConnectionInfo{}, err // network error — retryable
	}
	defer resp.Body.Close()
	// The success body carries the PAT; never echo it into an error string.
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))

	switch resp.StatusCode {
	case http.StatusOK:
		var out adoConnectionInfo
		if err := json.Unmarshal(body, &out); err != nil {
			return adoConnectionInfo{}, fmt.Errorf("parse connection token response: %w", err)
		}
		if out.Token == "" {
			return adoConnectionInfo{}, temporal.NewNonRetryableApplicationError("connection returned empty token", "ADOAuth", nil)
		}
		if out.BaseURL == "" {
			return adoConnectionInfo{}, temporal.NewNonRetryableApplicationError("connection returned empty baseUrl", "ADOConfig", nil)
		}
		if out.Organization == "" {
			return adoConnectionInfo{}, temporal.NewNonRetryableApplicationError("connection returned empty organization", "ADOConfig", nil)
		}
		return out, nil
	case http.StatusNotFound:
		return adoConnectionInfo{}, temporal.NewNonRetryableApplicationError(
			fmt.Sprintf("git connection %s not found", connectionID), "ConnectionNotFound", nil)
	default:
		// Do NOT include the response body: a misconfigured route could conceivably
		// echo request detail, and we never risk leaking the PAT. Status only.
		return adoConnectionInfo{}, fmt.Errorf("connection token route HTTP %d", resp.StatusCode)
	}
}

// adoGet performs an authenticated ADO REST GET and returns the body and response
// headers (the caller reads x-ms-continuationtoken for pagination). 401/403/404
// map to non-retryable errors (bad credentials, no access, deleted repo); 5xx/429
// and network errors are retryable. Error strings carry only the URL and status —
// never the Authorization header — so the PAT cannot leak.
func (a *ADOScanActivities) adoGet(ctx context.Context, u, auth string) ([]byte, http.Header, error) {
	cctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(cctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", auth)

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 16<<20))

	if resp.StatusCode/100 == 2 {
		return body, resp.Header, nil
	}
	switch resp.StatusCode {
	case http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound:
		// Bad PAT, no access, or deleted repo/project — none recover on retry.
		return nil, nil, temporal.NewNonRetryableApplicationError(
			fmt.Sprintf("ado GET %s: HTTP %d", u, resp.StatusCode), "ADOUnreadable", nil)
	default:
		return nil, nil, fmt.Errorf("ado GET %s: HTTP %d", u, resp.StatusCode)
	}
}

// fetchADOFileContent reads one file's raw content via the items API with
// $format=text (Accept: text/plain), which returns the file body verbatim.
// Returns ok=false for a missing file (404 — skipped, not fatal).
func (a *ADOScanActivities) fetchADOFileContent(ctx context.Context, base, org, project, repo, branch, p, auth string) (string, bool, error) {
	u := fmt.Sprintf(
		"%s/%s/%s/_apis/git/repositories/%s/items?path=%s&versionDescriptor.versionType=branch&versionDescriptor.version=%s&$format=text&api-version=%s",
		base, url.PathEscape(org), url.PathEscape(project), url.PathEscape(repo),
		url.QueryEscape("/"+p), url.QueryEscape(branch), adoAPIVersion)

	cctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(cctx, http.MethodGet, u, nil)
	if err != nil {
		return "", false, err
	}
	req.Header.Set("Accept", "text/plain")
	req.Header.Set("Authorization", auth)

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return "", false, err
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode/100 == 2:
		content, err := io.ReadAll(io.LimitReader(resp.Body, maxFileBytes+1))
		if err != nil {
			return "", false, err
		}
		return string(content), true, nil
	case resp.StatusCode == http.StatusNotFound:
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
		return "", false, nil
	default:
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
		return "", false, fmt.Errorf("ado contents GET %s: HTTP %d", p, resp.StatusCode)
	}
}
