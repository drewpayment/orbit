package activities

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/testsuite"
)

// TestADOBasicAuth verifies the PAT is encoded as HTTP Basic with an empty
// username: base64(":" + pat).
func TestADOBasicAuth(t *testing.T) {
	got := adoBasicAuth("s3cr3t-pat")
	require.True(t, strings.HasPrefix(got, "Basic "))
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(got, "Basic "))
	require.NoError(t, err)
	require.Equal(t, ":s3cr3t-pat", string(decoded))
}

// TestADOItemsToEntries verifies ADO items map to provider-agnostic treeEntry:
// leading '/' stripped, empty root dropped, isFolder → tree, Size 0.
func TestADOItemsToEntries(t *testing.T) {
	items := []adoItem{
		{Path: "/", IsFolder: true, GitObjectType: "tree"},
		{Path: "/src", IsFolder: true, GitObjectType: "tree"},
		{Path: "/src/main.go", IsFolder: false, GitObjectType: "blob"},
		{Path: "/.orbit.yaml", IsFolder: false, GitObjectType: "blob"},
		{Path: "", IsFolder: true}, // defensive: empty path dropped too
	}
	got := adoItemsToEntries(items)
	require.Equal(t, []treeEntry{
		{Path: "src", Type: "tree", Size: 0},
		{Path: "src/main.go", Type: "blob", Size: 0},
		{Path: ".orbit.yaml", Type: "blob", Size: 0},
	}, got)
}

// TestADOItemsToEntriesFeedsSelection proves the ADO mapping composes with the
// shared selector + vendored filter exactly like the GitHub path.
func TestADOItemsToEntriesFeedsSelection(t *testing.T) {
	items := []adoItem{
		{Path: "/.orbit.yaml", IsFolder: false},
		{Path: "/Dockerfile", IsFolder: false},
		{Path: "/node_modules", IsFolder: true},
		{Path: "/node_modules/left-pad/package.json", IsFolder: false}, // vendored → dropped
		{Path: "/docs/openapi.yaml", IsFolder: false},
		{Path: "/README.md", IsFolder: false}, // not well-known
	}
	sel := selectWellKnownFiles(adoItemsToEntries(items), maxFilesPerRepo, maxFileBytes)
	require.Equal(t, []string{".orbit.yaml", "docs/openapi.yaml", "Dockerfile"}, sel.Paths)
}

// adoTestServer is a single httptest server standing in for both orbit-www (the
// token + ingest routes) and the Azure DevOps REST API. The token route returns
// baseUrl == the server's own URL so every ADO call loops back here.
type adoTestServer struct {
	srv        *httptest.Server
	pat        string
	project    string // connection project filter ("" = org-wide)
	authHeader string // last Authorization header seen on an ADO call
	ingestBody ingestRequest
	ingestSeen bool
}

func newADOTestServer(t *testing.T, project string, handler func(w http.ResponseWriter, r *http.Request, ts *adoTestServer)) *adoTestServer {
	t.Helper()
	ts := &adoTestServer{pat: "test-pat", project: project}
	ts.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/internal/git-connections/token":
			require.Equal(t, "test-key", r.Header.Get("X-API-Key"))
			_ = json.NewEncoder(w).Encode(adoConnectionInfo{
				Provider:     "azure-devops",
				Organization: "acme",
				Project:      ts.project,
				BaseURL:      ts.srv.URL,
				PAT:          ts.pat,
			})
		case r.Method == http.MethodPost && r.URL.Path == "/api/internal/discovery/ingest":
			require.Equal(t, "test-key", r.Header.Get("X-API-Key"))
			body, _ := io.ReadAll(r.Body)
			require.NoError(t, json.Unmarshal(body, &ts.ingestBody))
			ts.ingestSeen = true
			_ = json.NewEncoder(w).Encode(ScanRepoResult{Proposed: 3, Imported: 1})
		default:
			// ADO REST call — record the auth header and delegate.
			ts.authHeader = r.Header.Get("Authorization")
			handler(w, r, ts)
		}
	}))
	t.Cleanup(ts.srv.Close)
	return ts
}

