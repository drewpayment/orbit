# Kafka UX Restructure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restructure the Kafka UX to use "Virtual Clusters" as the primary entity, removing the "Kafka Application" abstraction and auto-provisioning of dev/stage/prod environments.

**Architecture:** Virtual clusters become top-level workspace resources. Users explicitly create each cluster with a chosen environment. The navigation changes from "Topics | Catalog | Shares" to "Virtual Clusters | Topic Catalog | Incoming Shares | My Requests". The workspace dashboard gets a summary "Kafka Overview" card instead of a topic list.

**Tech Stack:** Next.js 15 (App Router), Payload CMS 3.0, React 19, TypeScript, Tailwind CSS, shadcn/ui components

---

## Phase 1: Navigation & Terminology Updates

### Task 1: Update KafkaNavigation Component

**Files:**
- Modify: `orbit-www/src/components/features/kafka/KafkaNavigation.tsx`

**Step 1: Update navigation labels**

Change the first nav item from "Topics" to "Virtual Clusters":

```typescript
const navItems = [
  { href: `/workspaces/${slug}/kafka`, label: 'Virtual Clusters', exact: true },
  { href: `/workspaces/${slug}/kafka/catalog`, label: 'Topic Catalog' },
  { href: `/workspaces/${slug}/kafka/shared/incoming`, label: 'Incoming Shares' },
  { href: `/workspaces/${slug}/kafka/shared/outgoing`, label: 'My Requests' },
]
```

**Step 2: Update the isActive pattern matching**

The existing `topicDetailPattern` needs to become a cluster detail pattern:

```typescript
const isActive = (href: string, exact?: boolean) => {
  if (exact) {
    // For exact match, also check if we're on a cluster detail page
    const clusterDetailPattern = new RegExp(`^/workspaces/${slug}/kafka/clusters/[^/]+`)
    if (clusterDetailPattern.test(pathname)) {
      return href === `/workspaces/${slug}/kafka`
    }
    return pathname === href
  }
  return pathname.startsWith(href)
}
```

**Step 3: Verify the change**

Run: `cd orbit-www && pnpm build`
Expected: Build succeeds with no errors

**Step 4: Commit**

```bash
git add orbit-www/src/components/features/kafka/KafkaNavigation.tsx
git commit -m "refactor(kafka): rename Topics tab to Virtual Clusters in navigation"
```

---

### Task 2: Update Main Kafka Page Header

**Files:**
- Modify: `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/page.tsx`

**Step 1: Update page title and description**

Change "Kafka Topics" to "Virtual Clusters":

```typescript
<div className="mb-8">
  <div className="flex items-center justify-between mb-4">
    <div>
      <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">
        Virtual Clusters
      </h1>
      <p className="text-lg text-gray-600 dark:text-gray-400">
        Manage Kafka virtual clusters for {workspace.name}
      </p>
    </div>
  </div>
</div>
```

**Step 2: Commit**

```bash
git add orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/page.tsx
git commit -m "refactor(kafka): update main page header to Virtual Clusters"
```

---

## Phase 2: Virtual Clusters List View

### Task 3: Create VirtualClustersList Component

**Files:**
- Create: `orbit-www/src/components/features/kafka/VirtualClustersList.tsx`
- Modify: `orbit-www/src/components/features/kafka/index.ts`

**Step 1: Create the VirtualClustersList component**

