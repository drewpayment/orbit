# Multi-Package Manager Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Support npm, yarn, pnpm, and bun package managers in the build service, with workflow pause for user selection when auto-detection fails.

**Architecture:** Analyzer detects package manager from lockfiles or packageManager field. If neither exists, workflow pauses via Temporal signal/query pattern, frontend shows selection UI, user choice resumes workflow. Railpack handles actual build execution.

**Tech Stack:** Go (build-service, temporal-workflows), Protocol Buffers, TypeScript/React (orbit-www), Temporal SDK

---

## Task 1: Update Proto Schema

**Files:**
- Modify: `proto/idp/build/v1/build.proto`

**Step 1: Add PackageManagerInfo message**

Add after `DetectedBuildConfig` message (around line 48):

```protobuf
// Package manager detection result
message PackageManagerInfo {
  bool detected = 1;             // true if lockfile or packageManager field found
  string name = 2;               // "npm", "yarn", "pnpm", "bun", or ""
  string source = 3;             // "lockfile", "packageManager", "engines", ""
  string lockfile = 4;           // e.g., "yarn.lock" if detected from lockfile
  string requested_version = 5;  // e.g., "10.2.0" from packageManager field
  bool version_supported = 6;    // true if we can fulfill this version
  string supported_range = 7;    // e.g., ">=7.0.0" - what we support
}
```

**Step 2: Update DetectedBuildConfig**

Add field to `DetectedBuildConfig`:

```protobuf
message DetectedBuildConfig {
  string language = 1;
  string language_version = 2;
  string framework = 3;
  string build_command = 4;
  string start_command = 5;
  PackageManagerInfo package_manager = 6;  // NEW
}
```

**Step 3: Update BuildImageRequest**

Add field to `BuildImageRequest`:

```protobuf
message BuildImageRequest {
  string repo_url = 1;
  string ref = 2;
  string image_url = 3;
  string installation_token = 4;
  RegistryConfig registry = 5;
  map<string, string> build_env = 6;
  string package_manager = 7;  // NEW: "npm", "yarn", "pnpm", "bun", or "" for auto
}
```

**Step 4: Regenerate proto code**

Run: `make proto-gen`

Expected: Go and TypeScript code regenerated without errors.

**Step 5: Commit**

```bash
git add proto/idp/build/v1/build.proto proto/gen/ orbit-www/src/lib/proto/
git commit -m "feat(proto): add PackageManagerInfo to build proto schema"
```

---

## Task 2: Add Package Manager Detection to Analyzer

**Files:**
- Modify: `services/build-service/internal/railpack/analyzer.go`
- Modify: `services/build-service/internal/railpack/analyzer_test.go`

**Step 1: Write failing test for lockfile detection**

Add to `analyzer_test.go`:

```go
func TestAnalyzer_DetectsPackageManagerFromLockfile(t *testing.T) {
	tests := []struct {
		name         string
		lockfile     string
		wantPM       string
		wantSource   string
		wantDetected bool
	}{
		{"npm from package-lock.json", "package-lock.json", "npm", "lockfile", true},
		{"yarn from yarn.lock", "yarn.lock", "yarn", "lockfile", true},
		{"pnpm from pnpm-lock.yaml", "pnpm-lock.yaml", "pnpm", "lockfile", true},
		{"bun from bun.lockb", "bun.lockb", "bun", "lockfile", true},
		{"bun from bun.lock", "bun.lock", "bun", "lockfile", true},
		{"no lockfile", "", "", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tmpDir := t.TempDir()

			// Create package.json (required for Node.js detection)
			err := os.WriteFile(filepath.Join(tmpDir, "package.json"), []byte(`{"name": "test"}`), 0644)
			require.NoError(t, err)

			// Create lockfile if specified
			if tt.lockfile != "" {
				err := os.WriteFile(filepath.Join(tmpDir, tt.lockfile), []byte(""), 0644)
				require.NoError(t, err)
			}

			analyzer := NewAnalyzer(slog.Default())
			result, err := analyzer.Analyze(context.Background(), tmpDir)

			require.NoError(t, err)
			require.NotNil(t, result.PackageManager)
			assert.Equal(t, tt.wantDetected, result.PackageManager.Detected)
			assert.Equal(t, tt.wantPM, result.PackageManager.Name)
			assert.Equal(t, tt.wantSource, result.PackageManager.Source)
		})
	}
}
```

**Step 2: Run test to verify it fails**

Run: `cd services/build-service && go test -v -run TestAnalyzer_DetectsPackageManagerFromLockfile ./internal/railpack/`

Expected: FAIL - `result.PackageManager` is nil or missing fields.

**Step 3: Add PackageManagerInfo struct and detection logic**

In `analyzer.go`, add the struct and detection function:

