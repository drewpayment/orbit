# Deployment UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a complete deployment management UI with progress tracking, generated file preview, and commit-to-repo functionality.

**Architecture:** React components using shadcn/ui, server actions for data fetching, client-side polling for progress updates. Expandable table rows show deployment progress and generated files.

**Tech Stack:** Next.js 15, React 19, shadcn/ui, Zod validation, Payload CMS, Connect-RPC client

---

## Phase 1: Core Infrastructure

### Task 1.1: Add generatedFiles Field to Deployments Collection

**Files:**
- Modify: `orbit-www/src/collections/Deployments.ts:251` (before timestamps)

**Step 1: Add the field**

Add after `deploymentError` field (line 251):

```typescript
    {
      name: 'generatedFiles',
      type: 'json',
      admin: {
        readOnly: true,
        description: 'Generated deployment files awaiting commit',
      },
    },
```

**Step 2: Verify TypeScript**

Run: `cd orbit-www && bunx tsc --noEmit 2>&1 | head -20`
Expected: No new errors

**Step 3: Commit**

```bash
git add orbit-www/src/collections/Deployments.ts
git commit -m "feat: add generatedFiles field to Deployments collection"
```

---

### Task 1.2: Create getDeploymentGenerators Server Action

**Files:**
- Modify: `orbit-www/src/app/actions/deployments.ts`

**Step 1: Add the server action**

Add at end of file:

```typescript
export async function getDeploymentGenerators() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized', generators: [] }
  }

  const payload = await getPayload({ config })

  try {
    const generators = await payload.find({
      collection: 'deployment-generators',
      where: {
        or: [
          { isBuiltIn: { equals: true } },
          // Future: workspace-specific generators
        ],
      },
      limit: 100,
    })

    return {
      success: true,
      generators: generators.docs.map(g => ({
        id: g.id,
        name: g.name,
        slug: g.slug,
        type: g.type,
        description: g.description,
        configSchema: g.configSchema,
      })),
    }
  } catch (error) {
    console.error('Failed to fetch generators:', error)
    return { success: false, error: 'Failed to fetch generators', generators: [] }
  }
}
```

**Step 2: Verify TypeScript**

Run: `cd orbit-www && bunx tsc --noEmit 2>&1 | head -20`
Expected: No new errors

**Step 3: Commit**

```bash
git add orbit-www/src/app/actions/deployments.ts
git commit -m "feat: add getDeploymentGenerators server action"
```

---

### Task 1.3: Update deploymentStatusColors in AppDetail

**Files:**
- Modify: `orbit-www/src/components/features/apps/AppDetail.tsx:43-48`

**Step 1: Add 'generated' status color**

Replace the `deploymentStatusColors` object:

```typescript
const deploymentStatusColors: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-800',
  deploying: 'bg-blue-100 text-blue-800',
  generated: 'bg-purple-100 text-purple-800',
  deployed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
}
```

**Step 2: Verify no TypeScript errors**

Run: `cd orbit-www && bunx tsc --noEmit 2>&1 | head -20`

**Step 3: Commit**

```bash
git add orbit-www/src/components/features/apps/AppDetail.tsx
git commit -m "feat: add 'generated' status color to deployment badges"
```

---

## Phase 2: Expandable Deployment Row

### Task 2.1: Create DeploymentRow Component

**Files:**
- Create: `orbit-www/src/components/features/apps/DeploymentRow.tsx`

**Step 1: Create the component**

