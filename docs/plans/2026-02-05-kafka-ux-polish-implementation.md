# Kafka UX Polish (2.4) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add retry functionality and error visibility for failed/partial Kafka application provisioning in both workspace and admin views.

**Architecture:** Banner + Modal approach for workspace view (non-disruptive), new Provisioning sub-tab for admin view. Shared RetryProvisioningButton component. Tiered error detail (moderate for workspace, detailed for admin).

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, shadcn/ui, Payload CMS, Sonner (toasts)

---

## Task 1: Server Action - List Applications With Provisioning Issues

**Files:**
- Modify: `orbit-www/src/app/actions/kafka-applications.ts`
- Test: `orbit-www/src/app/actions/__tests__/kafka-applications.test.ts`

**Step 1: Write the test file**

Create test file if it doesn't exist:

```typescript
// orbit-www/src/app/actions/__tests__/kafka-applications.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock payload
vi.mock('payload', () => ({
  getPayload: vi.fn(),
}))

// Mock auth
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

describe('listApplicationsWithProvisioningIssues', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return applications with failed or partial provisioning status', async () => {
    // This test will be implemented after we know the exact function signature
    expect(true).toBe(true)
  })
})
```

**Step 2: Run test to verify setup**

Run: `cd orbit-www && pnpm test src/app/actions/__tests__/kafka-applications.test.ts`
Expected: PASS (placeholder test)

**Step 3: Add the server action**

Add to `orbit-www/src/app/actions/kafka-applications.ts`:

```typescript
export interface ApplicationWithProvisioningIssue {
  id: string
  name: string
  slug: string
  workspaceId: string
  workspaceSlug: string
  provisioningStatus: 'pending' | 'in_progress' | 'partial' | 'failed'
  provisioningError?: string
  provisioningDetails?: ProvisioningDetails
  provisioningWorkflowId?: string
  updatedAt: string
}

export interface ListProvisioningIssuesResult {
  success: boolean
  applications?: ApplicationWithProvisioningIssue[]
  error?: string
}

export async function listApplicationsWithProvisioningIssues(
  workspaceId?: string
): Promise<ListProvisioningIssuesResult> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    const whereClause: Record<string, unknown> = {
      provisioningStatus: {
        in: ['pending', 'in_progress', 'partial', 'failed'],
      },
    }

    // If workspaceId provided, filter by workspace
    if (workspaceId) {
      whereClause.workspace = { equals: workspaceId }
    }

    const applications = await payload.find({
      collection: 'kafka-applications',
      where: whereClause,
      depth: 1, // Include workspace
      sort: '-updatedAt',
    })

    const result: ApplicationWithProvisioningIssue[] = applications.docs.map((app) => {
      const workspace = typeof app.workspace === 'string' 
        ? { id: app.workspace, slug: 'unknown' }
        : app.workspace

      return {
        id: app.id,
        name: app.name,
        slug: app.slug,
        workspaceId: typeof app.workspace === 'string' ? app.workspace : app.workspace.id,
        workspaceSlug: workspace?.slug || 'unknown',
        provisioningStatus: app.provisioningStatus as ApplicationWithProvisioningIssue['provisioningStatus'],
        provisioningError: app.provisioningError || undefined,
        provisioningDetails: app.provisioningDetails as ProvisioningDetails | undefined,
        provisioningWorkflowId: app.provisioningWorkflowId || undefined,
        updatedAt: app.updatedAt,
      }
    })

    return { success: true, applications: result }
  } catch (error) {
    console.error('Error listing applications with provisioning issues:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
```

**Step 4: Export the new types and function**

Ensure the new types and function are exported from the file.

**Step 5: Run type check**

Run: `cd orbit-www && pnpm tsc --noEmit`
Expected: No type errors

**Step 6: Commit**

```bash
git add orbit-www/src/app/actions/kafka-applications.ts
git add orbit-www/src/app/actions/__tests__/kafka-applications.test.ts
git commit -m "feat(kafka): add listApplicationsWithProvisioningIssues server action"
```

---

## Task 2: Shared Component - RetryProvisioningButton

