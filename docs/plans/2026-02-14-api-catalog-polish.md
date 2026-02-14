# API Catalog Polish (2.2) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Clean up dead code, add type safety, fix error handling, and add auth/empty states to the existing API Catalog frontend.

**Architecture:** Surgical fixes to existing files — no new features, no architectural changes. Remove orphaned components (SchemaEditor, APICreationWizard, gRPC client), replace `any` types with shared interfaces, fix 3 error handling gaps, add auth guard + empty states.

**Tech Stack:** Next.js 15, React 19, TypeScript, Payload CMS, shadcn/ui, Sonner (toasts)

**Branch:** Create from `main`

---

## Task 1: Create Shared Type Definitions

**Files:**
- Create: `orbit-www/src/types/api-catalog.ts`

**Step 1: Create the types file**

Based on the Payload CMS collection field definitions in `APISchemas.ts` (lines 132-343) and `APISchemaVersions.ts` (lines 41-113), create:

```typescript
// orbit-www/src/types/api-catalog.ts

export interface APISchema {
  id: string
  name: string
  slug: string
  description?: string
  workspace: string | { id: string; slug: string; name?: string }
  visibility: 'private' | 'workspace' | 'public'
  schemaType: 'openapi'
  currentVersion?: string
  rawContent?: string
  status: 'draft' | 'published' | 'deprecated'
  tags?: Array<{ id?: string; tag: string }>
  contactName?: string
  contactEmail?: string
  serverUrls?: Array<{ id?: string; url: string }>
  repository?: string | { id: string }
  repositoryPath?: string
  specTitle?: string
  specDescription?: string
  endpointCount?: number
  latestVersionNumber?: number
  createdBy?: string | { id: string; name?: string; email?: string }
  lastEditedBy?: string | { id: string }
  createdAt: string
  updatedAt: string
}

export interface APISchemaVersion {
  id: string
  schema: string | APISchema
  workspace: string | { id: string }
  version: string
  versionNumber: number
  rawContent?: string
  contentHash?: string
  releaseNotes?: string
  createdBy?: string | { id: string; name?: string; email?: string }
  createdAt: string
  updatedAt: string
}
```

**Step 2: Verify types compile**

Run: `cd orbit-www && npx tsc --noEmit src/types/api-catalog.ts 2>&1 | head -20`
Expected: No errors (or only pre-existing errors unrelated to this file)

**Step 3: Commit**

```bash
git add orbit-www/src/types/api-catalog.ts
git commit -m "feat(api-catalog): add shared TypeScript interfaces for APISchema and APISchemaVersion"
```

---

## Task 2: Remove Dead Code — SchemaEditor, APICreationWizard, gRPC Client

**Files:**
- Delete: `orbit-www/src/components/features/api-catalog/SchemaEditor.tsx`
- Delete: `orbit-www/src/components/features/api-catalog/SchemaEditor.test.tsx`
- Delete: `orbit-www/src/components/features/api-catalog/APICreationWizard.tsx`
- Delete: `orbit-www/src/lib/grpc/api-catalog-client.ts`
- Modify: `orbit-www/src/lib/schema-validators.ts` (line 1 — update import)

**Step 1: Update the SchemaType import in schema-validators.ts**

Change line 1 from:
```typescript
import { SchemaType } from './grpc/api-catalog-client';
```
to:
```typescript
import { SchemaType } from '@/lib/proto/api_catalog_pb';
```

This imports `SchemaType` directly from the proto-generated code instead of through the gRPC client re-export.

**Step 2: Delete the orphaned files**

```bash
rm orbit-www/src/components/features/api-catalog/SchemaEditor.tsx
rm orbit-www/src/components/features/api-catalog/SchemaEditor.test.tsx
rm orbit-www/src/components/features/api-catalog/APICreationWizard.tsx
rm orbit-www/src/lib/grpc/api-catalog-client.ts
```

**Step 3: Verify no broken imports**

Run: `cd orbit-www && npx tsc --noEmit 2>&1 | grep -i "schema-validators\|api-catalog-client\|SchemaEditor\|APICreationWizard" | head -20`
Expected: No errors referencing these files. If any other file imports from the deleted files, fix those imports.