func (ts *adoTestServer) activities() *ADOScanActivities {
	return NewADOScanActivities(ts.srv.URL, "test-key", nil)
}

// runListADORepos executes ListADOReposActivity inside a Temporal test activity
// environment so activity.RecordHeartbeat has a valid context.
func runListADORepos(t *testing.T, a *ADOScanActivities, in ListADOReposInput) ([]RepoRef, error) {
	t.Helper()
	env := (&testsuite.WorkflowTestSuite{}).NewTestActivityEnvironment()
	env.RegisterActivity(a.ListADOReposActivity)
	val, err := env.ExecuteActivity(a.ListADOReposActivity, in)
	if err != nil {
		return nil, err
	}
	var repos []RepoRef
	require.NoError(t, val.Get(&repos))
	return repos, nil
}

// runScanADORepo executes ScanADORepoActivity inside a Temporal test activity
// environment so activity.RecordHeartbeat has a valid context.
func runScanADORepo(t *testing.T, a *ADOScanActivities, in ScanADORepoInput) (ScanRepoResult, error) {
	t.Helper()
	env := (&testsuite.WorkflowTestSuite{}).NewTestActivityEnvironment()
	env.RegisterActivity(a.ScanADORepoActivity)
	val, err := env.ExecuteActivity(a.ScanADORepoActivity, in)
	if err != nil {
		return ScanRepoResult{}, err
	}
	var res ScanRepoResult
	require.NoError(t, val.Get(&res))
	return res, nil
}

// TestListADOReposActivity_ProjectScoped verifies a connection pinned to a
// project lists only that project's repos, skips disabled repos, and strips
// refs/heads/ from the default branch.
func TestListADOReposActivity_ProjectScoped(t *testing.T) {
	ts := newADOTestServer(t, "Payments", func(w http.ResponseWriter, r *http.Request, ts *adoTestServer) {
		require.Contains(t, r.URL.Path, "/acme/Payments/_apis/git/repositories")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"value": []map[string]any{
				{"name": "billing", "defaultBranch": "refs/heads/main", "webUrl": "https://dev.azure.com/acme/Payments/_git/billing", "isDisabled": false, "project": map[string]any{"name": "Payments"}},
				{"name": "archived-svc", "defaultBranch": "refs/heads/main", "isDisabled": true, "project": map[string]any{"name": "Payments"}},
				{"name": "no-branch", "defaultBranch": "", "webUrl": "u", "isDisabled": false, "project": map[string]any{"name": "Payments"}},
			},
		})
	})

	repos, err := runListADORepos(t, ts.activities(), ListADOReposInput{ConnectionID: "conn-1"})
	require.NoError(t, err)
	require.Equal(t, []RepoRef{
		{Owner: "Payments", Name: "billing", URL: "https://dev.azure.com/acme/Payments/_git/billing", DefaultBranch: "main"},
		{Owner: "Payments", Name: "no-branch", URL: "u", DefaultBranch: "main"},
	}, repos)

	// Auth header must be Basic base64(":"+pat) — never the raw PAT.
	require.Equal(t, adoBasicAuth("test-pat"), ts.authHeader)
	require.NotContains(t, ts.authHeader, "test-pat")
}