```typescript
'use client'

import { useState } from 'react'
import { TableCell, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  ChevronDown,
  ChevronRight,
  Play,
  Pencil,
  Trash2,
  Loader2,
} from 'lucide-react'
import type { Deployment } from '@/payload-types'

const statusConfig = {
  healthy: { icon: CheckCircle2, color: 'text-green-500' },
  degraded: { icon: AlertTriangle, color: 'text-yellow-500' },
  down: { icon: XCircle, color: 'text-red-500' },
  unknown: { icon: HelpCircle, color: 'text-gray-400' },
}

const deploymentStatusColors: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-800',
  deploying: 'bg-blue-100 text-blue-800',
  generated: 'bg-purple-100 text-purple-800',
  deployed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
}

interface DeploymentRowProps {
  deployment: Deployment
  onDeploy: (id: string) => Promise<void>
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}

export function DeploymentRow({
  deployment,
  onDeploy,
  onEdit,
  onDelete,
}: DeploymentRowProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isDeploying, setIsDeploying] = useState(false)

  const healthStatus = deployment.healthStatus || 'unknown'
  const HealthIcon = statusConfig[healthStatus].icon
  const status = deployment.status || 'pending'

  const handleDeploy = async () => {
    setIsDeploying(true)
    setIsExpanded(true)
    try {
      await onDeploy(deployment.id)
    } finally {
      setIsDeploying(false)
    }
  }

  const canDeploy = status === 'pending' || status === 'failed' || status === 'generated'

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded} asChild>
      <>
        <TableRow className="cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
          <TableCell className="w-8">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </TableCell>
          <TableCell className="font-medium">{deployment.name}</TableCell>
          <TableCell>
            <Badge variant="outline">{deployment.generator}</Badge>
          </TableCell>
          <TableCell>{deployment.target?.type || '-'}</TableCell>
          <TableCell>
            <Badge className={deploymentStatusColors[status]}>
              {status}
            </Badge>
          </TableCell>
          <TableCell>
            <div className="flex items-center gap-1">
              <HealthIcon className={`h-4 w-4 ${statusConfig[healthStatus].color}`} />
              <span className="capitalize">{healthStatus}</span>
            </div>
          </TableCell>
          <TableCell>
            {deployment.lastDeployedAt
              ? new Date(deployment.lastDeployedAt).toLocaleString()
              : 'Never'}
          </TableCell>
          <TableCell onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-1">
              {canDeploy && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDeploy}
                  disabled={isDeploying}
                >
                  {isDeploying ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => onEdit(deployment.id)}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onDelete(deployment.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </TableCell>
        </TableRow>
        <CollapsibleContent asChild>
          <TableRow>
            <TableCell colSpan={8} className="bg-muted/50 p-4">
              {/* Progress panel will go here in next task */}
              <div className="text-sm text-muted-foreground">
                Deployment details for {deployment.name}
                {deployment.workflowId && (
                  <span className="ml-2 font-mono text-xs">
                    Workflow: {deployment.workflowId}
                  </span>
                )}
              </div>
            </TableCell>
          </TableRow>
        </CollapsibleContent>
      </>
    </Collapsible>
  )
}
```

**Step 2: Verify TypeScript**

Run: `cd orbit-www && bunx tsc --noEmit 2>&1 | head -20`

**Step 3: Commit**

```bash
git add orbit-www/src/components/features/apps/DeploymentRow.tsx
git commit -m "feat: create DeploymentRow component with expand/collapse"
```

---

### Task 2.2: Integrate DeploymentRow into AppDetail

**Files:**
- Modify: `orbit-www/src/components/features/apps/AppDetail.tsx`

**Step 1: Add imports**

Add to imports section:

```typescript
import { DeploymentRow } from './DeploymentRow'
import { startDeployment } from '@/app/actions/deployments'
import { toast } from 'sonner'
```

**Step 2: Add handler functions**

Add inside the `AppDetail` component, after the state declarations:

```typescript
  const handleDeploy = async (deploymentId: string) => {
    const result = await startDeployment(deploymentId)
    if (result.success) {
      toast.success('Deployment started')
      router.refresh()
    } else {
      toast.error(result.error || 'Failed to start deployment')
    }
  }

  const handleEditDeployment = (deploymentId: string) => {
    // TODO: Open edit modal
    console.log('Edit deployment:', deploymentId)
  }

  const handleDeleteDeployment = (deploymentId: string) => {
    // TODO: Confirm and delete
    console.log('Delete deployment:', deploymentId)
  }
```

**Step 3: Add router import**

Add `useRouter` to imports and add inside component:

```typescript
import { useRouter } from 'next/navigation'
// Inside component:
const router = useRouter()
```

**Step 4: Update table to use DeploymentRow**

Replace the table header row to add expand column, and replace TableBody content:

```typescript
<TableHeader>
  <TableRow>
    <TableHead className="w-8"></TableHead>
    <TableHead>Name</TableHead>
    <TableHead>Generator</TableHead>
    <TableHead>Target</TableHead>
    <TableHead>Status</TableHead>
    <TableHead>Health</TableHead>
    <TableHead>Last Deployed</TableHead>
    <TableHead></TableHead>
  </TableRow>
</TableHeader>
<TableBody>
  {deployments.map((deployment) => (
    <DeploymentRow
      key={deployment.id}
      deployment={deployment}
      onDeploy={handleDeploy}
      onEdit={handleEditDeployment}
      onDelete={handleDeleteDeployment}
    />
  ))}
</TableBody>
```

**Step 5: Verify and test**

