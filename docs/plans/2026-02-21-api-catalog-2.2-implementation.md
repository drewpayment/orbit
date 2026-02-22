# API Catalog Integration (Phase 2.2) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the API Catalog with Scalar doc rendering, Temporal-based auto-discovery from repos, AsyncAPI support, and deprecation workflow.

**Architecture:** Scalar replaces Swagger UI for spec rendering. A long-running `RepositorySpecSyncWorkflow` per repo handles auto-discovery via signals. AsyncAPI added as a second schema type. Deprecation workflow adds status transitions with UI feedback.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, shadcn/ui, Payload CMS, Temporal (Go), `@scalar/api-reference-react`

**Design:** `docs/plans/2026-02-21-api-catalog-2.2-design.md`

---

## Task 1: Replace Swagger UI with Scalar

**Files:**
- Modify: `orbit-www/src/components/features/api-catalog/SwaggerUIViewer.tsx` (rename to APISpecViewer)
- Modify: `orbit-www/src/app/(frontend)/catalog/apis/[id]/api-detail-client.tsx`
- Modify: `orbit-www/package.json`

**Step 1: Install Scalar, remove Swagger UI**

Run:
```bash
cd orbit-www && pnpm add @scalar/api-reference-react && pnpm remove swagger-ui-react @types/swagger-ui-react
```

**Step 2: Rewrite SwaggerUIViewer as APISpecViewer**

Replace contents of `orbit-www/src/components/features/api-catalog/SwaggerUIViewer.tsx`:

```tsx
'use client'

import React from 'react'
import dynamic from 'next/dynamic'
import { Loader2, AlertCircle } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { parse as parseYaml } from 'yaml'

const ApiReferenceReact = dynamic(
  () => import('@scalar/api-reference-react').then((mod) => mod.ApiReferenceReact),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading API documentation...</span>
      </div>
    ),
  }
)

interface APISpecViewerProps {
  /** OpenAPI or AsyncAPI spec content (YAML or JSON string) */
  spec: string
  /** Optional version label to display */
  version?: string
  /** Additional class names */
  className?: string
}

function parseSpec(content: string): { spec: Record<string, unknown> | null; error: string | null } {
  if (!content?.trim()) {
    return { spec: null, error: 'No specification content provided' }
  }

  try {
    return { spec: JSON.parse(content), error: null }
  } catch {
    try {
      const parsed = parseYaml(content)
      if (!parsed || typeof parsed !== 'object') {
        return { spec: null, error: 'Invalid specification format' }
      }
      return { spec: parsed as Record<string, unknown>, error: null }
    } catch (yamlError) {
      return {
        spec: null,
        error: `Failed to parse specification: ${yamlError instanceof Error ? yamlError.message : 'Unknown error'}`,
      }
    }
  }
}

export function APISpecViewer({ spec, version, className }: APISpecViewerProps) {
  const { spec: parsedSpec, error } = React.useMemo(() => parseSpec(spec), [spec])

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          <div className="font-semibold">Failed to load API documentation</div>
          <p className="text-sm mt-1">{error}</p>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className={className}>
      {version && (
        <div className="mb-4 text-sm text-muted-foreground">
          Viewing version: <span className="font-medium">{version}</span>
        </div>
      )}
      <ApiReferenceReact
        configuration={{
          content: parsedSpec,
          hideTestRequestButton: true,
          hideClientButton: true,
          darkMode: true,
          layout: 'classic',
          hideDarkModeToggle: true,
        }}
      />
    </div>
  )
}

/** @deprecated Use APISpecViewer instead */
export const SwaggerUIViewer = APISpecViewer
```

**Step 3: Update api-detail-client.tsx imports**

In `orbit-www/src/app/(frontend)/catalog/apis/[id]/api-detail-client.tsx`:

- Change import from `import { SwaggerUIViewer } from '@/components/features/api-catalog/SwaggerUIViewer'`
  to `import { APISpecViewer } from '@/components/features/api-catalog/SwaggerUIViewer'`
- Replace `<SwaggerUIViewer` with `<APISpecViewer` (two references to update: the component usage)
- Update the CardDescription text from `"Interactive documentation generated from the OpenAPI specification"` to `"Interactive documentation generated from the API specification"`

**Step 4: Verify build**

Run: `cd orbit-www && pnpm tsc --noEmit`
Expected: No type errors

**Step 5: Commit**

```bash
git add orbit-www/src/components/features/api-catalog/SwaggerUIViewer.tsx
git add orbit-www/src/app/(frontend)/catalog/apis/[id]/api-detail-client.tsx
git add orbit-www/package.json orbit-www/pnpm-lock.yaml
git commit -m "feat(api-catalog): replace Swagger UI with Scalar for API doc rendering"
```

---

## Task 2: Add AsyncAPI Schema Type Support

**Files:**
- Modify: `orbit-www/src/collections/api-catalog/APISchemas.ts`
- Modify: `orbit-www/src/lib/schema-validators.ts`
- Modify: `orbit-www/src/types/api-catalog.ts`
- Modify: `orbit-www/src/components/features/api-catalog/wizard/SchemaContentStep.tsx`

**Step 1: Add AsyncAPI validator**

In `orbit-www/src/lib/schema-validators.ts`, add after the `validateOpenAPI` function:

```typescript
export function validateAsyncAPI(content: string): ValidationResult {
  const errors: ValidationError[] = []

  if (!content.trim()) {
    return { valid: false, errors: [{ message: 'Content is empty' }] }
  }

  // Try JSON parse first
  let parsed: Record<string, unknown> | null = null
  try {
    parsed = JSON.parse(content)
  } catch {
    // Try basic YAML detection
    const lines = content.split('\n')
    const hasAsyncapi = lines.some((l) => l.trim().startsWith('asyncapi:'))
    const hasInfo = lines.some((l) => l.trim().startsWith('info:'))
    const hasChannels = lines.some((l) => l.trim().startsWith('channels:'))

    if (!hasAsyncapi) {
      errors.push({ message: 'Missing "asyncapi" field. Expected an AsyncAPI specification.' })
    }
    if (!hasInfo) {
      errors.push({ message: 'Missing "info" section.' })
    }
    if (!hasChannels) {
      errors.push({ message: 'Missing "channels" section.' })
    }

    return { valid: errors.length === 0, errors }
  }

  if (parsed) {
    if (!parsed.asyncapi) {
      errors.push({ message: 'Missing "asyncapi" field. Expected an AsyncAPI specification.' })
    }
    if (!parsed.info) {
      errors.push({ message: 'Missing "info" section.' })
    }
    if (!parsed.channels) {
      errors.push({ message: 'Missing "channels" section.' })
    }
  }

  return { valid: errors.length === 0, errors }
}
```

Also update the `validateSchema` dispatch function to handle `'asyncapi'`:

```typescript
// Add to the switch/if-else in validateSchema:
// If it currently only handles SchemaType enum from proto, add a string-based branch:
export function validateSchemaByType(schemaType: 'openapi' | 'asyncapi', content: string): ValidationResult {
  switch (schemaType) {
    case 'openapi':
      return validateOpenAPI(content)
    case 'asyncapi':
      return validateAsyncAPI(content)
    default:
      return { valid: false, errors: [{ message: `Unsupported schema type: ${schemaType}` }] }
  }
}
```

**Step 2: Update APISchemas collection**

In `orbit-www/src/collections/api-catalog/APISchemas.ts`, find the `schemaType` field and change:

```typescript
options: [
  { label: 'OpenAPI', value: 'openapi' },
]
```

to:

```typescript
options: [
  { label: 'OpenAPI', value: 'openapi' },
  { label: 'AsyncAPI', value: 'asyncapi' },
]
```

Also update the `beforeValidate` hook to handle AsyncAPI specs. Find where it parses `rawContent` to extract metadata. After the OpenAPI parsing block, add AsyncAPI detection:

```typescript
// Detect spec type and extract metadata
const isAsyncAPI = typeof parsed === 'object' && parsed !== null && 'asyncapi' in parsed
const isOpenAPI = typeof parsed === 'object' && parsed !== null && ('openapi' in parsed || 'swagger' in parsed)

if (isAsyncAPI) {
  const asyncSpec = parsed as Record<string, unknown>
  const info = asyncSpec.info as Record<string, unknown> | undefined
  if (info) {
    data.specTitle = (info.title as string) || data.specTitle
    data.specDescription = (info.description as string) || data.specDescription
    data.currentVersion = (info.version as string) || data.currentVersion
    const contact = info.contact as Record<string, unknown> | undefined
    if (contact) {
      data.contactName = (contact.name as string) || data.contactName
      data.contactEmail = (contact.email as string) || data.contactEmail
    }
  }
  // Count channels instead of endpoints
  const channels = asyncSpec.channels as Record<string, unknown> | undefined
  if (channels) {
    data.endpointCount = Object.keys(channels).length
  }
} else if (isOpenAPI) {
  // ... existing OpenAPI extraction logic
}
```

**Step 3: Update type definition**

In `orbit-www/src/types/api-catalog.ts`, change:

```typescript
schemaType: 'openapi'
```

to:

```typescript
schemaType: 'openapi' | 'asyncapi'
```

**Step 4: Add AsyncAPI template to wizard**

In `orbit-www/src/components/features/api-catalog/wizard/SchemaContentStep.tsx`:

Add the AsyncAPI template constant after `OPENAPI_TEMPLATE`:

```typescript
const ASYNCAPI_TEMPLATE = `asyncapi: 2.6.0
info:
  title: My Event API
  version: 1.0.0
  description: Describe your event-driven API here

channels:
  user.signup:
    description: User signup events
    subscribe:
      summary: Receive user signup events
      message:
        payload:
          type: object
          properties:
            userId:
              type: string
            email:
              type: string
            timestamp:
              type: string
              format: date-time
`
```

Update the template buttons area to show both options. Replace the single "Use Template" button with:

```tsx
<Button type="button" variant="outline" size="sm" onClick={handleUseTemplate}>
  <FileText className="mr-2 h-4 w-4" />
  OpenAPI Template
</Button>
<Button type="button" variant="outline" size="sm" onClick={() => form.setValue('rawContent', ASYNCAPI_TEMPLATE)}>
  <FileText className="mr-2 h-4 w-4" />
  AsyncAPI Template
</Button>
```

Update the validation in the `useEffect` to use `validateSchemaByType` instead of `validateOpenAPI`. This requires detecting the spec type from content:

```typescript
React.useEffect(() => {
  if (content) {
    // Auto-detect spec type from content
    const isAsyncAPI = content.includes('asyncapi:') || content.includes('"asyncapi"')
    const result = isAsyncAPI ? validateAsyncAPI(content) : validateOpenAPI(content)
    onValidationChange(result)
  } else {
    onValidationChange({ valid: false, errors: [{ message: 'Please provide an API specification' }] })
  }
}, [content, onValidationChange])
```

Update the imports to include `validateAsyncAPI`:

```typescript
import { validateOpenAPI, validateAsyncAPI, type ValidationResult } from '@/lib/schema-validators'
```

Update the CardTitle and CardDescription text:

- Title: `"API Specification"` (from `"OpenAPI Specification"`)
- Description: `"Paste your OpenAPI or AsyncAPI specification or upload a file. YAML and JSON formats are supported."` (from `"Paste your OpenAPI specification..."`)

**Step 5: Verify build**