// TestListADOReposActivity_OrgWidePaginates verifies org-wide enumeration
// (empty project) follows the x-ms-continuationtoken header across project pages
// and collects repos from every project.
func TestListADOReposActivity_OrgWidePaginates(t *testing.T) {
	ts := newADOTestServer(t, "", func(w http.ResponseWriter, r *http.Request, ts *adoTestServer) {
		switch {
		case strings.Contains(r.URL.Path, "/_apis/projects"):
			cont := r.URL.Query().Get("continuationToken")
			if cont == "" {
				// First page → one project, more to come.
				w.Header().Set("x-ms-continuationtoken", "page2")
				_ = json.NewEncoder(w).Encode(map[string]any{"value": []map[string]any{{"name": "Alpha"}}})
			} else {
				require.Equal(t, "page2", cont)
				_ = json.NewEncoder(w).Encode(map[string]any{"value": []map[string]any{{"name": "Beta"}}})
			}
		case strings.Contains(r.URL.Path, "/acme/Alpha/_apis/git/repositories"):
			_ = json.NewEncoder(w).Encode(map[string]any{"value": []map[string]any{
				{"name": "alpha-svc", "defaultBranch": "refs/heads/main", "webUrl": "a", "project": map[string]any{"name": "Alpha"}},
			}})
		case strings.Contains(r.URL.Path, "/acme/Beta/_apis/git/repositories"):
			_ = json.NewEncoder(w).Encode(map[string]any{"value": []map[string]any{
				{"name": "beta-svc", "defaultBranch": "refs/heads/trunk", "webUrl": "b", "project": map[string]any{"name": "Beta"}},
			}})
		default:
			t.Fatalf("unexpected ADO path: %s", r.URL.Path)
		}
	})

	repos, err := runListADORepos(t, ts.activities(), ListADOReposInput{ConnectionID: "conn-1"})
	require.NoError(t, err)
	require.Equal(t, []RepoRef{
		{Owner: "Alpha", Name: "alpha-svc", URL: "a", DefaultBranch: "main"},
		{Owner: "Beta", Name: "beta-svc", URL: "b", DefaultBranch: "trunk"},
	}, repos)
}

// TestScanADORepoActivity_EndToEnd walks the item listing, fetches the selected
// well-known files via $format=text, and POSTs the bundle with installationId ==
// connectionId (dedupeKey) and connectionId set. Vendored paths are excluded from
// both selection and the tree list.
func TestScanADORepoActivity_EndToEnd(t *testing.T) {
	ts := newADOTestServer(t, "Payments", func(w http.ResponseWriter, r *http.Request, ts *adoTestServer) {
		q := r.URL.Query()
		switch {
		case q.Get("recursionLevel") == "Full":
			// Item listing. Confirm branch descriptor is wired.
			require.Equal(t, "main", q.Get("versionDescriptor.version"))
			require.Equal(t, "branch", q.Get("versionDescriptor.versionType"))
			_ = json.NewEncoder(w).Encode(map[string]any{"value": []adoItem{
				{Path: "/", IsFolder: true},
				{Path: "/.orbit.yaml", IsFolder: false},
				{Path: "/Dockerfile", IsFolder: false},
				{Path: "/node_modules", IsFolder: true},
				{Path: "/node_modules/dep/package.json", IsFolder: false}, // vendored
				{Path: "/README.md", IsFolder: false},                     // not well-known, but goes in tree
			}})
		case q.Get("$format") == "text":
			// Raw content fetch. Path carries the leading slash.
			require.Equal(t, "text/plain", r.Header.Get("Accept"))
			p := q.Get("path")
			require.True(t, strings.HasPrefix(p, "/"), "content path must carry leading slash, got %q", p)
			_, _ = io.WriteString(w, "content-of:"+p)
		default:
			t.Fatalf("unexpected ADO items call: %s?%s", r.URL.Path, r.URL.RawQuery)
		}
	})

	res, err := runScanADORepo(t, ts.activities(), ScanADORepoInput{
		ConnectionID: "conn-1",
		WorkspaceID:  "ws-1",
		Repo:         RepoRef{Owner: "Payments", Name: "billing", DefaultBranch: "main"},
		ScanRunID:    "run-1",
	})
	require.NoError(t, err)
	require.Equal(t, ScanRepoResult{Proposed: 3, Imported: 1}, res)

	require.True(t, ts.ingestSeen, "ingest must be called")
	b := ts.ingestBody
	require.Equal(t, "conn-1", b.InstallationID, "installationId must carry the connection id verbatim (dedupeKey)")
	require.Equal(t, "conn-1", b.ConnectionID)
	require.Equal(t, "ws-1", b.WorkspaceID)
	require.Equal(t, "run-1", b.ScanRunID)
	// Selected + fetched files: the two well-known blobs, not README or vendored.
	require.Len(t, b.Bundle.Files, 2)
	require.Contains(t, b.Bundle.Files, ".orbit.yaml")
	require.Contains(t, b.Bundle.Files, "Dockerfile")
	require.Equal(t, "content-of:/.orbit.yaml", b.Bundle.Files[".orbit.yaml"])
	// Tree list includes real paths (incl. README + folders) but excludes vendored.
	require.Contains(t, b.Bundle.Tree, "README.md")
	require.Contains(t, b.Bundle.Tree, ".orbit.yaml")
	for _, p := range b.Bundle.Tree {
		require.NotContains(t, p, "node_modules", "vendored path must not appear in tree")
	}
}