```go
// PackageManagerInfo holds package manager detection results
type PackageManagerInfo struct {
	Detected         bool
	Name             string // "npm", "yarn", "pnpm", "bun", or ""
	Source           string // "lockfile", "packageManager", "engines", ""
	Lockfile         string // actual lockfile found
	RequestedVersion string // version from packageManager field
	VersionSupported bool
	SupportedRange   string
}

// Supported version ranges
var supportedVersions = map[string]string{
	"npm":  ">=7.0.0",
	"yarn": ">=1.22.0",
	"pnpm": ">=7.0.0",
	"bun":  ">=1.0.0",
}

// lockfileToPackageManager maps lockfiles to package managers (priority order)
var lockfileToPackageManager = []struct {
	file string
	pm   string
}{
	{"pnpm-lock.yaml", "pnpm"},
	{"bun.lockb", "bun"},
	{"bun.lock", "bun"},
	{"yarn.lock", "yarn"},
	{"package-lock.json", "npm"},
}

func (a *Analyzer) detectPackageManager(projectDir string) *PackageManagerInfo {
	result := &PackageManagerInfo{
		VersionSupported: true, // Default to true unless we find an unsupported version
	}

	// Priority 1: Check packageManager field in package.json
	if pm, version := a.readPackageManagerField(projectDir); pm != "" {
		result.Detected = true
		result.Name = pm
		result.Source = "packageManager"
		result.RequestedVersion = version
		result.SupportedRange = supportedVersions[pm]
		result.VersionSupported = a.isVersionSupported(pm, version)
		return result
	}

	// Priority 2: Check lockfiles
	for _, lf := range lockfileToPackageManager {
		lockfilePath := filepath.Join(projectDir, lf.file)
		if _, err := os.Stat(lockfilePath); err == nil {
			result.Detected = true
			result.Name = lf.pm
			result.Source = "lockfile"
			result.Lockfile = lf.file
			result.SupportedRange = supportedVersions[lf.pm]
			return result
		}
	}

	// Not detected - workflow will need to ask user
	return result
}

func (a *Analyzer) readPackageManagerField(projectDir string) (pm string, version string) {
	packageJSONPath := filepath.Join(projectDir, "package.json")
	data, err := os.ReadFile(packageJSONPath)
	if err != nil {
		return "", ""
	}

	var pkg struct {
		PackageManager string `json:"packageManager"`
	}
	if err := json.Unmarshal(data, &pkg); err != nil {
		return "", ""
	}

	if pkg.PackageManager == "" {
		return "", ""
	}

	// Parse "npm@10.2.0" format
	parts := strings.SplitN(pkg.PackageManager, "@", 2)
	pm = parts[0]
	if len(parts) > 1 {
		version = parts[1]
		// Handle corepack hash suffix: "pnpm@8.0.0+sha256.abc..."
		if idx := strings.Index(version, "+"); idx != -1 {
			version = version[:idx]
		}
	}
	return pm, version
}

func (a *Analyzer) isVersionSupported(pm, version string) bool {
	if version == "" {
		return true // No version constraint specified
	}

	supportedRange, ok := supportedVersions[pm]
	if !ok {
		return true // Unknown package manager, allow it
	}

	// Parse minimum version from range like ">=7.0.0"
	minVersion := strings.TrimPrefix(supportedRange, ">=")

	// Simple semver comparison (major.minor.patch)
	return semverCompare(version, minVersion) >= 0
}

// semverCompare returns -1 if a < b, 0 if a == b, 1 if a > b
func semverCompare(a, b string) int {
	parseVersion := func(v string) (int, int, int) {
		parts := strings.Split(v, ".")
		major, minor, patch := 0, 0, 0
		if len(parts) >= 1 {
			major, _ = strconv.Atoi(parts[0])
		}
		if len(parts) >= 2 {
			minor, _ = strconv.Atoi(parts[1])
		}
		if len(parts) >= 3 {
			// Handle versions like "1.22.19" or "1.22.19-rc1"
			patchStr := parts[2]
			if idx := strings.IndexAny(patchStr, "-+"); idx != -1 {
				patchStr = patchStr[:idx]
			}
			patch, _ = strconv.Atoi(patchStr)
		}
		return major, minor, patch
	}

	aMajor, aMinor, aPatch := parseVersion(a)
	bMajor, bMinor, bPatch := parseVersion(b)

	if aMajor != bMajor {
		if aMajor < bMajor {
			return -1
		}
		return 1
	}
	if aMinor != bMinor {
		if aMinor < bMinor {
			return -1
		}
		return 1
	}
	if aPatch != bPatch {
		if aPatch < bPatch {
			return -1
		}
		return 1
	}
	return 0
}
```

**Step 4: Update AnalyzeResult struct**

Add `PackageManager` field to `AnalyzeResult`:

```go
type AnalyzeResult struct {
	Detected        bool
	Language        string
	LanguageVersion string
	Framework       string
	BuildCommand    string
	StartCommand    string
	DetectedFiles   []string
	PackageManager  *PackageManagerInfo // NEW
}
```

**Step 5: Call detectPackageManager in detectNodeJS**

Update `detectNodeJS()` to call detection and remove hardcoded npm:

```go
func (a *Analyzer) detectNodeJS(projectDir string) *AnalyzeResult {
	packageJSONPath := filepath.Join(projectDir, "package.json")
	if _, err := os.Stat(packageJSONPath); os.IsNotExist(err) {
		return nil
	}

	// Read package.json
	data, err := os.ReadFile(packageJSONPath)
	if err != nil {
		return nil
	}

	var pkg struct {
		Dependencies    map[string]string `json:"dependencies"`
		DevDependencies map[string]string `json:"devDependencies"`
		Scripts         map[string]string `json:"scripts"`
	}
	if err := json.Unmarshal(data, &pkg); err != nil {
		return nil
	}

	result := &AnalyzeResult{
		Detected:       true,
		Language:       "nodejs",
		DetectedFiles:  []string{"package.json"},
		PackageManager: a.detectPackageManager(projectDir), // NEW
	}

	// Detect Node.js version from .nvmrc
	if nvmrc, err := os.ReadFile(filepath.Join(projectDir, ".nvmrc")); err == nil {
		result.LanguageVersion = strings.TrimSpace(string(nvmrc))
		result.DetectedFiles = append(result.DetectedFiles, ".nvmrc")
	}

	// Detect framework (no longer setting build/start commands - let Railpack decide)
	if _, hasNext := pkg.Dependencies["next"]; hasNext {
		result.Framework = "nextjs"
	} else if _, hasReact := pkg.Dependencies["react"]; hasReact {
		result.Framework = "react"
	} else if _, hasExpress := pkg.Dependencies["express"]; hasExpress {
		result.Framework = "express"
	}

	return result
}
```