```typescript
'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Plus,
  RefreshCw,
  MoreHorizontal,
  Server,
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'
import { listVirtualClusters, type VirtualClusterData } from '@/app/actions/kafka-virtual-clusters'
import { CreateVirtualClusterDialog } from './CreateVirtualClusterDialog'

interface VirtualClustersListProps {
  workspaceId: string
  workspaceSlug: string
}

const statusConfig = {
  provisioning: {
    icon: Loader2,
    label: 'Provisioning',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    animate: true,
  },
  active: {
    icon: CheckCircle2,
    label: 'Active',
    className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    animate: false,
  },
  read_only: {
    icon: Clock,
    label: 'Read Only',
    className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    animate: false,
  },
  deleting: {
    icon: Loader2,
    label: 'Deleting',
    className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    animate: true,
  },
  deleted: {
    icon: AlertCircle,
    label: 'Deleted',
    className: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
    animate: false,
  },
}

const envColors: Record<string, string> = {
  dev: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200',
  development: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200',
  stage: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-200',
  staging: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-200',
  prod: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200',
  production: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200',
  qa: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-200',
}

export function VirtualClustersList({ workspaceId, workspaceSlug }: VirtualClustersListProps) {
  const [clusters, setClusters] = useState<VirtualClusterData[]>([])
  const [loading, setLoading] = useState(true)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)

  const loadClusters = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listVirtualClusters({ workspaceId })
      if (result.success && result.clusters) {
        setClusters(result.clusters)
      } else {
        toast.error(result.error || 'Failed to load virtual clusters')
      }
    } catch {
      toast.error('Failed to load virtual clusters')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    loadClusters()
  }, [loadClusters])

  const handleCreateSuccess = () => {
    setCreateDialogOpen(false)
    loadClusters()
    toast.success('Virtual cluster created successfully')
  }

  const renderStatusBadge = (status: VirtualClusterData['status']) => {
    const config = statusConfig[status] || statusConfig.active
    const StatusIcon = config.icon
    return (
      <Badge variant="secondary" className={config.className}>
        <StatusIcon className={`h-3 w-3 mr-1 ${config.animate ? 'animate-spin' : ''}`} />
        {config.label}
      </Badge>
    )
  }

  const renderEnvironmentBadge = (env: string) => {
    const color = envColors[env] || 'bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-200'
    return (
      <Badge variant="secondary" className={color}>
        {env.toUpperCase()}
      </Badge>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-muted-foreground">
            {clusters.length} virtual cluster{clusters.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadClusters} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Create Virtual Cluster
          </Button>
        </div>
      </div>

      {clusters.length === 0 && !loading ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Server className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold mb-2">No Virtual Clusters Yet</h3>
            <p className="text-muted-foreground text-center max-w-md mb-4">
              Virtual clusters provide isolated Kafka environments for your services.
              Create one to get started with topics, schemas, and service accounts.
            </p>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Create Your First Virtual Cluster
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Virtual Clusters</CardTitle>
            <CardDescription>
              Isolated Kafka environments for your workspace
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Environment</TableHead>
                  <TableHead>Topics</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clusters.map((cluster) => (
                  <TableRow key={cluster.id}>
                    <TableCell>
                      <div>
                        <Link
                          href={`/workspaces/${workspaceSlug}/kafka/clusters/${cluster.id}`}
                          className="font-medium hover:underline"
                        >
                          {cluster.name}
                        </Link>
                        <p className="text-sm text-muted-foreground">{cluster.advertisedHost}</p>
                      </div>
                    </TableCell>
                    <TableCell>{renderEnvironmentBadge(cluster.environment)}</TableCell>
                    <TableCell>{cluster.topicCount ?? 0}</TableCell>
                    <TableCell>{renderStatusBadge(cluster.status)}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={`/workspaces/${workspaceSlug}/kafka/clusters/${cluster.id}`}>
                              View Details
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href={`/workspaces/${workspaceSlug}/kafka/clusters/${cluster.id}?tab=settings`}>
                              Settings
                            </Link>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <CreateVirtualClusterDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        onSuccess={handleCreateSuccess}
      />
    </>
  )
}
```

**Step 2: Export from barrel file**

Add to `orbit-www/src/components/features/kafka/index.ts`:

```typescript
export { VirtualClustersList } from './VirtualClustersList'
```

**Step 3: Commit**

```bash
git add orbit-www/src/components/features/kafka/VirtualClustersList.tsx
git add orbit-www/src/components/features/kafka/index.ts
git commit -m "feat(kafka): add VirtualClustersList component"
```

---

### Task 4: Create CreateVirtualClusterDialog Component

**Files:**
- Create: `orbit-www/src/components/features/kafka/CreateVirtualClusterDialog.tsx`
- Modify: `orbit-www/src/components/features/kafka/index.ts`

**Step 1: Create the dialog component**

```typescript
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { createVirtualCluster } from '@/app/actions/kafka-virtual-clusters'

interface CreateVirtualClusterDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  workspaceSlug: string
  onSuccess: () => void
}

const environments = [
  { value: 'dev', label: 'Development' },
  { value: 'staging', label: 'Staging' },
  { value: 'qa', label: 'QA' },
  { value: 'prod', label: 'Production' },
]

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 63)
}

export function CreateVirtualClusterDialog({
  open,
  onOpenChange,
  workspaceId,
  workspaceSlug,
  onSuccess,
}: CreateVirtualClusterDialogProps) {
  const [name, setName] = useState('')
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false)
  const [environment, setEnvironment] = useState('')
  const [loading, setLoading] = useState(false)

  // Generate suggested name from workspace slug + environment
  const suggestedName = environment ? `${workspaceSlug}-${environment}` : ''

  const handleEnvironmentChange = (value: string) => {
    setEnvironment(value)
    if (!nameManuallyEdited) {
      setName(`${workspaceSlug}-${value}`)
    }
  }

  const handleNameChange = (value: string) => {
    setName(value)
    setNameManuallyEdited(true)
  }

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    if (!environment) {
      toast.error('Environment is required')
      return
    }
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      toast.error(
        'Name must start with a letter and contain only lowercase letters, numbers, and hyphens'
      )
      return
    }

    setLoading(true)
    try {
      const result = await createVirtualCluster({
        name: name.trim(),
        environment,
        workspaceId,
      })

      if (result.success) {
        resetForm()
        onSuccess()
      } else {
        toast.error(result.error || 'Failed to create virtual cluster')
      }
    } catch {
      toast.error('Failed to create virtual cluster')
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setName('')
    setEnvironment('')
    setNameManuallyEdited(false)
  }

  const previewHost = name && environment
    ? `${name}.${environment}.kafka.orbit.io`
    : 'your-cluster.env.kafka.orbit.io'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create Virtual Cluster</DialogTitle>
          <DialogDescription>
            Create a new isolated Kafka environment. Choose an environment and name for your cluster.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="environment">Environment</Label>
            <Select value={environment} onValueChange={handleEnvironmentChange} disabled={loading}>
              <SelectTrigger>
                <SelectValue placeholder="Select an environment" />
              </SelectTrigger>
              <SelectContent>
                {environments.map((env) => (
                  <SelectItem key={env.value} value={env.value}>
                    {env.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="name">Cluster Name</Label>
            <Input
              id="name"
              placeholder="e.g., payments-dev"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              disabled={loading}
            />
            <p className="text-sm text-muted-foreground">
              Endpoint: <code className="text-xs">{previewHost}</code>
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading || !name || !environment}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Virtual Cluster
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

**Step 2: Export from barrel file**

Add to `orbit-www/src/components/features/kafka/index.ts`:

```typescript
export { CreateVirtualClusterDialog } from './CreateVirtualClusterDialog'
```

**Step 3: Commit**

```bash
git add orbit-www/src/components/features/kafka/CreateVirtualClusterDialog.tsx
git add orbit-www/src/components/features/kafka/index.ts
git commit -m "feat(kafka): add CreateVirtualClusterDialog component"
```

---

### Task 5: Create Virtual Clusters Server Actions

**Files:**
- Create: `orbit-www/src/app/actions/kafka-virtual-clusters.ts`

**Step 1: Create the server actions file**

```typescript
'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { getTemporalClient } from '@/lib/temporal/client'

