# Railpack Build Service Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable users to build container images from source repositories using Railpack with minimal configuration, supporting GHCR (via GitHub App) and ACR (via tokens).

**Architecture:** New `build-service` (Go) with BuildKit integration handles image builds. Temporal workflow orchestrates clone → analyze → build → push. Apps collection extended with build config and latest build info. Registry configs stored per-workspace. UI adds build section to App detail page above deployments.

**Tech Stack:** Go 1.21+, Temporal, Railpack CLI, BuildKit, gRPC/Protobuf, Payload CMS, Next.js 15, React 19

**Prerequisites:**
- GitHub App already installed with `write:packages` permission for GHCR
- Existing App and Deployment collections
- Existing Temporal worker infrastructure

---

## Phase 1: Proto Definitions

### Task 1: Add Build Service Proto Definitions

**Files:**
- Create: `proto/build.proto`

**Step 1: Create the build service proto file**

```protobuf
// proto/build.proto
syntax = "proto3";

package idp.build.v1;

option go_package = "github.com/drewpayment/orbit/proto/gen/go/idp/build/v1;buildv1";

// BuildService handles container image building via Railpack
service BuildService {
  // Analyze a repository to detect build configuration
  rpc AnalyzeRepository(AnalyzeRepositoryRequest) returns (AnalyzeRepositoryResponse);

  // Build and push a container image
  rpc BuildImage(BuildImageRequest) returns (BuildImageResponse);

  // Stream build logs in real-time
  rpc StreamBuildLogs(StreamBuildLogsRequest) returns (stream BuildLogEntry);
}

// AnalyzeRepositoryRequest contains parameters for repository analysis
message AnalyzeRepositoryRequest {
  string repo_url = 1;           // e.g., https://github.com/org/repo
  string ref = 2;                // Branch, tag, or commit SHA
  string installation_token = 3; // GitHub App installation token for private repos
}

// AnalyzeRepositoryResponse contains the analysis results
message AnalyzeRepositoryResponse {
  bool detected = 1;                    // Whether Railpack could detect the project
  DetectedBuildConfig config = 2;       // Detected configuration (if detected=true)
  string error = 3;                     // Error message (if detected=false)
  repeated string detected_files = 4;   // Files that triggered detection
}

// DetectedBuildConfig contains Railpack-detected build settings
message DetectedBuildConfig {
  string language = 1;           // e.g., "nodejs", "python", "go"
  string language_version = 2;   // e.g., "22", "3.12", "1.22"
  string framework = 3;          // e.g., "nextjs", "fastapi", "gin"
  string build_command = 4;      // e.g., "npm run build"
  string start_command = 5;      // e.g., "npm start"
}

// BuildImageRequest contains parameters for building an image
message BuildImageRequest {
  string request_id = 1;              // Unique request identifier
  string app_id = 2;                  // Orbit App ID
  string repo_url = 3;                // Repository URL
  string ref = 4;                     // Branch, tag, or commit SHA
  string installation_token = 5;      // GitHub App installation token

  // Build configuration (can override detected values)
  optional string language_version = 6;
  optional string build_command = 7;
  optional string start_command = 8;
  map<string, string> build_env = 9;  // Environment variables for build

  // Registry configuration
  RegistryConfig registry = 10;
  string image_tag = 11;              // Tag for the built image
}

// RegistryConfig contains container registry authentication
message RegistryConfig {
  RegistryType type = 1;
  string url = 2;                     // Registry URL (e.g., ghcr.io, myregistry.azurecr.io)
  string repository = 3;              // Image repository path (e.g., org/app-name)
  string token = 4;                   // Auth token (installation token for GHCR, ACR token for ACR)
  optional string username = 5;       // Username (for ACR)
}

// RegistryType enum
enum RegistryType {
  REGISTRY_TYPE_UNSPECIFIED = 0;
  REGISTRY_TYPE_GHCR = 1;
  REGISTRY_TYPE_ACR = 2;
}

// BuildImageResponse contains the build results
message BuildImageResponse {
  bool success = 1;
  string image_url = 2;               // Full image URL (e.g., ghcr.io/org/app:tag)
  string image_digest = 3;            // Image digest (sha256:...)
  string error = 4;                   // Error message if failed
  repeated BuildStep steps = 5;       // Build steps for progress tracking
}

// BuildStep represents a step in the build process
message BuildStep {
  string name = 1;
  BuildStepStatus status = 2;
  string message = 3;
  int64 duration_ms = 4;
}

// BuildStepStatus enum
enum BuildStepStatus {
  BUILD_STEP_STATUS_UNSPECIFIED = 0;
  BUILD_STEP_STATUS_PENDING = 1;
  BUILD_STEP_STATUS_RUNNING = 2;
  BUILD_STEP_STATUS_COMPLETED = 3;
  BUILD_STEP_STATUS_FAILED = 4;
}

// StreamBuildLogsRequest for streaming build output
message StreamBuildLogsRequest {
  string request_id = 1;
}

// BuildLogEntry represents a single log line
message BuildLogEntry {
  int64 timestamp = 1;
  string level = 2;                   // "info", "warn", "error"
  string message = 3;
  string step = 4;                    // Which build step this belongs to
}
```

**Step 2: Generate proto code**

Run: `make proto-gen`
Expected: Go code generated to `proto/gen/go/idp/build/v1/` and TypeScript to `orbit-www/src/lib/proto/`

**Step 3: Verify generation**

Run: `ls proto/gen/go/idp/build/v1/`
Expected: `build.pb.go`, `build_grpc.pb.go`

Run: `ls orbit-www/src/lib/proto/idp/build/v1/`
Expected: TypeScript client files

**Step 4: Commit**

```bash
git add proto/build.proto proto/gen/ orbit-www/src/lib/proto/
git commit -m "feat(build): add build service proto definitions"
```

---

## Phase 2: Registry Configuration

### Task 2: Create RegistryConfigs Collection

**Files:**
- Create: `orbit-www/src/collections/RegistryConfigs.ts`
- Modify: `orbit-www/src/payload.config.ts`

**Step 1: Create the RegistryConfigs collection**

```typescript
// orbit-www/src/collections/RegistryConfigs.ts
import type { CollectionConfig } from 'payload'

export const RegistryConfigs: CollectionConfig = {
  slug: 'registry-configs',
  admin: {
    useAsTitle: 'name',
    group: 'Settings',
    defaultColumns: ['name', 'type', 'workspace', 'isDefault', 'updatedAt'],
  },
  access: {
    read: async ({ req: { user, payload }, id }) => {
      if (!user) return false
      if (!id) {
        // List view - filter by workspace membership
        return {
          workspace: {
            in: await getWorkspaceIdsForUser(payload, user.id),
          },
        }
      }
      return true
    },
    create: async ({ req: { user, payload }, data }) => {
      if (!user || !data?.workspace) return false

      const workspaceId =
        typeof data.workspace === 'string' ? data.workspace : data.workspace.id

      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: workspaceId } },
            { user: { equals: user.id } },
            { role: { in: ['owner', 'admin'] } },
            { status: { equals: 'active' } },
          ],
        },
        overrideAccess: true,
      })
      return members.docs.length > 0
    },
    update: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false

      const config = await payload.findByID({
        collection: 'registry-configs',
        id,
        overrideAccess: true,
      })

      if (!config?.workspace) return false

      const workspaceId =
        typeof config.workspace === 'string'
          ? config.workspace
          : config.workspace.id

      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: workspaceId } },
            { user: { equals: user.id } },
            { role: { in: ['owner', 'admin'] } },
            { status: { equals: 'active' } },
          ],
        },
        overrideAccess: true,
      })
      return members.docs.length > 0
    },
    delete: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false

      const config = await payload.findByID({
        collection: 'registry-configs',
        id,
        overrideAccess: true,
      })

      if (!config?.workspace) return false

      const workspaceId =
        typeof config.workspace === 'string'
          ? config.workspace
          : config.workspace.id

      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: workspaceId } },
            { user: { equals: user.id } },
            { role: { equals: 'owner' } },
            { status: { equals: 'active' } },
          ],
        },
        overrideAccess: true,
      })
      return members.docs.length > 0
    },
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: {
        description: 'Display name (e.g., "Production GHCR", "Dev ACR")',
      },
    },
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'type',
      type: 'select',
      required: true,
      options: [
        { label: 'GitHub Container Registry', value: 'ghcr' },
        { label: 'Azure Container Registry', value: 'acr' },
      ],
    },
    {
      name: 'isDefault',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description: 'Use as default registry for this workspace',
        position: 'sidebar',
      },
    },
    // GHCR-specific fields (uses GitHub App automatically)
    {
      name: 'ghcrOwner',
      type: 'text',
      admin: {
        description: 'GitHub owner/org for GHCR (e.g., "drewpayment")',
        condition: (data) => data?.type === 'ghcr',
      },
    },
    // ACR-specific fields
    {
      name: 'acrLoginServer',
      type: 'text',
      admin: {
        description: 'ACR login server (e.g., "myregistry.azurecr.io")',
        condition: (data) => data?.type === 'acr',
      },
    },
    {
      name: 'acrUsername',
      type: 'text',
      admin: {
        description: 'ACR token name or username',
        condition: (data) => data?.type === 'acr',
      },
    },
    {
      name: 'acrToken',
      type: 'text',
      admin: {
        description: 'ACR repository-scoped token',
        condition: (data) => data?.type === 'acr',
      },
      access: {
        read: () => false, // Never return token in API responses
      },
    },
  ],
  timestamps: true,
}

// Helper function to get workspace IDs for a user
async function getWorkspaceIdsForUser(
  payload: any,
  userId: string
): Promise<string[]> {
  const members = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [{ user: { equals: userId } }, { status: { equals: 'active' } }],
    },
    overrideAccess: true,
    limit: 100,
  })

  return members.docs.map((m: any) =>
    typeof m.workspace === 'string' ? m.workspace : m.workspace.id
  )
}
```

**Step 2: Register collection in payload.config.ts**

Add to imports in `orbit-www/src/payload.config.ts`:
```typescript
import { RegistryConfigs } from './collections/RegistryConfigs'
```

Add to collections array:
```typescript
collections: [
  // ... existing collections
  RegistryConfigs,
],
```

**Step 3: Verify server starts**

Run: `cd orbit-www && bun run dev`
Expected: Server starts, RegistryConfigs collection visible in admin under "Settings"

**Step 4: Commit**

```bash
git add orbit-www/src/collections/RegistryConfigs.ts orbit-www/src/payload.config.ts
git commit -m "feat(build): add RegistryConfigs collection for GHCR and ACR"
```

---

### Task 3: Extend Apps Collection with Build Fields