**Step 6: Run test to verify it passes**

Run: `cd services/build-service && go test -v -run TestAnalyzer_DetectsPackageManagerFromLockfile ./internal/railpack/`

Expected: PASS

**Step 7: Commit**

```bash
git add services/build-service/internal/railpack/
git commit -m "feat(build): add package manager detection from lockfiles"
```

---

## Task 3: Add Package Manager Field Detection Test

**Files:**
- Modify: `services/build-service/internal/railpack/analyzer_test.go`

**Step 1: Write failing test for packageManager field**

```go
func TestAnalyzer_DetectsPackageManagerFromField(t *testing.T) {
	tests := []struct {
		name            string
		packageJSON     string
		wantPM          string
		wantVersion     string
		wantSupported   bool
	}{
		{
			name:          "npm from packageManager field",
			packageJSON:   `{"name": "test", "packageManager": "npm@10.2.0"}`,
			wantPM:        "npm",
			wantVersion:   "10.2.0",
			wantSupported: true,
		},
		{
			name:          "pnpm with corepack hash",
			packageJSON:   `{"name": "test", "packageManager": "pnpm@8.15.0+sha256.abc123"}`,
			wantPM:        "pnpm",
			wantVersion:   "8.15.0",
			wantSupported: true,
		},
		{
			name:          "yarn classic",
			packageJSON:   `{"name": "test", "packageManager": "yarn@1.22.19"}`,
			wantPM:        "yarn",
			wantVersion:   "1.22.19",
			wantSupported: true,
		},
		{
			name:          "unsupported npm version",
			packageJSON:   `{"name": "test", "packageManager": "npm@6.14.0"}`,
			wantPM:        "npm",
			wantVersion:   "6.14.0",
			wantSupported: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tmpDir := t.TempDir()
			err := os.WriteFile(filepath.Join(tmpDir, "package.json"), []byte(tt.packageJSON), 0644)
			require.NoError(t, err)

			analyzer := NewAnalyzer(slog.Default())
			result, err := analyzer.Analyze(context.Background(), tmpDir)

			require.NoError(t, err)
			require.NotNil(t, result.PackageManager)
			assert.True(t, result.PackageManager.Detected)
			assert.Equal(t, tt.wantPM, result.PackageManager.Name)
			assert.Equal(t, "packageManager", result.PackageManager.Source)
			assert.Equal(t, tt.wantVersion, result.PackageManager.RequestedVersion)
			assert.Equal(t, tt.wantSupported, result.PackageManager.VersionSupported)
		})
	}
}
```

**Step 2: Run test to verify it passes**

Run: `cd services/build-service && go test -v -run TestAnalyzer_DetectsPackageManagerFromField ./internal/railpack/`

Expected: PASS (implementation already done in Task 2)

**Step 3: Commit**

```bash
git add services/build-service/internal/railpack/analyzer_test.go
git commit -m "test(build): add package manager field detection tests"
```

---

## Task 4: Update gRPC Server to Return PackageManagerInfo

**Files:**
- Modify: `services/build-service/internal/grpc/build/server.go`

**Step 1: Update AnalyzeRepository handler**

Find the `AnalyzeRepository` method and update it to include package manager info:

```go
func (s *Server) AnalyzeRepository(ctx context.Context, req *connect.Request[buildv1.AnalyzeRepositoryRequest]) (*connect.Response[buildv1.AnalyzeRepositoryResponse], error) {
	// ... existing clone and analyze logic ...

	// Build response with package manager info
	resp := &buildv1.AnalyzeRepositoryResponse{
		Detected: result.Detected,
	}

	if result.Detected {
		resp.Config = &buildv1.DetectedBuildConfig{
			Language:        result.Language,
			LanguageVersion: result.LanguageVersion,
			Framework:       result.Framework,
			BuildCommand:    result.BuildCommand,
			StartCommand:    result.StartCommand,
		}

		// Add package manager info if available
		if result.PackageManager != nil {
			resp.Config.PackageManager = &buildv1.PackageManagerInfo{
				Detected:         result.PackageManager.Detected,
				Name:             result.PackageManager.Name,
				Source:           result.PackageManager.Source,
				Lockfile:         result.PackageManager.Lockfile,
				RequestedVersion: result.PackageManager.RequestedVersion,
				VersionSupported: result.PackageManager.VersionSupported,
				SupportedRange:   result.PackageManager.SupportedRange,
			}
		}
	}

	return connect.NewResponse(resp), nil
}
```

**Step 2: Update BuildImage handler to accept package_manager**

```go
func (s *Server) BuildImage(ctx context.Context, req *connect.Request[buildv1.BuildImageRequest]) (*connect.Response[buildv1.BuildImageResponse], error) {
	// ... existing setup ...

	buildReq := &builder.BuildRequest{
		RepoURL:           req.Msg.RepoUrl,
		Ref:               req.Msg.Ref,
		ImageURL:          req.Msg.ImageUrl,
		InstallationToken: req.Msg.InstallationToken,
		Registry:          registryConfig,
		BuildEnv:          req.Msg.BuildEnv,
		PackageManager:    req.Msg.PackageManager, // NEW
	}

	// ... rest of method ...
}
```

**Step 3: Rebuild and verify**

Run: `cd services/build-service && go build ./...`

Expected: Build succeeds

**Step 4: Commit**

```bash
git add services/build-service/internal/grpc/build/server.go
git commit -m "feat(build): return PackageManagerInfo from AnalyzeRepository"
```

