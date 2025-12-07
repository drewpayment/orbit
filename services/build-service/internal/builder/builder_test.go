package builder

import (
	"context"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestBuilder_ValidatesInput(t *testing.T) {
	logger := slog.Default()
	b := NewBuilder(logger, "/tmp/builds")

	// Missing required fields (RequestID and RepoURL)
	req := &BuildRequest{
		AppID: "app-123",
		// Missing RequestID and RepoURL
	}

	_, err := b.Build(context.Background(), req)
	require.Error(t, err)
	// RequestID is validated first, so that's the error we'll get
	require.Contains(t, err.Error(), "request_id is required")
}

func TestBuilder_ValidatesMissingRequestID(t *testing.T) {
	logger := slog.Default()
	b := NewBuilder(logger, "/tmp/builds")

	req := &BuildRequest{
		AppID:   "app-123",
		RepoURL: "https://github.com/org/repo",
		Registry: RegistryConfig{
			URL:        "ghcr.io",
			Repository: "org/repo",
		},
		// Missing RequestID
	}

	_, err := b.Build(context.Background(), req)
	require.Error(t, err)
	require.Contains(t, err.Error(), "request_id is required")
}

func TestBuilder_ValidatesMissingRepoURL(t *testing.T) {
	logger := slog.Default()
	b := NewBuilder(logger, "/tmp/builds")

	req := &BuildRequest{
		RequestID: "req-123",
		AppID:     "app-123",
		Registry: RegistryConfig{
			URL:        "ghcr.io",
			Repository: "org/repo",
		},
		// Missing RepoURL
	}

	_, err := b.Build(context.Background(), req)
	require.Error(t, err)
	require.Contains(t, err.Error(), "repo_url is required")
}

func TestBuilder_GeneratesCorrectImageTag(t *testing.T) {
	req := &BuildRequest{
		AppID:   "app-123",
		RepoURL: "https://github.com/org/repo",
		Ref:     "abc123def",
		Registry: RegistryConfig{
			Type:       RegistryTypeGHCR,
			URL:        "ghcr.io",
			Repository: "org/repo",
		},
	}

	tag := generateImageTag(req)
	require.Equal(t, "ghcr.io/org/repo:abc123d", tag) // First 7 chars of SHA
}

func TestBuilder_ValidatesMissingRegistryURL(t *testing.T) {
	logger := slog.Default()
	b := NewBuilder(logger, "/tmp/builds")

	req := &BuildRequest{
		RequestID: "req-123",
		AppID:     "app-123",
		RepoURL:   "https://github.com/org/repo",
		Registry: RegistryConfig{
			Repository: "org/repo",
			// Missing URL
		},
	}

	_, err := b.Build(context.Background(), req)
	require.Error(t, err)
	require.Contains(t, err.Error(), "registry url is required")
}

func TestBuilder_ValidatesMissingRegistryRepository(t *testing.T) {
	logger := slog.Default()
	b := NewBuilder(logger, "/tmp/builds")

	req := &BuildRequest{
		RequestID: "req-123",
		AppID:     "app-123",
		RepoURL:   "https://github.com/org/repo",
		Registry: RegistryConfig{
			URL: "ghcr.io",
			// Missing Repository
		},
	}

	_, err := b.Build(context.Background(), req)
	require.Error(t, err)
	require.Contains(t, err.Error(), "registry repository is required")
}

func TestGenerateImageTag_WithCustomTag(t *testing.T) {
	req := &BuildRequest{
		AppID:    "app-123",
		RepoURL:  "https://github.com/org/repo",
		ImageTag: "v1.2.3",
		Registry: RegistryConfig{
			Type:       RegistryTypeGHCR,
			URL:        "ghcr.io",
			Repository: "org/repo",
		},
	}

	tag := generateImageTag(req)
	require.Equal(t, "ghcr.io/org/repo:v1.2.3", tag)
}

func TestGenerateImageTag_WithShortRef(t *testing.T) {
	req := &BuildRequest{
		AppID:   "app-123",
		RepoURL: "https://github.com/org/repo",
		Ref:     "abc",
		Registry: RegistryConfig{
			Type:       RegistryTypeGHCR,
			URL:        "ghcr.io",
			Repository: "org/repo",
		},
	}

	tag := generateImageTag(req)
	require.Equal(t, "ghcr.io/org/repo:abc", tag) // Short ref used as-is
}

func TestGenerateImageTag_WithEmptyRef(t *testing.T) {
	req := &BuildRequest{
		AppID:   "app-123",
		RepoURL: "https://github.com/org/repo",
		Registry: RegistryConfig{
			Type:       RegistryTypeGHCR,
			URL:        "ghcr.io",
			Repository: "org/repo",
		},
	}

	tag := generateImageTag(req)
	require.Equal(t, "ghcr.io/org/repo:latest", tag) // Empty ref defaults to "latest"
}

func TestGenerateImageTag_ACRRegistry(t *testing.T) {
	req := &BuildRequest{
		AppID:   "app-123",
		RepoURL: "https://github.com/org/repo",
		Ref:     "abc123def",
		Registry: RegistryConfig{
			Type:       RegistryTypeACR,
			URL:        "myregistry.azurecr.io",
			Repository: "myapp",
		},
	}

	tag := generateImageTag(req)
	require.Equal(t, "myregistry.azurecr.io/myapp:abc123d", tag)
}

func TestNewBuilder_WithNilLogger(t *testing.T) {
	b := NewBuilder(nil, "/tmp/builds")
	require.NotNil(t, b)
	require.NotNil(t, b.logger)
	require.Equal(t, "/tmp/builds", b.workDir)
}

func TestNewBuilder_WithLogger(t *testing.T) {
	logger := slog.Default()
	b := NewBuilder(logger, "/tmp/builds")
	require.NotNil(t, b)
	require.Equal(t, logger, b.logger)
	require.Equal(t, "/tmp/builds", b.workDir)
}

func TestValidateRequest_AllFieldsProvided(t *testing.T) {
	logger := slog.Default()
	b := NewBuilder(logger, "/tmp/builds")

	req := &BuildRequest{
		RequestID: "req-123",
		AppID:     "app-123",
		RepoURL:   "https://github.com/org/repo",
		Registry: RegistryConfig{
			URL:        "ghcr.io",
			Repository: "org/repo",
		},
	}

	err := b.validateRequest(req)
	require.NoError(t, err)
}

func TestBuildRequest_StructFields(t *testing.T) {
	// Test that all fields can be set properly
	req := &BuildRequest{
		RequestID:         "req-123",
		AppID:             "app-123",
		RepoURL:           "https://github.com/org/repo",
		Ref:               "main",
		InstallationToken: "token-123",
		LanguageVersion:   "go1.21",
		BuildCommand:      "go build",
		StartCommand:      "./app",
		BuildEnv: map[string]string{
			"ENV": "production",
		},
		Registry: RegistryConfig{
			Type:       RegistryTypeGHCR,
			URL:        "ghcr.io",
			Repository: "org/repo",
			Token:      "registry-token",
			Username:   "user",
		},
		ImageTag: "v1.0.0",
	}

	require.Equal(t, "req-123", req.RequestID)
	require.Equal(t, "app-123", req.AppID)
	require.Equal(t, "https://github.com/org/repo", req.RepoURL)
	require.Equal(t, "main", req.Ref)
	require.Equal(t, "token-123", req.InstallationToken)
	require.Equal(t, "go1.21", req.LanguageVersion)
	require.Equal(t, "go build", req.BuildCommand)
	require.Equal(t, "./app", req.StartCommand)
	require.Equal(t, "production", req.BuildEnv["ENV"])
	require.Equal(t, RegistryTypeGHCR, req.Registry.Type)
	require.Equal(t, "v1.0.0", req.ImageTag)
}

func TestBuildResult_StructFields(t *testing.T) {
	// Test BuildResult structure
	result := &BuildResult{
		Success:     true,
		ImageURL:    "ghcr.io/org/repo:v1.0.0",
		ImageDigest: "sha256:abc123",
		Error:       "",
		Steps: []BuildStep{
			{Name: "clone", Status: "completed", Message: "Repository cloned", DurationMs: 1000},
			{Name: "build", Status: "completed", Message: "Image built", DurationMs: 5000},
			{Name: "push", Status: "completed", Message: "Image pushed", DurationMs: 3000},
		},
	}

	require.True(t, result.Success)
	require.Equal(t, "ghcr.io/org/repo:v1.0.0", result.ImageURL)
	require.Equal(t, "sha256:abc123", result.ImageDigest)
	require.Empty(t, result.Error)
	require.Len(t, result.Steps, 3)
	require.Equal(t, "clone", result.Steps[0].Name)
	require.Equal(t, int64(1000), result.Steps[0].DurationMs)
}

func TestRegistryTypes(t *testing.T) {
	// Test registry type constants
	require.Equal(t, RegistryType("ghcr"), RegistryTypeGHCR)
	require.Equal(t, RegistryType("acr"), RegistryTypeACR)
}

func TestExtractBuildErrorSummary(t *testing.T) {
	tests := []struct {
		name     string
		output   string
		expected string
	}{
		{
			name: "npm error",
			output: `Step 5/10 : RUN npm install
npm ERR! code ENOENT
npm ERR! syscall open
npm ERR! path /app/package.json
npm ERR! enoent ENOENT: no such file or directory, open '/app/package.json'`,
			expected: "npm install failed: npm ERR! enoent ENOENT: no such file or directory, open '/app/package.json'",
		},
		{
			name: "yarn classic error",
			output: `Step 5/10 : RUN yarn install
yarn install v1.22.19
[1/4] Resolving packages...
error Package "react@^18.0.0" not found.
info Visit https://yarnpkg.com/en/docs/cli/install for documentation about this command.`,
			expected: "yarn install failed: error Package \"react@^18.0.0\" not found.",
		},
		{
			name: "yarn berry error",
			output: `Step 5/10 : RUN yarn install
➤ YN0000: ┌ Resolution step
YN0001: Error: Cannot find package "@types/node"
➤ YN0000: └ Completed in 1s 234ms`,
			expected: "yarn install failed: YN0001: Error: Cannot find package \"@types/node\"",
		},
		{
			name: "pnpm error",
			output: `Step 5/10 : RUN pnpm install
 ERR_PNPM_FETCH_404  GET https://registry.npmjs.org/nonexistent-package: Not Found - 404
This error happened while installing a direct dependency of /app`,
			expected: "pnpm install failed: ERR_PNPM_FETCH_404  GET https://registry.npmjs.org/nonexistent-package: Not Found - 404",
		},
		{
			name: "bun error",
			output: `Step 5/10 : RUN bun install
bun install v1.0.0
error: Package "typescript" not found
1 package installed`,
			expected: "bun install failed: error: Package \"typescript\" not found",
		},
		{
			name: "Node.js version error with engine",
			output: `Step 5/10 : RUN npm install
npm ERR! code EBADENGINE
error engine Unsupported engine: node@16.20.0
The engine "node" is incompatible with this module. Expected version ">=18.0.0". Got "16.20.0"`,
			expected: "Node.js version mismatch: The engine \"node\" is incompatible with this module. Expected version \">=18.0.0\". Got \"16.20.0\"",
		},
		{
			name: "Node.js version error with engine string",
			output: `Step 5/10 : RUN npm install
error vite@5.0.0: The engine "node" is incompatible with this module. Expected version ">=18.0.0". Got "16.20.0"
error Found incompatible module.`,
			expected: "Node.js version mismatch: error vite@5.0.0: The engine \"node\" is incompatible with this module. Expected version \">=18.0.0\". Got \"16.20.0\"",
		},
		{
			name: "lockfile not found",
			output: `Step 5/10 : RUN pnpm install
Lockfile not found. Please commit pnpm-lock.yaml to your repository.`,
			expected: "Lockfile not found. Please commit a lockfile or ensure package manager was selected.",
		},
		{
			name: "generic build failure with non-zero code",
			output: `Step 7/10 : RUN npm run build
> build
> next build

Error: Build failed with unknown error
The command '/bin/sh -c npm run build' returned a non-zero code: 1`,
			expected: "Error: Build failed with unknown error",
		},
		{
			name: "COPY failed error",
			output: `Step 3/10 : COPY package.json ./
COPY failed: file not found in build context or excluded by .dockerignore: stat package.json: file does not exist`,
			expected: "COPY failed: file not found in build context or excluded by .dockerignore: stat package.json: file does not exist",
		},
		{
			name: "generic fallback with long output",
			output: `Step 10/10 : RUN some-command
This is a very long error message that exceeds the 200 character limit and should be truncated to avoid overwhelming the user interface with excessive text that may not be useful for debugging purpose and could make error hard to read`,
			expected: "This is a very long error message that exceeds the 200 character limit and should be truncated to avoid overwhelming the user interface with excessive text that may not be useful for debugging purpose...",
		},
		{
			name: "empty output",
			output: `


`,
			expected: "Build failed. Check logs for details.",
		},
		{
			name: "only deprecated warnings",
			output: `DEPRECATED: The legacy builder is deprecated and will be removed in a future release.
DEPRECATED: Install the buildx component to build images with BuildKit


`,
			expected: "Build failed. Check logs for details.",
		},
		{
			name: "multiple package manager errors prioritize last",
			output: `Step 5/10 : RUN npm install
npm WARN deprecated package@1.0.0
npm ERR! code ENOTFOUND
npm ERR! network request to https://registry.npmjs.org/package failed
Step 6/10 : RUN npm run build
npm ERR! Missing script: "build"`,
			expected: "npm install failed: npm ERR! Missing script: \"build\"",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := extractBuildErrorSummary(tt.output)
			require.Equal(t, tt.expected, result)
		})
	}
}
