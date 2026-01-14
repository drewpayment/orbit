# Multi-Package Manager Support Design

**Date**: 2025-12-06
**Status**: Design Complete
**Author**: Claude + Drew

## Overview

Extend the build service to support all Node.js package managers (npm, yarn, pnpm, bun) instead of hardcoding npm. When no lockfile or `packageManager` field is detected, the workflow pauses and prompts the user to select their preferred package manager.

## Goals

1. Support all 4 package managers: npm, yarn, pnpm, bun
2. Lean on Railpack's detection - don't duplicate logic
3. Pause workflow and ask user when package manager cannot be auto-detected
4. Validate package manager versions against supported ranges
5. Validate Node.js version from `engines.node`

## Architecture

### Detection Flow

```
Repository analyzed
    ↓
Check packageManager field in package.json
    ↓ (found)              ↓ (not found)
Validate version    →    Check lockfiles
    ↓                         ↓
Version OK?          Lockfile found?
    ↓ no                  ↓ no
Fail with error      Workflow pauses → awaiting_input status
    ↓ yes                 ↓
                    User selects PM in UI
                          ↓
                    Signal sent to workflow
                          ↓
Continue build with detected/selected package manager
```

### Lockfile Detection Priority

Matches Railpack's detection order:

| Lockfile | Package Manager |
|----------|-----------------|
| `pnpm-lock.yaml` | pnpm |
| `bun.lockb` / `bun.lock` | bun |
| `yarn.lock` | yarn |
| `package-lock.json` | npm |

### Version Validation

Supported version ranges (can be updated as Railpack/Corepack evolves):

| Package Manager | Supported Range |
|-----------------|-----------------|
| npm | >=7.0.0 |
| yarn | >=1.22.0 |
| pnpm | >=7.0.0 |
| bun | >=1.0.0 |

Node.js version from `engines.node` is also validated against Railpack's supported Node versions.

## Component Changes

### 1. Proto Schema

**File**: `proto/idp/build/v1/build.proto`

```protobuf
message DetectedBuildConfig {
  string language = 1;
  string language_version = 2;
  string framework = 3;
  string build_command = 4;      // Now optional - may be empty
  string start_command = 5;      // Now optional - may be empty
  PackageManagerInfo package_manager = 6;  // NEW
}

message PackageManagerInfo {
  bool detected = 1;             // true if lockfile or packageManager field found
  string name = 2;               // "npm", "yarn", "pnpm", "bun", or ""
  string source = 3;             // "lockfile", "packageManager", "engines", ""
  string lockfile = 4;           // e.g., "yarn.lock" if detected from lockfile
  string requested_version = 5;  // e.g., "10.2.0" from packageManager field
  bool version_supported = 6;    // true if we can fulfill this version
  string supported_range = 7;    // e.g., ">=8.0.0" - what we support
}

message BuildImageRequest {
  // ... existing fields ...
  string package_manager = 7;    // NEW: "npm", "yarn", "pnpm", "bun", or "" for auto
}
```

### 2. Analyzer (Build Service)

**File**: `services/build-service/internal/railpack/analyzer.go`

Changes:
- Remove all hardcoded `npm run build` / `npm start` commands
- Add `detectPackageManager()` function
- Add `validatePackageManagerVersion()` function
- Add `PackageManagerDetection` struct to `AnalyzeResult`

```go
type PackageManagerDetection struct {
    Detected         bool
    PackageManager   string  // "npm", "yarn", "pnpm", "bun", or ""
    Source           string  // "lockfile", "packageManager", "engines", ""
    Lockfile         string  // actual lockfile found
    RequestedVersion string  // version from packageManager field
    VersionSupported bool
    SupportedRange   string
}

var supportedVersions = map[string]string{
    "npm":  ">=7.0.0",
    "yarn": ">=1.22.0",
    "pnpm": ">=7.0.0",
    "bun":  ">=1.0.0",
}
```

### 3. Temporal Workflow

**File**: `temporal-workflows/internal/workflows/build_workflow.go`

New status and signal:
```go
const BuildStatusAwaitingInput = "awaiting_input"
const SignalPackageManagerSelected = "package_manager_selected"
const QueryBuildState = "build_state"

type BuildState struct {
    Status              string   `json:"status"`
    NeedsPackageManager bool     `json:"needsPackageManager"`
    AvailableChoices    []string `json:"availableChoices"`
    SelectedPM          string   `json:"selectedPM"`
}
```

Workflow logic:
1. Register query handler for `build_state`
2. After analyze, check `PackageManager.VersionSupported` - fail if false
3. Check `PackageManager.Detected` - if false:
   - Set status to `awaiting_input`
   - Update frontend status with available choices
   - Wait for `package_manager_selected` signal
4. Continue build with detected/selected package manager

### 4. Frontend

**Files**:
- `orbit-www/src/app/actions/builds.ts`
- `orbit-www/src/components/features/apps/BuildSection.tsx`

New server action:
```typescript
export async function selectPackageManager(
  workflowId: string,
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun'
): Promise<{ success: boolean; error?: string }>
```

Extended BuildStatus type:
```typescript
export interface BuildStatus {
  status: 'none' | 'analyzing' | 'awaiting_input' | 'building' | 'success' | 'failed';
  needsPackageManager?: boolean;
  availableChoices?: ('npm' | 'yarn' | 'pnpm' | 'bun')[];
  // ... existing fields ...
}
```