**Files:**
- Modify: `orbit-www/src/collections/Apps.ts`

**Step 1: Add build configuration and latest build fields**

Add the following fields to the Apps collection (after the existing `healthConfig` group):

```typescript
// Build configuration (detected or user-specified)
{
  name: 'buildConfig',
  type: 'group',
  admin: {
    description: 'Railpack build configuration',
  },
  fields: [
    {
      name: 'language',
      type: 'text',
      admin: {
        description: 'Detected language (e.g., nodejs, python, go)',
        readOnly: true,
      },
    },
    {
      name: 'languageVersion',
      type: 'text',
      admin: {
        description: 'Language version (e.g., 22, 3.12)',
      },
    },
    {
      name: 'framework',
      type: 'text',
      admin: {
        description: 'Detected framework (e.g., nextjs, fastapi)',
        readOnly: true,
      },
    },
    {
      name: 'buildCommand',
      type: 'text',
      admin: {
        description: 'Build command override',
      },
    },
    {
      name: 'startCommand',
      type: 'text',
      admin: {
        description: 'Start command override',
      },
    },
    {
      name: 'dockerfilePath',
      type: 'text',
      admin: {
        description: 'Path to Dockerfile (if Railpack detection fails)',
      },
    },
  ],
},
// Latest build information
{
  name: 'latestBuild',
  type: 'group',
  admin: {
    description: 'Information about the most recent build',
  },
  fields: [
    {
      name: 'imageUrl',
      type: 'text',
      admin: {
        description: 'Full image URL (e.g., ghcr.io/org/app:tag)',
        readOnly: true,
      },
    },
    {
      name: 'imageDigest',
      type: 'text',
      admin: {
        description: 'Image digest (sha256:...)',
        readOnly: true,
      },
    },
    {
      name: 'imageTag',
      type: 'text',
      admin: {
        description: 'Image tag used',
        readOnly: true,
      },
    },
    {
      name: 'builtAt',
      type: 'date',
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'builtBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'buildWorkflowId',
      type: 'text',
      admin: {
        description: 'Temporal workflow ID for the build',
        readOnly: true,
      },
    },
    {
      name: 'status',
      type: 'select',
      options: [
        { label: 'Never Built', value: 'none' },
        { label: 'Analyzing', value: 'analyzing' },
        { label: 'Building', value: 'building' },
        { label: 'Success', value: 'success' },
        { label: 'Failed', value: 'failed' },
      ],
      defaultValue: 'none',
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'error',
      type: 'textarea',
      admin: {
        description: 'Error message if build failed',
        readOnly: true,
        condition: (data) => data?.latestBuild?.status === 'failed',
      },
    },
  ],
},
// Registry configuration for this app
{
  name: 'registryConfig',
  type: 'relationship',
  relationTo: 'registry-configs',
  admin: {
    description: 'Container registry for built images (uses workspace default if not set)',
    position: 'sidebar',
  },
},
```

**Step 2: Verify server starts**

Run: `cd orbit-www && bun run dev`
Expected: Server starts, new fields visible on App edit page

**Step 3: Commit**

```bash
git add orbit-www/src/collections/Apps.ts
git commit -m "feat(build): add buildConfig and latestBuild fields to Apps collection"
```

---

## Phase 3: Build Service Implementation

### Task 4: Initialize Build Service Module

**Files:**
- Create: `services/build-service/go.mod`
- Create: `services/build-service/go.sum`
- Create: `services/build-service/cmd/server/main.go`

**Step 1: Create Go module**

Run:
```bash
mkdir -p services/build-service/cmd/server
cd services/build-service
go mod init github.com/drewpayment/orbit/services/build-service
```

**Step 2: Add proto dependency**

Run:
```bash
cd services/build-service
go mod edit -replace github.com/drewpayment/orbit/proto=../../proto
```

**Step 3: Create minimal main.go**

```go
// services/build-service/cmd/server/main.go
package main

import (
	"log"
	"log/slog"
	"net"
	"os"

	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"

	buildv1 "github.com/drewpayment/orbit/proto/gen/go/idp/build/v1"
	"github.com/drewpayment/orbit/services/build-service/internal/grpc/build"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	port := os.Getenv("BUILD_SERVICE_PORT")
	if port == "" {
		port = "50053"
	}

	lis, err := net.Listen("tcp", ":"+port)
	if err != nil {
		log.Fatalf("failed to listen: %v", err)
	}

	grpcServer := grpc.NewServer()

	// Create and register build service
	buildService := build.NewBuildServer(logger)
	buildv1.RegisterBuildServiceServer(grpcServer, buildService)

	// Enable reflection for grpcurl/grpcui
	reflection.Register(grpcServer)

	logger.Info("Build service starting", "port", port)

	if err := grpcServer.Serve(lis); err != nil {
		log.Fatalf("failed to serve: %v", err)
	}
}
```

**Step 4: Install dependencies**

Run:
```bash
cd services/build-service
go mod tidy
```

**Step 5: Commit**

```bash
git add services/build-service/go.mod services/build-service/go.sum services/build-service/cmd/server/main.go
git commit -m "feat(build): initialize build-service Go module"
```

---

### Task 5: Implement Build Server Stub

**Files:**
- Create: `services/build-service/internal/grpc/build/server.go`
- Create: `services/build-service/internal/grpc/build/server_test.go`

**Step 1: Write the failing test**

```go
// services/build-service/internal/grpc/build/server_test.go
package build

import (
	"context"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/require"

	buildv1 "github.com/drewpayment/orbit/proto/gen/go/idp/build/v1"
)

func TestAnalyzeRepository_ReturnsDetectedConfig(t *testing.T) {
	logger := slog.Default()
	server := NewBuildServer(logger)

	req := &buildv1.AnalyzeRepositoryRequest{
		RepoUrl: "https://github.com/test/nodejs-app",
		Ref:     "main",
	}

	resp, err := server.AnalyzeRepository(context.Background(), req)

	require.NoError(t, err)
	require.NotNil(t, resp)
	// Stub returns not implemented for now
	require.False(t, resp.Detected)
	require.Contains(t, resp.Error, "not implemented")
}
```

**Step 2: Run test to verify it fails**

Run: `cd services/build-service && go test -v ./internal/grpc/build/`
Expected: FAIL (package/types not defined)

**Step 3: Write the server implementation**

```go
// services/build-service/internal/grpc/build/server.go
package build

import (
	"context"
	"log/slog"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	buildv1 "github.com/drewpayment/orbit/proto/gen/go/idp/build/v1"
)

// BuildServer implements the BuildService gRPC server
type BuildServer struct {
	buildv1.UnimplementedBuildServiceServer
	logger *slog.Logger
}

// NewBuildServer creates a new BuildServer instance
func NewBuildServer(logger *slog.Logger) *BuildServer {
	if logger == nil {
		logger = slog.Default()
	}
	return &BuildServer{
		logger: logger,
	}
}

// AnalyzeRepository analyzes a repository to detect build configuration
func (s *BuildServer) AnalyzeRepository(
	ctx context.Context,
	req *buildv1.AnalyzeRepositoryRequest,
) (*buildv1.AnalyzeRepositoryResponse, error) {
	s.logger.Info("AnalyzeRepository called",
		"repo_url", req.RepoUrl,
		"ref", req.Ref,
	)

	// TODO: Implement Railpack analysis
	return &buildv1.AnalyzeRepositoryResponse{
		Detected: false,
		Error:    "not implemented yet",
	}, nil
}

// BuildImage builds and pushes a container image
func (s *BuildServer) BuildImage(
	ctx context.Context,
	req *buildv1.BuildImageRequest,
) (*buildv1.BuildImageResponse, error) {
	s.logger.Info("BuildImage called",
		"request_id", req.RequestId,
		"app_id", req.AppId,
		"repo_url", req.RepoUrl,
	)

	// TODO: Implement Railpack build
	return &buildv1.BuildImageResponse{
		Success: false,
		Error:   "not implemented yet",
	}, nil
}

// StreamBuildLogs streams build logs in real-time
func (s *BuildServer) StreamBuildLogs(
	req *buildv1.StreamBuildLogsRequest,
	stream buildv1.BuildService_StreamBuildLogsServer,
) error {
	return status.Errorf(codes.Unimplemented, "StreamBuildLogs not implemented yet")
}
```

**Step 4: Run test to verify it passes**

Run: `cd services/build-service && go test -v ./internal/grpc/build/`
Expected: PASS

**Step 5: Verify build compiles**

Run: `cd services/build-service && go build ./cmd/server/`
Expected: Build succeeds

**Step 6: Commit**

```bash
git add services/build-service/internal/grpc/build/
git commit -m "feat(build): add BuildServer gRPC stub implementation"
```

---

### Task 6: Implement Railpack Analyzer

**Files:**
- Create: `services/build-service/internal/railpack/analyzer.go`
- Create: `services/build-service/internal/railpack/analyzer_test.go`

**Step 1: Write the failing test**

```go
// services/build-service/internal/railpack/analyzer_test.go
package railpack

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestAnalyzer_DetectsNodeJS(t *testing.T) {
	// Create a temporary directory with a package.json
	tmpDir := t.TempDir()
	packageJSON := `{
		"name": "test-app",
		"version": "1.0.0",
		"scripts": {
			"build": "next build",
			"start": "next start"
		},
		"dependencies": {
			"next": "^14.0.0"
		}
	}`
	err := os.WriteFile(filepath.Join(tmpDir, "package.json"), []byte(packageJSON), 0644)
	require.NoError(t, err)

	analyzer := NewAnalyzer(slog.Default())
	result, err := analyzer.Analyze(context.Background(), tmpDir)

	require.NoError(t, err)
	require.True(t, result.Detected)
	require.Equal(t, "nodejs", result.Language)
	require.Equal(t, "nextjs", result.Framework)
}

func TestAnalyzer_DetectsPython(t *testing.T) {
	tmpDir := t.TempDir()
	requirements := `fastapi==0.104.0
uvicorn==0.24.0
`
	err := os.WriteFile(filepath.Join(tmpDir, "requirements.txt"), []byte(requirements), 0644)
	require.NoError(t, err)

	mainPy := `from fastapi import FastAPI
app = FastAPI()
`
	err = os.WriteFile(filepath.Join(tmpDir, "main.py"), []byte(mainPy), 0644)
	require.NoError(t, err)

	analyzer := NewAnalyzer(slog.Default())
	result, err := analyzer.Analyze(context.Background(), tmpDir)

	require.NoError(t, err)
	require.True(t, result.Detected)
	require.Equal(t, "python", result.Language)
}

func TestAnalyzer_ReturnsNotDetectedForUnknown(t *testing.T) {
	tmpDir := t.TempDir()
	// Empty directory - nothing to detect

	analyzer := NewAnalyzer(slog.Default())
	result, err := analyzer.Analyze(context.Background(), tmpDir)

	require.NoError(t, err)
	require.False(t, result.Detected)
	require.NotEmpty(t, result.Error)
}
```