Run: `cd orbit-www && bunx tsc --noEmit 2>&1 | head -20`

**Step 6: Commit**

```bash
git add orbit-www/src/components/features/apps/AppDetail.tsx
git commit -m "feat: integrate DeploymentRow with deploy action"
```

---

## Phase 3: Progress Panel

### Task 3.1: Create ProgressSteps Component

**Files:**
- Create: `orbit-www/src/components/features/apps/ProgressSteps.tsx`

**Step 1: Create the component**

```typescript
'use client'

import { CheckCircle2, Circle, Loader2 } from 'lucide-react'
import { Progress } from '@/components/ui/progress'

interface ProgressStepsProps {
  currentStep: string
  stepsTotal: number
  stepsCurrent: number
  message: string
  status: string
}

const STEP_NAMES = [
  'Initializing',
  'Validating',
  'Preparing',
  'Generating',
  'Finalizing',
]

export function ProgressSteps({
  currentStep,
  stepsTotal,
  stepsCurrent,
  message,
  status,
}: ProgressStepsProps) {
  const progressPercent = stepsTotal > 0 ? (stepsCurrent / stepsTotal) * 100 : 0
  const isComplete = status === 'generated' || status === 'deployed'
  const isFailed = status === 'failed'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">
          Step {stepsCurrent} of {stepsTotal}: {message}
        </span>
        <span className="text-sm text-muted-foreground">{Math.round(progressPercent)}%</span>
      </div>

      <Progress value={progressPercent} className="h-2" />

      <div className="flex flex-col gap-2">
        {STEP_NAMES.slice(0, stepsTotal).map((step, index) => {
          const stepNum = index + 1
          const isCurrentStep = stepNum === stepsCurrent
          const isCompleted = stepNum < stepsCurrent || isComplete

          return (
            <div key={step} className="flex items-center gap-2 text-sm">
              {isCompleted ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : isCurrentStep ? (
                <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              ) : (
                <Circle className="h-4 w-4 text-gray-300" />
              )}
              <span className={isCompleted ? 'text-muted-foreground' : ''}>
                {step}
              </span>
            </div>
          )
        })}
      </div>

      {isFailed && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          Deployment failed. Check the error details below.
        </div>
      )}
    </div>
  )
}
```

**Step 2: Verify TypeScript**

Run: `cd orbit-www && bunx tsc --noEmit 2>&1 | head -20`

**Step 3: Commit**

```bash
git add orbit-www/src/components/features/apps/ProgressSteps.tsx
git commit -m "feat: create ProgressSteps component"
```

---

### Task 3.2: Create DeploymentProgressPanel Component

**Files:**
- Create: `orbit-www/src/components/features/apps/DeploymentProgressPanel.tsx`

**Step 1: Create the component**