New UI component: `PackageManagerPrompt`
- Amber warning styling
- Shows when `status === 'awaiting_input' && needsPackageManager`
- Buttons for each package manager choice
- Calls `selectPackageManager` action on selection

### 5. Build Service - Railpack Integration

**File**: `services/build-service/internal/builder/builder.go`

Pass package manager to Railpack via environment variable:
```go
if req.PackageManager != "" {
    cmd.Env = append(cmd.Env, fmt.Sprintf("RAILPACK_PACKAGE_MANAGER=%s", req.PackageManager))
}
```

Updated error extraction to handle all package managers:
- npm ERR!
- yarn error / YN0
- ERR_PNPM
- bun error patterns

## Data Flow

### Happy Path (lockfile exists)

```
User clicks "Build Now"
    ↓
startBuild() server action
    ↓
Temporal workflow starts
    ↓
AnalyzeRepository activity
    ↓
Detects yarn.lock → PackageManager{Detected: true, Name: "yarn"}
    ↓
UpdateBuildStatus("building")
    ↓
BuildAndPushImage activity (Railpack auto-detects yarn)
    ↓
UpdateBuildStatus("success")
```

### User Input Path (no lockfile)

```
User clicks "Build Now"
    ↓
startBuild() server action
    ↓
Temporal workflow starts
    ↓
AnalyzeRepository activity
    ↓
No lockfile, no packageManager field → PackageManager{Detected: false}
    ↓
UpdateBuildStatus("awaiting_input", choices: ["npm", "yarn", "pnpm", "bun"])
    ↓
Workflow.Await(signal: "package_manager_selected")  ← PAUSED
    ↓
Frontend polls, sees awaiting_input, shows PackageManagerPrompt
    ↓
User clicks "pnpm"
    ↓
selectPackageManager("workflow-id", "pnpm") → Temporal signal
    ↓
Workflow receives signal, resumes
    ↓
BuildAndPushImage with RAILPACK_PACKAGE_MANAGER=pnpm
    ↓
UpdateBuildStatus("success")
```

### Version Validation Failure Path

```
AnalyzeRepository activity
    ↓
Detects packageManager: "npm@6.14.0"
    ↓
validateVersion("npm", "6.14.0") → false (requires >=7.0.0)
    ↓
Workflow fails immediately
    ↓
UpdateBuildStatus("failed", error: "Package manager version not supported:
    npm@6.14.0 requested, but only npm >=7.0.0 is supported.
    Please update your package.json packageManager field.")
```

## Testing Strategy

### Unit Tests

**Analyzer tests** (`services/build-service/internal/railpack/analyzer_test.go`):
- Detect npm from package-lock.json
- Detect yarn from yarn.lock
- Detect pnpm from pnpm-lock.yaml
- Detect bun from bun.lockb
- Detect from packageManager field
- No detection when no lockfile or packageManager
- Version validation: supported versions pass
- Version validation: unsupported versions fail with correct error

**Workflow tests** (Temporal test framework):
- Signal handler receives package manager selection
- Query handler returns correct state
- Workflow pauses on awaiting_input
- Workflow resumes after signal

### Integration Tests

- End-to-end build with each package manager
- User selection flow (no lockfile → prompt → select → build succeeds)
- Version validation failure shows correct error in UI

## Error Messages

| Scenario | Error Message |
|----------|---------------|
| Unsupported npm version | "Package manager version not supported: npm@6.14.0 requested, but only npm >=7.0.0 is supported. Please update your package.json packageManager field." |
| Unsupported Node version | "Node.js version not supported: 14.0.0 requested, but only >=18.0.0 is supported." |
| npm install fails | "npm install failed: [specific error]" |
| yarn install fails | "yarn install failed: [specific error]" |
| pnpm install fails | "pnpm install failed: [specific error]" |
| bun install fails | "bun install failed: [specific error]" |

## Files to Modify

| File | Changes |
|------|---------|
| `proto/idp/build/v1/build.proto` | Add PackageManagerInfo message, update DetectedBuildConfig and BuildImageRequest |
| `services/build-service/internal/railpack/analyzer.go` | Add package manager detection, remove hardcoded npm commands |
| `services/build-service/internal/railpack/analyzer_test.go` | Add tests for all package managers |
| `services/build-service/internal/builder/builder.go` | Pass package manager to Railpack, update error extraction |
| `temporal-workflows/internal/workflows/build_workflow.go` | Add signal/query handlers, awaiting_input status |
| `temporal-workflows/internal/activities/build_activities.go` | Pass package manager through to build service |
| `temporal-workflows/pkg/types/build_types.go` | Add BuildState type |
| `orbit-www/src/app/actions/builds.ts` | Add selectPackageManager action |
| `orbit-www/src/components/features/apps/BuildSection.tsx` | Add PackageManagerPrompt component |
| `orbit-www/src/collections/Apps.ts` | Update latestBuild status enum to include awaiting_input |

## References

- [Railpack Node.js Documentation](https://railpack.com/languages/node/) - Package manager detection priority
- `.agent/SOPs/container-image-builds.md` - Build service architecture
- `docs/plans/2025-12-04-railpack-build-service.md` - Original build service implementation
