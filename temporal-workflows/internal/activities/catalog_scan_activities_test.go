package activities

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestIngestRequestOmitsEmptyWorkspace verifies the WP8 contract: a global scan
// (empty WorkspaceID) marshals a body with NO workspaceId key, so the ingest
// route's parseBody treats it as absent (a workspace-less proposal). A workspace
// scan still carries the id.
func TestIngestRequestOmitsEmptyWorkspace(t *testing.T) {
	global, err := json.Marshal(ingestRequest{
		InstallationID: "42",
		WorkspaceID:    "",
		Repo:           RepoRef{Owner: "acme", Name: "billing"},
		ScanRunID:      "run-1",
		Bundle:         ingestBundle{Tree: []string{}, Files: map[string]string{}},
	})
	require.NoError(t, err)
	require.NotContains(t, string(global), "workspaceId", "global scan must omit workspaceId")

	scoped, err := json.Marshal(ingestRequest{
		InstallationID: "42",
		WorkspaceID:    "ws-1",
		Repo:           RepoRef{Owner: "acme", Name: "billing"},
		Bundle:         ingestBundle{Tree: []string{}, Files: map[string]string{}},
	})
	require.NoError(t, err)
	require.True(t, strings.Contains(string(scoped), `"workspaceId":"ws-1"`), "workspace scan must carry workspaceId")
}

func blob(p string, size int64) treeEntry { return treeEntry{Path: p, Type: "blob", Size: size} }
func tree(p string) treeEntry             { return treeEntry{Path: p, Type: "tree"} }