**Step 2: Run test to verify it fails**

Run: `cd services/build-service && go test -v ./internal/railpack/`
Expected: FAIL (package not defined)

**Step 3: Write the analyzer implementation**

```go
// services/build-service/internal/railpack/analyzer.go
package railpack

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// AnalyzeResult contains the results of Railpack analysis
type AnalyzeResult struct {
	Detected        bool
	Language        string
	LanguageVersion string
	Framework       string
	BuildCommand    string
	StartCommand    string
	DetectedFiles   []string
	Error           string
}

// Analyzer handles Railpack-based project analysis
type Analyzer struct {
	logger *slog.Logger
}

// NewAnalyzer creates a new Analyzer instance
func NewAnalyzer(logger *slog.Logger) *Analyzer {
	if logger == nil {
		logger = slog.Default()
	}
	return &Analyzer{logger: logger}
}

// Analyze detects the project type and build configuration
func (a *Analyzer) Analyze(ctx context.Context, projectDir string) (*AnalyzeResult, error) {
	a.logger.Info("Analyzing project", "dir", projectDir)

	// Try Railpack CLI first if available
	result, err := a.tryRailpackCLI(ctx, projectDir)
	if err == nil && result.Detected {
		return result, nil
	}

	// Fallback to manual detection
	return a.detectManually(projectDir)
}

// tryRailpackCLI attempts to use the Railpack CLI for detection
func (a *Analyzer) tryRailpackCLI(ctx context.Context, projectDir string) (*AnalyzeResult, error) {
	// Check if railpack is available
	_, err := exec.LookPath("railpack")
	if err != nil {
		a.logger.Debug("Railpack CLI not found, using manual detection")
		return nil, err
	}

	// Run railpack build --plan to get the build plan without building
	cmd := exec.CommandContext(ctx, "railpack", "build", "--plan", "--json", projectDir)
	output, err := cmd.Output()
	if err != nil {
		a.logger.Debug("Railpack CLI failed", "error", err)
		return nil, err
	}

	// Parse Railpack output
	var planOutput struct {
		Provider string `json:"provider"`
		Version  string `json:"version"`
	}
	if err := json.Unmarshal(output, &planOutput); err != nil {
		return nil, err
	}

	return &AnalyzeResult{
		Detected:        true,
		Language:        planOutput.Provider,
		LanguageVersion: planOutput.Version,
	}, nil
}

// detectManually performs manual detection based on file presence
func (a *Analyzer) detectManually(projectDir string) (*AnalyzeResult, error) {
	result := &AnalyzeResult{
		Detected:      false,
		DetectedFiles: []string{},
	}

	// Check for Node.js
	if nodeResult := a.detectNodeJS(projectDir); nodeResult != nil {
		return nodeResult, nil
	}

	// Check for Python
	if pythonResult := a.detectPython(projectDir); pythonResult != nil {
		return pythonResult, nil
	}

	// Check for Go
	if goResult := a.detectGo(projectDir); goResult != nil {
		return goResult, nil
	}

	// Check for Dockerfile (fallback)
	if dockerResult := a.detectDockerfile(projectDir); dockerResult != nil {
		return dockerResult, nil
	}

	result.Error = "Could not detect project type. Please add a Dockerfile to your repository."
	return result, nil
}

func (a *Analyzer) detectNodeJS(projectDir string) *AnalyzeResult {
	packageJSONPath := filepath.Join(projectDir, "package.json")
	if _, err := os.Stat(packageJSONPath); os.IsNotExist(err) {
		return nil
	}

	data, err := os.ReadFile(packageJSONPath)
	if err != nil {
		return nil
	}

	var pkg struct {
		Scripts      map[string]string `json:"scripts"`
		Dependencies map[string]string `json:"dependencies"`
	}
	if err := json.Unmarshal(data, &pkg); err != nil {
		return nil
	}

	result := &AnalyzeResult{
		Detected:      true,
		Language:      "nodejs",
		DetectedFiles: []string{"package.json"},
	}

	// Detect framework
	if _, hasNext := pkg.Dependencies["next"]; hasNext {
		result.Framework = "nextjs"
		result.BuildCommand = "npm run build"
		result.StartCommand = "npm start"
	} else if _, hasReact := pkg.Dependencies["react"]; hasReact {
		result.Framework = "react"
		result.BuildCommand = "npm run build"
		result.StartCommand = "npm start"
	} else if _, hasExpress := pkg.Dependencies["express"]; hasExpress {
		result.Framework = "express"
		result.StartCommand = "npm start"
	} else {
		// Generic Node.js
		if _, hasBuild := pkg.Scripts["build"]; hasBuild {
			result.BuildCommand = "npm run build"
		}
		if _, hasStart := pkg.Scripts["start"]; hasStart {
			result.StartCommand = "npm start"
		}
	}

	// Detect Node version from .nvmrc or engines
	nvmrcPath := filepath.Join(projectDir, ".nvmrc")
	if nvmrcData, err := os.ReadFile(nvmrcPath); err == nil {
		result.LanguageVersion = strings.TrimSpace(string(nvmrcData))
		result.DetectedFiles = append(result.DetectedFiles, ".nvmrc")
	}

	return result
}

func (a *Analyzer) detectPython(projectDir string) *AnalyzeResult {
	// Check for various Python project indicators
	indicators := []string{
		"requirements.txt",
		"pyproject.toml",
		"setup.py",
		"Pipfile",
	}

	var detectedFile string
	for _, indicator := range indicators {
		path := filepath.Join(projectDir, indicator)
		if _, err := os.Stat(path); err == nil {
			detectedFile = indicator
			break
		}
	}

	if detectedFile == "" {
		return nil
	}

	result := &AnalyzeResult{
		Detected:        true,
		Language:        "python",
		LanguageVersion: "3.12", // Default
		DetectedFiles:   []string{detectedFile},
	}

	// Check for FastAPI/Flask/Django
	reqPath := filepath.Join(projectDir, "requirements.txt")
	if data, err := os.ReadFile(reqPath); err == nil {
		content := strings.ToLower(string(data))
		if strings.Contains(content, "fastapi") {
			result.Framework = "fastapi"
			result.StartCommand = "uvicorn main:app --host 0.0.0.0 --port 8000"
		} else if strings.Contains(content, "flask") {
			result.Framework = "flask"
			result.StartCommand = "flask run --host 0.0.0.0"
		} else if strings.Contains(content, "django") {
			result.Framework = "django"
			result.StartCommand = "python manage.py runserver 0.0.0.0:8000"
		}
	}

	// Check for .python-version
	pvPath := filepath.Join(projectDir, ".python-version")
	if pvData, err := os.ReadFile(pvPath); err == nil {
		result.LanguageVersion = strings.TrimSpace(string(pvData))
		result.DetectedFiles = append(result.DetectedFiles, ".python-version")
	}

	return result
}

func (a *Analyzer) detectGo(projectDir string) *AnalyzeResult {
	goModPath := filepath.Join(projectDir, "go.mod")
	if _, err := os.Stat(goModPath); os.IsNotExist(err) {
		return nil
	}

	result := &AnalyzeResult{
		Detected:        true,
		Language:        "go",
		LanguageVersion: "1.22", // Default
		BuildCommand:    "go build -o app .",
		StartCommand:    "./app",
		DetectedFiles:   []string{"go.mod"},
	}

	// Parse go.mod for version
	if data, err := os.ReadFile(goModPath); err == nil {
		lines := strings.Split(string(data), "\n")
		for _, line := range lines {
			if strings.HasPrefix(line, "go ") {
				result.LanguageVersion = strings.TrimPrefix(line, "go ")
				break
			}
		}
	}

	return result
}

func (a *Analyzer) detectDockerfile(projectDir string) *AnalyzeResult {
	dockerfilePath := filepath.Join(projectDir, "Dockerfile")
	if _, err := os.Stat(dockerfilePath); os.IsNotExist(err) {
		return nil
	}

	return &AnalyzeResult{
		Detected:      true,
		Language:      "dockerfile",
		DetectedFiles: []string{"Dockerfile"},
	}
}
```

**Step 4: Run test to verify it passes**

Run: `cd services/build-service && go test -v ./internal/railpack/`
Expected: PASS

**Step 5: Commit**

```bash
git add services/build-service/internal/railpack/
git commit -m "feat(build): implement Railpack project analyzer with manual fallback"
```

---

### Task 7: Implement Builder with BuildKit

**Files:**
- Create: `services/build-service/internal/builder/builder.go`
- Create: `services/build-service/internal/builder/builder_test.go`

**Step 1: Write the failing test**

```go
// services/build-service/internal/builder/builder_test.go
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

	// Missing required fields
	req := &BuildRequest{
		AppID: "app-123",
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
```

**Step 2: Run test to verify it fails**

Run: `cd services/build-service && go test -v ./internal/builder/`
Expected: FAIL (package not defined)

**Step 3: Write the builder implementation**