---

## Task 5: Update Builder to Pass Package Manager to Railpack

**Files:**
- Modify: `services/build-service/internal/builder/builder.go`

**Step 1: Update BuildRequest struct**

Add `PackageManager` field:

```go
type BuildRequest struct {
	RepoURL           string
	Ref               string
	ImageURL          string
	InstallationToken string
	Registry          *RegistryConfig
	BuildEnv          map[string]string
	PackageManager    string // NEW: "npm", "yarn", "pnpm", "bun", or ""
}
```

**Step 2: Pass to Railpack via environment variable**

In `buildImage` method, add after setting build env:

```go
func (b *Builder) buildImage(ctx context.Context, req *BuildRequest, buildDir, imageURL string) (string, error) {
	// ... existing code ...

	cmd := exec.CommandContext(ctx, railpackPath, "build", buildDir, "-t", imageURL)

	// Start with current environment
	cmd.Env = os.Environ()

	// Add build-specific variables
	for k, v := range req.BuildEnv {
		cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", k, v))
	}

	// NEW: Pass package manager to Railpack if specified
	if req.PackageManager != "" {
		b.logger.Info("Using specified package manager", "pm", req.PackageManager)
		cmd.Env = append(cmd.Env, fmt.Sprintf("RAILPACK_PACKAGE_MANAGER=%s", req.PackageManager))
	}

	// ... rest of method ...
}
```

**Step 3: Update error extraction for all package managers**

Update `extractBuildErrorSummary`:

```go
func extractBuildErrorSummary(output string) string {
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)

		// Lockfile errors
		if strings.Contains(line, "Lockfile not found") {
			return "Lockfile not found. Please commit a lockfile or ensure package manager was selected."
		}

		// npm errors
		if strings.Contains(line, "npm ERR!") {
			return "npm install failed: " + line
		}

		// yarn errors (classic and berry)
		if strings.Contains(line, "error ") && strings.Contains(strings.ToLower(output), "yarn") {
			return "yarn install failed: " + line
		}
		if strings.HasPrefix(line, "YN") && strings.Contains(line, "Error") {
			return "yarn install failed: " + line
		}

		// pnpm errors
		if strings.Contains(line, "ERR_PNPM") {
			return "pnpm install failed: " + line
		}

		// bun errors
		if strings.Contains(line, "error:") && strings.Contains(strings.ToLower(output), "bun") {
			return "bun install failed: " + line
		}

		// Node.js version errors
		if strings.Contains(line, "Unsupported engine") || strings.Contains(line, `engine "node"`) {
			return "Node.js version mismatch: " + line
		}

		// COPY failed (common Docker error)
		if strings.Contains(line, "COPY failed") {
			return line
		}
	}
	return "Build failed. Check logs for details."
}
```

**Step 4: Rebuild and verify**

Run: `cd services/build-service && go build ./...`

Expected: Build succeeds

**Step 5: Commit**

```bash
git add services/build-service/internal/builder/builder.go
git commit -m "feat(build): pass package manager to Railpack via env var"
```

---

## Task 6: Update Temporal Workflow Types

**Files:**
- Modify: `temporal-workflows/pkg/types/build_types.go`

**Step 1: Add new types for workflow state and status**

```go
// Build status constants
const (
	BuildStatusAnalyzing     = "analyzing"
	BuildStatusAwaitingInput = "awaiting_input"
	BuildStatusBuilding      = "building"
	BuildStatusPushing       = "pushing"
	BuildStatusSuccess       = "success"
	BuildStatusFailed        = "failed"
)

// BuildState represents the current workflow state (for queries)
type BuildState struct {
	Status              string   `json:"status"`
	NeedsPackageManager bool     `json:"needsPackageManager"`
	AvailableChoices    []string `json:"availableChoices"`
	SelectedPM          string   `json:"selectedPM"`
	Error               string   `json:"error,omitempty"`
}

// PackageManagerInfo from analysis
type PackageManagerInfo struct {
	Detected         bool   `json:"detected"`
	Name             string `json:"name"`
	Source           string `json:"source"`
	Lockfile         string `json:"lockfile"`
	RequestedVersion string `json:"requestedVersion"`
	VersionSupported bool   `json:"versionSupported"`
	SupportedRange   string `json:"supportedRange"`
}

// Signal and query names
const (
	SignalPackageManagerSelected = "package_manager_selected"
	QueryBuildState              = "build_state"
)
```

**Step 2: Update AnalyzeRepositoryResult**

Add PackageManager field:

```go
type AnalyzeRepositoryResult struct {
	Detected        bool                `json:"detected"`
	Error           string              `json:"error,omitempty"`
	Language        string              `json:"language,omitempty"`
	LanguageVersion string              `json:"languageVersion,omitempty"`
	Framework       string              `json:"framework,omitempty"`
	BuildCommand    string              `json:"buildCommand,omitempty"`
	StartCommand    string              `json:"startCommand,omitempty"`
	PackageManager  *PackageManagerInfo `json:"packageManager,omitempty"` // NEW
}
```

**Step 3: Verify build**

Run: `cd temporal-workflows && go build ./...`

Expected: Build succeeds

**Step 4: Commit**

```bash
git add temporal-workflows/pkg/types/build_types.go
git commit -m "feat(temporal): add BuildState and PackageManagerInfo types"
```

---

## Task 7: Update Build Activities for Package Manager

**Files:**
- Modify: `temporal-workflows/internal/activities/build_activities.go`

**Step 1: Update AnalyzeRepository activity result mapping**

Find where the activity maps the gRPC response to the result type and add package manager:

```go
func (a *BuildActivities) AnalyzeRepository(ctx context.Context, input AnalyzeRepositoryInput) (*types.AnalyzeRepositoryResult, error) {
	// ... existing gRPC call ...

	result := &types.AnalyzeRepositoryResult{
		Detected: resp.Msg.Detected,
		Error:    resp.Msg.Error,
	}

	if resp.Msg.Config != nil {
		result.Language = resp.Msg.Config.Language
		result.LanguageVersion = resp.Msg.Config.LanguageVersion
		result.Framework = resp.Msg.Config.Framework
		result.BuildCommand = resp.Msg.Config.BuildCommand
		result.StartCommand = resp.Msg.Config.StartCommand

		// NEW: Map package manager info
		if resp.Msg.Config.PackageManager != nil {
			result.PackageManager = &types.PackageManagerInfo{
				Detected:         resp.Msg.Config.PackageManager.Detected,
				Name:             resp.Msg.Config.PackageManager.Name,
				Source:           resp.Msg.Config.PackageManager.Source,
				Lockfile:         resp.Msg.Config.PackageManager.Lockfile,
				RequestedVersion: resp.Msg.Config.PackageManager.RequestedVersion,
				VersionSupported: resp.Msg.Config.PackageManager.VersionSupported,
				SupportedRange:   resp.Msg.Config.PackageManager.SupportedRange,
			}
		}
	}

	return result, nil
}
```

**Step 2: Update BuildAndPushInput to include package manager**

```go
type BuildAndPushInput struct {
	RepoURL           string            `json:"repoUrl"`
	Ref               string            `json:"ref"`
	ImageURL          string            `json:"imageUrl"`
	InstallationToken string            `json:"installationToken"`
	Registry          RegistryConfig    `json:"registry"`
	BuildEnv          map[string]string `json:"buildEnv,omitempty"`
	PackageManager    string            `json:"packageManager,omitempty"` // NEW
}
```

**Step 3: Pass package manager in BuildAndPushImage activity**

```go
func (a *BuildActivities) BuildAndPushImage(ctx context.Context, input BuildAndPushInput) (*types.BuildAndPushResult, error) {
	// ... existing code ...

	req := connect.NewRequest(&buildv1.BuildImageRequest{
		RepoUrl:           input.RepoURL,
		Ref:               input.Ref,
		ImageUrl:          input.ImageURL,
		InstallationToken: input.InstallationToken,
		Registry: &buildv1.RegistryConfig{
			Type:       input.Registry.Type,
			Url:        input.Registry.URL,
			Repository: input.Registry.Repository,
			Token:      input.Registry.Token,
		},
		BuildEnv:       input.BuildEnv,
		PackageManager: input.PackageManager, // NEW
	})

	// ... rest of method ...
}
```

**Step 4: Verify build**

Run: `cd temporal-workflows && go build ./...`

Expected: Build succeeds

**Step 5: Commit**

```bash
git add temporal-workflows/internal/activities/build_activities.go
git commit -m "feat(temporal): pass package manager through build activities"
```

---

## Task 8: Update Build Workflow with Signal/Query Handlers

**Files:**
- Modify: `temporal-workflows/internal/workflows/build_workflow.go`

**Step 1: Add query handler and signal handling**

Update the workflow to include state management, query handler, and signal waiting:

```go
func BuildWorkflow(ctx workflow.Context, input types.BuildWorkflowInput) (*types.BuildWorkflowResult, error) {
	logger := workflow.GetLogger(ctx)

	// Initialize workflow state
	state := &types.BuildState{
		Status: types.BuildStatusAnalyzing,
	}

	// Register query handler for build state
	err := workflow.SetQueryHandler(ctx, types.QueryBuildState, func() (*types.BuildState, error) {
		return state, nil
	})
	if err != nil {
		return nil, fmt.Errorf("failed to register query handler: %w", err)
	}

	// Activity options
	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	// Step 1: Update status to analyzing
	var updateResult types.UpdateBuildStatusResult
	err = workflow.ExecuteActivity(ctx, activities.ActivityUpdateBuildStatus, types.UpdateBuildStatusInput{
		AppID:  input.AppID,
		Status: types.BuildStatusAnalyzing,
	}).Get(ctx, &updateResult)
	if err != nil {
		logger.Error("Failed to update status", "error", err)
	}

	// Step 2: Analyze repository
	var analyzeResult types.AnalyzeRepositoryResult
	err = workflow.ExecuteActivity(ctx, activities.ActivityAnalyzeRepository, types.AnalyzeRepositoryInput{
		RepoURL:           input.RepoURL,
		Ref:               input.Ref,
		InstallationToken: input.Registry.Token,
	}).Get(ctx, &analyzeResult)
	if err != nil {
		return failWorkflow(ctx, input.AppID, state, fmt.Sprintf("Analysis failed: %v", err))
	}

	if !analyzeResult.Detected {
		return failWorkflow(ctx, input.AppID, state, "Could not detect project type")
	}

	// Step 3: Check package manager version support
	if analyzeResult.PackageManager != nil && !analyzeResult.PackageManager.VersionSupported {
		errMsg := fmt.Sprintf(
			"Package manager version not supported: %s@%s requested, but only %s %s is supported. Please update your package.json packageManager field.",
			analyzeResult.PackageManager.Name,
			analyzeResult.PackageManager.RequestedVersion,
			analyzeResult.PackageManager.Name,
			analyzeResult.PackageManager.SupportedRange,
		)
		return failWorkflow(ctx, input.AppID, state, errMsg)
	}

	// Step 4: Check if we need user input for package manager
	packageManager := ""
	if analyzeResult.PackageManager != nil {
		packageManager = analyzeResult.PackageManager.Name
	}

	if analyzeResult.PackageManager == nil || !analyzeResult.PackageManager.Detected {
		// No package manager detected - wait for user selection
		state.Status = types.BuildStatusAwaitingInput
		state.NeedsPackageManager = true
		state.AvailableChoices = []string{"npm", "yarn", "pnpm", "bun"}

		// Update frontend status
		err = workflow.ExecuteActivity(ctx, activities.ActivityUpdateBuildStatus, types.UpdateBuildStatusInput{
			AppID:            input.AppID,
			Status:           types.BuildStatusAwaitingInput,
			AvailableChoices: state.AvailableChoices,
		}).Get(ctx, &updateResult)
		if err != nil {
			logger.Error("Failed to update awaiting_input status", "error", err)
		}

		// Wait for signal with user's package manager choice
		signalChan := workflow.GetSignalChannel(ctx, types.SignalPackageManagerSelected)
		var selectedPM string
		signalChan.Receive(ctx, &selectedPM)

		logger.Info("Received package manager selection", "pm", selectedPM)
		state.SelectedPM = selectedPM
		packageManager = selectedPM
	}

	// Step 5: Update status to building
	state.Status = types.BuildStatusBuilding
	err = workflow.ExecuteActivity(ctx, activities.ActivityUpdateBuildStatus, types.UpdateBuildStatusInput{
		AppID:  input.AppID,
		Status: types.BuildStatusBuilding,
	}).Get(ctx, &updateResult)
	if err != nil {
		logger.Error("Failed to update building status", "error", err)
	}

	// Step 6: Build and push image
	var buildResult types.BuildAndPushResult
	err = workflow.ExecuteActivity(ctx, activities.ActivityBuildAndPushImage, types.BuildAndPushInput{
		RepoURL:           input.RepoURL,
		Ref:               input.Ref,
		ImageURL:          fmt.Sprintf("%s/%s:%s", input.Registry.URL, input.Registry.Repository, input.ImageTag),
		InstallationToken: input.Registry.Token,
		Registry: types.RegistryConfig{
			Type:       input.Registry.Type,
			URL:        input.Registry.URL,
			Repository: input.Registry.Repository,
			Token:      input.Registry.Token,
		},
		PackageManager: packageManager, // Pass selected/detected package manager
	}).Get(ctx, &buildResult)
	if err != nil {
		return failWorkflow(ctx, input.AppID, state, fmt.Sprintf("Build failed: %v", err))
	}

	if buildResult.Error != "" {
		return failWorkflow(ctx, input.AppID, state, buildResult.Error)
	}

	// Step 7: Update status to success
	state.Status = types.BuildStatusSuccess
	imageURL := fmt.Sprintf("%s/%s:%s", input.Registry.URL, input.Registry.Repository, input.ImageTag)
	err = workflow.ExecuteActivity(ctx, activities.ActivityUpdateBuildStatus, types.UpdateBuildStatusInput{
		AppID:       input.AppID,
		Status:      types.BuildStatusSuccess,
		ImageURL:    imageURL,
		ImageDigest: buildResult.Digest,
	}).Get(ctx, &updateResult)
	if err != nil {
		logger.Error("Failed to update success status", "error", err)
	}

	return &types.BuildWorkflowResult{
		Status:      types.BuildStatusSuccess,
		ImageURL:    imageURL,
		ImageDigest: buildResult.Digest,
	}, nil
}

func failWorkflow(ctx workflow.Context, appID string, state *types.BuildState, errMsg string) (*types.BuildWorkflowResult, error) {
	state.Status = types.BuildStatusFailed
	state.Error = errMsg

	var updateResult types.UpdateBuildStatusResult
	_ = workflow.ExecuteActivity(ctx, activities.ActivityUpdateBuildStatus, types.UpdateBuildStatusInput{
		AppID:  appID,
		Status: types.BuildStatusFailed,
		Error:  errMsg,
	}).Get(ctx, &updateResult)

	return &types.BuildWorkflowResult{
		Status: types.BuildStatusFailed,
		Error:  errMsg,
	}, nil
}
```

**Step 2: Verify build**

Run: `cd temporal-workflows && go build ./...`

Expected: Build succeeds

**Step 3: Commit**

```bash
git add temporal-workflows/internal/workflows/build_workflow.go
git commit -m "feat(temporal): add signal/query handlers for package manager selection"
```

---

## Task 9: Update UpdateBuildStatus Activity

**Files:**
- Modify: `temporal-workflows/internal/activities/build_activities.go`
- Modify: `temporal-workflows/pkg/types/build_types.go`

**Step 1: Update UpdateBuildStatusInput type**

In `build_types.go`, add new fields:

```go
type UpdateBuildStatusInput struct {
	AppID            string   `json:"appId"`
	Status           string   `json:"status"`
	Error            string   `json:"error,omitempty"`
	ImageURL         string   `json:"imageUrl,omitempty"`
	ImageDigest      string   `json:"imageDigest,omitempty"`
	AvailableChoices []string `json:"availableChoices,omitempty"` // NEW: for awaiting_input
}
```

**Step 2: Update PayloadBuildClient to send choices**

In `temporal-workflows/internal/services/payload_build_client.go`, update the request body:

```go
type updateBuildStatusRequest struct {
	Status           string   `json:"status"`
	Error            string   `json:"error,omitempty"`
	ImageURL         string   `json:"imageUrl,omitempty"`
	ImageDigest      string   `json:"imageDigest,omitempty"`
	AvailableChoices []string `json:"availableChoices,omitempty"`
}

func (c *PayloadBuildClient) UpdateBuildStatus(ctx context.Context, appID string, input types.UpdateBuildStatusInput) error {
	body := updateBuildStatusRequest{
		Status:           input.Status,
		Error:            input.Error,
		ImageURL:         input.ImageURL,
		ImageDigest:      input.ImageDigest,
		AvailableChoices: input.AvailableChoices,
	}
	// ... rest of method ...
}
```

