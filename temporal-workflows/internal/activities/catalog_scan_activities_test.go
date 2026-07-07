package activities

import (
	"testing"

	"github.com/stretchr/testify/require"
)

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
			name: "build manifests are matched at repo root only",
			entries: []treeEntry{
				blob("package.json", 100),          // root — matched
				blob("frontend/package.json", 100), // nested — ignored
				blob("vendor/go.mod", 100),         // nested — ignored
			},
			maxFiles:  40,
			maxBytes:  maxFileBytes,
			wantPaths: []string{"package.json"},
		},
		{
			name: "api specs and k8s manifests matched anywhere; specs sort ahead of k8s",
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
				// prioAPISpec sorted lexically by full path
				"api/v1/swagger.json",
				"events/asyncapi.yaml",
				"schema.graphql",
				// prioK8s sorted lexically by full path
				"charts/app/values.yaml",
				"k8s/deployment.yaml",
				"kubernetes/service.yml",
			},
		},
		{
			name: "CODEOWNERS matched in root, .github and docs only",
			entries: []treeEntry{
				blob("CODEOWNERS", 100),
				blob(".github/CODEOWNERS", 100),
				blob("docs/CODEOWNERS", 100),
				blob("src/CODEOWNERS", 100), // ignored
			},
			maxFiles: 40,
			maxBytes: maxFileBytes,
			wantPaths: []string{
				".github/CODEOWNERS",
				"CODEOWNERS",
				"docs/CODEOWNERS",
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
			name: "docker-compose variants at root are matched",
			entries: []treeEntry{
				blob("docker-compose.yml", 100),
				blob("docker-compose.prod.yaml", 100),
				blob("deploy/docker-compose.yml", 100), // deploy dir → matched as k8s yaml
			},
			maxFiles: 40,
			maxBytes: maxFileBytes,
			wantPaths: []string{
				// service priority (root compose) sorts ahead of k8s-dir yaml
				"docker-compose.prod.yaml",
				"docker-compose.yml",
				"deploy/docker-compose.yml",
			},
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
		{".orbit.yaml", prioManifest, true},
		{"catalog-info.yaml", prioManifest, true},
		{"nested/.orbit.yaml", 0, false}, // manifest is root-only
		{"docs/openapi.yaml", prioAPISpec, true},
		{"schema.graphqls", prioAPISpec, true},
		{"Dockerfile", prioService, true},
		{"go.mod", prioService, true},
		{"pkg/go.mod", 0, false}, // build manifest is root-only
		{"docker-compose.yml", prioService, true},
		{".github/CODEOWNERS", prioService, true},
		{"src/CODEOWNERS", 0, false},
		{"k8s/deploy.yaml", prioK8s, true},
		{"manifests/app.yml", prioK8s, true},
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

func TestEncodePath(t *testing.T) {
	require.Equal(t, "docs/api/openapi.yaml", encodePath("docs/api/openapi.yaml"))
	require.Equal(t, "a%20b/c.yaml", encodePath("a b/c.yaml"))
	require.Equal(t, ".github/CODEOWNERS", encodePath(".github/CODEOWNERS"))
}