export interface VirtualClusterData {
  id: string
  name: string
  environment: string
  status: 'provisioning' | 'active' | 'read_only' | 'deleting' | 'deleted'
  advertisedHost: string
  advertisedPort: number
  topicPrefix: string
  groupPrefix: string
  topicCount?: number
  createdAt: string
}

export interface ListVirtualClustersInput {
  workspaceId: string
}

export interface ListVirtualClustersResult {
  success: boolean
  clusters?: VirtualClusterData[]
  error?: string
}

export async function listVirtualClusters(
  input: ListVirtualClustersInput
): Promise<ListVirtualClustersResult> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    // Verify user is member of workspace
    const membership = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          { workspace: { equals: input.workspaceId } },
          { user: { equals: session.user.id } },
          { status: { equals: 'active' } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })

    if (membership.docs.length === 0) {
      return { success: false, error: 'Not a member of this workspace' }
    }

    // Fetch virtual clusters directly for this workspace
    const clusters = await payload.find({
      collection: 'kafka-virtual-clusters',
      where: {
        workspace: { equals: input.workspaceId },
        status: { not_equals: 'deleted' },
      },
      sort: '-createdAt',
      limit: 100,
      overrideAccess: true,
    })

    // Get topic counts for each cluster
    const clusterIds = clusters.docs.map((c) => c.id)
    const topics = await payload.find({
      collection: 'kafka-topics',
      where: {
        virtualCluster: { in: clusterIds },
      },
      limit: 1000,
      overrideAccess: true,
    })

    // Group topic counts by cluster
    const topicCountByCluster = new Map<string, number>()
    for (const topic of topics.docs) {
      const clusterId = typeof topic.virtualCluster === 'string'
        ? topic.virtualCluster
        : topic.virtualCluster?.id
      if (clusterId) {
        topicCountByCluster.set(clusterId, (topicCountByCluster.get(clusterId) || 0) + 1)
      }
    }

    const result: VirtualClusterData[] = clusters.docs.map((cluster) => ({
      id: cluster.id,
      name: cluster.name || cluster.advertisedHost?.split('.')[0] || 'Unknown',
      environment: cluster.environment,
      status: cluster.status as VirtualClusterData['status'],
      advertisedHost: cluster.advertisedHost,
      advertisedPort: cluster.advertisedPort,
      topicPrefix: cluster.topicPrefix,
      groupPrefix: cluster.groupPrefix,
      topicCount: topicCountByCluster.get(cluster.id) || 0,
      createdAt: cluster.createdAt,
    }))

    return { success: true, clusters: result }
  } catch (error) {
    console.error('Error listing virtual clusters:', error)
    return { success: false, error: 'Failed to list virtual clusters' }
  }
}

export interface CreateVirtualClusterInput {
  name: string
  environment: string
  workspaceId: string
}

export interface CreateVirtualClusterResult {
  success: boolean
  clusterId?: string
  error?: string
}