```typescript
'use client'

import { useState, useEffect, useCallback } from 'react'
import { ProgressSteps } from './ProgressSteps'
import { getDeploymentWorkflowProgress } from '@/app/actions/deployments'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Deployment } from '@/payload-types'

interface DeploymentProgressPanelProps {
  deployment: Deployment
  isExpanded: boolean
  onRetry: () => void
}

interface ProgressData {
  currentStep: string
  stepsTotal: number
  stepsCurrent: number
  message: string
  status: string
}

export function DeploymentProgressPanel({
  deployment,
  isExpanded,
  onRetry,
}: DeploymentProgressPanelProps) {
  const [progress, setProgress] = useState<ProgressData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPolling, setIsPolling] = useState(false)

  const status = deployment.status || 'pending'
  const workflowId = deployment.workflowId

  const fetchProgress = useCallback(async () => {
    if (!workflowId) return

    try {
      const result = await getDeploymentWorkflowProgress(workflowId)
      if (result.success) {
        setProgress({
          currentStep: result.currentStep || '',
          stepsTotal: result.stepsTotal || 5,
          stepsCurrent: result.stepsCurrent || 0,
          message: result.message || '',
          status: result.status || 'running',
        })
        setError(null)
      } else {
        setError(result.error || 'Failed to fetch progress')
      }
    } catch (err) {
      setError('Connection error')
    }
  }, [workflowId])

  useEffect(() => {
    if (!isExpanded || !workflowId) return
    if (status !== 'deploying') return

    setIsPolling(true)
    fetchProgress()

    const interval = setInterval(fetchProgress, 2000)

    return () => {
      clearInterval(interval)
      setIsPolling(false)
    }
  }, [isExpanded, workflowId, status, fetchProgress])

  // No workflow yet
  if (!workflowId && status === 'pending') {
    return (
      <div className="text-sm text-muted-foreground p-4">
        Click Deploy to start this deployment.
      </div>
    )
  }

  // Show error state
  if (status === 'failed') {
    return (
      <div className="space-y-4 p-4">
        <div className="flex items-start gap-3 rounded-md bg-red-50 p-4">
          <AlertCircle className="h-5 w-5 text-red-500 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-red-800">Deployment Failed</p>
            <p className="text-sm text-red-700 mt-1">
              {deployment.deploymentError || 'An unknown error occurred'}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry Deployment
        </Button>
      </div>
    )
  }

  // Show progress
  if (status === 'deploying' && progress) {
    return (
      <div className="p-4">
        <ProgressSteps
          currentStep={progress.currentStep}
          stepsTotal={progress.stepsTotal}
          stepsCurrent={progress.stepsCurrent}
          message={progress.message}
          status={progress.status}
        />
        {error && (
          <p className="text-sm text-amber-600 mt-2">
            {error} - Retrying...
          </p>
        )}
      </div>
    )
  }

  // Generated state - will add file preview in Phase 4
  if (status === 'generated') {
    return (
      <div className="p-4">
        <div className="rounded-md bg-purple-50 p-4">
          <p className="font-medium text-purple-800">Files Generated</p>
          <p className="text-sm text-purple-700 mt-1">
            Deployment files have been generated. Review and commit below.
          </p>
        </div>
        {/* GeneratedFilesView will go here */}
      </div>
    )
  }

  // Deployed state
  if (status === 'deployed') {
    return (
      <div className="p-4">
        <div className="rounded-md bg-green-50 p-4">
          <p className="font-medium text-green-800">Deployed Successfully</p>
          {deployment.target?.url && (
            <a
              href={deployment.target.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-green-700 hover:underline mt-1 block"
            >
              {deployment.target.url}
            </a>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="text-sm text-muted-foreground p-4">
      Loading...
    </div>
  )
}
```

**Step 2: Verify TypeScript**

Run: `cd orbit-www && bunx tsc --noEmit 2>&1 | head -20`

**Step 3: Commit**

```bash
git add orbit-www/src/components/features/apps/DeploymentProgressPanel.tsx
git commit -m "feat: create DeploymentProgressPanel with polling"
```

---

### Task 3.3: Integrate Progress Panel into DeploymentRow

**Files:**
- Modify: `orbit-www/src/components/features/apps/DeploymentRow.tsx`

**Step 1: Add import**

```typescript
import { DeploymentProgressPanel } from './DeploymentProgressPanel'
```

**Step 2: Replace placeholder in CollapsibleContent**

Replace the placeholder div inside CollapsibleContent:

```typescript
<CollapsibleContent asChild>
  <TableRow>
    <TableCell colSpan={8} className="bg-muted/50 p-0">
      <DeploymentProgressPanel
        deployment={deployment}
        isExpanded={isExpanded}
        onRetry={handleDeploy}
      />
    </TableCell>
  </TableRow>
</CollapsibleContent>
```

**Step 3: Verify TypeScript**

Run: `cd orbit-www && bunx tsc --noEmit 2>&1 | head -20`

**Step 4: Commit**

```bash
git add orbit-www/src/components/features/apps/DeploymentRow.tsx
git commit -m "feat: integrate progress panel into deployment row"
```

---

## Phase 4: Generated Files View

### Task 4.1: Create GeneratedFilesView Component

**Files:**
- Create: `orbit-www/src/components/features/apps/GeneratedFilesView.tsx`

**Step 1: Create the component**

```typescript
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Check, Copy, FileCode } from 'lucide-react'
import { toast } from 'sonner'

interface GeneratedFile {
  path: string
  content: string
}

interface GeneratedFilesViewProps {
  files: GeneratedFile[]
}

export function GeneratedFilesView({ files }: GeneratedFilesViewProps) {
  const [copiedFile, setCopiedFile] = useState<string | null>(null)

  const handleCopy = async (file: GeneratedFile) => {
    try {
      await navigator.clipboard.writeText(file.content)
      setCopiedFile(file.path)
      toast.success(`Copied ${file.path}`)
      setTimeout(() => setCopiedFile(null), 2000)
    } catch {
      toast.error('Failed to copy to clipboard')
    }
  }

  if (files.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No files generated.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-medium flex items-center gap-2">
        <FileCode className="h-4 w-4" />
        Generated Files
      </h4>

      {files.map((file) => (
        <div key={file.path} className="rounded-md border">
          <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b">
            <span className="text-sm font-mono">{file.path}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleCopy(file)}
            >
              {copiedFile === file.path ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
          <ScrollArea className="h-[200px]">
            <pre className="p-3 text-sm font-mono whitespace-pre-wrap">
              {file.content}
            </pre>
          </ScrollArea>
        </div>
      ))}
    </div>
  )
}
```