```go
// services/build-service/internal/builder/builder.go
package builder

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// RegistryType represents the type of container registry
type RegistryType string

const (
	RegistryTypeGHCR RegistryType = "ghcr"
	RegistryTypeACR  RegistryType = "acr"
)

// RegistryConfig contains registry authentication details
type RegistryConfig struct {
	Type       RegistryType
	URL        string
	Repository string
	Token      string
	Username   string // For ACR
}

// BuildRequest contains parameters for building an image
type BuildRequest struct {
	RequestID       string
	AppID           string
	RepoURL         string
	Ref             string
	InstallationToken string
	LanguageVersion string
	BuildCommand    string
	StartCommand    string
	BuildEnv        map[string]string
	Registry        RegistryConfig
	ImageTag        string // Optional - auto-generated if empty
}

// BuildResult contains the results of a build
type BuildResult struct {
	Success     bool
	ImageURL    string
	ImageDigest string
	Error       string
	Steps       []BuildStep
}

// BuildStep represents a step in the build process
type BuildStep struct {
	Name       string
	Status     string
	Message    string
	DurationMs int64
}

// Builder handles container image building
type Builder struct {
	logger   *slog.Logger
	workDir  string
}

// NewBuilder creates a new Builder instance
func NewBuilder(logger *slog.Logger, workDir string) *Builder {
	if logger == nil {
		logger = slog.Default()
	}
	return &Builder{
		logger:  logger,
		workDir: workDir,
	}
}

// Build builds and pushes a container image
func (b *Builder) Build(ctx context.Context, req *BuildRequest) (*BuildResult, error) {
	// Validate input
	if err := b.validateRequest(req); err != nil {
		return nil, err
	}

	result := &BuildResult{
		Steps: []BuildStep{},
	}

	// Create work directory
	buildDir := filepath.Join(b.workDir, req.RequestID)
	if err := os.MkdirAll(buildDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create build directory: %w", err)
	}
	defer os.RemoveAll(buildDir)

	// Step 1: Clone repository
	result.Steps = append(result.Steps, BuildStep{Name: "clone", Status: "running"})
	if err := b.cloneRepo(ctx, req, buildDir); err != nil {
		result.Steps[len(result.Steps)-1].Status = "failed"
		result.Steps[len(result.Steps)-1].Message = err.Error()
		result.Error = fmt.Sprintf("failed to clone repository: %v", err)
		return result, nil
	}
	result.Steps[len(result.Steps)-1].Status = "completed"

	// Step 2: Build image with Railpack/BuildKit
	result.Steps = append(result.Steps, BuildStep{Name: "build", Status: "running"})
	imageURL := generateImageTag(req)
	digest, err := b.buildImage(ctx, req, buildDir, imageURL)
	if err != nil {
		result.Steps[len(result.Steps)-1].Status = "failed"
		result.Steps[len(result.Steps)-1].Message = err.Error()
		result.Error = fmt.Sprintf("failed to build image: %v", err)
		return result, nil
	}
	result.Steps[len(result.Steps)-1].Status = "completed"

	// Step 3: Push image to registry
	result.Steps = append(result.Steps, BuildStep{Name: "push", Status: "running"})
	if err := b.pushImage(ctx, req, imageURL); err != nil {
		result.Steps[len(result.Steps)-1].Status = "failed"
		result.Steps[len(result.Steps)-1].Message = err.Error()
		result.Error = fmt.Sprintf("failed to push image: %v", err)
		return result, nil
	}
	result.Steps[len(result.Steps)-1].Status = "completed"

	result.Success = true
	result.ImageURL = imageURL
	result.ImageDigest = digest

	return result, nil
}

func (b *Builder) validateRequest(req *BuildRequest) error {
	if req.RepoURL == "" {
		return fmt.Errorf("repo_url is required")
	}
	if req.Registry.URL == "" {
		return fmt.Errorf("registry url is required")
	}
	if req.Registry.Repository == "" {
		return fmt.Errorf("registry repository is required")
	}
	return nil
}

func (b *Builder) cloneRepo(ctx context.Context, req *BuildRequest, buildDir string) error {
	b.logger.Info("Cloning repository", "url", req.RepoURL, "ref", req.Ref)

	// Construct authenticated URL if token provided
	repoURL := req.RepoURL
	if req.InstallationToken != "" {
		// For GitHub, use x-access-token authentication
		repoURL = strings.Replace(repoURL, "https://", fmt.Sprintf("https://x-access-token:%s@", req.InstallationToken), 1)
	}

	// Clone the repository
	cmd := exec.CommandContext(ctx, "git", "clone", "--depth", "1", "--single-branch")
	if req.Ref != "" {
		cmd.Args = append(cmd.Args, "--branch", req.Ref)
	}
	cmd.Args = append(cmd.Args, repoURL, buildDir)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")

	output, err := cmd.CombinedOutput()
	if err != nil {
		b.logger.Error("Git clone failed", "error", err, "output", string(output))
		return fmt.Errorf("git clone failed: %w", err)
	}

	return nil
}

func (b *Builder) buildImage(ctx context.Context, req *BuildRequest, buildDir, imageURL string) (string, error) {
	b.logger.Info("Building image", "dir", buildDir, "image", imageURL)

	// Check if Railpack is available
	railpackPath, err := exec.LookPath("railpack")
	if err != nil {
		// Fallback to docker build if Dockerfile exists
		return b.buildWithDocker(ctx, req, buildDir, imageURL)
	}

	// Build with Railpack
	cmd := exec.CommandContext(ctx, railpackPath, "build", buildDir, "-t", imageURL)

	// Add build environment variables
	for k, v := range req.BuildEnv {
		cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", k, v))
	}

	output, err := cmd.CombinedOutput()
	if err != nil {
		b.logger.Error("Railpack build failed", "error", err, "output", string(output))
		return "", fmt.Errorf("railpack build failed: %w", err)
	}

	// TODO: Parse digest from Railpack output
	return "sha256:placeholder", nil
}

func (b *Builder) buildWithDocker(ctx context.Context, req *BuildRequest, buildDir, imageURL string) (string, error) {
	b.logger.Info("Building with Docker", "dir", buildDir, "image", imageURL)

	dockerfilePath := filepath.Join(buildDir, "Dockerfile")
	if _, err := os.Stat(dockerfilePath); os.IsNotExist(err) {
		return "", fmt.Errorf("no Dockerfile found and Railpack not available")
	}

	cmd := exec.CommandContext(ctx, "docker", "build", "-t", imageURL, buildDir)
	output, err := cmd.CombinedOutput()
	if err != nil {
		b.logger.Error("Docker build failed", "error", err, "output", string(output))
		return "", fmt.Errorf("docker build failed: %w", err)
	}

	// Get image digest
	inspectCmd := exec.CommandContext(ctx, "docker", "inspect", "--format={{index .RepoDigests 0}}", imageURL)
	digestOutput, _ := inspectCmd.Output()

	return strings.TrimSpace(string(digestOutput)), nil
}

func (b *Builder) pushImage(ctx context.Context, req *BuildRequest, imageURL string) error {
	b.logger.Info("Pushing image", "image", imageURL)

	// Login to registry
	if err := b.loginToRegistry(ctx, req); err != nil {
		return fmt.Errorf("registry login failed: %w", err)
	}

	// Push image
	cmd := exec.CommandContext(ctx, "docker", "push", imageURL)
	output, err := cmd.CombinedOutput()
	if err != nil {
		b.logger.Error("Docker push failed", "error", err, "output", string(output))
		return fmt.Errorf("docker push failed: %w", err)
	}

	return nil
}

func (b *Builder) loginToRegistry(ctx context.Context, req *BuildRequest) error {
	var cmd *exec.Cmd

	switch req.Registry.Type {
	case RegistryTypeGHCR:
		// For GHCR, use the installation token
		cmd = exec.CommandContext(ctx, "docker", "login", "ghcr.io",
			"-u", "x-access-token",
			"--password-stdin")
		cmd.Stdin = strings.NewReader(req.Registry.Token)

	case RegistryTypeACR:
		// For ACR, use provided credentials
		cmd = exec.CommandContext(ctx, "docker", "login", req.Registry.URL,
			"-u", req.Registry.Username,
			"--password-stdin")
		cmd.Stdin = strings.NewReader(req.Registry.Token)

	default:
		return fmt.Errorf("unsupported registry type: %s", req.Registry.Type)
	}

	output, err := cmd.CombinedOutput()
	if err != nil {
		b.logger.Error("Docker login failed", "error", err, "output", string(output))
		return fmt.Errorf("docker login failed: %w", err)
	}

	return nil
}

// generateImageTag creates the full image URL with tag
func generateImageTag(req *BuildRequest) string {
	tag := req.ImageTag
	if tag == "" {
		// Use first 7 chars of ref (commit SHA) as tag
		if len(req.Ref) >= 7 {
			tag = req.Ref[:7]
		} else if req.Ref != "" {
			tag = req.Ref
		} else {
			tag = "latest"
		}
	}

	return fmt.Sprintf("%s/%s:%s", req.Registry.URL, req.Registry.Repository, tag)
}
```

**Step 4: Run test to verify it passes**

Run: `cd services/build-service && go test -v ./internal/builder/`
Expected: PASS

**Step 5: Commit**

```bash
git add services/build-service/internal/builder/
git commit -m "feat(build): implement Builder with Railpack and Docker fallback"
```

---

### Task 8: Wire Analyzer and Builder to gRPC Server

**Files:**
- Modify: `services/build-service/internal/grpc/build/server.go`
- Modify: `services/build-service/internal/grpc/build/server_test.go`

**Step 1: Update the test for real analysis**

Add to `server_test.go`:

```go
func TestAnalyzeRepository_WithNodeJSProject(t *testing.T) {
	// Create temp dir with package.json
	tmpDir := t.TempDir()
	packageJSON := `{"name": "test", "dependencies": {"next": "^14.0.0"}}`
	err := os.WriteFile(filepath.Join(tmpDir, "package.json"), []byte(packageJSON), 0644)
	require.NoError(t, err)

	logger := slog.Default()
	server := NewBuildServerWithWorkDir(logger, tmpDir)

	// Note: This test would need the server to accept a local path
	// In reality, the server clones from a URL
	// This is a simplified test showing the pattern
}
```

**Step 2: Update server to use analyzer and builder**

