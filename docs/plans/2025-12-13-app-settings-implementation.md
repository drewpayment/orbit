# App Settings Implementation Plan

**Date:** 2025-12-13
**Design:** [2025-12-13-app-settings-design.md](./2025-12-13-app-settings-design.md)
**Status:** Ready for Implementation

## Overview

Implement a slide-out settings panel for the App Detail page that allows users to:
- Edit general app settings (name, description)
- Configure health check monitoring
- Change repository branch
- Delete the application (with confirmation)

## Prerequisites

- Feature branch: `feat/application-lifecycle-catalog` merged
- Design document reviewed
- Existing patterns understood (WorkspaceSettingsDialog, Sheet component)

---

## Implementation Tasks

### Task 1: Add Server Actions

**File:** `orbit-www/src/app/actions/apps.ts`

#### 1.1 Add `updateAppSettings` action

```typescript
interface UpdateAppSettingsInput {
  name: string
  description?: string
  healthConfig?: {
    url?: string
    method?: 'GET' | 'HEAD' | 'POST'
    interval?: number
    timeout?: number
    expectedStatus?: number
  }
  branch?: string
}

export async function updateAppSettings(
  appId: string,
  data: UpdateAppSettingsInput
): Promise<{ success: boolean; error?: string }>
```

Implementation details:
- Authenticate user via `auth.api.getSession()`
- Fetch app to get workspace ID
- Verify user has workspace member access (active member with owner/admin/member role)
- Update app via `payload.update()` with:
  - `name`, `description` fields directly
  - `healthConfig` group fields (url, method, interval, timeout, expectedStatus)
  - `repository.branch` if branch provided
- Revalidate `/apps` and `/apps/${appId}` paths
- Return `{ success: true }` or `{ success: false, error: message }`

#### 1.2 Add `deleteApp` action

```typescript
export async function deleteApp(
  appId: string,
  confirmName: string
): Promise<{ success: boolean; error?: string }>
```

Implementation details:
- Authenticate user via `auth.api.getSession()`
- Fetch app to get name and workspace ID
- Validate `confirmName === app.name` (exact match)
- Verify user has workspace owner/admin role (not just member)
- Delete app via `payload.delete()` - Payload hooks handle cascade deletion
- Revalidate `/apps` path
- Return `{ success: true }` or `{ success: false, error: message }`

**Verification:**
- [ ] Unit test: updateAppSettings validates workspace membership
- [ ] Unit test: updateAppSettings updates all fields correctly
- [ ] Unit test: deleteApp requires exact name match
- [ ] Unit test: deleteApp requires owner/admin role

---

### Task 2: Add GitHub Branch Fetching

**File:** `orbit-www/src/app/actions/github.ts`

#### 2.1 Add `getRepositoryBranches` action

```typescript
export async function getRepositoryBranches(
  installationId: string,
  owner: string,
  repo: string
): Promise<{ success: boolean; branches?: string[]; error?: string }>
```

Implementation details:
- Authenticate user via `auth.api.getSession()`
- Fetch GitHub installation by ID to get `installationId` number
- Use `getInstallationOctokit(installationId)` to get authenticated client
- Call `octokit.request('GET /repos/{owner}/{repo}/branches', { owner, repo, per_page: 100 })`
- Extract branch names: `response.data.map(b => b.name)`
- Sort alphabetically with default branch first (if identifiable)
- Return `{ success: true, branches }` or `{ success: false, error }`

**Verification:**
- [ ] Unit test: returns branches array on success
- [ ] Unit test: handles authentication errors
- [ ] Unit test: handles repository not found

---

### Task 3: Create AppSettingsSheet Component

**File:** `orbit-www/src/components/features/apps/AppSettingsSheet.tsx`

#### 3.1 Component Structure

```typescript
interface AppSettingsSheetProps {
  app: App
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AppSettingsSheet({ app, open, onOpenChange }: AppSettingsSheetProps)
```

#### 3.2 Form Schema (Zod)

```typescript
const appSettingsSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be less than 100 characters'),
  description: z.string().max(500, 'Description must be less than 500 characters').optional(),
  healthConfig: z.object({
    url: z.string().url('Must be a valid URL').optional().or(z.literal('')),
    method: z.enum(['GET', 'HEAD', 'POST']).default('GET'),
    interval: z.coerce.number().min(30, 'Minimum 30 seconds').default(60),
    timeout: z.coerce.number().min(1, 'Minimum 1 second').default(10),
    expectedStatus: z.coerce.number().min(100).max(599).default(200),
  }),
  branch: z.string().optional(),
})
```

#### 3.3 State Management

```typescript
const [isSubmitting, setIsSubmitting] = useState(false)
const [isDeleting, setIsDeleting] = useState(false)
const [branches, setBranches] = useState<string[]>([])
const [loadingBranches, setLoadingBranches] = useState(false)
const [deleteConfirmName, setDeleteConfirmName] = useState('')
```

#### 3.4 Branch Loading Effect

```typescript
useEffect(() => {
  if (open && app.repository?.installationId && app.repository?.owner && app.repository?.name) {
    setLoadingBranches(true)
    getRepositoryBranches(app.repository.installationId, app.repository.owner, app.repository.name)
      .then(result => {
        if (result.success && result.branches) {
          setBranches(result.branches)
        }
      })
      .finally(() => setLoadingBranches(false))
  }
}, [open, app.repository])
```

#### 3.5 Unsaved Changes Warning

```typescript
const handleOpenChange = (newOpen: boolean) => {
  if (!newOpen && form.formState.isDirty) {
    if (!confirm('You have unsaved changes. Discard?')) return
  }
  onOpenChange(newOpen)
}
```