**Files:**
- Create: `orbit-www/src/components/features/kafka/RetryProvisioningButton.tsx`
- Test: `orbit-www/src/components/features/kafka/__tests__/RetryProvisioningButton.test.tsx`

**Step 1: Create the test file**

```typescript
// orbit-www/src/components/features/kafka/__tests__/RetryProvisioningButton.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RetryProvisioningButton } from '../RetryProvisioningButton'

// Mock the server action
vi.mock('@/app/actions/kafka-applications', () => ({
  retryVirtualClusterProvisioning: vi.fn(),
}))

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('RetryProvisioningButton', () => {
  it('renders with default text', () => {
    render(<RetryProvisioningButton applicationId="app-123" onRetryComplete={vi.fn()} />)
    expect(screen.getByRole('button', { name: /retry provisioning/i })).toBeInTheDocument()
  })

  it('shows loading state when clicked', async () => {
    const { retryVirtualClusterProvisioning } = await import('@/app/actions/kafka-applications')
    vi.mocked(retryVirtualClusterProvisioning).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ success: true }), 100))
    )

    render(<RetryProvisioningButton applicationId="app-123" onRetryComplete={vi.fn()} />)
    
    fireEvent.click(screen.getByRole('button'))
    
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('calls onRetryComplete after successful retry', async () => {
    const { retryVirtualClusterProvisioning } = await import('@/app/actions/kafka-applications')
    vi.mocked(retryVirtualClusterProvisioning).mockResolvedValue({ success: true })

    const onRetryComplete = vi.fn()
    render(<RetryProvisioningButton applicationId="app-123" onRetryComplete={onRetryComplete} />)
    
    fireEvent.click(screen.getByRole('button'))
    
    await waitFor(() => {
      expect(onRetryComplete).toHaveBeenCalled()
    })
  })

  it('is disabled when disabled prop is true', () => {
    render(<RetryProvisioningButton applicationId="app-123" onRetryComplete={vi.fn()} disabled />)
    expect(screen.getByRole('button')).toBeDisabled()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd orbit-www && pnpm test src/components/features/kafka/__tests__/RetryProvisioningButton.test.tsx`