**Step 2: Verify TypeScript**

Run: `cd orbit-www && bunx tsc --noEmit 2>&1 | head -20`

**Step 3: Commit**

```bash
git add orbit-www/src/components/features/apps/GeneratedFilesView.tsx
git commit -m "feat: create GeneratedFilesView component"
```

---

### Task 4.2: Create CommitToRepoForm Component

**Files:**
- Create: `orbit-www/src/components/features/apps/CommitToRepoForm.tsx`

**Step 1: Create the component**

```typescript
'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { GitBranch, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

const formSchema = z.object({
  branch: z.string().min(1, 'Branch is required'),
  newBranch: z.string().optional(),
  createNewBranch: z.boolean().default(false),
  message: z.string().min(1, 'Commit message is required'),
})

type FormData = z.infer<typeof formSchema>

interface CommitToRepoFormProps {
  deploymentId: string
  branches: string[]
  defaultBranch: string
  onCommit: (data: { branch: string; newBranch?: string; message: string }) => Promise<void>
}

export function CommitToRepoForm({
  deploymentId,
  branches,
  defaultBranch,
  onCommit,
}: CommitToRepoFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      branch: defaultBranch,
      newBranch: '',
      createNewBranch: false,
      message: 'chore: add deployment configuration',
    },
  })

  const createNewBranch = form.watch('createNewBranch')

  const onSubmit = async (data: FormData) => {
    setIsSubmitting(true)
    try {
      await onCommit({
        branch: data.createNewBranch ? '' : data.branch,
        newBranch: data.createNewBranch ? data.newBranch : undefined,
        message: data.message,
      })
      toast.success('Files committed successfully')
    } catch (error) {
      toast.error('Failed to commit files')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="rounded-md border p-4 mt-4">
      <h4 className="text-sm font-medium flex items-center gap-2 mb-4">
        <GitBranch className="h-4 w-4" />
        Commit to Repository
      </h4>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="createNewBranch"
            render={({ field }) => (
              <FormItem className="flex items-center gap-2">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
                <FormLabel className="!mt-0">Create new branch</FormLabel>
              </FormItem>
            )}
          />

          {createNewBranch ? (
            <FormField
              control={form.control}
              name="newBranch"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New Branch Name</FormLabel>
                  <FormControl>
                    <Input placeholder="feature/deployment-config" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : (
            <FormField
              control={form.control}
              name="branch"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Branch</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select branch" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {branches.map((branch) => (
                        <SelectItem key={branch} value={branch}>
                          {branch}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <FormField
            control={form.control}
            name="message"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Commit Message</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Committing...
              </>
            ) : (
              'Commit to Repository'
            )}
          </Button>
        </form>
      </Form>
    </div>
  )
}
```

**Step 2: Verify TypeScript**

Run: `cd orbit-www && bunx tsc --noEmit 2>&1 | head -20`

**Step 3: Commit**

```bash
git add orbit-www/src/components/features/apps/CommitToRepoForm.tsx
git commit -m "feat: create CommitToRepoForm component"
```

---

### Task 4.3: Add Server Actions for Files and Branches

**Files:**
- Modify: `orbit-www/src/app/actions/deployments.ts`

**Step 1: Add getGeneratedFiles action**

```typescript
export async function getGeneratedFiles(deploymentId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized', files: [] }
  }

  const payload = await getPayload({ config })

  try {
    const deployment = await payload.findByID({
      collection: 'deployments',
      id: deploymentId,
      depth: 0,
    })

    if (!deployment) {
      return { success: false, error: 'Deployment not found', files: [] }
    }

    const files = (deployment.generatedFiles as Array<{ path: string; content: string }>) || []
    return { success: true, files }
  } catch (error) {
    console.error('Failed to get generated files:', error)
    return { success: false, error: 'Failed to get generated files', files: [] }
  }
}
```

**Step 2: Add getRepoBranches action**

```typescript
export async function getRepoBranches(appId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized', branches: [] }
  }

  // For now, return default branches
  // TODO: Implement actual GitHub API call to fetch branches
  return {
    success: true,
    branches: ['main', 'develop'],
    defaultBranch: 'main',
  }
}
```