**Step 3: Verify build**

Run: `cd temporal-workflows && go build ./...`

Expected: Build succeeds

**Step 4: Commit**

```bash
git add temporal-workflows/
git commit -m "feat(temporal): add availableChoices to UpdateBuildStatus"
```

---

## Task 10: Update Frontend - Internal API for Choices

**Files:**
- Modify: `orbit-www/src/app/api/internal/apps/[id]/build-status/route.ts`

**Step 1: Update PATCH handler to accept availableChoices**

```typescript
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // ... existing auth check ...

  const body = await request.json();
  const { status, error, imageUrl, imageDigest, availableChoices } = body;

  // Build update data
  const updateData: Partial<App['latestBuild']> = {
    status: status as App['latestBuild']['status'],
  };

  if (error) updateData.error = error;
  if (imageUrl) updateData.imageUrl = imageUrl;
  if (imageDigest) updateData.imageDigest = imageDigest;
  if (availableChoices) updateData.availableChoices = availableChoices; // NEW

  // ... rest of handler ...
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd orbit-www && bunx tsc --noEmit`

Expected: No errors (or existing errors only)

**Step 3: Commit**

```bash
git add orbit-www/src/app/api/internal/apps/
git commit -m "feat(api): accept availableChoices in build status update"
```

---

## Task 11: Update Payload Apps Collection Schema

**Files:**
- Modify: `orbit-www/src/collections/Apps.ts`

**Step 1: Update latestBuild schema**

Add `awaiting_input` status and `availableChoices` field:

```typescript
{
  name: 'latestBuild',
  type: 'group',
  fields: [
    {
      name: 'status',
      type: 'select',
      options: [
        { label: 'None', value: 'none' },
        { label: 'Analyzing', value: 'analyzing' },
        { label: 'Awaiting Input', value: 'awaiting_input' }, // NEW
        { label: 'Building', value: 'building' },
        { label: 'Success', value: 'success' },
        { label: 'Failed', value: 'failed' },
      ],
      defaultValue: 'none',
    },
    {
      name: 'availableChoices', // NEW
      type: 'json',
      admin: {
        description: 'Available package manager choices when awaiting_input',
      },
    },
    // ... existing fields: error, imageUrl, imageDigest, workflowId, builtAt ...
  ],
}
```

**Step 2: Regenerate Payload types**

Run: `cd orbit-www && bun run generate:types`

Expected: `payload-types.ts` updated with new fields

**Step 3: Commit**

```bash
git add orbit-www/src/collections/Apps.ts orbit-www/src/payload-types.ts
git commit -m "feat(payload): add awaiting_input status and availableChoices to Apps"
```

---

## Task 12: Add selectPackageManager Server Action

**Files:**
- Modify: `orbit-www/src/app/actions/builds.ts`

**Step 1: Add the new server action**

```typescript
import { Client } from '@temporalio/client';

// Temporal client singleton (add if not exists)
let temporalClient: Client | null = null;

async function getTemporalClient(): Promise<Client> {
  if (!temporalClient) {
    temporalClient = new Client({
      connection: await Connection.connect({
        address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
      }),
    });
  }
  return temporalClient;
}

export async function selectPackageManager(
  workflowId: string,
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun'
): Promise<{ success: boolean; error?: string }> {
  'use server';

  try {
    const user = await getUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    // Validate package manager
    const validPMs = ['npm', 'yarn', 'pnpm', 'bun'];
    if (!validPMs.includes(packageManager)) {
      return { success: false, error: 'Invalid package manager' };
    }

    // Send signal to Temporal workflow
    const client = await getTemporalClient();
    const handle = client.workflow.getHandle(workflowId);

    await handle.signal('package_manager_selected', packageManager);

    return { success: true };
  } catch (error) {
    console.error('Failed to send package manager signal:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
```

**Step 2: Update getBuildStatus return type**

```typescript
export interface BuildStatus {
  status: 'none' | 'analyzing' | 'awaiting_input' | 'building' | 'success' | 'failed';
  error?: string;
  imageUrl?: string;
  imageDigest?: string;
  workflowId?: string;
  builtAt?: string;
  // NEW
  needsPackageManager?: boolean;
  availableChoices?: string[];
}

export async function getBuildStatus(appId: string): Promise<BuildStatus> {
  // ... existing code ...

  return {
    status: app.latestBuild?.status || 'none',
    error: app.latestBuild?.error,
    imageUrl: app.latestBuild?.imageUrl,
    imageDigest: app.latestBuild?.imageDigest,
    workflowId: app.latestBuild?.workflowId,
    builtAt: app.latestBuild?.builtAt,
    // NEW
    needsPackageManager: app.latestBuild?.status === 'awaiting_input',
    availableChoices: app.latestBuild?.availableChoices as string[] | undefined,
  };
}
```

**Step 3: Add Temporal client dependency if needed**

Run: `cd orbit-www && bun add @temporalio/client`

**Step 4: Verify TypeScript compiles**

Run: `cd orbit-www && bunx tsc --noEmit`

Expected: No new errors

**Step 5: Commit**

```bash
git add orbit-www/src/app/actions/builds.ts orbit-www/package.json orbit-www/bun.lockb
git commit -m "feat(actions): add selectPackageManager server action"
```

---

## Task 13: Add PackageManagerPrompt UI Component