func TestSelectWellKnownFiles(t *testing.T) {
	tests := []struct {
		name             string
		entries          []treeEntry
		maxFiles         int
		maxBytes         int64
		wantPaths        []string
		wantSkippedLarge []string
		wantTruncated    bool
	}{
		{
			name: "picks tier1 manifest, api spec, build manifest and container files",
			entries: []treeEntry{
				blob(".orbit.yaml", 100),
				blob("Dockerfile", 200),
				blob("package.json", 300),
				blob("go.mod", 50),
				blob("README.md", 400),
				blob("src/index.ts", 500),
				blob("docs/api/openapi.yaml", 600),
				tree("src"),
			},
			maxFiles: 40,
			maxBytes: maxFileBytes,
			// Order is by priority (manifest, apispec, service) then lexical.
			wantPaths: []string{
				".orbit.yaml",
				"docs/api/openapi.yaml",
				"Dockerfile",
				"go.mod",
				"package.json",
			},
			wantTruncated: false,
		},
		{
			name: "build manifests matched at root and sub-app dirs; vendored excluded",
			entries: []treeEntry{
				blob("package.json", 100),            // root, depth 0
				blob("frontend/package.json", 100),   // depth 1 — now matched
				blob("apps/api/pyproject.toml", 100), // depth 2 — now matched
				blob("vendor/go.mod", 100),           // vendored — excluded
			},
			maxFiles: 40,
			maxBytes: maxFileBytes,
			// Same priority class (service); shallower sorts first, then lexical.
			wantPaths: []string{
				"package.json",
				"frontend/package.json",
				"apps/api/pyproject.toml",
			},
		},
		{
			name: "api specs and k8s manifests matched anywhere; specs sort ahead of k8s, shallow first",
			entries: []treeEntry{
				blob("k8s/deployment.yaml", 100),
				blob("kubernetes/service.yml", 100),
				blob("charts/app/values.yaml", 100),
				blob("api/v1/swagger.json", 100),
				blob("events/asyncapi.yaml", 100),
				blob("schema.graphql", 100),
				blob("random/config.yaml", 100), // not under a k8s dir — ignored
			},
			maxFiles: 40,
			maxBytes: maxFileBytes,
			wantPaths: []string{
				// prioAPISpec: shallower depth first, then lexical
				"schema.graphql",       // depth 0
				"events/asyncapi.yaml", // depth 1
				"api/v1/swagger.json",  // depth 2
				// prioK8s: shallower depth first, then lexical
				"k8s/deployment.yaml",    // depth 1
				"kubernetes/service.yml", // depth 1
				"charts/app/values.yaml", // depth 2
			},
		},
		{
			name: "CODEOWNERS matched in root, .github and docs only; root sorts first",
			entries: []treeEntry{
				blob("CODEOWNERS", 100),
				blob(".github/CODEOWNERS", 100),
				blob("docs/CODEOWNERS", 100),
				blob("src/CODEOWNERS", 100), // ignored
			},
			maxFiles: 40,
			maxBytes: maxFileBytes,
			wantPaths: []string{
				"CODEOWNERS",         // depth 0
				".github/CODEOWNERS", // depth 1
				"docs/CODEOWNERS",    // depth 1
			},
		},
		{
			name: "oversized well-known files are skipped and noted",
			entries: []treeEntry{
				blob(".orbit.yaml", 100),
				blob("docs/openapi.yaml", maxFileBytes+1), // too large
				blob("Dockerfile", 200),
			},
			maxFiles:         40,
			maxBytes:         maxFileBytes,
			wantPaths:        []string{".orbit.yaml", "Dockerfile"},
			wantSkippedLarge: []string{"docs/openapi.yaml"},
		},
		{
			name: "cap truncates lower-priority files but keeps tier1 manifest",
			entries: []treeEntry{
				blob("z/openapi.yaml", 100), // apispec, priority 1
				blob("a/openapi.yaml", 100), // apispec, priority 1
				blob(".orbit.yaml", 100),    // manifest, priority 0 — must survive
			},
			maxFiles:      2,
			maxBytes:      maxFileBytes,
			wantPaths:     []string{".orbit.yaml", "a/openapi.yaml"},
			wantTruncated: true,
		},
		{
			name: "docker-compose variants at root and sub-app dirs are matched",
			entries: []treeEntry{
				blob("docker-compose.yml", 100),
				blob("docker-compose.prod.yaml", 100),
				blob("deploy/docker-compose.yml", 100), // depth 1 compose (service class)
			},
			maxFiles: 40,
			maxBytes: maxFileBytes,
			wantPaths: []string{
				// root composes (depth 0) sort ahead of the depth-1 compose.
				"docker-compose.prod.yaml",
				"docker-compose.yml",
				"deploy/docker-compose.yml",
			},
		},
		{
			name: "monorepo: sub-app manifests and orbit files collected up to depth 3; vendored and too-deep excluded",
			entries: []treeEntry{
				blob(".orbit.yaml", 100),                   // manifest, depth 0
				blob("apps/api/.orbit.yaml", 100),          // manifest, depth 2
				blob("apps/web-next/package.json", 100),    // service, depth 2
				blob("apps/api/pyproject.toml", 100),       // service, depth 2
				blob("apps/api/Dockerfile", 100),           // service, depth 2
				blob("services/x/docker-compose.yml", 100), // service, depth 2
				blob("package.json", 100),                  // service, depth 0
				blob("node_modules/x/package.json", 100),   // vendored — excluded
				blob("a/b/c/d/package.json", 100),          // depth 4 — excluded
				blob("nested/catalog-info.yaml", 100),      // non-root catalog-info — excluded
			},
			maxFiles: maxFilesPerRepo,
			maxBytes: maxFileBytes,
			wantPaths: []string{
				".orbit.yaml",          // manifest depth 0
				"apps/api/.orbit.yaml", // manifest depth 2
				"package.json",         // service depth 0
				// service depth 2 (equal score) → lexical
				"apps/api/Dockerfile",
				"apps/api/pyproject.toml",
				"apps/web-next/package.json",
				"services/x/docker-compose.yml",
			},
		},
		{
			name: "over-cap selection keeps shallow/high-priority files and truncates",
			entries: []treeEntry{
				blob("apps/api/package.json", 100), // service depth 2
				blob("package.json", 100),          // service depth 0
				blob(".orbit.yaml", 100),           // manifest depth 0
			},
			maxFiles:      2,
			maxBytes:      maxFileBytes,
			wantPaths:     []string{".orbit.yaml", "package.json"},
			wantTruncated: true,
		},
		{
			name:      "no matches yields empty selection",
			entries:   []treeEntry{blob("README.md", 100), blob("src/main.rs", 100), tree("src")},
			maxFiles:  40,
			maxBytes:  maxFileBytes,
			wantPaths: []string{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := selectWellKnownFiles(tt.entries, tt.maxFiles, tt.maxBytes)
			require.Equal(t, tt.wantPaths, got.Paths, "paths")
			if tt.wantSkippedLarge == nil {
				require.Empty(t, got.SkippedLarge, "skippedLarge")
			} else {
				require.Equal(t, tt.wantSkippedLarge, got.SkippedLarge, "skippedLarge")
			}
			require.Equal(t, tt.wantTruncated, got.Truncated, "truncated")
		})
	}
}