// TestScanADORepoActivity_MissingFileSkipped verifies a 404 on content fetch is
// skipped (not fatal) and the file simply absent from the bundle.
func TestScanADORepoActivity_MissingFileSkipped(t *testing.T) {
	ts := newADOTestServer(t, "Payments", func(w http.ResponseWriter, r *http.Request, ts *adoTestServer) {
		q := r.URL.Query()
		switch {
		case q.Get("recursionLevel") == "Full":
			_ = json.NewEncoder(w).Encode(map[string]any{"value": []adoItem{
				{Path: "/.orbit.yaml", IsFolder: false},
				{Path: "/Dockerfile", IsFolder: false},
			}})
		case q.Get("$format") == "text":
			if strings.Contains(q.Get("path"), "Dockerfile") {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			_, _ = io.WriteString(w, "orbit-content")
		default:
			t.Fatalf("unexpected call")
		}
	})

	res, err := runScanADORepo(t, ts.activities(), ScanADORepoInput{
		ConnectionID: "conn-1",
		Repo:         RepoRef{Owner: "Payments", Name: "billing", DefaultBranch: "main"},
		ScanRunID:    "run-1",
	})
	require.NoError(t, err)
	require.Equal(t, ScanRepoResult{Proposed: 3, Imported: 1}, res)
	require.Len(t, ts.ingestBody.Bundle.Files, 1)
	require.Contains(t, ts.ingestBody.Bundle.Files, ".orbit.yaml")
	// Global scan parity: no workspace → omitted from the marshalled body.
	require.Empty(t, ts.ingestBody.WorkspaceID)
}

// TestScanADORepoActivity_UnreadableRepoNonRetryable verifies a 404 on the item
// listing surfaces as a non-retryable error so the workflow records the repo and
// continues (partial-failure tolerance).
func TestScanADORepoActivity_UnreadableRepoNonRetryable(t *testing.T) {
	ts := newADOTestServer(t, "Payments", func(w http.ResponseWriter, r *http.Request, ts *adoTestServer) {
		w.WriteHeader(http.StatusNotFound)
	})

	_, err := ts.activities().ScanADORepoActivity(context.Background(), ScanADORepoInput{
		ConnectionID: "conn-1",
		Repo:         RepoRef{Owner: "Payments", Name: "gone", DefaultBranch: "main"},
		ScanRunID:    "run-1",
	})
	require.Error(t, err)
	require.False(t, ts.ingestSeen, "no bundle should be posted for an unreadable repo")
	// The error must never contain the PAT.
	require.NotContains(t, err.Error(), "test-pat")
}

// TestADOConnectionNotFound verifies a 404 from the token route is a
// non-retryable ConnectionNotFound error and never leaks a PAT.
func TestADOConnectionNotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	a := NewADOScanActivities(srv.URL, "test-key", nil)
	_, err := a.ListADOReposActivity(context.Background(), ListADOReposInput{ConnectionID: "missing"})
	require.Error(t, err)
	require.Contains(t, err.Error(), "not found")
}

// TestADOInputValidation verifies empty ids are rejected non-retryably before any
// HTTP call.
func TestADOInputValidation(t *testing.T) {
	a := NewADOScanActivities("http://unused", "test-key", nil)
	_, err := a.ListADOReposActivity(context.Background(), ListADOReposInput{ConnectionID: ""})
	require.Error(t, err)

	_, err = a.ScanADORepoActivity(context.Background(), ScanADORepoInput{
		ConnectionID: "conn-1",
		Repo:         RepoRef{Owner: "", Name: ""},
	})
	require.Error(t, err)
}