Run: `cd orbit-www && pnpm tsc --noEmit`
Expected: No type errors

**Step 6: Commit**

```bash
git add orbit-www/src/lib/schema-validators.ts
git add orbit-www/src/collections/api-catalog/APISchemas.ts
git add orbit-www/src/types/api-catalog.ts
git add orbit-www/src/components/features/api-catalog/wizard/SchemaContentStep.tsx
git commit -m "feat(api-catalog): add AsyncAPI schema type support"
```

---

## Task 3: Deprecation Workflow

**Files:**
- Modify: `orbit-www/src/collections/api-catalog/APISchemas.ts`
- Modify: `orbit-www/src/app/(frontend)/catalog/apis/[id]/api-detail-client.tsx`
- Modify: `orbit-www/src/app/(frontend)/workspaces/[slug]/apis/actions.ts`
- Modify: `orbit-www/src/app/(frontend)/catalog/apis/catalog-client.tsx`

**Step 1: Add deprecationMessage field to APISchemas collection**

In `orbit-www/src/collections/api-catalog/APISchemas.ts`, add after the `status` field:

```typescript
{
  name: 'deprecationMessage',
  type: 'text',
  admin: {
    description: 'Reason for deprecation (shown to consumers)',
    condition: (data) => data?.status === 'deprecated',
  },
},
```

**Step 2: Add deprecationMessage to the type**

In `orbit-www/src/types/api-catalog.ts`, add to the `APISchema` interface:

```typescript
deprecationMessage?: string | null
```

**Step 3: Add deprecateAPISchema server action**

In `orbit-www/src/app/(frontend)/workspaces/[slug]/apis/actions.ts`, add:

```typescript
export async function deprecateAPISchema(
  id: string,
  message?: string,
): Promise<void> {
  const payload = await getPayload({ config })

  await payload.update({
    collection: 'api-schemas',
    id,
    data: {
      status: 'deprecated',
      deprecationMessage: message || null,
    },
  })
}
```

**Step 4: Add deprecation banner and button to api-detail-client.tsx**

In `orbit-www/src/app/(frontend)/catalog/apis/[id]/api-detail-client.tsx`:

Add import for the deprecate action:

```typescript
import { deleteAPISchema, deprecateAPISchema } from '@/app/(frontend)/workspaces/[slug]/apis/actions'
```

Add deprecation banner after the version viewing notice (around line 198), before the Tabs:

```tsx
{/* Deprecation banner */}
{status === 'deprecated' && (
  <div className="mb-4 p-4 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg">
    <div className="flex items-center gap-2 text-red-800 dark:text-red-200">
      <AlertCircle className="h-5 w-5" />
      <span className="font-semibold">This API has been deprecated</span>
    </div>
    {api.deprecationMessage && (
      <p className="mt-2 text-sm text-red-700 dark:text-red-300 ml-7">
        {api.deprecationMessage}
      </p>
    )}
  </div>
)}
```