**Step 4: Run linter**

Run: `cd orbit-www && bun run lint 2>&1 | tail -10`
Expected: No new errors

**Step 5: Commit**

```bash
git add -u orbit-www/src/components/features/api-catalog/
git add -u orbit-www/src/lib/grpc/api-catalog-client.ts
git add orbit-www/src/lib/schema-validators.ts
git commit -m "refactor(api-catalog): remove orphaned SchemaEditor, APICreationWizard, and gRPC client"
```

---

## Task 3: Replace `any` Types in APIDetailClient

**Files:**
- Modify: `orbit-www/src/app/(frontend)/catalog/apis/[id]/api-detail-client.tsx`

**Step 1: Replace the `any` type aliases with imports**

Remove lines 55-58:
```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type APISchema = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Version = any
```

Add import at the top of the file:
```typescript
import type { APISchema, APISchemaVersion } from '@/types/api-catalog'
```

**Step 2: Update the props interface**

Change `APIDetailClientProps` (around line 60) from:
```typescript
interface APIDetailClientProps {
  api: APISchema
  versions: Version[]
  canEdit: boolean
  userId?: string
}
```
to:
```typescript
interface APIDetailClientProps {
  api: APISchema
  versions: APISchemaVersion[]
  canEdit: boolean
  userId?: string
}
```

**Step 3: Fix any type errors that surface**

With proper types, some property accesses may need adjustment. Check for:
- `api.createdBy.name` — may need narrowing since `createdBy` can be string or object
- `api.workspace.slug` — same narrowing needed
- Version properties accessed by `VersionHistory` component

**Step 4: Verify types compile**

Run: `cd orbit-www && npx tsc --noEmit 2>&1 | grep "api-detail-client" | head -20`
Expected: No new errors in this file

**Step 5: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/catalog/apis/\[id\]/api-detail-client.tsx
git commit -m "refactor(api-catalog): replace any types with APISchema and APISchemaVersion in detail view"
```

---

## Task 4: Replace `any` Type in EditAPIClient

**Files:**
- Modify: `orbit-www/src/app/(frontend)/workspaces/[slug]/apis/[id]/edit-api-client.tsx`

**Step 1: Replace the `any` type alias with import**

Remove lines 50-51:
```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type APISchema = any
```

Add import at the top of the file:
```typescript
import type { APISchema } from '@/types/api-catalog'
```

**Step 2: Fix any type errors that surface**

With proper types, property accesses on `api` will be type-checked. Fix any narrowing issues (e.g., `api.workspace` being string or object).

**Step 3: Verify types compile**

Run: `cd orbit-www && npx tsc --noEmit 2>&1 | grep "edit-api-client" | head -20`
Expected: No new errors in this file

**Step 4: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/workspaces/\[slug\]/apis/\[id\]/edit-api-client.tsx
git commit -m "refactor(api-catalog): replace any type with APISchema in edit view"
```

---

## Task 5: Fix canEdit Logic in Detail Page

**Files:**
- Modify: `orbit-www/src/app/(frontend)/catalog/apis/[id]/page.tsx`

**Step 1: Expand canEdit to check workspace membership**

Replace the `canEdit` block (lines 27-34):
```typescript
// Check if user can edit (creator or workspace member)
let canEdit = false
if (user) {
  const createdById = typeof api.createdBy === 'object'
    ? api.createdBy.id
    : api.createdBy
  canEdit = createdById === user.id
  // TODO: Also check workspace membership for owner/admin/member
}
```

With:
```typescript
// Check if user can edit (creator or workspace member with appropriate role)
let canEdit = false
if (user) {
  const createdById = typeof api.createdBy === 'object'
    ? api.createdBy.id
    : api.createdBy
  canEdit = createdById === user.id

  // Also check workspace membership for owner/admin/member
  if (!canEdit) {
    const workspaceId = typeof api.workspace === 'string'
      ? api.workspace
      : api.workspace?.id
    if (workspaceId) {
      const memberships = await payload.find({
        collection: 'workspace-members',
        where: {
          user: { equals: user.id },
          workspace: { equals: workspaceId },
          status: { equals: 'active' },
          role: { in: ['owner', 'admin', 'member'] },
        },
        limit: 1,
        overrideAccess: true,
      })
      canEdit = memberships.docs.length > 0
    }
  }
}
```