#### 3.6 Form Submit Handler

```typescript
const onSubmit = async (data: z.infer<typeof appSettingsSchema>) => {
  try {
    setIsSubmitting(true)
    const result = await updateAppSettings(app.id, {
      name: data.name,
      description: data.description,
      healthConfig: data.healthConfig.url ? data.healthConfig : undefined,
      branch: data.branch,
    })

    if (result.success) {
      toast.success('Settings saved', { description: 'App settings have been updated' })
      onOpenChange(false)
      router.refresh()
    } else {
      toast.error('Failed to save settings', { description: result.error })
    }
  } finally {
    setIsSubmitting(false)
  }
}
```

#### 3.7 Delete Handler

```typescript
const handleDelete = async () => {
  if (deleteConfirmName !== app.name) return

  try {
    setIsDeleting(true)
    const result = await deleteApp(app.id, deleteConfirmName)

    if (result.success) {
      toast.success('App deleted', { description: `${app.name} has been permanently deleted` })
      router.push('/apps')
    } else {
      toast.error('Failed to delete app', { description: result.error })
    }
  } finally {
    setIsDeleting(false)
  }
}
```

#### 3.8 UI Layout

Use Sheet component with sections:
1. **Header:** "Settings" title with close button
2. **General Section:** Name input, Description textarea
3. **Health Check Section:** URL, Method select, Interval/Timeout numbers, Expected Status
4. **Repository Section:** Read-only URL display, Branch select dropdown
5. **Danger Zone Section:** Red background, delete confirmation input, delete button
6. **Footer:** Cancel and Save Changes buttons

**Component imports needed:**
- `Sheet, SheetContent, SheetHeader, SheetFooter, SheetTitle` from ui/sheet
- `Form, FormField, FormItem, FormLabel, FormControl, FormMessage` from ui/form
- `Input, Textarea, Button, Select, Separator` from ui/*
- `Loader2, ExternalLink, AlertTriangle` from lucide-react
- `useForm` from react-hook-form
- `zodResolver` from @hookform/resolvers/zod
- `toast` from sonner
- `useRouter` from next/navigation

**Verification:**
- [ ] Manual test: Form loads with current app values
- [ ] Manual test: Validation errors show inline
- [ ] Manual test: Unsaved changes warning on close
- [ ] Manual test: Branch dropdown loads and is searchable
- [ ] Manual test: Delete requires exact name match
- [ ] Manual test: Success toast and redirect after delete

---

### Task 4: Wire Up Settings Button in AppDetail

**File:** `orbit-www/src/components/features/apps/AppDetail.tsx`

#### 4.1 Add State and Import

```typescript
import { AppSettingsSheet } from './AppSettingsSheet'

// Inside component:
const [showSettings, setShowSettings] = useState(false)
```

#### 4.2 Update Settings Button

Change the existing Settings button from:
```tsx
<Button variant="outline" size="sm">
  <Settings className="mr-2 h-4 w-4" />
  Settings
</Button>
```

To:
```tsx
<Button variant="outline" size="sm" onClick={() => setShowSettings(true)}>
  <Settings className="mr-2 h-4 w-4" />
  Settings
</Button>
```

#### 4.3 Add Sheet Component

Add at the end of the component, before closing div:
```tsx
<AppSettingsSheet
  app={app}
  open={showSettings}
  onOpenChange={setShowSettings}
/>
```

**Verification:**
- [ ] Manual test: Settings button opens sheet
- [ ] Manual test: Sheet closes via X, backdrop, or Cancel
- [ ] Manual test: Form saves and refreshes data

---

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `orbit-www/src/app/actions/apps.ts` | Modify | Add updateAppSettings, deleteApp |
| `orbit-www/src/app/actions/github.ts` | Modify | Add getRepositoryBranches |
| `orbit-www/src/components/features/apps/AppSettingsSheet.tsx` | Create | Main settings sheet component |
| `orbit-www/src/components/features/apps/AppDetail.tsx` | Modify | Wire up settings button |

---

## Testing Checklist

### Unit Tests
- [ ] `updateAppSettings` validates workspace membership
- [ ] `updateAppSettings` handles partial updates correctly
- [ ] `deleteApp` requires exact name match
- [ ] `deleteApp` requires owner/admin role
- [ ] `getRepositoryBranches` returns branches on success
- [ ] `getRepositoryBranches` handles errors gracefully

### Integration Tests
- [ ] Full flow: open settings, edit name, save
- [ ] Full flow: open settings, configure health check, save
- [ ] Full flow: delete app with confirmation

### Manual Testing
- [ ] Settings button opens slide-out panel
- [ ] Form populates with current values
- [ ] Validation errors appear inline
- [ ] Branch dropdown loads from GitHub API
- [ ] Unsaved changes warning on dismiss
- [ ] Save updates app and shows toast
- [ ] Delete requires typing exact app name
- [ ] Delete redirects to /apps with toast

---

## Dependencies

- Existing: Sheet component (shadcn/ui)
- Existing: Form components (react-hook-form + zod)
- Existing: Toast (sonner)
- Existing: GitHub Octokit client
- Existing: Payload CMS API

No new dependencies required.

---

## Estimated Complexity

- **Task 1 (Server Actions):** Medium - straightforward CRUD, access control validation
- **Task 2 (GitHub Branches):** Low - single API call, existing patterns
- **Task 3 (Sheet Component):** High - largest component, multiple sections, form handling
- **Task 4 (Wiring):** Low - simple state and props connection

Total: ~3-4 hours of focused development time