export async function createVirtualCluster(
  input: CreateVirtualClusterInput
): Promise<CreateVirtualClusterResult> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    // Verify user is member of workspace
    const membership = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          { workspace: { equals: input.workspaceId } },
          { user: { equals: session.user.id } },
          { status: { equals: 'active' } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })

    if (membership.docs.length === 0) {
      return { success: false, error: 'Not a member of this workspace' }
    }

    // Get workspace for slug
    const workspace = await payload.findByID({
      collection: 'workspaces',
      id: input.workspaceId,
      overrideAccess: true,
    })

    if (!workspace) {
      return { success: false, error: 'Workspace not found' }
    }

    // Check if a cluster with this name already exists in workspace
    const existing = await payload.find({
      collection: 'kafka-virtual-clusters',
      where: {
        and: [
          { workspace: { equals: input.workspaceId } },
          { name: { equals: input.name } },
          { status: { not_equals: 'deleted' } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })

    if (existing.docs.length > 0) {
      return { success: false, error: 'A virtual cluster with this name already exists' }
    }

    // Find the physical cluster via environment mapping
    const mapping = await payload.find({
      collection: 'kafka-environment-mappings',
      where: {
        environment: { equals: input.environment },
        isDefault: { equals: true },
      },
      limit: 1,
      overrideAccess: true,
    })

    if (mapping.docs.length === 0) {
      return { success: false, error: `No default cluster configured for ${input.environment} environment` }
    }

    const physicalClusterId = typeof mapping.docs[0].cluster === 'string'
      ? mapping.docs[0].cluster
      : mapping.docs[0].cluster?.id

    if (!physicalClusterId) {
      return { success: false, error: 'Physical cluster not found in mapping' }
    }

    // Generate prefixes
    const prefix = `${workspace.slug}-${input.name}-`
    const advertisedHost = `${input.name}.${input.environment}.kafka.orbit.io`

    // Create the virtual cluster
    const cluster = await payload.create({
      collection: 'kafka-virtual-clusters',
      data: {
        name: input.name,
        workspace: input.workspaceId,
        environment: input.environment,
        physicalCluster: physicalClusterId,
        topicPrefix: prefix,
        groupPrefix: prefix,
        advertisedHost,
        advertisedPort: 9092,
        status: 'provisioning',
      },
      overrideAccess: true,
    })

    // Trigger Temporal workflow to provision the cluster in Bifrost
    await triggerVirtualClusterProvisionWorkflow({
      clusterId: cluster.id,
      clusterName: input.name,
      workspaceId: input.workspaceId,
      workspaceSlug: workspace.slug,
      environment: input.environment,
    })

    return { success: true, clusterId: cluster.id }
  } catch (error) {
    console.error('Error creating virtual cluster:', error)
    return { success: false, error: 'Failed to create virtual cluster' }
  }
}

export interface GetVirtualClusterInput {
  clusterId: string
}

export interface GetVirtualClusterResult {
  success: boolean
  cluster?: VirtualClusterData & {
    workspaceId: string
    workspaceSlug: string
  }
  error?: string
}

export async function getVirtualCluster(
  input: GetVirtualClusterInput
): Promise<GetVirtualClusterResult> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    const cluster = await payload.findByID({
      collection: 'kafka-virtual-clusters',
      id: input.clusterId,
      depth: 1,
    })

    if (!cluster) {
      return { success: false, error: 'Virtual cluster not found' }
    }

    const workspaceId = typeof cluster.workspace === 'string'
      ? cluster.workspace
      : cluster.workspace?.id

    const workspaceSlug = typeof cluster.workspace === 'string'
      ? ''
      : cluster.workspace?.slug || ''

    // Get topic count
    const topics = await payload.find({
      collection: 'kafka-topics',
      where: {
        virtualCluster: { equals: cluster.id },
      },
      limit: 0,
      overrideAccess: true,
    })

    return {
      success: true,
      cluster: {
        id: cluster.id,
        name: cluster.name || cluster.advertisedHost?.split('.')[0] || 'Unknown',
        environment: cluster.environment,
        status: cluster.status as VirtualClusterData['status'],
        advertisedHost: cluster.advertisedHost,
        advertisedPort: cluster.advertisedPort,
        topicPrefix: cluster.topicPrefix,
        groupPrefix: cluster.groupPrefix,
        topicCount: topics.totalDocs,
        createdAt: cluster.createdAt,
        workspaceId: workspaceId || '',
        workspaceSlug,
      },
    }
  } catch (error) {
    console.error('Error getting virtual cluster:', error)
    return { success: false, error: 'Failed to get virtual cluster' }
  }
}

/**
 * Triggers a workflow to provision the virtual cluster in Bifrost
 */