```go
// services/build-service/internal/grpc/build/server.go
package build

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	buildv1 "github.com/drewpayment/orbit/proto/gen/go/idp/build/v1"
	"github.com/drewpayment/orbit/services/build-service/internal/builder"
	"github.com/drewpayment/orbit/services/build-service/internal/railpack"
)

// BuildServer implements the BuildService gRPC server
type BuildServer struct {
	buildv1.UnimplementedBuildServiceServer
	logger   *slog.Logger
	workDir  string
	analyzer *railpack.Analyzer
	builder  *builder.Builder
}

// NewBuildServer creates a new BuildServer instance
func NewBuildServer(logger *slog.Logger) *BuildServer {
	workDir := os.Getenv("BUILD_WORK_DIR")
	if workDir == "" {
		workDir = "/tmp/orbit-builds"
	}
	return NewBuildServerWithWorkDir(logger, workDir)
}

// NewBuildServerWithWorkDir creates a new BuildServer with a specific work directory
func NewBuildServerWithWorkDir(logger *slog.Logger, workDir string) *BuildServer {
	if logger == nil {
		logger = slog.Default()
	}
	return &BuildServer{
		logger:   logger,
		workDir:  workDir,
		analyzer: railpack.NewAnalyzer(logger),
		builder:  builder.NewBuilder(logger, workDir),
	}
}

// AnalyzeRepository analyzes a repository to detect build configuration
func (s *BuildServer) AnalyzeRepository(
	ctx context.Context,
	req *buildv1.AnalyzeRepositoryRequest,
) (*buildv1.AnalyzeRepositoryResponse, error) {
	s.logger.Info("AnalyzeRepository called",
		"repo_url", req.RepoUrl,
		"ref", req.Ref,
	)

	// Clone repository to temp directory
	cloneDir := filepath.Join(s.workDir, "analyze-"+generateRequestID())
	defer os.RemoveAll(cloneDir)

	if err := s.cloneForAnalysis(ctx, req, cloneDir); err != nil {
		return &buildv1.AnalyzeRepositoryResponse{
			Detected: false,
			Error:    "Failed to clone repository: " + err.Error(),
		}, nil
	}

	// Run analysis
	result, err := s.analyzer.Analyze(ctx, cloneDir)
	if err != nil {
		return &buildv1.AnalyzeRepositoryResponse{
			Detected: false,
			Error:    "Analysis failed: " + err.Error(),
		}, nil
	}

	if !result.Detected {
		return &buildv1.AnalyzeRepositoryResponse{
			Detected: false,
			Error:    result.Error,
		}, nil
	}

	return &buildv1.AnalyzeRepositoryResponse{
		Detected: true,
		Config: &buildv1.DetectedBuildConfig{
			Language:        result.Language,
			LanguageVersion: result.LanguageVersion,
			Framework:       result.Framework,
			BuildCommand:    result.BuildCommand,
			StartCommand:    result.StartCommand,
		},
		DetectedFiles: result.DetectedFiles,
	}, nil
}

// BuildImage builds and pushes a container image
func (s *BuildServer) BuildImage(
	ctx context.Context,
	req *buildv1.BuildImageRequest,
) (*buildv1.BuildImageResponse, error) {
	s.logger.Info("BuildImage called",
		"request_id", req.RequestId,
		"app_id", req.AppId,
		"repo_url", req.RepoUrl,
	)

	// Convert proto request to builder request
	buildReq := &builder.BuildRequest{
		RequestID:         req.RequestId,
		AppID:             req.AppId,
		RepoURL:           req.RepoUrl,
		Ref:               req.Ref,
		InstallationToken: req.InstallationToken,
		BuildEnv:          req.BuildEnv,
		ImageTag:          req.ImageTag,
	}

	// Handle optional overrides
	if req.LanguageVersion != nil {
		buildReq.LanguageVersion = *req.LanguageVersion
	}
	if req.BuildCommand != nil {
		buildReq.BuildCommand = *req.BuildCommand
	}
	if req.StartCommand != nil {
		buildReq.StartCommand = *req.StartCommand
	}

	// Convert registry config
	if req.Registry != nil {
		buildReq.Registry = builder.RegistryConfig{
			URL:        req.Registry.Url,
			Repository: req.Registry.Repository,
			Token:      req.Registry.Token,
		}
		if req.Registry.Username != nil {
			buildReq.Registry.Username = *req.Registry.Username
		}

		switch req.Registry.Type {
		case buildv1.RegistryType_REGISTRY_TYPE_GHCR:
			buildReq.Registry.Type = builder.RegistryTypeGHCR
		case buildv1.RegistryType_REGISTRY_TYPE_ACR:
			buildReq.Registry.Type = builder.RegistryTypeACR
		}
	}

	// Execute build
	result, err := s.builder.Build(ctx, buildReq)
	if err != nil {
		return &buildv1.BuildImageResponse{
			Success: false,
			Error:   err.Error(),
		}, nil
	}

	// Convert steps to proto
	var protoSteps []*buildv1.BuildStep
	for _, step := range result.Steps {
		protoStep := &buildv1.BuildStep{
			Name:       step.Name,
			Message:    step.Message,
			DurationMs: step.DurationMs,
		}
		switch step.Status {
		case "pending":
			protoStep.Status = buildv1.BuildStepStatus_BUILD_STEP_STATUS_PENDING
		case "running":
			protoStep.Status = buildv1.BuildStepStatus_BUILD_STEP_STATUS_RUNNING
		case "completed":
			protoStep.Status = buildv1.BuildStepStatus_BUILD_STEP_STATUS_COMPLETED
		case "failed":
			protoStep.Status = buildv1.BuildStepStatus_BUILD_STEP_STATUS_FAILED
		}
		protoSteps = append(protoSteps, protoStep)
	}

	return &buildv1.BuildImageResponse{
		Success:     result.Success,
		ImageUrl:    result.ImageURL,
		ImageDigest: result.ImageDigest,
		Error:       result.Error,
		Steps:       protoSteps,
	}, nil
}

// StreamBuildLogs streams build logs in real-time
func (s *BuildServer) StreamBuildLogs(
	req *buildv1.StreamBuildLogsRequest,
	stream buildv1.BuildService_StreamBuildLogsServer,
) error {
	return status.Errorf(codes.Unimplemented, "StreamBuildLogs not implemented yet")
}

// Helper functions

func (s *BuildServer) cloneForAnalysis(ctx context.Context, req *buildv1.AnalyzeRepositoryRequest, cloneDir string) error {
	// Use git clone with authentication if token provided
	// Similar to builder.cloneRepo but simplified for analysis
	return nil // TODO: Implement
}

func generateRequestID() string {
	// Generate a short random ID
	return "temp" // TODO: Use proper UUID
}
```

**Step 3: Run tests**

Run: `cd services/build-service && go test -v ./...`
Expected: PASS

**Step 4: Verify build**

Run: `cd services/build-service && go build ./cmd/server/`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add services/build-service/internal/grpc/build/
git commit -m "feat(build): wire analyzer and builder to gRPC server"
```

---

## Phase 4: Build Workflow

### Task 9: Create Build Workflow in Temporal

**Files:**
- Create: `temporal-workflows/internal/workflows/build_workflow.go`
- Create: `temporal-workflows/internal/workflows/build_workflow_test.go`

**Step 1: Write the failing test**

```go
// temporal-workflows/internal/workflows/build_workflow_test.go
package workflows

import (
	"testing"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/testsuite"
)