**Step 3: Add commitGeneratedFiles action**

```typescript
export async function commitGeneratedFiles(input: {
  deploymentId: string
  branch: string
  newBranch?: string
  message: string
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  try {
    const deployment = await payload.findByID({
      collection: 'deployments',
      id: input.deploymentId,
      depth: 1,
    })

    if (!deployment) {
      return { success: false, error: 'Deployment not found' }
    }

    // TODO: Implement actual commit via gRPC to repository service
    // For now, simulate success
    console.log('Would commit files:', {
      deploymentId: input.deploymentId,
      branch: input.newBranch || input.branch,
      message: input.message,
    })

    // Update deployment status
    await payload.update({
      collection: 'deployments',
      id: input.deploymentId,
      data: {
        status: 'deployed',
        lastDeployedAt: new Date().toISOString(),
      },
    })

    return { success: true, commitSha: 'placeholder-sha' }
  } catch (error) {
    console.error('Failed to commit files:', error)
    return { success: false, error: 'Failed to commit files' }
  }
}
```

**Step 4: Verify TypeScript**

Run: `cd orbit-www && bunx tsc --noEmit 2>&1 | head -20`

**Step 5: Commit**

```bash
git add orbit-www/src/app/actions/deployments.ts
git commit -m "feat: add server actions for files and commit"
```

---

### Task 4.4: Integrate Generated Files View into Progress Panel

**Files:**
- Modify: `orbit-www/src/components/features/apps/DeploymentProgressPanel.tsx`

**Step 1: Add imports**

```typescript
import { GeneratedFilesView } from './GeneratedFilesView'
import { CommitToRepoForm } from './CommitToRepoForm'
import { getGeneratedFiles, getRepoBranches, commitGeneratedFiles } from '@/app/actions/deployments'
```

**Step 2: Add state and fetch logic**

Add inside component, after existing state:

```typescript
const [files, setFiles] = useState<Array<{ path: string; content: string }>>([])
const [branches, setBranches] = useState<string[]>(['main'])
const [defaultBranch, setDefaultBranch] = useState('main')

// Fetch files when status is 'generated'
useEffect(() => {
  if (status === 'generated' && isExpanded) {
    getGeneratedFiles(deployment.id).then((result) => {
      if (result.success) {
        setFiles(result.files)
      }
    })

    // Get app ID for branches
    const appId = typeof deployment.app === 'string' ? deployment.app : deployment.app?.id
    if (appId) {
      getRepoBranches(appId).then((result) => {
        if (result.success) {
          setBranches(result.branches)
          setDefaultBranch(result.defaultBranch)
        }
      })
    }
  }
}, [status, isExpanded, deployment.id, deployment.app])

const handleCommit = async (data: { branch: string; newBranch?: string; message: string }) => {
  const result = await commitGeneratedFiles({
    deploymentId: deployment.id,
    ...data,
  })
  if (!result.success) {
    throw new Error(result.error)
  }
}
```

**Step 3: Update the 'generated' status section**

Replace the generated status section:

```typescript
// Generated state
if (status === 'generated') {
  return (
    <div className="p-4 space-y-4">
      <div className="rounded-md bg-purple-50 p-4">
        <p className="font-medium text-purple-800">Files Generated</p>
        <p className="text-sm text-purple-700 mt-1">
          Deployment files have been generated. Review and commit below.
        </p>
      </div>

      <GeneratedFilesView files={files} />

      <CommitToRepoForm
        deploymentId={deployment.id}
        branches={branches}
        defaultBranch={defaultBranch}
        onCommit={handleCommit}
      />
    </div>
  )
}
```

**Step 4: Verify TypeScript**

Run: `cd orbit-www && bunx tsc --noEmit 2>&1 | head -20`

**Step 5: Commit**

```bash
git add orbit-www/src/components/features/apps/DeploymentProgressPanel.tsx
git commit -m "feat: integrate generated files view with commit form"
```

---

## Phase 5: Dynamic Generator Form

### Task 5.1: Update AddDeploymentModal to Fetch Generators

**Files:**
- Modify: `orbit-www/src/components/features/apps/AddDeploymentModal.tsx`

**Step 1: Add import and state**

Add to imports:

```typescript
import { getDeploymentGenerators } from '@/app/actions/deployments'
```

Add state inside component:

```typescript
const [generators, setGenerators] = useState<Array<{
  id: string
  name: string
  slug: string
  type: string
  description?: string
}>>([])
const [loadingGenerators, setLoadingGenerators] = useState(true)
```