async function triggerVirtualClusterProvisionWorkflow(input: {
  clusterId: string
  clusterName: string
  workspaceId: string
  workspaceSlug: string
  environment: string
}): Promise<string | null> {
  const workflowId = `virtual-cluster-provision-${input.clusterId}`

  try {
    const client = await getTemporalClient()

    const handle = await client.workflow.start('SingleVirtualClusterProvisionWorkflow', {
      taskQueue: 'orbit-workflows',
      workflowId,
      args: [{
        ClusterID: input.clusterId,
        ClusterName: input.clusterName,
        WorkspaceID: input.workspaceId,
        WorkspaceSlug: input.workspaceSlug,
        Environment: input.environment,
      }],
    })

    console.log(
      `[Kafka] Started SingleVirtualClusterProvisionWorkflow: ${handle.workflowId} for cluster ${input.clusterName}`
    )

    return handle.workflowId
  } catch (error) {
    console.error('[Kafka] Failed to start SingleVirtualClusterProvisionWorkflow:', error)
    return null
  }
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/app/actions/kafka-virtual-clusters.ts
git commit -m "feat(kafka): add virtual clusters server actions"
```

---

### Task 6: Update KafkaVirtualClusters Collection

**Files:**
- Modify: `orbit-www/src/collections/kafka/KafkaVirtualClusters.ts`

**Step 1: Add workspace field and name field**

Add these fields to the collection (before the `application` field):

```typescript
{
  name: 'name',
  type: 'text',
  required: true,
  index: true,
  admin: {
    description: 'User-defined name for this virtual cluster',
  },
  validate: (value: string | undefined | null) => {
    if (!value) return 'Name is required'
    if (!/^[a-z][a-z0-9-]*$/.test(value)) {
      return 'Name must start with a letter and contain only lowercase letters, numbers, and hyphens'
    }
    if (value.length > 63) {
      return 'Name must be 63 characters or less'
    }
    return true
  },
},
{
  name: 'workspace',
  type: 'relationship',
  relationTo: 'workspaces',
  required: true,
  index: true,
  admin: {
    description: 'Workspace that owns this virtual cluster',
  },
},
```

**Step 2: Make application field optional**

Change the `application` field from `required: true` to `required: false`:

```typescript
{
  name: 'application',
  type: 'relationship',
  relationTo: 'kafka-applications',
  required: false, // Changed from true - now optional for backward compatibility
  index: true,
  admin: {
    description: 'Legacy: Parent Kafka application (deprecated)',
  },
},
```

**Step 3: Update environment options to include more choices**

```typescript
{
  name: 'environment',
  type: 'select',
  required: true,
  options: [
    { label: 'Development', value: 'dev' },
    { label: 'Staging', value: 'staging' },
    { label: 'QA', value: 'qa' },
    { label: 'Production', value: 'prod' },
  ],
  index: true,
  admin: {
    description: 'Target environment',
  },
},
```

**Step 4: Update access control to use workspace directly**

Update the `read` access function:

```typescript
read: async ({ req: { user, payload } }) => {
  if (!user) return false

  // Admins can see all
  if (user.collection === 'users') return true

  // Regular users see only virtual clusters for their workspaces
  const memberships = await payload.find({
    collection: 'workspace-members',
    where: {
      user: { equals: user.id },
      status: { equals: 'active' },
    },
    limit: 1000,
    overrideAccess: true,
  })

  const workspaceIds = memberships.docs.map((m) =>
    String(typeof m.workspace === 'string' ? m.workspace : m.workspace.id)
  )

  return {
    workspace: { in: workspaceIds },
  } as Where
},
```

**Step 5: Commit**

```bash
git add orbit-www/src/collections/kafka/KafkaVirtualClusters.ts
git commit -m "refactor(kafka): update KafkaVirtualClusters collection for direct workspace ownership"
```

---

### Task 7: Update Main Kafka Page to Use VirtualClustersList

**Files:**
- Modify: `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/page.tsx`

**Step 1: Replace KafkaTopicsClient with VirtualClustersList**

```typescript
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { VirtualClustersList } from '@/components/features/kafka'

interface PageProps {
  params: Promise<{
    slug: string
  }>
}

export default async function KafkaPage({ params }: PageProps) {
  const { slug } = await params
  const payload = await getPayload({ config })

  // Fetch workspace
  const workspaceResult = await payload.find({
    collection: 'workspaces',
    where: {
      slug: {
        equals: slug,
      },
    },
    limit: 1,
  })

  if (!workspaceResult.docs.length) {
    notFound()
  }

  const workspace = workspaceResult.docs[0]

  return (
    <>
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">
              Virtual Clusters
            </h1>
            <p className="text-lg text-gray-600 dark:text-gray-400">
              Manage Kafka virtual clusters for {workspace.name}
            </p>
          </div>
        </div>
      </div>

      {/* Virtual Clusters List */}
      <VirtualClustersList
        workspaceId={workspace.id as string}
        workspaceSlug={slug}
      />
    </>
  )
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/page.tsx
git commit -m "refactor(kafka): replace topic list with virtual clusters list on main page"
```

---

## Phase 3: Virtual Cluster Detail Page

### Task 8: Create Virtual Cluster Detail Route

**Files:**
- Create: `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/clusters/[clusterId]/page.tsx`
- Create: `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/clusters/[clusterId]/cluster-detail-client.tsx`

**Step 1: Create the server component page**

Create `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/clusters/[clusterId]/page.tsx`:

```typescript
import { getPayload } from 'payload'
import config from '@payload-config'
import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { ClusterDetailClient } from './cluster-detail-client'

interface PageProps {
  params: Promise<{ slug: string; clusterId: string }>
}

export default async function ClusterDetailPage({ params }: PageProps) {
  const { slug, clusterId } = await params

  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    redirect('/login')
  }

  const payload = await getPayload({ config })

  // Fetch workspace
  const workspaceResult = await payload.find({
    collection: 'workspaces',
    where: { slug: { equals: slug } },
    limit: 1,
  })

  if (workspaceResult.docs.length === 0) {
    notFound()
  }

  const workspace = workspaceResult.docs[0]

  // Fetch virtual cluster
  const cluster = await payload.findByID({
    collection: 'kafka-virtual-clusters',
    id: clusterId,
    depth: 1,
  })

  if (!cluster) {
    notFound()
  }

  // Verify cluster belongs to workspace
  const clusterWorkspaceId = typeof cluster.workspace === 'string'
    ? cluster.workspace
    : cluster.workspace?.id

  if (clusterWorkspaceId !== workspace.id) {
    notFound()
  }

  // Check user permissions
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspace.id } },
        { user: { equals: session.user.id } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
    overrideAccess: true,
  })

  if (membership.docs.length === 0) {
    notFound()
  }

  const userRole = membership.docs[0].role
  const canManage = userRole === 'owner' || userRole === 'admin'
  const canApprove = userRole === 'owner' || userRole === 'admin'

  return (
    <ClusterDetailClient
      workspaceSlug={slug}
      cluster={{
        id: cluster.id,
        name: cluster.name || cluster.advertisedHost?.split('.')[0] || 'Unknown',
        environment: cluster.environment,
        status: cluster.status as 'provisioning' | 'active' | 'read_only' | 'deleting' | 'deleted',
        advertisedHost: cluster.advertisedHost,
        advertisedPort: cluster.advertisedPort,
        topicPrefix: cluster.topicPrefix,
        groupPrefix: cluster.groupPrefix,
      }}
      canManage={canManage}
      canApprove={canApprove}
      userId={session.user.id}
    />
  )
}
```

**Step 2: Create the client component**

Create `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/clusters/[clusterId]/cluster-detail-client.tsx`:

```typescript
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ArrowLeft, Settings, CheckCircle2, Clock, AlertCircle, Loader2, Network } from 'lucide-react'
import { TopicsPanel } from '@/components/features/kafka/TopicsPanel'
import { ServiceAccountsPanel } from '@/components/features/kafka/ServiceAccountsPanel'
import { ConnectionDetailsPanel } from '@/components/features/kafka/ConnectionDetailsPanel'