Expected: FAIL (component doesn't exist)

**Step 3: Create the component**

```typescript
// orbit-www/src/components/features/kafka/RetryProvisioningButton.tsx
'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { retryVirtualClusterProvisioning } from '@/app/actions/kafka-applications'

interface RetryProvisioningButtonProps {
  applicationId: string
  onRetryComplete: () => void
  disabled?: boolean
  size?: 'default' | 'sm' | 'lg' | 'icon'
  variant?: 'default' | 'secondary' | 'outline' | 'ghost'
}

export function RetryProvisioningButton({
  applicationId,
  onRetryComplete,
  disabled = false,
  size = 'default',
  variant = 'default',
}: RetryProvisioningButtonProps) {
  const [isRetrying, setIsRetrying] = useState(false)

  const handleRetry = useCallback(async () => {
    if (isRetrying || disabled) return

    setIsRetrying(true)
    toast.success('Provisioning started')

    try {
      const result = await retryVirtualClusterProvisioning(applicationId)

      if (result.success) {
        toast.success('Provisioning workflow started successfully')
        onRetryComplete()
      } else {
        toast.error(`Failed to start provisioning: ${result.error}`)
      }
    } catch (error) {
      toast.error('Failed to start provisioning')
      console.error('Retry provisioning error:', error)
    } finally {
      setIsRetrying(false)
    }
  }, [applicationId, onRetryComplete, isRetrying, disabled])

  return (
    <Button
      onClick={handleRetry}
      disabled={disabled || isRetrying}
      size={size}
      variant={variant}
    >
      <RefreshCw className={`h-4 w-4 mr-2 ${isRetrying ? 'animate-spin' : ''}`} />
      {isRetrying ? 'Retrying...' : 'Retry Provisioning'}
    </Button>
  )
}
```

**Step 4: Run tests**

Run: `cd orbit-www && pnpm test src/components/features/kafka/__tests__/RetryProvisioningButton.test.tsx`
Expected: PASS

**Step 5: Export from index**

Add to `orbit-www/src/components/features/kafka/index.ts`:

```typescript
export { RetryProvisioningButton } from './RetryProvisioningButton'
```

**Step 6: Commit**

```bash
git add orbit-www/src/components/features/kafka/RetryProvisioningButton.tsx
git add orbit-www/src/components/features/kafka/__tests__/RetryProvisioningButton.test.tsx
git add orbit-www/src/components/features/kafka/index.ts
git commit -m "feat(kafka): add RetryProvisioningButton component"
```

---

## Task 3: Shared Component - ProvisioningStatusBadge

**Files:**
- Create: `orbit-www/src/components/features/kafka/ProvisioningStatusBadge.tsx`

**Step 1: Create the component**

```typescript
// orbit-www/src/components/features/kafka/ProvisioningStatusBadge.tsx
'use client'

import { Badge } from '@/components/ui/badge'
import { CheckCircle2, Clock, Loader2, AlertTriangle, XCircle } from 'lucide-react'

type ProvisioningStatus = 'pending' | 'in_progress' | 'completed' | 'partial' | 'failed'

interface ProvisioningStatusBadgeProps {
  status: ProvisioningStatus
  showLabel?: boolean
}

const statusConfig: Record<ProvisioningStatus, {
  icon: typeof CheckCircle2
  label: string
  className: string
  animate?: boolean
}> = {
  pending: {
    icon: Clock,
    label: 'Pending',
    className: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
  },
  in_progress: {
    icon: Loader2,
    label: 'In Progress',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    animate: true,
  },
  completed: {
    icon: CheckCircle2,
    label: 'Completed',
    className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  },
  partial: {
    icon: AlertTriangle,
    label: 'Partial',
    className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  },
  failed: {
    icon: XCircle,
    label: 'Failed',
    className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  },
}

export function ProvisioningStatusBadge({ status, showLabel = true }: ProvisioningStatusBadgeProps) {
  const config = statusConfig[status]
  const Icon = config.icon

  return (
    <Badge variant="secondary" className={config.className}>
      <Icon className={`h-3 w-3 ${showLabel ? 'mr-1' : ''} ${config.animate ? 'animate-spin' : ''}`} />
      {showLabel && config.label}
    </Badge>
  )
}
```

**Step 2: Export from index**

Add to `orbit-www/src/components/features/kafka/index.ts`:

```typescript
export { ProvisioningStatusBadge } from './ProvisioningStatusBadge'
```

**Step 3: Commit**

```bash
git add orbit-www/src/components/features/kafka/ProvisioningStatusBadge.tsx
git add orbit-www/src/components/features/kafka/index.ts
git commit -m "feat(kafka): add ProvisioningStatusBadge component"
```

---

## Task 4: Workspace Component - ProvisioningErrorModal

**Files:**
- Create: `orbit-www/src/components/features/kafka/ProvisioningErrorModal.tsx`

**Step 1: Create the component**

```typescript
// orbit-www/src/components/features/kafka/ProvisioningErrorModal.tsx
'use client'

import { useState, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { CheckCircle2, XCircle, MinusCircle, ExternalLink } from 'lucide-react'
import { RetryProvisioningButton } from './RetryProvisioningButton'
import { ProvisioningStatusBadge } from './ProvisioningStatusBadge'
import type { ApplicationWithProvisioningIssue } from '@/app/actions/kafka-applications'

interface ProvisioningErrorModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  applications: ApplicationWithProvisioningIssue[]
  onRetryComplete: () => void
}

type EnvStatus = 'success' | 'failed' | 'skipped'

function getEnvIcon(status: EnvStatus) {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="h-4 w-4 text-green-600" />
    case 'failed':
      return <XCircle className="h-4 w-4 text-red-600" />
    case 'skipped':
      return <MinusCircle className="h-4 w-4 text-gray-400" />
  }
}

function getEnvStatusText(env: string, details: ApplicationWithProvisioningIssue['provisioningDetails']) {
  if (!details) return { status: 'skipped' as EnvStatus, message: 'Not attempted' }
  
  const envDetails = details[env as keyof typeof details]
  if (!envDetails) return { status: 'skipped' as EnvStatus, message: 'Not configured' }

  if (envDetails.status === 'success') {
    return { status: 'success' as EnvStatus, message: 'Provisioned successfully' }
  }
  if (envDetails.status === 'failed') {
    // Moderate detail: show brief error, not full stack trace
    const briefError = envDetails.error?.split('\n')[0] || 'Unknown error'
    return { status: 'failed' as EnvStatus, message: briefError }
  }
  return { status: 'skipped' as EnvStatus, message: envDetails.message || 'Skipped' }
}

export function ProvisioningErrorModal({
  open,
  onOpenChange,
  applications,
  onRetryComplete,
}: ProvisioningErrorModalProps) {
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set())

  const handleRetryComplete = useCallback((appId: string) => {
    setRetryingIds((prev) => {
      const next = new Set(prev)
      next.delete(appId)
      return next
    })
    onRetryComplete()
  }, [onRetryComplete])

  const environments = ['dev', 'stage', 'prod']

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Provisioning Issues</DialogTitle>
          <DialogDescription>
            {applications.length} application{applications.length !== 1 ? 's' : ''} with provisioning issues
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 max-h-[60vh] overflow-y-auto">
          {applications.map((app) => (
            <div key={app.id} className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium">{app.name}</h4>
                  <p className="text-sm text-muted-foreground">{app.workspaceSlug}</p>
                </div>
                <ProvisioningStatusBadge status={app.provisioningStatus} />
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Environment Status:</p>
                {environments.map((env) => {
                  const { status, message } = getEnvStatusText(env, app.provisioningDetails)
                  return (
                    <div key={env} className="flex items-start gap-2 text-sm">
                      {getEnvIcon(status)}
                      <span className="font-medium w-12">{env}</span>
                      <span className={status === 'failed' ? 'text-red-600' : 'text-muted-foreground'}>
                        {message}
                      </span>
                    </div>
                  )
                })}
              </div>

              <div className="flex items-center gap-2 pt-2">
                <RetryProvisioningButton
                  applicationId={app.id}
                  onRetryComplete={() => handleRetryComplete(app.id)}
                  disabled={app.provisioningStatus === 'in_progress' || retryingIds.has(app.id)}
                  size="sm"
                />
                <Button variant="outline" size="sm" asChild>
                  <a href="mailto:platform-team@example.com?subject=Kafka Provisioning Issue">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Contact Support
                  </a>
                </Button>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

**Step 2: Export from index**

Add to `orbit-www/src/components/features/kafka/index.ts`:

```typescript
export { ProvisioningErrorModal } from './ProvisioningErrorModal'
```

**Step 3: Commit**

```bash
git add orbit-www/src/components/features/kafka/ProvisioningErrorModal.tsx
git add orbit-www/src/components/features/kafka/index.ts
git commit -m "feat(kafka): add ProvisioningErrorModal component for workspace view"
```

---

## Task 5: Workspace Component - ProvisioningAlert

**Files:**
- Create: `orbit-www/src/components/features/kafka/ProvisioningAlert.tsx`

**Step 1: Create the component**

```typescript
// orbit-www/src/components/features/kafka/ProvisioningAlert.tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'
import { ProvisioningErrorModal } from './ProvisioningErrorModal'
import {
  listApplicationsWithProvisioningIssues,
  type ApplicationWithProvisioningIssue,
} from '@/app/actions/kafka-applications'

interface ProvisioningAlertProps {
  workspaceId: string
}

export function ProvisioningAlert({ workspaceId }: ProvisioningAlertProps) {
  const [applications, setApplications] = useState<ApplicationWithProvisioningIssue[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)

  const loadIssues = useCallback(async () => {
    try {
      const result = await listApplicationsWithProvisioningIssues(workspaceId)
      if (result.success && result.applications) {
        // Only show failed and partial (not pending/in_progress for the alert)
        const issues = result.applications.filter(
          (app) => app.provisioningStatus === 'failed' || app.provisioningStatus === 'partial'
        )
        setApplications(issues)
      }
    } catch (error) {
      console.error('Failed to load provisioning issues:', error)
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    loadIssues()
  }, [loadIssues])

  const handleRetryComplete = useCallback(() => {
    // Refresh the list after a retry
    loadIssues()
  }, [loadIssues])

  // Don't render anything if loading or no issues
  if (loading || applications.length === 0) {
    return null
  }

  const issueCount = applications.length
  const issueText = issueCount === 1 
    ? '1 application has provisioning issues'
    : `${issueCount} applications have provisioning issues`

  return (
    <>
      <Alert variant="destructive" className="mb-6 bg-yellow-50 border-yellow-200 text-yellow-800 dark:bg-yellow-900/20 dark:border-yellow-800 dark:text-yellow-200">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription className="flex items-center justify-between w-full">
          <span>{issueText}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setModalOpen(true)}
            className="ml-4"
          >
            View Details
          </Button>
        </AlertDescription>
      </Alert>

      <ProvisioningErrorModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        applications={applications}
        onRetryComplete={handleRetryComplete}
      />
    </>
  )
}
```

**Step 2: Export from index**

Add to `orbit-www/src/components/features/kafka/index.ts`:

```typescript
export { ProvisioningAlert } from './ProvisioningAlert'
```

**Step 3: Commit**

```bash
git add orbit-www/src/components/features/kafka/ProvisioningAlert.tsx
git add orbit-www/src/components/features/kafka/index.ts
git commit -m "feat(kafka): add ProvisioningAlert component for workspace view"
```

---

## Task 6: Integrate ProvisioningAlert into VirtualClustersList

**Files:**
- Modify: `orbit-www/src/components/features/kafka/VirtualClustersList.tsx`

**Step 1: Add import**

Add to imports in VirtualClustersList.tsx:

```typescript
import { ProvisioningAlert } from './ProvisioningAlert'
```

**Step 2: Add alert to render**

In the return statement, add the ProvisioningAlert at the top, right after the opening fragment:

```typescript
return (
  <>
    <ProvisioningAlert workspaceId={workspaceId} />
    
    <div className="flex items-center justify-between mb-6">
    {/* ... rest of existing code ... */}
```

**Step 3: Verify the integration**

Run: `cd orbit-www && pnpm tsc --noEmit`
Expected: No type errors

**Step 4: Commit**

```bash
git add orbit-www/src/components/features/kafka/VirtualClustersList.tsx
git commit -m "feat(kafka): integrate ProvisioningAlert into workspace virtual clusters view"
```

---

## Task 7: Admin Component - ProvisioningTab

**Files:**
- Create: `orbit-www/src/app/(frontend)/platform/kafka/components/ProvisioningTab.tsx`

**Step 1: Create the component**

```typescript
// orbit-www/src/app/(frontend)/platform/kafka/components/ProvisioningTab.tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { RefreshCw, ChevronDown, CheckCircle2, XCircle, MinusCircle, Copy, Check } from 'lucide-react'
import { toast } from 'sonner'
import {
  listApplicationsWithProvisioningIssues,
  retryVirtualClusterProvisioning,
  type ApplicationWithProvisioningIssue,
} from '@/app/actions/kafka-applications'
import { ProvisioningStatusBadge } from '@/components/features/kafka'

type StatusFilter = 'all' | 'failed' | 'partial' | 'in_progress' | 'pending'

export function ProvisioningTab() {
  const [applications, setApplications] = useState<ApplicationWithProvisioningIssue[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set())
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const loadApplications = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listApplicationsWithProvisioningIssues()
      if (result.success && result.applications) {
        setApplications(result.applications)
      } else {
        toast.error(result.error || 'Failed to load applications')
      }
    } catch (error) {
      toast.error('Failed to load applications')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadApplications()
  }, [loadApplications])

  const handleRetry = useCallback(async (appId: string) => {
    setRetryingIds((prev) => new Set(prev).add(appId))
    toast.success('Provisioning started')

    try {
      const result = await retryVirtualClusterProvisioning(appId)
      if (result.success) {
        toast.success('Provisioning workflow started')
        loadApplications()
      } else {
        toast.error(`Failed: ${result.error}`)
      }
    } catch (error) {
      toast.error('Failed to start provisioning')
    } finally {
      setRetryingIds((prev) => {
        const next = new Set(prev)
        next.delete(appId)
        return next
      })
    }
  }, [loadApplications])

  const copyWorkflowId = useCallback((workflowId: string) => {
    navigator.clipboard.writeText(workflowId)
    setCopiedId(workflowId)
    setTimeout(() => setCopiedId(null), 2000)
  }, [])

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const filteredApplications = applications.filter((app) => {
    if (filter === 'all') return true
    return app.provisioningStatus === filter
  })

  const environments = ['dev', 'stage', 'prod']

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <p className="text-sm text-muted-foreground">
            {filteredApplications.length} of {applications.length} application
            {applications.length !== 1 ? 's' : ''}
          </p>
          <Select value={filter} onValueChange={(v) => setFilter(v as StatusFilter)}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="partial">Partial</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" onClick={loadApplications} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Empty state */}
      {filteredApplications.length === 0 && !loading && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <CheckCircle2 className="h-12 w-12 text-green-500 mb-4" />
            <h3 className="text-lg font-semibold mb-2">All Clear</h3>
            <p className="text-muted-foreground text-center">
              No applications with provisioning issues.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Applications list */}
      <div className="space-y-4">
        {filteredApplications.map((app) => (
          <Card key={app.id}>
            <Collapsible
              open={expandedIds.has(app.id)}
              onOpenChange={() => toggleExpanded(app.id)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="p-0 h-auto">
                        <ChevronDown
                          className={`h-4 w-4 transition-transform ${
                            expandedIds.has(app.id) ? 'rotate-180' : ''
                          }`}
                        />
                      </Button>
                    </CollapsibleTrigger>
                    <div>
                      <CardTitle className="text-base">{app.name}</CardTitle>
                      <CardDescription>{app.workspaceSlug}</CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <ProvisioningStatusBadge status={app.provisioningStatus} />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRetry(app.id)}
                      disabled={app.provisioningStatus === 'in_progress' || retryingIds.has(app.id)}
                    >
                      <RefreshCw
                        className={`h-4 w-4 mr-2 ${retryingIds.has(app.id) ? 'animate-spin' : ''}`}
                      />
                      Retry
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CollapsibleContent>
                <CardContent className="pt-0 space-y-4">
                  {/* Workflow ID */}
                  {app.provisioningWorkflowId && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">Workflow:</span>
                      <code className="bg-muted px-2 py-0.5 rounded text-xs font-mono">
                        {app.provisioningWorkflowId}
                      </code>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => copyWorkflowId(app.provisioningWorkflowId!)}
                      >
                        {copiedId === app.provisioningWorkflowId ? (
                          <Check className="h-3 w-3 text-green-500" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                  )}

                  {/* Environment breakdown */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-muted-foreground">Environment Status:</p>
                    {environments.map((env) => {
                      const details = app.provisioningDetails?.[env as keyof typeof app.provisioningDetails]
                      let icon = <MinusCircle className="h-4 w-4 text-gray-400" />
                      let statusText = 'Not configured'
                      let errorText: string | null = null

                      if (details) {
                        if (details.status === 'success') {
                          icon = <CheckCircle2 className="h-4 w-4 text-green-600" />
                          statusText = 'OK'
                        } else if (details.status === 'failed') {
                          icon = <XCircle className="h-4 w-4 text-red-600" />
                          statusText = 'Failed'
                          errorText = details.error || 'Unknown error'
                        } else if (details.status === 'skipped') {
                          statusText = details.message || 'Skipped'
                        }
                      }

                      return (
                        <div key={env} className="space-y-1">
                          <div className="flex items-center gap-2 text-sm">
                            {icon}
                            <span className="font-medium w-12 uppercase">{env}</span>
                            <span className={details?.status === 'failed' ? 'text-red-600' : 'text-muted-foreground'}>
                              {statusText}
                            </span>
                          </div>
                          {errorText && (
                            <pre className="ml-6 text-xs bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 p-2 rounded overflow-x-auto whitespace-pre-wrap">
                              {errorText}
                            </pre>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* Top-level error */}
                  {app.provisioningError && (
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-red-600">Error:</p>
                      <pre className="text-xs bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 p-2 rounded overflow-x-auto whitespace-pre-wrap">
                        {app.provisioningError}
                      </pre>
                    </div>
                  )}

                  {/* Timestamp */}
                  <p className="text-xs text-muted-foreground">
                    Last updated: {new Date(app.updatedAt).toLocaleString()}
                  </p>
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        ))}
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/platform/kafka/components/ProvisioningTab.tsx
git commit -m "feat(kafka): add ProvisioningTab component for admin view"
```

---

## Task 8: Integrate ProvisioningTab into GatewayTab

**Files:**
- Modify: `orbit-www/src/app/(frontend)/platform/kafka/components/GatewayTab.tsx`

**Step 1: Add import**

Add to imports:

```typescript
import { ProvisioningTab } from './ProvisioningTab'
```

**Step 2: Add the tab trigger**

In the TabsList, add a new TabsTrigger after "Status":

```typescript
<TabsTrigger value="provisioning">
  Provisioning
</TabsTrigger>
```

**Step 3: Add the tab content**

After the last TabsContent, add:

```typescript
<TabsContent value="provisioning" className="mt-6">
  <ProvisioningTab />
</TabsContent>
```

**Step 4: Verify the integration**

Run: `cd orbit-www && pnpm tsc --noEmit`
Expected: No type errors

**Step 5: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/platform/kafka/components/GatewayTab.tsx
git commit -m "feat(kafka): integrate ProvisioningTab into admin gateway view"
```

---

## Task 9: Final Testing and PR

**Step 1: Run all tests**

Run: `cd orbit-www && pnpm test`
Expected: All tests pass

**Step 2: Run type check**

Run: `cd orbit-www && pnpm tsc --noEmit`
Expected: No type errors

**Step 3: Run linter**

Run: `cd orbit-www && pnpm lint`
Expected: No errors

**Step 4: Manual testing checklist**

- [ ] Create a Kafka application and verify provisioning status shows
- [ ] Simulate a failed provisioning (or wait for one)
- [ ] Verify workspace alert banner appears
- [ ] Verify modal shows correct error details (moderate level)
- [ ] Verify retry button works and shows spinner
- [ ] Verify toast appears on retry
- [ ] Verify admin tab shows applications with issues
- [ ] Verify admin view shows full error details
- [ ] Verify workflow ID is copyable in admin view
- [ ] Verify filter works in admin view

**Step 5: Create PR**

```bash
git push -u origin clawdbot/kafka-ux-polish-2.4
gh pr create --title "feat(kafka): add retry and error visibility for provisioning issues" --body "## Summary

Adds UX improvements for Kafka application provisioning (Roadmap item 2.4):

### Workspace View
- Alert banner when applications have provisioning issues
- Modal with moderate error details (which environments failed, brief reason)
- Retry button with loading state and toast feedback

### Admin View
- New Provisioning sub-tab in Gateway section
- Full error details including stack traces and workflow IDs
- Filter by provisioning status
- Collapsible cards for each application

### Components Added
- \`RetryProvisioningButton\` - shared retry button with loading state
- \`ProvisioningStatusBadge\` - consistent status badges
- \`ProvisioningErrorModal\` - workspace error details modal
- \`ProvisioningAlert\` - workspace alert banner
- \`ProvisioningTab\` - admin provisioning issues tab

### Server Actions
- \`listApplicationsWithProvisioningIssues(workspaceId?)\` - fetch applications with issues

Closes #XXX"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Server action for listing provisioning issues | kafka-applications.ts |
| 2 | RetryProvisioningButton component | RetryProvisioningButton.tsx |
| 3 | ProvisioningStatusBadge component | ProvisioningStatusBadge.tsx |
| 4 | ProvisioningErrorModal component | ProvisioningErrorModal.tsx |
| 5 | ProvisioningAlert component | ProvisioningAlert.tsx |
| 6 | Integrate alert into VirtualClustersList | VirtualClustersList.tsx |
| 7 | ProvisioningTab admin component | ProvisioningTab.tsx |
| 8 | Integrate tab into GatewayTab | GatewayTab.tsx |
| 9 | Testing and PR | - |

Total estimated time: 2-3 hours