**Step 2: Add useEffect to fetch generators**

```typescript
useEffect(() => {
  if (open) {
    setLoadingGenerators(true)
    getDeploymentGenerators().then((result) => {
      if (result.success) {
        setGenerators(result.generators)
      }
      setLoadingGenerators(false)
    })
  }
}, [open])
```

**Step 3: Update the generator select field**

Replace the static Select with dynamic options:

```typescript
<FormField
  control={form.control}
  name="generator"
  render={({ field }) => (
    <FormItem>
      <FormLabel>Deployment Method</FormLabel>
      <Select
        onValueChange={field.onChange}
        defaultValue={field.value}
        disabled={loadingGenerators}
      >
        <FormControl>
          <SelectTrigger>
            <SelectValue placeholder={loadingGenerators ? "Loading..." : "Select method"} />
          </SelectTrigger>
        </FormControl>
        <SelectContent>
          {generators.map((gen) => (
            <SelectItem key={gen.slug} value={gen.type}>
              {gen.name}
            </SelectItem>
          ))}
          {generators.length === 0 && !loadingGenerators && (
            <SelectItem value="docker-compose">Docker Compose</SelectItem>
          )}
        </SelectContent>
      </Select>
      <FormMessage />
    </FormItem>
  )}
/>
```

**Step 4: Verify TypeScript**

Run: `cd orbit-www && bunx tsc --noEmit 2>&1 | head -20`

**Step 5: Commit**

```bash
git add orbit-www/src/components/features/apps/AddDeploymentModal.tsx
git commit -m "feat: fetch generators dynamically in AddDeploymentModal"
```

---

### Task 5.2: Seed DeploymentGenerators Collection

**Files:**
- Create: `orbit-www/src/app/api/seed-generators/route.ts`

**Step 1: Create seed API route**

```typescript
import { getPayload } from 'payload'
import config from '@payload-config'
import { builtInGenerators } from '@/lib/seeds/deployment-generators'
import { NextResponse } from 'next/server'

export async function POST() {
  const payload = await getPayload({ config })

  try {
    // Check if generators already exist
    const existing = await payload.find({
      collection: 'deployment-generators',
      where: { isBuiltIn: { equals: true } },
    })

    if (existing.docs.length > 0) {
      return NextResponse.json({
        message: 'Generators already seeded',
        count: existing.docs.length
      })
    }

    // Seed generators
    for (const generator of builtInGenerators) {
      await payload.create({
        collection: 'deployment-generators',
        data: {
          name: generator.name,
          slug: generator.slug,
          description: generator.description,
          type: generator.type,
          isBuiltIn: generator.isBuiltIn,
          configSchema: generator.configSchema,
          templateFiles: generator.templateFiles,
        },
      })
    }

    return NextResponse.json({
      message: 'Generators seeded successfully',
      count: builtInGenerators.length
    })
  } catch (error) {
    console.error('Seed failed:', error)
    return NextResponse.json({ error: 'Failed to seed generators' }, { status: 500 })
  }
}
```

**Step 2: Verify TypeScript**

Run: `cd orbit-www && bunx tsc --noEmit 2>&1 | head -20`

**Step 3: Commit**

```bash
git add orbit-www/src/app/api/seed-generators/route.ts
git commit -m "feat: add seed API route for deployment generators"
```

---

## Phase 6: Backend Workflow Adjustments

### Task 6.1: Modify Workflow to Store Generated Files

**Files:**
- Modify: `temporal-workflows/internal/workflows/deployment_workflow.go`

**Step 1: Update workflow to store files instead of auto-commit**

In the generate mode section (around line 232), change from calling CommitToRepo to storing files:

```go
// Step 4b: If generate mode, store files (don't auto-commit)
if mode == "generate" && len(executeResult.GeneratedFiles) > 0 {
    progress.CurrentStep = "storing"
    progress.Message = "Storing generated files"

    // Store files via status update instead of committing
    // The frontend will handle the commit with user-specified branch/message
    statusInput = UpdateDeploymentStatusInput{
        DeploymentID:   input.DeploymentID,
        Status:         "generated",
        GeneratedFiles: executeResult.GeneratedFiles,
    }
    err = workflow.ExecuteActivity(ctx, ActivityUpdateDeploymentStatus, statusInput).Get(ctx, nil)
    if err != nil {
        logger.Error("Failed to store generated files", "error", err)
    }
}
```