**Step 2: Add payload import if not present**

Check if `getPayload` and `config` are already imported. If not, add:
```typescript
import { getPayload } from 'payload'
import config from '@payload-config'
```

And add at the top of the function body:
```typescript
const payload = await getPayload({ config })
```

Note: The existing code may already use `payload` for the `getAPIById` call — check before adding duplicate initialization.

**Step 3: Verify types compile**

Run: `cd orbit-www && npx tsc --noEmit 2>&1 | grep "catalog/apis/\[id\]/page" | head -20`
Expected: No new errors

**Step 4: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/catalog/apis/\[id\]/page.tsx
git commit -m "feat(api-catalog): expand canEdit to check workspace membership"
```

---

## Task 6: Fix Error Handling — Version Restore

**Files:**
- Modify: `orbit-www/src/app/(frontend)/catalog/apis/[id]/api-detail-client.tsx`

**Step 1: Wrap onRestoreVersion in try/catch**

Replace the `onRestoreVersion` handler (around lines 335-347):
```tsx
onRestoreVersion={
  canEdit && userId
    ? async (versionId) => {
        const { restoreVersion } = await import(
          '@/app/(frontend)/workspaces/[slug]/apis/actions'
        )
        await restoreVersion(api.id, versionId, userId)
        toast.success('Version restored')
        router.refresh()
      }
    : undefined
}
```

With:
```tsx
onRestoreVersion={
  canEdit && userId
    ? async (versionId) => {
        try {
          const { restoreVersion } = await import(
            '@/app/(frontend)/workspaces/[slug]/apis/actions'
          )
          await restoreVersion(api.id, versionId, userId)
          toast.success('Version restored')
          router.refresh()
        } catch (error) {
          console.error('Failed to restore version:', error)
          toast.error('Failed to restore version')
        }
      }
    : undefined
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/catalog/apis/\[id\]/api-detail-client.tsx
git commit -m "fix(api-catalog): add error handling for version restore"
```

---

## Task 7: Fix Error Handling — Release Notes Dialog State Leak

**Files:**
- Modify: `orbit-www/src/app/(frontend)/workspaces/[slug]/apis/[id]/edit-api-client.tsx`

**Step 1: Clear releaseNotes on cancel**

Find the cancel button handler in the release notes dialog (around lines 434-443):
```tsx
<Button
  variant="outline"
  onClick={() => {
    setReleaseNotesDialog(false)
    setPendingFormData(null)
  }}
>
  Cancel
</Button>
```

Change to:
```tsx
<Button
  variant="outline"
  onClick={() => {
    setReleaseNotesDialog(false)
    setPendingFormData(null)
    setReleaseNotes('')
  }}
>
  Cancel
</Button>
```

**Step 2: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/workspaces/\[slug\]/apis/\[id\]/edit-api-client.tsx
git commit -m "fix(api-catalog): clear release notes state on dialog cancel"
```

---

## Task 8: Fix Error Handling — Delete Dialog Spinner

**Files:**
- Modify: `orbit-www/src/app/(frontend)/catalog/apis/[id]/api-detail-client.tsx`

**Step 1: Add loading state to delete button**

Find the `AlertDialogAction` button in the delete dialog (around line 185-188). It should look something like:
```tsx
<AlertDialogAction
  onClick={handleDelete}
  disabled={isDeleting}
  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
>
  Delete
</AlertDialogAction>
```

Change to:
```tsx
<AlertDialogAction
  onClick={handleDelete}
  disabled={isDeleting}
  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
>
  {isDeleting ? (
    <>
      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      Deleting...
    </>
  ) : (
    'Delete'
  )}
</AlertDialogAction>
```

**Step 2: Ensure Loader2 is imported**

Check if `Loader2` is already imported from `lucide-react`. If not, add it to the existing lucide-react import.

**Step 3: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/catalog/apis/\[id\]/api-detail-client.tsx
git commit -m "fix(api-catalog): add loading spinner to delete confirmation dialog"
```

---

## Task 9: Add Auth Guard to Workspace APIs List Page

**Files:**
- Modify: `orbit-www/src/app/(frontend)/workspaces/[slug]/apis/page.tsx`

**Step 1: Add auth check**

Add the same auth guard pattern used in `new/page.tsx`. Add import if not present:
```typescript
import { getCurrentUser } from '@/lib/auth/session'
import { redirect } from 'next/navigation'
```

Add at the beginning of the component function body (before the workspace lookup):
```typescript
const user = await getCurrentUser()

if (!user) {
  redirect('/login')
}
```

**Step 2: Verify the page still renders**

Run: `cd orbit-www && npx tsc --noEmit 2>&1 | grep "workspaces/\[slug\]/apis/page" | head -10`
Expected: No new errors

**Step 3: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/workspaces/\[slug\]/apis/page.tsx
git commit -m "fix(api-catalog): add auth guard to workspace APIs list page"
```

---

## Task 10: Add Empty State Placeholders to APIDetailClient

**Files:**
- Modify: `orbit-www/src/app/(frontend)/catalog/apis/[id]/api-detail-client.tsx`

**Step 1: Add empty state for description**

In the Overview tab, find where `api.description || api.specDescription` is rendered and wrap it:

```tsx
{api.description || api.specDescription ? (
  <p className="text-muted-foreground">{api.description || api.specDescription}</p>
) : (
  <p className="text-muted-foreground italic">No description provided</p>
)}
```

**Step 2: Add empty state for tags**

Find where `api.tags` is rendered (likely a `.map()` over tags). Wrap the tags section:

```tsx
{api.tags && api.tags.length > 0 ? (
  <div className="flex flex-wrap gap-2">
    {api.tags.map((t: { id?: string; tag: string }, i: number) => (
      <Badge key={t.id || i} variant="secondary">{t.tag}</Badge>
    ))}
  </div>
) : (
  <p className="text-sm text-muted-foreground italic">No tags</p>
)}
```

**Step 3: Add empty state for server URLs**

Find where `api.serverUrls` is rendered. Wrap the section:

```tsx
{api.serverUrls && api.serverUrls.length > 0 ? (
  <div className="space-y-1">
    {api.serverUrls.map((s: { id?: string; url: string }, i: number) => (
      <p key={s.id || i} className="text-sm font-mono">{s.url}</p>
    ))}
  </div>
) : (
  <p className="text-sm text-muted-foreground italic">No server URLs configured</p>
)}
```

**Step 4: Verify no rendering issues**

Run: `cd orbit-www && npx tsc --noEmit 2>&1 | grep "api-detail-client" | head -10`
Expected: No new errors

**Step 5: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/catalog/apis/\[id\]/api-detail-client.tsx
git commit -m "feat(api-catalog): add empty state placeholders for description, tags, and server URLs"
```

---

## Task 11: Final Verification

**Step 1: Run linter**

Run: `cd orbit-www && bun run lint 2>&1 | tail -10`
Expected: No new errors (warnings only in pre-existing proto files)

**Step 2: Run tests**

Run: `cd orbit-www && npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: No new test failures compared to baseline (23 pre-existing failures)

**Step 3: Verify no broken imports across codebase**

Run: `cd orbit-www && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Compare count against baseline — should be same or lower.

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Create shared type definitions | `types/api-catalog.ts` (new) |
| 2 | Remove dead code (SchemaEditor, APICreationWizard, gRPC client) | 4 deleted, 1 modified |
| 3 | Replace `any` types in APIDetailClient | `api-detail-client.tsx` |
| 4 | Replace `any` type in EditAPIClient | `edit-api-client.tsx` |
| 5 | Fix canEdit to check workspace membership | `catalog/apis/[id]/page.tsx` |
| 6 | Fix version restore error handling | `api-detail-client.tsx` |
| 7 | Fix release notes dialog state leak | `edit-api-client.tsx` |
| 8 | Add delete dialog spinner | `api-detail-client.tsx` |
| 9 | Add auth guard to workspace APIs list | `workspaces/[slug]/apis/page.tsx` |
| 10 | Add empty state placeholders | `api-detail-client.tsx` |
| 11 | Final verification | — |

Total estimated time: 1-2 hours