func TestClassifyWellKnown(t *testing.T) {
	tests := []struct {
		path     string
		wantPrio int
		wantOK   bool
	}{
		// Tier-1 orbit manifests: root and sub-app dirs up to depth 3 (monorepo).
		{".orbit.yaml", prioScore(prioManifest, 0), true},
		{"apps/api/.orbit.yaml", prioScore(prioManifest, 2), true},
		{"a/b/c/.orbit.yaml", prioScore(prioManifest, 3), true},
		{"a/b/c/d/.orbit.yaml", 0, false}, // depth 4 — too deep
		// Backstage descriptor stays root-only (we don't parse it).
		{"catalog-info.yaml", prioScore(prioManifest, 0), true},
		{"nested/catalog-info.yaml", 0, false},
		// API specs anywhere in the tree; depth folds into the sort key.
		{"docs/openapi.yaml", prioScore(prioAPISpec, 1), true},
		{"schema.graphqls", prioScore(prioAPISpec, 0), true},
		// A very deep API spec clamps its depth to 9 so its composite score
		// (prioScore(prioAPISpec, 9) = 19) stays below the shallowest service
		// score (prioScore(prioService, 0) = 20) — class dominance preserved.
		{"a/b/c/d/e/f/g/h/i/j/openapi.yaml", prioScore(prioAPISpec, 9), true},
		// Build + container manifests: root and sub-app dirs up to depth 3.
		{"Dockerfile", prioScore(prioService, 0), true},
		{"go.mod", prioScore(prioService, 0), true},
		{"apps/web-next/package.json", prioScore(prioService, 2), true},
		{"apps/api/pyproject.toml", prioScore(prioService, 2), true},
		{"apps/api/Dockerfile", prioScore(prioService, 2), true},
		{"services/x/docker-compose.yml", prioScore(prioService, 2), true},
		{"a/b/c/d/package.json", 0, false},        // depth 4 — too deep
		{"node_modules/x/package.json", 0, false}, // vendored
		{"docker-compose.yml", prioScore(prioService, 0), true},
		// Compose Spec canonical basenames match the same service class + depth rule.
		{"compose.yaml", prioScore(prioService, 0), true},
		{"apps/api/compose.yaml", prioScore(prioService, 2), true},
		{"compose.yml", prioScore(prioService, 0), true},
		{".github/CODEOWNERS", prioScore(prioService, 1), true},
		{"src/CODEOWNERS", 0, false},
		{"k8s/deploy.yaml", prioScore(prioK8s, 1), true},
		{"manifests/app.yml", prioScore(prioK8s, 1), true},
		{"src/config.yaml", 0, false},
		{"README.md", 0, false},
	}
	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			prio, ok := classifyWellKnown(tt.path)
			require.Equal(t, tt.wantOK, ok)
			if tt.wantOK {
				require.Equal(t, tt.wantPrio, prio)
			}
		})
	}
}

func TestPathDepth(t *testing.T) {
	cases := []struct {
		path string
		want int
	}{
		{"README.md", 0},                  // root file
		{"apps/api/.orbit.yaml", 2},       // two dir segments
		{"a/b/c/d/package.json", 4},       // four dir segments
		{"/apps/api/pyproject.toml", 2},   // defensive: leading slash stripped
		{"/README.md", 0},                 // leading-slash root file
		{"apps/web-next/package.json", 2}, // hyphenated segment
	}
	for _, c := range cases {
		if got := pathDepth(c.path); got != c.want {
			t.Errorf("pathDepth(%q) = %d, want %d", c.path, got, c.want)
		}
	}
}

func TestEncodePath(t *testing.T) {
	require.Equal(t, "docs/api/openapi.yaml", encodePath("docs/api/openapi.yaml"))
	require.Equal(t, "a%20b/c.yaml", encodePath("a b/c.yaml"))
	require.Equal(t, ".github/CODEOWNERS", encodePath(".github/CODEOWNERS"))
}

func TestIsVendoredPath(t *testing.T) {
	cases := []struct {
		path string
		want bool
	}{
		{"node_modules/accepts/package.json", true},
		{"web/node_modules/left-pad/package.json", true},
		{"vendor/github.com/foo/go.mod", true},
		{"dist/openapi.yaml", true},
		{"services/api/package.json", false},
		{"package.json", false},
		{"builder/package.json", false},
	}
	for _, c := range cases {
		if got := isVendoredPath(c.path); got != c.want {
			t.Errorf("isVendoredPath(%q) = %v, want %v", c.path, got, c.want)
		}
	}
}

func TestClassifyWellKnownSkipsVendored(t *testing.T) {
	if _, ok := classifyWellKnown("node_modules/some-sdk/openapi.yaml"); ok {
		t.Error("vendored openapi spec must not classify")
	}
	if _, ok := classifyWellKnown("docs/openapi.yaml"); !ok {
		t.Error("non-vendored openapi spec must classify")
	}
}