func TestBuildWorkflow_Success(t *testing.T) {
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestWorkflowEnvironment()

	input := BuildWorkflowInput{
		RequestID:   "build-123",
		AppID:       "app-456",
		WorkspaceID: "ws-789",
		UserID:      "user-001",
		RepoURL:     "https://github.com/org/repo",
		Ref:         "main",
		Registry: BuildRegistryConfig{
			Type:       "ghcr",
			URL:        "ghcr.io",
			Repository: "org/repo",
		},
	}

	// Mock activities
	env.OnActivity(ActivityAnalyzeRepository, mock.Anything, mock.Anything).Return(&AnalyzeRepositoryResult{
		Detected: true,
		Language: "nodejs",
		Framework: "nextjs",
	}, nil)

	env.OnActivity(ActivityUpdateBuildStatus, mock.Anything, mock.Anything).Return(nil)

	env.OnActivity(ActivityBuildAndPushImage, mock.Anything, mock.Anything).Return(&BuildAndPushResult{
		Success:     true,
		ImageURL:    "ghcr.io/org/repo:abc123",
		ImageDigest: "sha256:abc123",
	}, nil)

	env.ExecuteWorkflow(BuildWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var result BuildWorkflowResult
	require.NoError(t, env.GetWorkflowResult(&result))
	require.Equal(t, "success", result.Status)
	require.Equal(t, "ghcr.io/org/repo:abc123", result.ImageURL)
}

func TestBuildWorkflow_AnalysisFails(t *testing.T) {
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestWorkflowEnvironment()

	input := BuildWorkflowInput{
		RequestID:   "build-123",
		AppID:       "app-456",
		WorkspaceID: "ws-789",
		UserID:      "user-001",
		RepoURL:     "https://github.com/org/unknown-project",
		Ref:         "main",
		Registry: BuildRegistryConfig{
			Type:       "ghcr",
			URL:        "ghcr.io",
			Repository: "org/repo",
		},
	}

	// Mock analysis failure
	env.OnActivity(ActivityAnalyzeRepository, mock.Anything, mock.Anything).Return(&AnalyzeRepositoryResult{
		Detected: false,
		Error:    "Could not detect project type",
	}, nil)

	env.OnActivity(ActivityUpdateBuildStatus, mock.Anything, mock.Anything).Return(nil)

	env.ExecuteWorkflow(BuildWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())

	var result BuildWorkflowResult
	require.NoError(t, env.GetWorkflowResult(&result))
	require.Equal(t, "failed", result.Status)
	require.Contains(t, result.Error, "Could not detect")
}
```

**Step 2: Run test to verify it fails**

Run: `cd temporal-workflows && go test -v -run TestBuildWorkflow ./internal/workflows/`
Expected: FAIL (types not defined)

**Step 3: Write the workflow implementation**

```go
// temporal-workflows/internal/workflows/build_workflow.go
package workflows

import (
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// BuildWorkflowInput contains all parameters for image building
type BuildWorkflowInput struct {
	RequestID   string              `json:"requestId"`
	AppID       string              `json:"appId"`
	WorkspaceID string              `json:"workspaceId"`
	UserID      string              `json:"userId"`
	RepoURL     string              `json:"repoUrl"`
	Ref         string              `json:"ref"`
	Registry    BuildRegistryConfig `json:"registry"`
	// Optional overrides
	LanguageVersion string            `json:"languageVersion,omitempty"`
	BuildCommand    string            `json:"buildCommand,omitempty"`
	StartCommand    string            `json:"startCommand,omitempty"`
	BuildEnv        map[string]string `json:"buildEnv,omitempty"`
	ImageTag        string            `json:"imageTag,omitempty"`
}

// BuildRegistryConfig contains registry configuration
type BuildRegistryConfig struct {
	Type       string `json:"type"` // "ghcr" or "acr"
	URL        string `json:"url"`
	Repository string `json:"repository"`
	Token      string `json:"token"`
	Username   string `json:"username,omitempty"` // For ACR
}

// BuildWorkflowResult contains the workflow result
type BuildWorkflowResult struct {
	Status      string `json:"status"` // analyzing, building, success, failed
	ImageURL    string `json:"imageUrl,omitempty"`
	ImageDigest string `json:"imageDigest,omitempty"`
	Error       string `json:"error,omitempty"`
	// Detected config (for UI display)
	DetectedConfig *DetectedBuildConfig `json:"detectedConfig,omitempty"`
}

// DetectedBuildConfig contains Railpack-detected settings
type DetectedBuildConfig struct {
	Language        string `json:"language"`
	LanguageVersion string `json:"languageVersion"`
	Framework       string `json:"framework"`
	BuildCommand    string `json:"buildCommand"`
	StartCommand    string `json:"startCommand"`
}

// BuildProgress tracks workflow progress
type BuildProgress struct {
	CurrentStep  string `json:"currentStep"`
	StepsTotal   int    `json:"stepsTotal"`
	StepsCurrent int    `json:"stepsCurrent"`
	Message      string `json:"message"`
}

// Activity names
const (
	ActivityAnalyzeRepository  = "AnalyzeRepository"
	ActivityBuildAndPushImage  = "BuildAndPushImage"
	ActivityUpdateBuildStatus  = "UpdateBuildStatus"
)

// Activity input/output types
type AnalyzeRepositoryInput struct {
	RepoURL           string `json:"repoUrl"`
	Ref               string `json:"ref"`
	InstallationToken string `json:"installationToken"`
}

type AnalyzeRepositoryResult struct {
	Detected        bool   `json:"detected"`
	Language        string `json:"language"`
	LanguageVersion string `json:"languageVersion"`
	Framework       string `json:"framework"`
	BuildCommand    string `json:"buildCommand"`
	StartCommand    string `json:"startCommand"`
	Error           string `json:"error,omitempty"`
}

type BuildAndPushInput struct {
	RequestID         string            `json:"requestId"`
	AppID             string            `json:"appId"`
	RepoURL           string            `json:"repoUrl"`
	Ref               string            `json:"ref"`
	InstallationToken string            `json:"installationToken"`
	LanguageVersion   string            `json:"languageVersion"`
	BuildCommand      string            `json:"buildCommand"`
	StartCommand      string            `json:"startCommand"`
	BuildEnv          map[string]string `json:"buildEnv"`
	Registry          BuildRegistryConfig `json:"registry"`
	ImageTag          string            `json:"imageTag"`
}

type BuildAndPushResult struct {
	Success     bool   `json:"success"`
	ImageURL    string `json:"imageUrl"`
	ImageDigest string `json:"imageDigest"`
	Error       string `json:"error,omitempty"`
}

type UpdateBuildStatusInput struct {
	AppID       string              `json:"appId"`
	Status      string              `json:"status"`
	ImageURL    string              `json:"imageUrl,omitempty"`
	ImageDigest string              `json:"imageDigest,omitempty"`
	Error       string              `json:"error,omitempty"`
	BuildConfig *DetectedBuildConfig `json:"buildConfig,omitempty"`
}

// BuildWorkflow orchestrates container image building
func BuildWorkflow(ctx workflow.Context, input BuildWorkflowInput) (*BuildWorkflowResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting build workflow",
		"requestID", input.RequestID,
		"appID", input.AppID,
		"repoURL", input.RepoURL)

	// Progress tracking
	progress := BuildProgress{
		CurrentStep:  "initializing",
		StepsTotal:   4,
		StepsCurrent: 0,
		Message:      "Starting build",
	}

	// Set up query handler
	err := workflow.SetQueryHandler(ctx, "progress", func() (BuildProgress, error) {
		return progress, nil
	})
	if err != nil {
		return &BuildWorkflowResult{
			Status: "failed",
			Error:  "failed to set up progress tracking: " + err.Error(),
		}, nil
	}

	// Activity options
	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Minute, // Builds can take a while
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 2,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	// Helper to update status on failure
	updateStatusOnFailure := func(errMsg string) {
		statusInput := UpdateBuildStatusInput{
			AppID:  input.AppID,
			Status: "failed",
			Error:  errMsg,
		}
		_ = workflow.ExecuteActivity(ctx, ActivityUpdateBuildStatus, statusInput).Get(ctx, nil)
	}

	// Step 1: Update status to analyzing
	progress.CurrentStep = "analyzing"
	progress.StepsCurrent = 1
	progress.Message = "Analyzing repository"

	statusInput := UpdateBuildStatusInput{
		AppID:  input.AppID,
		Status: "analyzing",
	}
	err = workflow.ExecuteActivity(ctx, ActivityUpdateBuildStatus, statusInput).Get(ctx, nil)
	if err != nil {
		logger.Error("Failed to update status", "error", err)
	}

	// Step 2: Analyze repository
	analyzeInput := AnalyzeRepositoryInput{
		RepoURL: input.RepoURL,
		Ref:     input.Ref,
		// InstallationToken will be fetched by activity based on workspace
	}

	var analyzeResult AnalyzeRepositoryResult
	err = workflow.ExecuteActivity(ctx, ActivityAnalyzeRepository, analyzeInput).Get(ctx, &analyzeResult)
	if err != nil {
		updateStatusOnFailure("Analysis failed: " + err.Error())
		return &BuildWorkflowResult{
			Status: "failed",
			Error:  "Analysis failed: " + err.Error(),
		}, nil
	}

	if !analyzeResult.Detected {
		updateStatusOnFailure(analyzeResult.Error)
		return &BuildWorkflowResult{
			Status: "failed",
			Error:  analyzeResult.Error,
		}, nil
	}

	// Store detected config for result
	detectedConfig := &DetectedBuildConfig{
		Language:        analyzeResult.Language,
		LanguageVersion: analyzeResult.LanguageVersion,
		Framework:       analyzeResult.Framework,
		BuildCommand:    analyzeResult.BuildCommand,
		StartCommand:    analyzeResult.StartCommand,
	}

	// Step 3: Update status to building
	progress.CurrentStep = "building"
	progress.StepsCurrent = 2
	progress.Message = "Building container image"

	statusInput = UpdateBuildStatusInput{
		AppID:       input.AppID,
		Status:      "building",
		BuildConfig: detectedConfig,
	}
	_ = workflow.ExecuteActivity(ctx, ActivityUpdateBuildStatus, statusInput).Get(ctx, nil)

	// Step 4: Build and push image
	// Apply overrides from input if provided
	languageVersion := analyzeResult.LanguageVersion
	if input.LanguageVersion != "" {
		languageVersion = input.LanguageVersion
	}
	buildCommand := analyzeResult.BuildCommand
	if input.BuildCommand != "" {
		buildCommand = input.BuildCommand
	}
	startCommand := analyzeResult.StartCommand
	if input.StartCommand != "" {
		startCommand = input.StartCommand
	}

	buildInput := BuildAndPushInput{
		RequestID:       input.RequestID,
		AppID:           input.AppID,
		RepoURL:         input.RepoURL,
		Ref:             input.Ref,
		LanguageVersion: languageVersion,
		BuildCommand:    buildCommand,
		StartCommand:    startCommand,
		BuildEnv:        input.BuildEnv,
		Registry:        input.Registry,
		ImageTag:        input.ImageTag,
	}

	var buildResult BuildAndPushResult
	err = workflow.ExecuteActivity(ctx, ActivityBuildAndPushImage, buildInput).Get(ctx, &buildResult)
	if err != nil {
		updateStatusOnFailure("Build failed: " + err.Error())
		return &BuildWorkflowResult{
			Status:         "failed",
			Error:          "Build failed: " + err.Error(),
			DetectedConfig: detectedConfig,
		}, nil
	}

	if !buildResult.Success {
		updateStatusOnFailure(buildResult.Error)
		return &BuildWorkflowResult{
			Status:         "failed",
			Error:          buildResult.Error,
			DetectedConfig: detectedConfig,
		}, nil
	}

	// Step 5: Update status to success
	progress.CurrentStep = "complete"
	progress.StepsCurrent = 4
	progress.Message = "Build completed successfully"

	statusInput = UpdateBuildStatusInput{
		AppID:       input.AppID,
		Status:      "success",
		ImageURL:    buildResult.ImageURL,
		ImageDigest: buildResult.ImageDigest,
		BuildConfig: detectedConfig,
	}
	_ = workflow.ExecuteActivity(ctx, ActivityUpdateBuildStatus, statusInput).Get(ctx, nil)

	logger.Info("Build workflow completed successfully",
		"requestID", input.RequestID,
		"imageURL", buildResult.ImageURL)

	return &BuildWorkflowResult{
		Status:         "success",
		ImageURL:       buildResult.ImageURL,
		ImageDigest:    buildResult.ImageDigest,
		DetectedConfig: detectedConfig,
	}, nil
}
```

**Step 4: Run test to verify it passes**

Run: `cd temporal-workflows && go test -v -run TestBuildWorkflow ./internal/workflows/`
Expected: PASS

**Step 5: Commit**

```bash
git add temporal-workflows/internal/workflows/build_workflow.go temporal-workflows/internal/workflows/build_workflow_test.go
git commit -m "feat(build): add BuildWorkflow for container image building"
```

---

### Task 10: Create Build Activities

**Files:**
- Create: `temporal-workflows/internal/activities/build_activities.go`
- Create: `temporal-workflows/internal/activities/build_activities_test.go`

**Step 1: Write the failing test**

```go
// temporal-workflows/internal/activities/build_activities_test.go
package activities

import (
	"context"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestBuildActivities_AnalyzeRepository_ValidatesInput(t *testing.T) {
	activities := NewBuildActivities(nil, slog.Default())

	input := AnalyzeRepositoryInput{
		// Missing RepoURL
	}

	_, err := activities.AnalyzeRepository(context.Background(), input)
	require.Error(t, err)
	require.Contains(t, err.Error(), "repo_url")
}
```

**Step 2: Run test to verify it fails**

Run: `cd temporal-workflows && go test -v -run TestBuildActivities ./internal/activities/`
Expected: FAIL (types not defined)

**Step 3: Write the activities implementation**

```go
// temporal-workflows/internal/activities/build_activities.go
package activities

import (
	"context"
	"fmt"
	"log/slog"

	buildv1 "github.com/drewpayment/orbit/proto/gen/go/idp/build/v1"
	"github.com/drewpayment/orbit/temporal-workflows/internal/workflows"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// BuildServiceClient interface for build service operations
type BuildServiceClient interface {
	AnalyzeRepository(ctx context.Context, req *buildv1.AnalyzeRepositoryRequest) (*buildv1.AnalyzeRepositoryResponse, error)
	BuildImage(ctx context.Context, req *buildv1.BuildImageRequest) (*buildv1.BuildImageResponse, error)
}

// PayloadBuildClient interface for Payload CMS operations
type PayloadBuildClient interface {
	UpdateAppBuildStatus(ctx context.Context, appID string, status string, imageURL string, imageDigest string, errorMsg string, buildConfig *workflows.DetectedBuildConfig) error
	GetGitHubInstallationToken(ctx context.Context, workspaceID string) (string, error)
	GetRegistryConfig(ctx context.Context, registryID string) (*RegistryConfigData, error)
}

// RegistryConfigData represents registry configuration from Payload
type RegistryConfigData struct {
	Type           string `json:"type"`
	GHCROwner      string `json:"ghcrOwner"`
	ACRLoginServer string `json:"acrLoginServer"`
	ACRUsername    string `json:"acrUsername"`
	ACRToken       string `json:"acrToken"`
}

// BuildActivities holds dependencies for build activities
type BuildActivities struct {
	payloadClient    PayloadBuildClient
	buildServiceAddr string
	logger           *slog.Logger
}

// NewBuildActivities creates a new BuildActivities instance
func NewBuildActivities(payloadClient PayloadBuildClient, logger *slog.Logger) *BuildActivities {
	if logger == nil {
		logger = slog.Default()
	}
	return &BuildActivities{
		payloadClient:    payloadClient,
		buildServiceAddr: "localhost:50053", // TODO: Make configurable
		logger:           logger,
	}
}

// AnalyzeRepositoryInput for the analyze activity
type AnalyzeRepositoryInput = workflows.AnalyzeRepositoryInput

// AnalyzeRepositoryResult from the analyze activity
type AnalyzeRepositoryResult = workflows.AnalyzeRepositoryResult

// AnalyzeRepository calls the build service to analyze a repository
func (a *BuildActivities) AnalyzeRepository(ctx context.Context, input AnalyzeRepositoryInput) (*AnalyzeRepositoryResult, error) {
	a.logger.Info("AnalyzeRepository activity started", "repoURL", input.RepoURL)

	if input.RepoURL == "" {
		return nil, fmt.Errorf("repo_url is required")
	}

	// Connect to build service
	conn, err := grpc.DialContext(ctx, a.buildServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to build service: %w", err)
	}
	defer conn.Close()

	client := buildv1.NewBuildServiceClient(conn)

	// Call analyze
	resp, err := client.AnalyzeRepository(ctx, &buildv1.AnalyzeRepositoryRequest{
		RepoUrl:           input.RepoURL,
		Ref:               input.Ref,
		InstallationToken: input.InstallationToken,
	})
	if err != nil {
		return nil, fmt.Errorf("analyze failed: %w", err)
	}

	result := &AnalyzeRepositoryResult{
		Detected: resp.Detected,
		Error:    resp.Error,
	}

	if resp.Config != nil {
		result.Language = resp.Config.Language
		result.LanguageVersion = resp.Config.LanguageVersion
		result.Framework = resp.Config.Framework
		result.BuildCommand = resp.Config.BuildCommand
		result.StartCommand = resp.Config.StartCommand
	}

	return result, nil
}

// BuildAndPushInput for the build activity
type BuildAndPushInput = workflows.BuildAndPushInput

// BuildAndPushResult from the build activity
type BuildAndPushResult = workflows.BuildAndPushResult

// BuildAndPushImage calls the build service to build and push an image
func (a *BuildActivities) BuildAndPushImage(ctx context.Context, input BuildAndPushInput) (*BuildAndPushResult, error) {
	a.logger.Info("BuildAndPushImage activity started",
		"requestID", input.RequestID,
		"appID", input.AppID,
		"repoURL", input.RepoURL)

	// Connect to build service
	conn, err := grpc.DialContext(ctx, a.buildServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to build service: %w", err)
	}
	defer conn.Close()

	client := buildv1.NewBuildServiceClient(conn)

	// Convert registry type
	var registryType buildv1.RegistryType
	switch input.Registry.Type {
	case "ghcr":
		registryType = buildv1.RegistryType_REGISTRY_TYPE_GHCR
	case "acr":
		registryType = buildv1.RegistryType_REGISTRY_TYPE_ACR
	}

	// Build request
	req := &buildv1.BuildImageRequest{
		RequestId:         input.RequestID,
		AppId:             input.AppID,
		RepoUrl:           input.RepoURL,
		Ref:               input.Ref,
		InstallationToken: input.InstallationToken,
		BuildEnv:          input.BuildEnv,
		ImageTag:          input.ImageTag,
		Registry: &buildv1.RegistryConfig{
			Type:       registryType,
			Url:        input.Registry.URL,
			Repository: input.Registry.Repository,
			Token:      input.Registry.Token,
		},
	}

	// Set optional overrides
	if input.LanguageVersion != "" {
		req.LanguageVersion = &input.LanguageVersion
	}
	if input.BuildCommand != "" {
		req.BuildCommand = &input.BuildCommand
	}
	if input.StartCommand != "" {
		req.StartCommand = &input.StartCommand
	}
	if input.Registry.Username != "" {
		req.Registry.Username = &input.Registry.Username
	}

	// Call build
	resp, err := client.BuildImage(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("build failed: %w", err)
	}

	return &BuildAndPushResult{
		Success:     resp.Success,
		ImageURL:    resp.ImageUrl,
		ImageDigest: resp.ImageDigest,
		Error:       resp.Error,
	}, nil
}

// UpdateBuildStatusInput for the status update activity
type UpdateBuildStatusInput = workflows.UpdateBuildStatusInput

// UpdateBuildStatus updates the app's build status in Payload
func (a *BuildActivities) UpdateBuildStatus(ctx context.Context, input UpdateBuildStatusInput) error {
	a.logger.Info("UpdateBuildStatus activity",
		"appID", input.AppID,
		"status", input.Status)

	if a.payloadClient == nil {
		a.logger.Warn("No Payload client configured, skipping status update")
		return nil
	}

	return a.payloadClient.UpdateAppBuildStatus(
		ctx,
		input.AppID,
		input.Status,
		input.ImageURL,
		input.ImageDigest,
		input.Error,
		input.BuildConfig,
	)
}
```

**Step 4: Run test to verify it passes**

Run: `cd temporal-workflows && go test -v -run TestBuildActivities ./internal/activities/`
Expected: PASS

**Step 5: Commit**

```bash
git add temporal-workflows/internal/activities/build_activities.go temporal-workflows/internal/activities/build_activities_test.go
git commit -m "feat(build): add build activities for Temporal workflow"
```

---

### Task 11: Register Build Workflow in Worker

**Files:**
- Modify: `temporal-workflows/cmd/worker/main.go`

**Step 1: Add build workflow and activities registration**

Add to imports:
```go
// Build activities already use the same package
```

Add after deployment activities registration:
```go
// Build service address
buildServiceAddr := os.Getenv("BUILD_SERVICE_ADDRESS")
if buildServiceAddr == "" {
	buildServiceAddr = "localhost:50053"
}

// Register build workflow
w.RegisterWorkflow(workflows.BuildWorkflow)

// Create and register build activities
// TODO: Create PayloadBuildClient when implementing full integration
var buildPayloadClient activities.PayloadBuildClient = nil
buildActivities := activities.NewBuildActivities(
	buildPayloadClient,
	logger,
)
w.RegisterActivity(buildActivities.AnalyzeRepository)
w.RegisterActivity(buildActivities.BuildAndPushImage)
w.RegisterActivity(buildActivities.UpdateBuildStatus)

log.Printf("Build service address: %s", buildServiceAddr)
```

**Step 2: Verify build**

Run: `cd temporal-workflows && go build ./cmd/worker/`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add temporal-workflows/cmd/worker/main.go
git commit -m "feat(build): register BuildWorkflow in Temporal worker"
```

---

## Phase 5: Frontend Implementation

### Task 12: Create Build Server Actions

**Files:**
- Create: `orbit-www/src/app/actions/builds.ts`

**Step 1: Create the server actions**

```typescript
// orbit-www/src/app/actions/builds.ts
'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'

interface StartBuildInput {
  appId: string
  // Optional overrides
  languageVersion?: string
  buildCommand?: string
  startCommand?: string
  buildEnv?: Record<string, string>
  imageTag?: string
}

export async function startBuild(input: StartBuildInput) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  // Get app with workspace info
  const app = await payload.findByID({
    collection: 'apps',
    id: input.appId,
    depth: 2,
  })

  if (!app) {
    return { success: false, error: 'App not found' }
  }

  // Check workspace membership
  const workspaceId = typeof app.workspace === 'string'
    ? app.workspace
    : app.workspace.id

  const members = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { user: { equals: session.user.id } },
        { status: { equals: 'active' } },
      ],
    },
  })

  if (members.docs.length === 0) {
    return { success: false, error: 'Not a member of this workspace' }
  }

  // Check if app has repository configured
  if (!app.repository?.url) {
    return { success: false, error: 'App has no repository configured' }
  }

  // Get registry config (app-specific or workspace default)
  let registryConfig = null
  if (app.registryConfig) {
    registryConfig = typeof app.registryConfig === 'string'
      ? await payload.findByID({ collection: 'registry-configs', id: app.registryConfig })
      : app.registryConfig
  } else {
    // Find workspace default
    const defaults = await payload.find({
      collection: 'registry-configs',
      where: {
        and: [
          { workspace: { equals: workspaceId } },
          { isDefault: { equals: true } },
        ],
      },
      limit: 1,
    })
    if (defaults.docs.length > 0) {
      registryConfig = defaults.docs[0]
    }
  }

  if (!registryConfig) {
    return {
      success: false,
      error: 'No container registry configured. Please configure a registry in workspace settings.'
    }
  }

  try {
    // Update app build status to analyzing
    await payload.update({
      collection: 'apps',
      id: input.appId,
      data: {
        latestBuild: {
          status: 'analyzing',
          builtAt: null,
          builtBy: session.user.id,
          imageUrl: null,
          imageDigest: null,
          imageTag: null,
          buildWorkflowId: null,
          error: null,
        },
      },
    })

    // TODO: Start Temporal workflow via gRPC
    // For now, return success with placeholder workflow ID
    const workflowId = `build-${input.appId}-${Date.now()}`

    // Update with workflow ID
    await payload.update({
      collection: 'apps',
      id: input.appId,
      data: {
        latestBuild: {
          buildWorkflowId: workflowId,
        },
      },
    })

    return { success: true, workflowId }
  } catch (error) {
    console.error('Failed to start build:', error)
    return { success: false, error: 'Failed to start build' }
  }
}

export async function getBuildStatus(appId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return null
  }

  const payload = await getPayload({ config })

  const app = await payload.findByID({
    collection: 'apps',
    id: appId,
    depth: 1,
  })

  if (!app) {
    return null
  }

  return {
    status: app.latestBuild?.status || 'none',
    imageUrl: app.latestBuild?.imageUrl,
    imageDigest: app.latestBuild?.imageDigest,
    imageTag: app.latestBuild?.imageTag,
    builtAt: app.latestBuild?.builtAt,
    workflowId: app.latestBuild?.buildWorkflowId,
    error: app.latestBuild?.error,
    buildConfig: app.buildConfig,
  }
}

export async function analyzeRepository(appId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  const app = await payload.findByID({
    collection: 'apps',
    id: appId,
    depth: 1,
  })

  if (!app || !app.repository?.url) {
    return { success: false, error: 'App or repository not found' }
  }

  // TODO: Call build service AnalyzeRepository RPC
  // For now, return mock data
  return {
    success: true,
    detected: true,
    config: {
      language: 'nodejs',
      languageVersion: '22',
      framework: 'nextjs',
      buildCommand: 'npm run build',
      startCommand: 'npm start',
    },
  }
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/app/actions/builds.ts
git commit -m "feat(build): add build server actions"
```

---

### Task 13: Create Build Section Component

**Files:**
- Create: `orbit-www/src/components/features/apps/BuildSection.tsx`

**Step 1: Create the build section component**

```typescript
// orbit-www/src/components/features/apps/BuildSection.tsx
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, Play, RefreshCw, AlertCircle, CheckCircle2, Package } from 'lucide-react'
import { startBuild, getBuildStatus, analyzeRepository } from '@/app/actions/builds'
import { formatDistanceToNow } from 'date-fns'

interface BuildSectionProps {
  appId: string
  appName: string
  hasRepository: boolean
  hasRegistryConfig: boolean
}

type BuildStatus = 'none' | 'analyzing' | 'building' | 'success' | 'failed'

interface BuildInfo {
  status: BuildStatus
  imageUrl?: string
  imageDigest?: string
  imageTag?: string
  builtAt?: string
  workflowId?: string
  error?: string
  buildConfig?: {
    language?: string
    languageVersion?: string
    framework?: string
    buildCommand?: string
    startCommand?: string
  }
}

export function BuildSection({ appId, appName, hasRepository, hasRegistryConfig }: BuildSectionProps) {
  const router = useRouter()
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isStarting, setIsStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch initial build status
  useEffect(() => {
    async function fetchStatus() {
      const status = await getBuildStatus(appId)
      setBuildInfo(status)
      setIsLoading(false)
    }
    fetchStatus()
  }, [appId])

  // Poll for status while building
  useEffect(() => {
    if (buildInfo?.status === 'analyzing' || buildInfo?.status === 'building') {
      const interval = setInterval(async () => {
        const status = await getBuildStatus(appId)
        setBuildInfo(status)
        if (status?.status === 'success' || status?.status === 'failed') {
          router.refresh()
        }
      }, 3000)
      return () => clearInterval(interval)
    }
  }, [appId, buildInfo?.status, router])

  const handleStartBuild = async () => {
    setIsStarting(true)
    setError(null)

    const result = await startBuild({ appId })

    if (result.success) {
      setBuildInfo(prev => ({
        ...prev,
        status: 'analyzing',
        workflowId: result.workflowId,
      }))
    } else {
      setError(result.error || 'Failed to start build')
    }

    setIsStarting(false)
  }

  const getStatusBadge = (status: BuildStatus) => {
    switch (status) {
      case 'none':
        return <Badge variant="secondary">Never Built</Badge>
      case 'analyzing':
        return <Badge variant="default" className="bg-blue-500">Analyzing...</Badge>
      case 'building':
        return <Badge variant="default" className="bg-blue-500">Building...</Badge>
      case 'success':
        return <Badge variant="default" className="bg-green-500">Success</Badge>
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Container Image
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        </CardContent>
      </Card>
    )
  }

  // No repository configured
  if (!hasRepository) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Container Image
          </CardTitle>
          <CardDescription>
            Build container images from your source code
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-muted-foreground">
            <AlertCircle className="h-4 w-4" />
            <span>Configure a repository to enable builds</span>
          </div>
        </CardContent>
      </Card>
    )
  }

  // No registry configured
  if (!hasRegistryConfig) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Container Image
          </CardTitle>
          <CardDescription>
            Build container images from your source code
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <AlertCircle className="h-4 w-4" />
              <span>Configure a container registry to enable builds</span>
            </div>
            <Button variant="outline" size="sm" onClick={() => router.push('/settings/registries')}>
              Configure Registry
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  const isBuilding = buildInfo?.status === 'analyzing' || buildInfo?.status === 'building'

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Container Image
          </CardTitle>
          <CardDescription>
            Build container images from your source code using Railpack
          </CardDescription>
        </div>
        <Button
          onClick={handleStartBuild}
          disabled={isStarting || isBuilding}
          size="sm"
        >
          {isStarting || isBuilding ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {buildInfo?.status === 'analyzing' ? 'Analyzing...' : 'Building...'}
            </>
          ) : buildInfo?.status === 'success' ? (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              Rebuild
            </>
          ) : (
            <>
              <Play className="mr-2 h-4 w-4" />
              Build Now
            </>
          )}
        </Button>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-4 flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Status Card */}
          <div className="rounded-lg border p-4">
            <div className="text-sm text-muted-foreground mb-1">Status</div>
            <div className="flex items-center gap-2">
              {getStatusBadge(buildInfo?.status || 'none')}
            </div>
          </div>

          {/* Latest Build Card */}
          <div className="rounded-lg border p-4">
            <div className="text-sm text-muted-foreground mb-1">Latest Build</div>
            {buildInfo?.imageUrl ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <code className="text-xs truncate max-w-[200px]">
                    {buildInfo.imageUrl}
                  </code>
                </div>
                {buildInfo.builtAt && (
                  <div className="text-xs text-muted-foreground">
                    Built {formatDistanceToNow(new Date(buildInfo.builtAt), { addSuffix: true })}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No builds yet</div>
            )}
          </div>

          {/* Build Config Card */}
          <div className="rounded-lg border p-4">
            <div className="text-sm text-muted-foreground mb-1">Build Config</div>
            {buildInfo?.buildConfig?.language ? (
              <div className="space-y-1 text-sm">
                <div>
                  <span className="text-muted-foreground">Language: </span>
                  {buildInfo.buildConfig.language}
                  {buildInfo.buildConfig.languageVersion && ` ${buildInfo.buildConfig.languageVersion}`}
                </div>
                {buildInfo.buildConfig.framework && (
                  <div>
                    <span className="text-muted-foreground">Framework: </span>
                    {buildInfo.buildConfig.framework}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Auto-detect on build</div>
            )}
          </div>
        </div>

        {/* Error details */}
        {buildInfo?.status === 'failed' && buildInfo.error && (
          <div className="mt-4 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-destructive mt-0.5" />
              <div>
                <div className="font-medium text-destructive">Build Failed</div>
                <div className="text-sm text-muted-foreground mt-1">{buildInfo.error}</div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/components/features/apps/BuildSection.tsx
git commit -m "feat(build): add BuildSection component for App detail page"
```

---

### Task 14: Integrate Build Section into App Detail

**Files:**
- Modify: `orbit-www/src/components/features/apps/AppDetail.tsx`

**Step 1: Import BuildSection**

Add to imports:
```typescript
import { BuildSection } from './BuildSection'
```

**Step 2: Add BuildSection to the component**

Add after the info cards section (Origin, Repository, Health Check) and before the Deployments section:

```typescript
{/* Build Section */}
<BuildSection
  appId={app.id}
  appName={app.name}
  hasRepository={!!app.repository?.url}
  hasRegistryConfig={!!app.registryConfig || hasWorkspaceDefaultRegistry}
/>
```

Note: You'll need to check if the workspace has a default registry. Add this logic to fetch that info.

**Step 3: Verify it renders**

Run: `cd orbit-www && bun run dev`
Navigate to an app detail page
Expected: Build Section appears between info cards and Deployments table

**Step 4: Commit**

```bash
git add orbit-www/src/components/features/apps/AppDetail.tsx
git commit -m "feat(build): integrate BuildSection into App detail page"
```

---

## Phase 6: Docker Compose & Infrastructure

### Task 15: Add build-service to Docker Compose

**Files:**
- Modify: `docker-compose.yml`

**Step 1: Add build-service definition**

Add after temporal-worker service:

```yaml
  build-service:
    build:
      context: ./services/build-service
      dockerfile: Dockerfile
    ports:
      - "50053:50053"
    environment:
      - BUILD_SERVICE_PORT=50053
      - BUILD_WORK_DIR=/tmp/orbit-builds
      - BUILDKIT_HOST=tcp://buildkit:1234
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - build-workdir:/tmp/orbit-builds
    depends_on:
      - buildkit
    networks:
      - orbit-network

  buildkit:
    image: moby/buildkit:latest
    privileged: true
    networks:
      - orbit-network
```

Add to volumes section:
```yaml
volumes:
  build-workdir:
```

**Step 2: Create Dockerfile for build-service**

Create `services/build-service/Dockerfile`:

```dockerfile
# services/build-service/Dockerfile
FROM golang:1.22-alpine AS builder

WORKDIR /app

# Install git for go mod download
RUN apk add --no-cache git

# Copy go mod files
COPY go.mod go.sum ./
COPY ../../proto ../proto

# Download dependencies
RUN go mod download

# Copy source code
COPY . .

# Build
RUN CGO_ENABLED=0 GOOS=linux go build -o /build-service ./cmd/server

# Runtime image
FROM alpine:3.19

# Install dependencies for building (git, docker CLI, railpack)
RUN apk add --no-cache git docker-cli curl bash

# Install Railpack
RUN curl -sSL https://railpack.com/install.sh | sh

WORKDIR /app

COPY --from=builder /build-service /app/build-service

EXPOSE 50053

CMD ["/app/build-service"]
```

**Step 3: Commit**

```bash
git add docker-compose.yml services/build-service/Dockerfile
git commit -m "feat(build): add build-service to Docker Compose with BuildKit"
```

---

## Phase 7: Verification

### Task 16: End-to-End Verification

**Step 1: Run all Go tests**

Run: `cd temporal-workflows && go test -v ./...`
Expected: All tests pass

Run: `cd services/build-service && go test -v ./...`
Expected: All tests pass

**Step 2: Verify builds compile**

Run: `cd temporal-workflows && go build ./cmd/worker/`
Expected: Build succeeds

Run: `cd services/build-service && go build ./cmd/server/`
Expected: Build succeeds

**Step 3: Start development environment**

Run: `make dev` or `docker-compose up -d`
Expected: All services start including build-service

**Step 4: Verify frontend**

Run: `cd orbit-www && bun run dev`
Navigate to an app with a repository
Expected: Build Section appears with "Build Now" button

**Step 5: Test build flow (manual)**

1. Configure a registry (GHCR or ACR) in workspace settings
2. Navigate to an app with a GitHub repository
3. Click "Build Now"
4. Verify status changes: analyzing → building → success/failed

**Step 6: Final commit**

```bash
git add -A
git commit -m "feat(build): complete Railpack build service implementation"
```

---

## Summary

This plan implements:

1. **Proto definitions** for BuildService (analyze, build, stream logs)
2. **RegistryConfigs collection** for GHCR and ACR credentials
3. **Apps collection extensions** for build config and latest build info
4. **build-service** Go service with Railpack analyzer and BuildKit builder
5. **BuildWorkflow** Temporal workflow orchestrating the build process
6. **Build activities** connecting Temporal to the build service
7. **Frontend components** for build UI in App detail page
8. **Docker Compose** configuration with BuildKit

### Future Enhancements (not in this plan)

- Webhook-triggered builds on git push
- Build caching for faster subsequent builds
- Build logs streaming UI
- Multiple image tags per build
- Build history and rollback