interface Cluster {
  id: string
  name: string
  environment: string
  status: 'provisioning' | 'active' | 'read_only' | 'deleting' | 'deleted'
  advertisedHost: string
  advertisedPort: number
  topicPrefix: string
  groupPrefix: string
}

interface ClusterDetailClientProps {
  workspaceSlug: string
  cluster: Cluster
  canManage: boolean
  canApprove: boolean
  userId: string
}

const statusConfig = {
  provisioning: {
    icon: Loader2,
    label: 'Provisioning',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    animate: true,
  },
  active: {
    icon: CheckCircle2,
    label: 'Active',
    className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    animate: false,
  },
  read_only: {
    icon: Clock,
    label: 'Read Only',
    className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    animate: false,
  },
  deleting: {
    icon: Loader2,
    label: 'Deleting',
    className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    animate: true,
  },
  deleted: {
    icon: AlertCircle,
    label: 'Deleted',
    className: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
    animate: false,
  },
}

const envColors: Record<string, string> = {
  dev: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200',
  staging: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-200',
  qa: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-200',
  prod: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200',
}

export function ClusterDetailClient({
  workspaceSlug,
  cluster,
  canManage,
  canApprove,
  userId,
}: ClusterDetailClientProps) {
  const searchParams = useSearchParams()
  const initialTab = searchParams.get('tab') || 'topics'
  const [activeTab, setActiveTab] = useState(initialTab)

  const StatusIcon = statusConfig[cluster.status]?.icon || CheckCircle2
  const statusConf = statusConfig[cluster.status] || statusConfig.active

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/workspaces/${workspaceSlug}/kafka`}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{cluster.name}</h1>
              <Badge variant="secondary" className={envColors[cluster.environment] || 'bg-gray-100'}>
                {cluster.environment.toUpperCase()}
              </Badge>
              <Badge variant="secondary" className={statusConf.className}>
                <StatusIcon className={`h-3 w-3 mr-1 ${statusConf.animate ? 'animate-spin' : ''}`} />
                {statusConf.label}
              </Badge>
            </div>
            <p className="text-muted-foreground text-sm">{cluster.advertisedHost}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href={`/workspaces/${workspaceSlug}/kafka/clusters/${cluster.id}?tab=settings`}>
              <Settings className="h-4 w-4 mr-1" />
              Settings
            </Link>
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="topics">Topics</TabsTrigger>
          <TabsTrigger value="schemas">Schemas</TabsTrigger>
          <TabsTrigger value="consumer-groups">Consumer Groups</TabsTrigger>
          <TabsTrigger value="service-accounts">Service Accounts</TabsTrigger>
          <TabsTrigger value="connection">Connection</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="topics" className="space-y-6">
          <TopicsPanel
            virtualClusterId={cluster.id}
            virtualClusterName={cluster.name}
            environment={cluster.environment}
            canManage={canManage}
            canApprove={canApprove}
            userId={userId}
            workspaceSlug={workspaceSlug}
          />
        </TabsContent>

        <TabsContent value="schemas" className="space-y-6">
          <div className="text-muted-foreground">
            Schema management coming soon.
          </div>
        </TabsContent>

        <TabsContent value="consumer-groups" className="space-y-6">
          <div className="text-muted-foreground">
            Consumer group monitoring coming soon.
          </div>
        </TabsContent>

        <TabsContent value="service-accounts" className="space-y-6">
          <ServiceAccountsPanel
            virtualClusterId={cluster.id}
            environment={cluster.environment}
          />
        </TabsContent>

        <TabsContent value="connection" className="space-y-6">
          <ConnectionDetailsPanel
            virtualClusterId={cluster.id}
            advertisedHost={cluster.advertisedHost}
            advertisedPort={cluster.advertisedPort}
          />
        </TabsContent>

        <TabsContent value="settings" className="space-y-6">
          <div className="text-muted-foreground">
            Cluster settings and decommissioning options coming soon.
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
```

**Step 3: Commit**

```bash
git add orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/clusters/
git commit -m "feat(kafka): add virtual cluster detail page with tabbed interface"
```

---

## Phase 4: Workspace Dashboard Update

### Task 9: Create WorkspaceKafkaOverviewCard Component

**Files:**
- Create: `orbit-www/src/components/features/workspace/WorkspaceKafkaOverviewCard.tsx`

**Step 1: Create the overview card component**

```typescript
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Server, ChevronRight, MessageSquare, Share2 } from 'lucide-react'
import Link from 'next/link'

interface WorkspaceKafkaOverviewCardProps {
  workspaceSlug: string
  virtualClusterCount: number
  topicCount: number
  pendingShareCount: number
}

export function WorkspaceKafkaOverviewCard({
  workspaceSlug,
  virtualClusterCount,
  topicCount,
  pendingShareCount,
}: WorkspaceKafkaOverviewCardProps) {
  const hasResources = virtualClusterCount > 0 || topicCount > 0

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <Link
            href={`/workspaces/${workspaceSlug}/kafka`}
            className="flex items-center gap-2 hover:text-foreground/80 transition-colors"
          >
            <Server className="h-5 w-5" />
            <CardTitle className="text-base">Kafka Overview</CardTitle>
          </Link>
          <Button size="sm" variant="outline" asChild>
            <Link href={`/workspaces/${workspaceSlug}/kafka`}>
              Manage
              <ChevronRight className="h-4 w-4 ml-1" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!hasResources ? (
          <div className="text-center py-8">
            <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <Server className="h-6 w-6 text-muted-foreground" />
            </div>
            <h4 className="text-sm font-medium mb-2">Stream your data</h4>
            <p className="text-sm text-muted-foreground mb-4 max-w-[280px] mx-auto">
              Create virtual clusters to enable real-time data streaming between your services.
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/workspaces/${workspaceSlug}/kafka`}>Get Started</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold">{virtualClusterCount}</div>
                <div className="text-xs text-muted-foreground">Virtual Clusters</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold">{topicCount}</div>
                <div className="text-xs text-muted-foreground">Topics</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold">{pendingShareCount}</div>
                <div className="text-xs text-muted-foreground">Pending Shares</div>
              </div>
            </div>

            {/* Quick Links */}
            <div className="pt-4 border-t space-y-2">
              <Link
                href={`/workspaces/${workspaceSlug}/kafka`}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground py-1"
              >
                <Server className="h-4 w-4" />
                View Virtual Clusters
                <ChevronRight className="h-4 w-4 ml-auto" />
              </Link>
              <Link
                href={`/workspaces/${workspaceSlug}/kafka/catalog`}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground py-1"
              >
                <MessageSquare className="h-4 w-4" />
                Browse Topic Catalog
                <ChevronRight className="h-4 w-4 ml-auto" />
              </Link>
              {pendingShareCount > 0 && (
                <Link
                  href={`/workspaces/${workspaceSlug}/kafka/shared/incoming`}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground py-1"
                >
                  <Share2 className="h-4 w-4" />
                  View Incoming Shares
                  <ChevronRight className="h-4 w-4 ml-auto" />
                </Link>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

**Step 2: Export from barrel file**

Add to `orbit-www/src/components/features/workspace/index.ts` (create if doesn't exist):

```typescript
export { WorkspaceKafkaOverviewCard } from './WorkspaceKafkaOverviewCard'
```

**Step 3: Commit**

```bash
git add orbit-www/src/components/features/workspace/WorkspaceKafkaOverviewCard.tsx
git add orbit-www/src/components/features/workspace/index.ts
git commit -m "feat(kafka): add WorkspaceKafkaOverviewCard component"
```

---

### Task 10: Update Workspace Detail Page to Use New Card

**Files:**
- Modify: `orbit-www/src/app/(frontend)/workspaces/[slug]/page.tsx` (or wherever the workspace detail renders the Kafka card)

**Step 1: Find where WorkspaceKafkaTopicsCard is used**

Search for the usage and replace with the new card. The data fetching needs to change from topics to:
- Virtual cluster count
- Topic count
- Pending share count

**Step 2: Update the imports and component usage**

Replace:
```typescript
import { WorkspaceKafkaTopicsCard } from '@/components/features/workspace/WorkspaceKafkaTopicsCard'
```

With:
```typescript
import { WorkspaceKafkaOverviewCard } from '@/components/features/workspace/WorkspaceKafkaOverviewCard'
```

**Step 3: Update the data fetching**

Replace the topics query with:

```typescript
// Fetch virtual cluster count
const virtualClusters = await payload.find({
  collection: 'kafka-virtual-clusters',
  where: {
    workspace: { equals: workspace.id },
    status: { not_equals: 'deleted' },
  },
  limit: 0, // Just get count
  overrideAccess: true,
})

// Fetch topic count
const topics = await payload.find({
  collection: 'kafka-topics',
  where: {
    'virtualCluster.workspace': { equals: workspace.id },
  },
  limit: 0,
  overrideAccess: true,
})

// Fetch pending share count
const pendingShares = await payload.find({
  collection: 'kafka-topic-shares',
  where: {
    and: [
      { targetWorkspace: { equals: workspace.id } },
      { status: { equals: 'pending' } },
    ],
  },
  limit: 0,
  overrideAccess: true,
})
```

**Step 4: Update the component props**

```typescript
<WorkspaceKafkaOverviewCard
  workspaceSlug={workspace.slug}
  virtualClusterCount={virtualClusters.totalDocs}
  topicCount={topics.totalDocs}
  pendingShareCount={pendingShares.totalDocs}
/>
```

**Step 5: Commit**

```bash
git add orbit-www/src/app/(frontend)/workspaces/[slug]/page.tsx
git commit -m "refactor(kafka): use WorkspaceKafkaOverviewCard on workspace dashboard"
```

---

## Phase 5: Cleanup & Verification

### Task 11: Remove/Deprecate Old Applications Route

**Files:**
- Modify: `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/applications/page.tsx`

**Step 1: Add redirect to new virtual clusters view**

For backward compatibility, redirect old routes:

```typescript
import { redirect } from 'next/navigation'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function KafkaApplicationsPage({ params }: PageProps) {
  const { slug } = await params
  redirect(`/workspaces/${slug}/kafka`)
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/applications/page.tsx
git commit -m "refactor(kafka): redirect old applications route to virtual clusters"
```

---

### Task 12: Build and Verify

**Step 1: Run the build**

```bash
cd orbit-www && pnpm build
```

Expected: Build succeeds with no errors

**Step 2: Run the linter**

```bash
cd orbit-www && pnpm lint
```

Expected: No linting errors

**Step 3: Run tests**

```bash
cd orbit-www && pnpm test
```

Expected: All tests pass (some may need updating for new component names)

**Step 4: Manual verification checklist**

- [ ] Navigate to `/workspaces/{slug}/kafka` - shows Virtual Clusters list
- [ ] "Create Virtual Cluster" dialog works and creates a cluster
- [ ] Clicking a cluster navigates to `/workspaces/{slug}/kafka/clusters/{id}`
- [ ] Cluster detail page shows tabbed interface (Topics, Schemas, etc.)
- [ ] Workspace dashboard shows "Kafka Overview" card with correct counts
- [ ] Topic Catalog tab still works
- [ ] Incoming Shares tab still works
- [ ] Old `/workspaces/{slug}/kafka/applications` redirects properly

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat(kafka): complete UX restructure - virtual clusters as primary entity

- Navigation: Topics → Virtual Clusters
- Users explicitly create each cluster with chosen environment
- No auto-provisioning of dev/stage/prod
- Workspace dashboard shows Kafka Overview summary
- Virtual cluster detail with tabbed interface
- Backward-compatible redirect for old application routes"
```

---

## Summary

This implementation plan restructures the Kafka UX in Orbit to:

1. **Rename terminology**: "Kafka Application" → "Virtual Cluster"
2. **Remove auto-provisioning**: Users explicitly create each cluster
3. **Update navigation**: "Topics" tab → "Virtual Clusters" tab
4. **New cluster detail page**: Tabbed interface at `/kafka/clusters/{id}`
5. **Update workspace dashboard**: "Kafka Overview" summary card
6. **Maintain backward compatibility**: Old routes redirect appropriately

The plan reuses existing components (TopicsPanel, ServiceAccountsPanel, ConnectionDetailsPanel) and creates new ones only where needed.