**Files:**
- Modify: `orbit-www/src/components/features/apps/BuildSection.tsx`

**Step 1: Add the PackageManagerPrompt component**

Add this component inside the file:

```tsx
import { AlertCircle } from 'lucide-react';
import { selectPackageManager } from '@/app/actions/builds';

interface PackageManagerPromptProps {
  choices: string[];
  workflowId: string;
  onSelect: () => void;
}

function PackageManagerPrompt({ choices, workflowId, onSelect }: PackageManagerPromptProps) {
  const [selecting, setSelecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = async (pm: string) => {
    setSelecting(pm);
    setError(null);

    const result = await selectPackageManager(
      workflowId,
      pm as 'npm' | 'yarn' | 'pnpm' | 'bun'
    );

    if (result.success) {
      onSelect();
    } else {
      setError(result.error || 'Failed to select package manager');
      setSelecting(null);
    }
  };

  const pmIcons: Record<string, string> = {
    npm: '📦',
    yarn: '🧶',
    pnpm: '🚀',
    bun: '🥟',
  };

  return (
    <div className="p-4 border rounded-lg bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800">
      <div className="flex items-center gap-2 mb-3">
        <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
        <span className="font-medium text-amber-800 dark:text-amber-200">
          Package manager not detected
        </span>
      </div>
      <p className="text-sm text-amber-700 dark:text-amber-300 mb-4">
        No lockfile or <code className="px-1 bg-amber-100 dark:bg-amber-900 rounded">packageManager</code> field
        found in your repository. Please select which package manager to use for this build:
      </p>
      <div className="flex flex-wrap gap-2">
        {choices.map((pm) => (
          <button
            key={pm}
            onClick={() => handleSelect(pm)}
            disabled={selecting !== null}
            className={`
              px-4 py-2 rounded-md border font-medium transition-colors
              ${selecting === pm
                ? 'bg-amber-600 text-white border-amber-600'
                : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 hover:border-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20'
              }
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
          >
            <span className="mr-2">{pmIcons[pm] || '📦'}</span>
            {pm}
            {selecting === pm && (
              <span className="ml-2 inline-block animate-spin">⏳</span>
            )}
          </button>
        ))}
      </div>
      {error && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
```

**Step 2: Use the component in BuildSection**

In the main BuildSection component, add conditional rendering:

```tsx
export function BuildSection({ appId, appName, hasRepository, hasRegistryConfig }: BuildSectionProps) {
  // ... existing state and hooks ...

  return (
    <div className="space-y-4">
      {/* ... existing UI ... */}

      {/* NEW: Package manager selection prompt */}
      {status?.status === 'awaiting_input' && status.needsPackageManager && status.availableChoices && (
        <PackageManagerPrompt
          choices={status.availableChoices}
          workflowId={status.workflowId || ''}
          onSelect={() => refetch()}
        />
      )}

      {/* ... rest of existing UI ... */}
    </div>
  );
}
```

**Step 3: Add useState import if needed**

Ensure `useState` is imported at the top of the file.

**Step 4: Verify TypeScript compiles**

Run: `cd orbit-www && bunx tsc --noEmit`

Expected: No new errors

**Step 5: Commit**

```bash
git add orbit-www/src/components/features/apps/BuildSection.tsx
git commit -m "feat(ui): add PackageManagerPrompt component for build section"
```

---

## Task 14: Rebuild Docker Containers

**Step 1: Rebuild build-service**

Run: `docker compose build --no-cache build-service`

Expected: Build succeeds

**Step 2: Rebuild temporal-worker**

Run: `docker compose build --no-cache temporal-worker`

Expected: Build succeeds

**Step 3: Restart services**

Run: `docker compose up -d build-service temporal-worker`

Expected: Services start successfully

**Step 4: Verify services are running**

Run: `docker compose ps`

Expected: Both services show as "running"

**Step 5: Commit any docker-compose changes if needed**

```bash
git add docker-compose.yml
git commit -m "chore: update docker compose for multi-package-manager support" --allow-empty
```

---

## Task 15: Manual Testing

**Step 1: Test with yarn.lock repository**

1. Navigate to an App with a repository containing `yarn.lock`
2. Click "Build Now"
3. Verify status goes: analyzing → building → success
4. Check logs: `docker compose logs build-service | grep -i yarn`

Expected: Build uses yarn, no prompt shown

**Step 2: Test with no lockfile (user selection)**

1. Create/use an App with a repository that has no lockfile
2. Click "Build Now"
3. Verify prompt appears with npm/yarn/pnpm/bun options
4. Select "pnpm"
5. Verify build continues and completes

Expected: Prompt shown, selection works, build uses selected PM

**Step 3: Test version validation failure**

1. Create a test repo with `package.json`:
   ```json
   {"name": "test", "packageManager": "npm@6.0.0"}
   ```
2. Link to an App and click "Build Now"
3. Verify build fails with version error message

Expected: Error message about npm >=7.0.0 required

---

## Summary

This implementation plan covers:

1. **Proto changes** - PackageManagerInfo message
2. **Analyzer** - Lockfile and packageManager field detection with version validation
3. **gRPC server** - Returns package manager info
4. **Builder** - Passes PM to Railpack via env var
5. **Temporal types** - BuildState, signals, queries
6. **Activities** - Pass PM through build chain
7. **Workflow** - Signal/query handlers, await user selection
8. **Frontend API** - Accept/return availableChoices
9. **Payload schema** - awaiting_input status
10. **Server action** - selectPackageManager
11. **UI component** - PackageManagerPrompt
12. **Docker rebuild** - Deploy changes
13. **Manual testing** - Verify all paths

Total: ~15 tasks, each with clear verification steps.