**Step 2: Update UpdateDeploymentStatusInput type**

Add GeneratedFiles field:

```go
type UpdateDeploymentStatusInput struct {
    DeploymentID   string          `json:"deploymentId"`
    Status         string          `json:"status"`
    DeploymentURL  string          `json:"deploymentUrl,omitempty"`
    ErrorMessage   string          `json:"errorMessage,omitempty"`
    GeneratedFiles []GeneratedFile `json:"generatedFiles,omitempty"`
}
```

**Step 3: Build and verify**

Run: `cd temporal-workflows && go build ./...`

**Step 4: Commit**

```bash
git add temporal-workflows/internal/workflows/deployment_workflow.go
git commit -m "feat: store generated files instead of auto-commit"
```

---

### Task 6.2: Update Activity to Store Files in Payload

**Files:**
- Modify: `temporal-workflows/internal/activities/deployment_activities.go`

**Step 1: Update UpdateDeploymentStatusInput type**

Add GeneratedFiles field to match workflow:

```go
type UpdateDeploymentStatusInput struct {
    DeploymentID   string          `json:"deploymentId"`
    Status         string          `json:"status"`
    DeploymentURL  string          `json:"deploymentUrl,omitempty"`
    ErrorMessage   string          `json:"errorMessage,omitempty"`
    GeneratedFiles []GeneratedFile `json:"generatedFiles,omitempty"`
}
```

**Step 2: Update PayloadDeploymentClient interface**

```go
type PayloadDeploymentClient interface {
    GetGeneratorBySlug(ctx context.Context, slug string) (*GeneratorData, error)
    UpdateDeploymentStatus(ctx context.Context, deploymentID, status, url, errorMsg string, generatedFiles []GeneratedFile) error
}
```

**Step 3: Update UpdateDeploymentStatus activity**

```go
func (a *DeploymentActivities) UpdateDeploymentStatus(ctx context.Context, input UpdateDeploymentStatusInput) error {
    a.logger.Info("Updating deployment status",
        "deploymentID", input.DeploymentID,
        "status", input.Status)

    if a.payloadClient == nil {
        a.logger.Warn("No Payload client configured, skipping status update")
        return nil
    }

    return a.payloadClient.UpdateDeploymentStatus(
        ctx,
        input.DeploymentID,
        input.Status,
        input.DeploymentURL,
        input.ErrorMessage,
        input.GeneratedFiles,
    )
}
```

**Step 4: Build and verify**

Run: `cd temporal-workflows && go build ./...`

**Step 5: Commit**

```bash
git add temporal-workflows/internal/activities/deployment_activities.go
git commit -m "feat: update activity to store generated files"
```

---

## Phase 7: Testing & Polish

### Task 7.1: Add Toast Provider to Layout

**Files:**
- Modify: `orbit-www/src/app/(frontend)/layout.tsx`

**Step 1: Check if Toaster is already added**

Look for `<Toaster />` from sonner. If not present, add:

```typescript
import { Toaster } from '@/components/ui/sonner'

// In the layout return, add before closing tag:
<Toaster />
```

**Step 2: Commit if changes made**

```bash
git add orbit-www/src/app/\(frontend\)/layout.tsx
git commit -m "feat: add toast notifications to layout"
```

---

### Task 7.2: Manual Testing Checklist

**Test the complete flow:**

1. [ ] Navigate to an app's detail page
2. [ ] Click "Add Deployment" - verify generators load in dropdown
3. [ ] Fill form and create deployment - verify record created with status "pending"
4. [ ] Click Deploy button on the row - verify row expands and shows progress
5. [ ] Watch progress update (may need workflow actually running)
6. [ ] For generate mode: verify files display with copy button
7. [ ] Test commit form - branch selection and message
8. [ ] Test error states - failed deployment shows error and retry button
9. [ ] Verify toast notifications appear for success/error

---

## Summary

This plan covers 15 tasks across 7 phases:

| Phase | Tasks | Focus |
|-------|-------|-------|
| 1 | 1.1-1.3 | Infrastructure (field, action, colors) |
| 2 | 2.1-2.2 | Expandable row component |
| 3 | 3.1-3.3 | Progress panel with polling |
| 4 | 4.1-4.4 | Generated files view + commit form |
| 5 | 5.1-5.2 | Dynamic generator dropdown |
| 6 | 6.1-6.2 | Backend workflow adjustments |
| 7 | 7.1-7.2 | Toast notifications + testing |

Each task is designed to be completed in 5-15 minutes with clear verification steps.