Add `AlertCircle` to the lucide-react import (it's not currently imported in this file — check first, add if missing).

Add deprecate button in the `canEdit` actions section, before the delete AlertDialog:

```tsx
{status !== 'deprecated' && (
  <AlertDialog>
    <AlertDialogTrigger asChild>
      <Button variant="outline">Deprecate</Button>
    </AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Deprecate this API?</AlertDialogTitle>
        <AlertDialogDescription>
          This marks the API as deprecated. It will still be visible but consumers will be warned.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          onClick={async () => {
            try {
              await deprecateAPISchema(api.id)
              toast.success('API marked as deprecated')
              router.refresh()
            } catch {
              toast.error('Failed to deprecate API')
            }
          }}
        >
          Deprecate
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
)}
```

**Step 5: Hide deprecated APIs by default in catalog**

In `orbit-www/src/app/(frontend)/catalog/apis/catalog-client.tsx`, the status filter already has a "Deprecated" option. No change needed — deprecated APIs are already queryable. The `searchAPIs` action already handles the `deprecated` status filter.

**Step 6: Verify build**

Run: `cd orbit-www && pnpm tsc --noEmit`
Expected: No type errors

**Step 7: Commit**

```bash
git add orbit-www/src/collections/api-catalog/APISchemas.ts
git add orbit-www/src/types/api-catalog.ts
git add orbit-www/src/app/(frontend)/workspaces/[slug]/apis/actions.ts
git add orbit-www/src/app/(frontend)/catalog/apis/[id]/api-detail-client.tsx
git commit -m "feat(api-catalog): add deprecation workflow with banner and action"
```

---

## Task 4: Temporal Workflow — RepositorySpecSyncWorkflow

**Files:**
- Create: `temporal-workflows/internal/workflows/spec_sync_workflow.go`

**Step 1: Write the test**

Create `temporal-workflows/internal/workflows/spec_sync_workflow_test.go`:

```go
package workflows_test

import (
	"testing"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/testsuite"

	"github.com/drewpayment/orbit/temporal-workflows/internal/workflows"
)

func TestRepositorySpecSyncWorkflow_InitialScan(t *testing.T) {
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestWorkflowEnvironment()

	input := workflows.SpecSyncInput{
		AppID:          "app-123",
		RepoFullName:   "org/repo",
		InstallationID: "inst-456",
		WorkspaceID:    "ws-789",
	}

	// Mock ListRepoSpecFiles to return one OpenAPI file
	env.OnActivity(workflows.ActivityListRepoSpecFiles, mock.Anything, mock.Anything).Return(
		&workflows.ListSpecFilesResult{
			Files: []workflows.SpecFileInfo{
				{Path: "docs/openapi.yaml", SHA: "abc123"},
			},
		},
		nil,
	)

	// Mock FetchSpecContent
	env.OnActivity(workflows.ActivityFetchSpecContent, mock.Anything, mock.Anything).Return(
		&workflows.FetchSpecContentResult{
			Content: "openapi: 3.0.0\ninfo:\n  title: Test\n  version: 1.0.0\npaths: {}",
		},
		nil,
	)

	// Mock UpsertAPISchemaToCatalog
	env.OnActivity(workflows.ActivityUpsertAPISchema, mock.Anything, mock.Anything).Return(
		&workflows.UpsertSchemaResult{SchemaID: "schema-1", Action: "created"},
		nil,
	)

	env.ExecuteWorkflow(workflows.RepositorySpecSyncWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var result workflows.SpecSyncResult
	require.NoError(t, env.GetWorkflowResult(&result))
	require.Equal(t, "completed", result.Status)
	require.Equal(t, 1, result.SpecsFound)
}
```

**Step 2: Run test to verify it fails**

Run: `cd temporal-workflows && go test -v -race -run TestRepositorySpecSyncWorkflow ./internal/workflows/`
Expected: FAIL (types not defined)

**Step 3: Create the workflow**

Create `temporal-workflows/internal/workflows/spec_sync_workflow.go`:

```go
package workflows

import (
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// SpecSyncInput contains parameters for the spec sync workflow
type SpecSyncInput struct {
	AppID          string `json:"appId"`
	RepoFullName   string `json:"repoFullName"`
	InstallationID string `json:"installationId"`
	WorkspaceID    string `json:"workspaceId"`
}

// SpecSyncResult contains the workflow result
type SpecSyncResult struct {
	Status     string `json:"status"` // "completed", "failed"
	SpecsFound int    `json:"specsFound"`
	Error      string `json:"error,omitempty"`
}

// SpecSyncProgress tracks workflow progress for query handler
type SpecSyncProgress struct {
	CurrentStep string `json:"currentStep"`
	Message     string `json:"message"`
	SpecsFound  int    `json:"specsFound"`
}

// Signal names
const (
	SignalScanForSpecs = "ScanForSpecs"
	SignalWebhookPush  = "WebhookPush"
	SignalForceResync  = "ForceResync"
)

// WebhookPushSignal carries data from a GitHub push webhook
type WebhookPushSignal struct {
	ChangedPaths []string `json:"changedPaths"`
	CommitSHA    string   `json:"commitSha"`
}

// SpecFileInfo describes a discovered spec file
type SpecFileInfo struct {
	Path string `json:"path"`
	SHA  string `json:"sha"`
}

// Activity input/output types
type ListSpecFilesInput struct {
	RepoFullName   string `json:"repoFullName"`
	InstallationID string `json:"installationId"`
}

type ListSpecFilesResult struct {
	Files []SpecFileInfo `json:"files"`
}

type FetchSpecContentInput struct {
	RepoFullName   string `json:"repoFullName"`
	InstallationID string `json:"installationId"`
	FilePath       string `json:"filePath"`
	FileSHA        string `json:"fileSha"`
}

type FetchSpecContentResult struct {
	Content string `json:"content"`
}

type UpsertSchemaInput struct {
	AppID        string `json:"appId"`
	WorkspaceID  string `json:"workspaceId"`
	RepoFullName string `json:"repoFullName"`
	FilePath     string `json:"filePath"`
	Content      string `json:"content"`
	ContentSHA   string `json:"contentSha"`
}

type UpsertSchemaResult struct {
	SchemaID string `json:"schemaId"`
	Action   string `json:"action"` // "created", "updated", "unchanged"
}

type RemoveOrphanedSpecsInput struct {
	AppID        string   `json:"appId"`
	ActivePaths  []string `json:"activePaths"`
}

// Activity names
const (
	ActivityListRepoSpecFiles = "ListRepoSpecFiles"
	ActivityFetchSpecContent  = "FetchSpecContent"
	ActivityUpsertAPISchema   = "UpsertAPISchemaToCatalog"
	ActivityRemoveOrphanedSpecs = "RemoveOrphanedSpecs"
)

// RepositorySpecSyncWorkflow is a long-running workflow that discovers and syncs
// API specs from a repository into the Orbit API catalog.
func RepositorySpecSyncWorkflow(ctx workflow.Context, input SpecSyncInput) (*SpecSyncResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting spec sync workflow",
		"appID", input.AppID,
		"repo", input.RepoFullName)

	progress := SpecSyncProgress{
		CurrentStep: "initializing",
		Message:     "Starting spec sync",
	}

	err := workflow.SetQueryHandler(ctx, "progress", func() (SpecSyncProgress, error) {
		return progress, nil
	})
	if err != nil {
		return &SpecSyncResult{Status: "failed", Error: err.Error()}, err
	}

	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	// Perform initial scan
	result, scanErr := scanAndSync(ctx, input, &progress)
	if scanErr != nil {
		logger.Error("Initial scan failed", "error", scanErr)
	}

	// Long-running signal loop
	scanCh := workflow.GetSignalChannel(ctx, SignalScanForSpecs)
	pushCh := workflow.GetSignalChannel(ctx, SignalWebhookPush)
	resyncCh := workflow.GetSignalChannel(ctx, SignalForceResync)

	for {
		progress.CurrentStep = "waiting"
		progress.Message = "Waiting for signals"

		selector := workflow.NewSelector(ctx)

		selector.AddReceive(scanCh, func(c workflow.ReceiveChannel, more bool) {
			var signal struct{}
			c.Receive(ctx, &signal)
			logger.Info("Received ScanForSpecs signal")
			result, _ = scanAndSync(ctx, input, &progress)
		})

		selector.AddReceive(pushCh, func(c workflow.ReceiveChannel, more bool) {
			var signal WebhookPushSignal
			c.Receive(ctx, &signal)
			logger.Info("Received WebhookPush signal", "changedPaths", signal.ChangedPaths)
			result, _ = scanAndSync(ctx, input, &progress)
		})

		selector.AddReceive(resyncCh, func(c workflow.ReceiveChannel, more bool) {
			var signal struct{}
			c.Receive(ctx, &signal)
			logger.Info("Received ForceResync signal")
			result, _ = scanAndSync(ctx, input, &progress)
		})

		selector.Select(ctx)

		// Check for cancellation
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
	}
}

// scanAndSync performs the actual scan and sync logic
func scanAndSync(ctx workflow.Context, input SpecSyncInput, progress *SpecSyncProgress) (*SpecSyncResult, error) {
	logger := workflow.GetLogger(ctx)

	// Step 1: List spec files in repo
	progress.CurrentStep = "scanning"
	progress.Message = "Scanning repository for spec files"

	listInput := ListSpecFilesInput{
		RepoFullName:   input.RepoFullName,
		InstallationID: input.InstallationID,
	}
	var listResult ListSpecFilesResult
	err := workflow.ExecuteActivity(ctx, ActivityListRepoSpecFiles, listInput).Get(ctx, &listResult)
	if err != nil {
		logger.Error("Failed to list spec files", "error", err)
		return &SpecSyncResult{Status: "failed", Error: err.Error()}, err
	}

	progress.SpecsFound = len(listResult.Files)
	logger.Info("Found spec files", "count", len(listResult.Files))

	if len(listResult.Files) == 0 {
		progress.CurrentStep = "completed"
		progress.Message = "No spec files found"
		return &SpecSyncResult{Status: "completed", SpecsFound: 0}, nil
	}

	// Step 2: Fetch and upsert each spec
	activePaths := make([]string, 0, len(listResult.Files))

	for i, file := range listResult.Files {
		progress.CurrentStep = "syncing"
		progress.Message = "Syncing " + file.Path

		// Fetch content
		fetchInput := FetchSpecContentInput{
			RepoFullName:   input.RepoFullName,
			InstallationID: input.InstallationID,
			FilePath:       file.Path,
			FileSHA:        file.SHA,
		}
		var fetchResult FetchSpecContentResult
		err := workflow.ExecuteActivity(ctx, ActivityFetchSpecContent, fetchInput).Get(ctx, &fetchResult)
		if err != nil {
			logger.Error("Failed to fetch spec content", "path", file.Path, "error", err)
			continue // Skip this file, try others
		}

		// Upsert to catalog
		upsertInput := UpsertSchemaInput{
			AppID:        input.AppID,
			WorkspaceID:  input.WorkspaceID,
			RepoFullName: input.RepoFullName,
			FilePath:     file.Path,
			Content:      fetchResult.Content,
			ContentSHA:   file.SHA,
		}
		var upsertResult UpsertSchemaResult
		err = workflow.ExecuteActivity(ctx, ActivityUpsertAPISchema, upsertInput).Get(ctx, &upsertResult)
		if err != nil {
			logger.Error("Failed to upsert schema", "path", file.Path, "error", err)
			continue
		}

		activePaths = append(activePaths, file.Path)
		logger.Info("Synced spec file",
			"path", file.Path,
			"action", upsertResult.Action,
			"schemaID", upsertResult.SchemaID,
			"progress", i+1, "total", len(listResult.Files))
	}

	// Step 3: Remove orphaned specs
	progress.CurrentStep = "cleaning up"
	progress.Message = "Removing orphaned spec entries"

	orphanInput := RemoveOrphanedSpecsInput{
		AppID:       input.AppID,
		ActivePaths: activePaths,
	}
	err = workflow.ExecuteActivity(ctx, ActivityRemoveOrphanedSpecs, orphanInput).Get(ctx, nil)
	if err != nil {
		logger.Error("Failed to remove orphaned specs", "error", err)
		// Non-fatal, continue
	}

	progress.CurrentStep = "completed"
	progress.Message = "Sync completed"

	return &SpecSyncResult{
		Status:     "completed",
		SpecsFound: len(listResult.Files),
	}, nil
}
```

**Step 4: Run test to verify it passes**

Run: `cd temporal-workflows && go test -v -race -run TestRepositorySpecSyncWorkflow ./internal/workflows/`
Expected: PASS

**Step 5: Commit**

```bash
git add temporal-workflows/internal/workflows/spec_sync_workflow.go
git add temporal-workflows/internal/workflows/spec_sync_workflow_test.go
git commit -m "feat(temporal): add RepositorySpecSyncWorkflow for API spec auto-discovery"
```

---

## Task 5: Temporal Activities — Spec Sync

**Files:**
- Create: `temporal-workflows/internal/activities/spec_sync_activities.go`
- Create: `temporal-workflows/internal/activities/spec_sync_activities_test.go`

**Step 1: Write the test**

Create `temporal-workflows/internal/activities/spec_sync_activities_test.go`:

```go
package activities_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
)

func TestSpecFilePatternMatching(t *testing.T) {
	tests := []struct {
		path    string
		matches bool
	}{
		{"openapi.yaml", true},
		{"openapi.yml", true},
		{"openapi.json", true},
		{"docs/openapi.yaml", true},
		{"api/v1/swagger.json", true},
		{"asyncapi.yaml", true},
		{"asyncapi.yml", true},
		{"events/asyncapi.json", true},
		{"README.md", false},
		{"src/main.go", false},
		{"package.json", false},
	}

	for _, tc := range tests {
		t.Run(tc.path, func(t *testing.T) {
			result := activities.IsSpecFile(tc.path)
			assert.Equal(t, tc.matches, result, "path: %s", tc.path)
		})
	}
}

func TestDetectSpecType(t *testing.T) {
	tests := []struct {
		name     string
		content  string
		expected string
	}{
		{"openapi yaml", "openapi: 3.0.0\ninfo:\n  title: Test", "openapi"},
		{"swagger json", `{"swagger": "2.0"}`, "openapi"},
		{"asyncapi yaml", "asyncapi: 2.6.0\ninfo:\n  title: Test", "asyncapi"},
		{"unknown", "some random content", "unknown"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := activities.DetectSpecType(tc.content)
			assert.Equal(t, tc.expected, result)
		})
	}
}
```

**Step 2: Run test to verify it fails**

Run: `cd temporal-workflows && go test -v -race -run TestSpecFile ./internal/activities/`
Expected: FAIL

**Step 3: Create the activities**

Create `temporal-workflows/internal/activities/spec_sync_activities.go`:

```go
package activities

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"path/filepath"
	"strings"

	"github.com/drewpayment/orbit/temporal-workflows/internal/workflows"
)

// specFilePatterns are the file names we look for (case-insensitive matching done separately)
var specFileNames = map[string]bool{
	"openapi.yaml":  true,
	"openapi.yml":   true,
	"openapi.json":  true,
	"swagger.yaml":  true,
	"swagger.yml":   true,
	"swagger.json":  true,
	"asyncapi.yaml": true,
	"asyncapi.yml":  true,
	"asyncapi.json": true,
}

// IsSpecFile checks if a file path matches known API spec file patterns
func IsSpecFile(path string) bool {
	base := strings.ToLower(filepath.Base(path))
	return specFileNames[base]
}

// DetectSpecType determines the spec type from file content
func DetectSpecType(content string) string {
	// Try JSON
	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(content), &parsed); err == nil {
		if _, ok := parsed["openapi"]; ok {
			return "openapi"
		}
		if _, ok := parsed["swagger"]; ok {
			return "openapi"
		}
		if _, ok := parsed["asyncapi"]; ok {
			return "asyncapi"
		}
	}

	// Try YAML (simple line-based detection)
	for _, line := range strings.Split(content, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "openapi:") || strings.HasPrefix(trimmed, "swagger:") {
			return "openapi"
		}
		if strings.HasPrefix(trimmed, "asyncapi:") {
			return "asyncapi"
		}
	}

	return "unknown"
}

// PayloadAPICatalogClient is the interface for interacting with Orbit's API catalog
type PayloadAPICatalogClient interface {
	UpsertAPISchema(ctx context.Context, input workflows.UpsertSchemaInput) (*workflows.UpsertSchemaResult, error)
	RemoveOrphanedSpecs(ctx context.Context, appID string, activePaths []string) error
}

// GitHubContentClient is the interface for reading files from GitHub
type GitHubContentClient interface {
	ListSpecFiles(ctx context.Context, repoFullName, installationID string) ([]workflows.SpecFileInfo, error)
	FetchFileContent(ctx context.Context, repoFullName, installationID, filePath string) (string, error)
}

// SpecSyncActivities contains the activity implementations for spec sync
type SpecSyncActivities struct {
	github  GitHubContentClient
	catalog PayloadAPICatalogClient
	logger  *slog.Logger
}

// NewSpecSyncActivities creates a new SpecSyncActivities
func NewSpecSyncActivities(
	github GitHubContentClient,
	catalog PayloadAPICatalogClient,
	logger *slog.Logger,
) *SpecSyncActivities {
	return &SpecSyncActivities{
		github:  github,
		catalog: catalog,
		logger:  logger,
	}
}

// ListRepoSpecFiles scans a GitHub repo for spec files matching known patterns
func (a *SpecSyncActivities) ListRepoSpecFiles(
	ctx context.Context,
	input workflows.ListSpecFilesInput,
) (*workflows.ListSpecFilesResult, error) {
	a.logger.Info("Listing spec files",
		"repo", input.RepoFullName,
		"installationID", input.InstallationID)

	files, err := a.github.ListSpecFiles(ctx, input.RepoFullName, input.InstallationID)
	if err != nil {
		return nil, fmt.Errorf("failed to list spec files: %w", err)
	}

	// Filter to only known spec file patterns
	var specFiles []workflows.SpecFileInfo
	for _, f := range files {
		if IsSpecFile(f.Path) {
			specFiles = append(specFiles, f)
		}
	}

	a.logger.Info("Found spec files", "count", len(specFiles), "repo", input.RepoFullName)

	return &workflows.ListSpecFilesResult{Files: specFiles}, nil
}

// FetchSpecContent downloads a spec file's content from GitHub
func (a *SpecSyncActivities) FetchSpecContent(
	ctx context.Context,
	input workflows.FetchSpecContentInput,
) (*workflows.FetchSpecContentResult, error) {
	a.logger.Info("Fetching spec content",
		"repo", input.RepoFullName,
		"path", input.FilePath)

	content, err := a.github.FetchFileContent(ctx, input.RepoFullName, input.InstallationID, input.FilePath)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch spec content: %w", err)
	}

	return &workflows.FetchSpecContentResult{Content: content}, nil
}

// UpsertAPISchemaToCatalog creates or updates an API schema in the catalog
func (a *SpecSyncActivities) UpsertAPISchemaToCatalog(
	ctx context.Context,
	input workflows.UpsertSchemaInput,
) (*workflows.UpsertSchemaResult, error) {
	a.logger.Info("Upserting API schema",
		"appID", input.AppID,
		"path", input.FilePath)

	result, err := a.catalog.UpsertAPISchema(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("failed to upsert schema: %w", err)
	}

	return result, nil
}

// RemoveOrphanedSpecs marks schemas as deprecated if their source files are gone
func (a *SpecSyncActivities) RemoveOrphanedSpecs(
	ctx context.Context,
	input workflows.RemoveOrphanedSpecsInput,
) error {
	a.logger.Info("Removing orphaned specs",
		"appID", input.AppID,
		"activePaths", input.ActivePaths)

	return a.catalog.RemoveOrphanedSpecs(ctx, input.AppID, input.ActivePaths)
}
```

**Step 4: Run tests**

Run: `cd temporal-workflows && go test -v -race -run TestSpecFile ./internal/activities/ && go test -v -race -run TestDetectSpecType ./internal/activities/`
Expected: PASS

**Step 5: Commit**

```bash
git add temporal-workflows/internal/activities/spec_sync_activities.go
git add temporal-workflows/internal/activities/spec_sync_activities_test.go
git commit -m "feat(temporal): add spec sync activities with GitHub integration"
```

---

## Task 6: Register Workflow and Activities in Worker

**Files:**
- Modify: `temporal-workflows/cmd/worker/main.go`

**Step 1: Register the workflow and activities**

In `temporal-workflows/cmd/worker/main.go`, add after the decommissioning activities registration block (around line 384):

```go
// =======================================================================
// API Spec Sync Activities
// =======================================================================

// Register spec sync workflow
w.RegisterWorkflow(workflows.RepositorySpecSyncWorkflow)

// Create and register spec sync activities
// TODO: Implement GitHubContentClient and PayloadAPICatalogClient
var specSyncGitHubClient activities.GitHubContentClient = nil
var specSyncCatalogClient activities.PayloadAPICatalogClient = nil
specSyncActivities := activities.NewSpecSyncActivities(
	specSyncGitHubClient,
	specSyncCatalogClient,
	logger,
)
w.RegisterActivity(specSyncActivities.ListRepoSpecFiles)
w.RegisterActivity(specSyncActivities.FetchSpecContent)
w.RegisterActivity(specSyncActivities.UpsertAPISchemaToCatalog)
w.RegisterActivity(specSyncActivities.RemoveOrphanedSpecs)
log.Println("API spec sync activities registered")
```

**Step 2: Verify build**

Run: `cd temporal-workflows && go build ./cmd/worker/`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add temporal-workflows/cmd/worker/main.go
git commit -m "feat(temporal): register RepositorySpecSyncWorkflow in worker"
```

---

## Task 7: Webhook Handler — Signal Workflow on Push

**Files:**
- Create: `orbit-www/src/app/api/webhooks/github/spec-sync/route.ts`

**Step 1: Create the webhook route**

Create `orbit-www/src/app/api/webhooks/github/spec-sync/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { getPayload } from 'payload'
import config from '@payload-config'
import { Client, Connection } from '@temporalio/client'

const SPEC_FILE_PATTERNS = [
  /openapi\.(yaml|yml|json)$/i,
  /swagger\.(yaml|yml|json)$/i,
  /asyncapi\.(yaml|yml|json)$/i,
]

function isSpecFile(path: string): boolean {
  return SPEC_FILE_PATTERNS.some((pattern) => pattern.test(path))
}

export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get('X-Hub-Signature-256')
    if (!signature) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
    }

    const event = request.headers.get('X-GitHub-Event')
    if (event !== 'push') {
      return NextResponse.json({ message: 'Event ignored' }, { status: 200 })
    }

    const body = await request.text()

    let payloadData: {
      ref: string
      repository: { full_name: string; default_branch: string }
      commits?: Array<{
        added?: string[]
        modified?: string[]
        removed?: string[]
      }>
    }

    try {
      payloadData = JSON.parse(body)
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const repoFullName = payloadData.repository?.full_name
    const defaultBranch = payloadData.repository?.default_branch

    if (!repoFullName || !defaultBranch) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    // Only process pushes to the default branch
    if (payloadData.ref !== `refs/heads/${defaultBranch}`) {
      return NextResponse.json({ message: 'Not default branch' }, { status: 200 })
    }

    // Check if any spec files were changed
    const changedPaths: string[] = []
    for (const commit of payloadData.commits || []) {
      for (const path of [...(commit.added || []), ...(commit.modified || []), ...(commit.removed || [])]) {
        if (isSpecFile(path) && !changedPaths.includes(path)) {
          changedPaths.push(path)
        }
      }
    }

    if (changedPaths.length === 0) {
      return NextResponse.json({ message: 'No spec files changed' }, { status: 200 })
    }

    // Find apps linked to this repository
    const payload = await getPayload({ config })
    const apps = await payload.find({
      collection: 'apps',
      where: { 'repository.url': { contains: repoFullName } },
      overrideAccess: true,
      limit: 100,
    })

    if (apps.docs.length === 0) {
      return NextResponse.json({ message: 'No matching apps' }, { status: 200 })
    }

    // Verify signature against each app's webhook secret and signal the workflow
    const temporalAddress = process.env.TEMPORAL_ADDRESS || 'localhost:7233'
    const connection = await Connection.connect({ address: temporalAddress })
    const client = new Client({ connection })

    const results: Array<{ appId: string; success: boolean; error?: string }> = []

    for (const app of apps.docs) {
      if (!app.webhookSecret) {
        results.push({ appId: app.id, success: false, error: 'No webhook secret' })
        continue
      }

      const expectedSig =
        'sha256=' +
        crypto.createHmac('sha256', app.webhookSecret).update(body).digest('hex')

      const isValid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSig),
      )

      if (!isValid) {
        results.push({ appId: app.id, success: false, error: 'Invalid signature' })
        continue
      }

      try {
        const workflowId = `spec-sync-${app.id}`
        const handle = client.workflow.getHandle(workflowId)
        await handle.signal('WebhookPush', { changedPaths })
        results.push({ appId: app.id, success: true })
      } catch (error) {
        // Workflow might not exist yet — start it
        try {
          const repoFullName = typeof app.repository === 'object' && app.repository !== null
            ? `${(app.repository as { owner?: string }).owner}/${(app.repository as { name?: string }).name}`
            : ''

          await client.workflow.start('RepositorySpecSyncWorkflow', {
            workflowId: `spec-sync-${app.id}`,
            taskQueue: 'orbit-workflows',
            args: [{
              appId: app.id,
              repoFullName,
              installationId: typeof app.repository === 'object' ? (app.repository as { installationId?: string })?.installationId || '' : '',
              workspaceId: typeof app.workspace === 'string' ? app.workspace : (app.workspace as { id: string })?.id || '',
            }],
          })
          results.push({ appId: app.id, success: true })
        } catch (startError) {
          results.push({
            appId: app.id,
            success: false,
            error: startError instanceof Error ? startError.message : 'Failed to start workflow',
          })
        }
      }
    }

    return NextResponse.json({ success: true, results })
  } catch (error) {
    console.error('[Spec Sync Webhook] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

**Step 2: Verify build**

Run: `cd orbit-www && pnpm tsc --noEmit`
Expected: No type errors (may need `@temporalio/client` — check if already a dependency, if not install it)

**Step 3: Commit**

```bash
git add orbit-www/src/app/api/webhooks/github/spec-sync/route.ts
git commit -m "feat(api-catalog): add webhook handler to signal spec sync workflow on push"
```

---

## Task 8: Polish Cleanup

**Files:**
- Modify: `orbit-www/src/app/(frontend)/workspaces/[slug]/apis/workspace-apis-client.tsx`
- Modify: `orbit-www/src/app/(frontend)/catalog/apis/catalog-client.tsx`

**Step 1: Fix `any` types in workspace-apis-client.tsx**

In `orbit-www/src/app/(frontend)/workspaces/[slug]/apis/workspace-apis-client.tsx`:

Replace:
```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type APISchema = any
```

With:
```typescript
import type { APISchema } from '@/types/api-catalog'
```

**Step 2: Fix `any` types in catalog-client.tsx**

In `orbit-www/src/app/(frontend)/catalog/apis/catalog-client.tsx`:

Replace:
```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type APISchema = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Workspace = any
```

With:
```typescript
import type { APISchema } from '@/types/api-catalog'

interface Workspace {
  id: string
  name: string
  slug: string
}
```

**Step 3: Verify build**

Run: `cd orbit-www && pnpm tsc --noEmit`
Expected: No type errors

**Step 4: Commit**

```bash
git add orbit-www/src/app/(frontend)/workspaces/[slug]/apis/workspace-apis-client.tsx
git add orbit-www/src/app/(frontend)/catalog/apis/catalog-client.tsx
git commit -m "fix(api-catalog): replace any types with proper type imports"
```

---

## Task 9: Final Verification and PR

**Step 1: Run all frontend tests**

Run: `cd orbit-www && pnpm test`
Expected: No new test failures

**Step 2: Run Go tests**

Run: `cd temporal-workflows && go test -v -race ./...`
Expected: All tests pass

**Step 3: Run type check**

Run: `cd orbit-www && pnpm tsc --noEmit`
Expected: No type errors

**Step 4: Run linter**

Run: `cd orbit-www && pnpm lint`
Expected: No new errors

**Step 5: Create PR**

```bash
git push -u origin clawdbot/api-catalog-2.2
gh pr create --title "feat(api-catalog): Phase 2.2 - Scalar, auto-discovery, AsyncAPI, deprecation" --body "$(cat <<'EOF'
## Summary

Completes Phase 2.2 API Catalog Integration from the roadmap.

### Changes

- **Scalar swap**: Replace swagger-ui-react with @scalar/api-reference-react for API doc rendering
- **AsyncAPI support**: Add asyncapi as a schema type with validator, metadata extraction, and wizard template
- **Deprecation workflow**: Deprecate action with confirmation, banner on deprecated APIs, deprecationMessage field
- **Auto-discovery (Temporal)**: RepositorySpecSyncWorkflow scans repos for OpenAPI/AsyncAPI specs via signals
- **Webhook handler**: Signals workflow on GitHub push events touching spec files
- **Polish**: Replace `any` types with proper imports in catalog and workspace API clients

### Components

| Component | Description |
|-----------|-------------|
| APISpecViewer | Scalar-based spec viewer (replaces SwaggerUIViewer) |
| RepositorySpecSyncWorkflow | Long-running Temporal workflow with ScanForSpecs/WebhookPush/ForceResync signals |
| SpecSyncActivities | ListRepoSpecFiles, FetchSpecContent, UpsertAPISchemaToCatalog, RemoveOrphanedSpecs |

## Test plan

- [ ] Verify Scalar renders OpenAPI specs correctly on API detail page
- [ ] Verify AsyncAPI spec can be created via wizard with template
- [ ] Verify deprecation button appears, sets status, shows banner
- [ ] Verify spec sync workflow unit tests pass
- [ ] Verify no new test failures or type errors

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Replace Swagger UI with Scalar | SwaggerUIViewer.tsx, api-detail-client.tsx, package.json |
| 2 | AsyncAPI schema type support | schema-validators.ts, APISchemas.ts, api-catalog.ts, SchemaContentStep.tsx |
| 3 | Deprecation workflow | APISchemas.ts, api-detail-client.tsx, actions.ts, api-catalog.ts |
| 4 | Temporal RepositorySpecSyncWorkflow | spec_sync_workflow.go, spec_sync_workflow_test.go |
| 5 | Spec sync activities | spec_sync_activities.go, spec_sync_activities_test.go |
| 6 | Register workflow in worker | main.go |
| 7 | Webhook handler for spec sync | spec-sync/route.ts |
| 8 | Polish: fix `any` types | workspace-apis-client.tsx, catalog-client.tsx |
| 9 | Final verification and PR | — |

Total estimated time: 3-4 hours
