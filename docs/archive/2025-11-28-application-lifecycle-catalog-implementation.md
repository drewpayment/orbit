# Application Lifecycle Catalog - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an Application Catalog that tracks apps from template instantiation through deployment with live health monitoring.

**Architecture:** Payload CMS collections (App, Deployment, DeploymentGenerator) with Temporal workflows for deployment and health checks. Hybrid sync between Orbit DB and `.orbit.yaml` manifest files.

**Tech Stack:** Payload 3.0, Next.js 15, React 19, Temporal, Go, gRPC, Tailwind CSS

**Design Document:** See `docs/plans/2025-11-28-application-lifecycle-catalog-design.md` for full architecture.

---

## Phase 1: Core Data Model & Basic Catalog (MVP)

### Task 1: Create App Collection Schema

**Files:**
- Create: `orbit-www/src/collections/Apps.ts`
- Modify: `orbit-www/src/payload.config.ts`

**Step 1: Create the App collection**

```typescript
// orbit-www/src/collections/Apps.ts
import type { CollectionConfig } from 'payload'

export const Apps: CollectionConfig = {
  slug: 'apps',
  admin: {
    useAsTitle: 'name',
    group: 'Catalog',
    defaultColumns: ['name', 'status', 'workspace', 'updatedAt'],
  },
  access: {
    read: ({ req: { user } }) => {
      if (!user) return false
      return {
        'workspace.id': {
          in: user.workspaces?.map((w: { workspace: { id: string } }) =>
            typeof w.workspace === 'object' ? w.workspace.id : w.workspace
          ) || [],
        },
      }
    },
    create: ({ req: { user } }) => !!user,
    update: ({ req: { user } }) => !!user,
    delete: ({ req: { user } }) => !!user,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      index: true,
    },
    {
      name: 'description',
      type: 'textarea',
    },
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
    },
    {
      name: 'repository',
      type: 'group',
      fields: [
        {
          name: 'owner',
          type: 'text',
          required: true,
        },
        {
          name: 'name',
          type: 'text',
          required: true,
        },
        {
          name: 'url',
          type: 'text',
          required: true,
        },
        {
          name: 'installationId',
          type: 'text',
          required: true,
        },
      ],
    },
    {
      name: 'origin',
      type: 'group',
      fields: [
        {
          name: 'type',
          type: 'select',
          required: true,
          options: [
            { label: 'Template', value: 'template' },
            { label: 'Imported', value: 'imported' },
          ],
        },
        {
          name: 'template',
          type: 'relationship',
          relationTo: 'templates',
          admin: {
            condition: (data, siblingData) => siblingData?.type === 'template',
          },
        },
        {
          name: 'instantiatedAt',
          type: 'date',
          admin: {
            condition: (data, siblingData) => siblingData?.type === 'template',
          },
        },
      ],
    },
    {
      name: 'syncMode',
      type: 'select',
      defaultValue: 'orbit-primary',
      options: [
        { label: 'Orbit Primary', value: 'orbit-primary' },
        { label: 'Manifest Primary', value: 'manifest-primary' },
      ],
    },
    {
      name: 'manifestSha',
      type: 'text',
      admin: {
        readOnly: true,
        description: 'SHA of last synced .orbit.yaml',
      },
    },
    {
      name: 'healthConfig',
      type: 'group',
      fields: [
        {
          name: 'endpoint',
          type: 'text',
          defaultValue: '/health',
        },
        {
          name: 'interval',
          type: 'number',
          defaultValue: 60,
          admin: {
            description: 'Check interval in seconds',
          },
        },
        {
          name: 'timeout',
          type: 'number',
          defaultValue: 5,
          admin: {
            description: 'Timeout in seconds',
          },
        },
      ],
    },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'unknown',
      options: [
        { label: 'Healthy', value: 'healthy' },
        { label: 'Degraded', value: 'degraded' },
        { label: 'Down', value: 'down' },
        { label: 'Unknown', value: 'unknown' },
      ],
      admin: {
        position: 'sidebar',
      },
    },
  ],
  timestamps: true,
}
```

**Step 2: Register collection in payload.config.ts**

Add to imports:
```typescript
import { Apps } from './collections/Apps'
```

Add to collections array (after Templates):
```typescript
collections: [
  // ... existing collections
  Templates,
  Apps,  // Add this
  // ...
],
```

**Step 3: Run payload to generate types and verify**

Run: `cd orbit-www && bun run dev`
Expected: Server starts without errors, App collection appears in admin

**Step 4: Commit**

```bash
git add orbit-www/src/collections/Apps.ts orbit-www/src/payload.config.ts
git commit -m "feat(catalog): add App collection schema"
```

---

### Task 2: Create Deployment Collection Schema

**Files:**
- Create: `orbit-www/src/collections/Deployments.ts`
- Modify: `orbit-www/src/payload.config.ts`

**Step 1: Create the Deployment collection**

```typescript
// orbit-www/src/collections/Deployments.ts
import type { CollectionConfig } from 'payload'

export const Deployments: CollectionConfig = {
  slug: 'deployments',
  admin: {
    useAsTitle: 'name',
    group: 'Catalog',
    defaultColumns: ['name', 'app', 'status', 'healthStatus', 'lastDeployedAt'],
  },
  access: {
    read: ({ req: { user } }) => {
      if (!user) return false
      // Access through app's workspace
      return true // Will refine with proper workspace check via app relation
    },
    create: ({ req: { user } }) => !!user,
    update: ({ req: { user } }) => !!user,
    delete: ({ req: { user } }) => !!user,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: {
        description: 'e.g., production, staging, development',
      },
    },
    {
      name: 'app',
      type: 'relationship',
      relationTo: 'apps',
      required: true,
      index: true,
    },
    {
      name: 'generator',
      type: 'select',
      required: true,
      options: [
        { label: 'Docker Compose', value: 'docker-compose' },
        { label: 'Terraform', value: 'terraform' },
        { label: 'Helm', value: 'helm' },
        { label: 'Custom', value: 'custom' },
      ],
    },
    {
      name: 'config',
      type: 'json',
      admin: {
        description: 'Generator-specific configuration',
      },
    },
    {
      name: 'target',
      type: 'group',
      fields: [
        {
          name: 'type',
          type: 'text',
          required: true,
          admin: {
            description: 'e.g., kubernetes, aws-ecs, docker-host',
          },
        },
        {
          name: 'region',
          type: 'text',
        },
        {
          name: 'cluster',
          type: 'text',
        },
        {
          name: 'url',
          type: 'text',
          admin: {
            description: 'Deployment URL after successful deploy',
          },
        },
      ],
    },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'pending',
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Deploying', value: 'deploying' },
        { label: 'Deployed', value: 'deployed' },
        { label: 'Failed', value: 'failed' },
      ],
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'lastDeployedAt',
      type: 'date',
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'lastDeployedBy',
      type: 'relationship',
      relationTo: 'users',
    },
    {
      name: 'healthStatus',
      type: 'select',
      defaultValue: 'unknown',
      options: [
        { label: 'Healthy', value: 'healthy' },
        { label: 'Degraded', value: 'degraded' },
        { label: 'Down', value: 'down' },
        { label: 'Unknown', value: 'unknown' },
      ],
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'healthLastChecked',
      type: 'date',
    },
    {
      name: 'workflowId',
      type: 'text',
      admin: {
        readOnly: true,
        description: 'Active Temporal workflow ID',
      },
    },
    {
      name: 'deploymentError',
      type: 'textarea',
      admin: {
        readOnly: true,
        condition: (data) => data?.status === 'failed',
      },
    },
  ],
  timestamps: true,
}
```

**Step 2: Register collection in payload.config.ts**

Add to imports:
```typescript
import { Deployments } from './collections/Deployments'
```

Add to collections array:
```typescript
collections: [
  // ... existing collections
  Apps,
  Deployments,  // Add this
  // ...
],
```

**Step 3: Verify server starts**

Run: `cd orbit-www && bun run dev`
Expected: Server starts, Deployment collection visible in admin under "Catalog" group

**Step 4: Commit**

```bash
git add orbit-www/src/collections/Deployments.ts orbit-www/src/payload.config.ts
git commit -m "feat(catalog): add Deployment collection schema"
```

---

### Task 3: Create Apps List Page (Card Grid View)

**Files:**
- Create: `orbit-www/src/app/(authenticated)/apps/page.tsx`
- Create: `orbit-www/src/app/(authenticated)/apps/layout.tsx`

**Step 1: Create the apps layout**

```typescript
// orbit-www/src/app/(authenticated)/apps/layout.tsx
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Applications | Orbit',
  description: 'View and manage your applications',
}

export default function AppsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
```

**Step 2: Create the apps list page**

```typescript
// orbit-www/src/app/(authenticated)/apps/page.tsx
import { getPayload } from 'payload'
import config from '@payload-config'
import { getCurrentUser } from '@/lib/auth/session'
import { redirect } from 'next/navigation'
import { AppsCatalog } from '@/components/features/apps/AppsCatalog'

export default async function AppsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const payload = await getPayload({ config })

  // Get user's workspaces
  const workspaceIds = user.workspaces?.map((w) =>
    typeof w.workspace === 'object' ? w.workspace.id : w.workspace
  ) || []

  // Fetch apps for user's workspaces
  const { docs: apps } = await payload.find({
    collection: 'apps',
    where: {
      'workspace': {
        in: workspaceIds,
      },
    },
    depth: 2, // Include workspace and template relations
    sort: '-updatedAt',
  })

  return (
    <div className="container mx-auto py-8 px-4">
      <AppsCatalog apps={apps} />
    </div>
  )
}
```

**Step 3: Commit layout and page**

```bash
git add orbit-www/src/app/\(authenticated\)/apps/
git commit -m "feat(catalog): add apps list page route"
```

---

### Task 4: Create AppsCatalog Component

**Files:**
- Create: `orbit-www/src/components/features/apps/AppsCatalog.tsx`
- Create: `orbit-www/src/components/features/apps/AppCard.tsx`

**Step 1: Create AppCard component**

```typescript
// orbit-www/src/components/features/apps/AppCard.tsx
'use client'

import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  ExternalLink,
  MoreVertical
} from 'lucide-react'
import type { App, Template } from '@/payload-types'

interface AppCardProps {
  app: App
}

const statusConfig = {
  healthy: { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-500' },
  degraded: { icon: AlertTriangle, color: 'text-yellow-500', bg: 'bg-yellow-500' },
  down: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-500' },
  unknown: { icon: HelpCircle, color: 'text-gray-400', bg: 'bg-gray-400' },
}

export function AppCard({ app }: AppCardProps) {
  const status = app.status || 'unknown'
  const StatusIcon = statusConfig[status].icon
  const template = app.origin?.template as Template | undefined

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${statusConfig[status].bg}`} />
            <CardTitle className="text-lg">{app.name}</CardTitle>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </div>
        {app.description && (
          <CardDescription className="line-clamp-2">
            {app.description}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {app.origin?.type === 'template' && template ? (
            <Badge variant="secondary">Template: {template.name}</Badge>
          ) : (
            <Badge variant="outline">Imported</Badge>
          )}
        </div>

        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-1">
            <StatusIcon className={`h-4 w-4 ${statusConfig[status].color}`} />
            <span className="text-sm capitalize">{status}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/apps/${app.id}`}>View</Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
```

**Step 2: Create AppsCatalog component**

```typescript
// orbit-www/src/components/features/apps/AppsCatalog.tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { LayoutGrid, Network, Plus, Search } from 'lucide-react'
import { AppCard } from './AppCard'
import type { App } from '@/payload-types'

interface AppsCatalogProps {
  apps: App[]
}

type ViewMode = 'grid' | 'graph'
type StatusFilter = 'all' | 'healthy' | 'degraded' | 'down' | 'unknown'

export function AppsCatalog({ apps }: AppsCatalogProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const filteredApps = apps.filter((app) => {
    const matchesSearch = app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.description?.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesStatus = statusFilter === 'all' || app.status === statusFilter
    return matchesSearch && matchesStatus
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Applications</h1>
          <p className="text-muted-foreground">
            {apps.length} application{apps.length !== 1 ? 's' : ''} in your catalog
          </p>
        </div>
        <Button asChild>
          <Link href="/apps/new">
            <Plus className="mr-2 h-4 w-4" />
            New App
          </Link>
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search applications..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="healthy">Healthy</SelectItem>
            <SelectItem value="degraded">Degraded</SelectItem>
            <SelectItem value="down">Down</SelectItem>
            <SelectItem value="unknown">Unknown</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex border rounded-md">
          <Button
            variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
            size="icon"
            onClick={() => setViewMode('grid')}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === 'graph' ? 'secondary' : 'ghost'}
            size="icon"
            onClick={() => setViewMode('graph')}
            disabled // Graph view in Phase 3
          >
            <Network className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      {filteredApps.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-muted-foreground">
            {apps.length === 0
              ? 'No applications yet. Create one from a template or import an existing repository.'
              : 'No applications match your filters.'}
          </p>
          {apps.length === 0 && (
            <div className="flex gap-4 justify-center mt-4">
              <Button asChild variant="outline">
                <Link href="/templates">Browse Templates</Link>
              </Button>
              <Button asChild>
                <Link href="/apps/import">Import Repository</Link>
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredApps.map((app) => (
            <AppCard key={app.id} app={app} />
          ))}
        </div>
      )}
    </div>
  )
}
```

**Step 3: Commit components**

```bash
git add orbit-www/src/components/features/apps/
git commit -m "feat(catalog): add AppsCatalog and AppCard components"
```

---

### Task 5: Create App Detail Page

**Files:**
- Create: `orbit-www/src/app/(authenticated)/apps/[id]/page.tsx`
- Create: `orbit-www/src/components/features/apps/AppDetail.tsx`

**Step 1: Create the app detail page route**

```typescript
// orbit-www/src/app/(authenticated)/apps/[id]/page.tsx
import { getPayload } from 'payload'
import config from '@payload-config'
import { getCurrentUser } from '@/lib/auth/session'
import { redirect, notFound } from 'next/navigation'
import { AppDetail } from '@/components/features/apps/AppDetail'

interface AppDetailPageProps {
  params: Promise<{ id: string }>
}

export default async function AppDetailPage({ params }: AppDetailPageProps) {
  const { id } = await params
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const payload = await getPayload({ config })

  try {
    const app = await payload.findByID({
      collection: 'apps',
      id,
      depth: 2,
    })

    if (!app) notFound()

    // Fetch deployments for this app
    const { docs: deployments } = await payload.find({
      collection: 'deployments',
      where: {
        app: { equals: id },
      },
      sort: '-updatedAt',
      depth: 1,
    })

    return <AppDetail app={app} deployments={deployments} />
  } catch {
    notFound()
  }
}
```

**Step 2: Create AppDetail component**

```typescript
// orbit-www/src/components/features/apps/AppDetail.tsx
'use client'

import Link from 'next/link'
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
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  ExternalLink,
  GitBranch,
  Plus,
  Settings,
} from 'lucide-react'
import type { App, Deployment, Template, Workspace } from '@/payload-types'

interface AppDetailProps {
  app: App
  deployments: Deployment[]
}

const statusConfig = {
  healthy: { icon: CheckCircle2, color: 'text-green-500', label: 'Healthy' },
  degraded: { icon: AlertTriangle, color: 'text-yellow-500', label: 'Degraded' },
  down: { icon: XCircle, color: 'text-red-500', label: 'Down' },
  unknown: { icon: HelpCircle, color: 'text-gray-400', label: 'Unknown' },
}

const deploymentStatusColors = {
  pending: 'bg-gray-100 text-gray-800',
  deploying: 'bg-blue-100 text-blue-800',
  deployed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
}

export function AppDetail({ app, deployments }: AppDetailProps) {
  const status = app.status || 'unknown'
  const StatusIcon = statusConfig[status].icon
  const template = app.origin?.template as Template | undefined
  const workspace = app.workspace as Workspace

  return (
    <div className="container mx-auto py-8 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/apps">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">{app.name}</h1>
            <div className="flex items-center gap-1">
              <StatusIcon className={`h-5 w-5 ${statusConfig[status].color}`} />
              <span className="text-sm text-muted-foreground">{statusConfig[status].label}</span>
            </div>
          </div>
          {app.description && (
            <p className="text-muted-foreground mt-1">{app.description}</p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Origin</CardDescription>
          </CardHeader>
          <CardContent>
            {app.origin?.type === 'template' && template ? (
              <div>
                <div className="font-medium">{template.name}</div>
                <div className="text-sm text-muted-foreground">
                  Created {app.origin.instantiatedAt
                    ? new Date(app.origin.instantiatedAt).toLocaleDateString()
                    : 'from template'}
                </div>
              </div>
            ) : (
              <div className="font-medium">Imported Repository</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Repository</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-muted-foreground" />
              <a
                href={app.repository?.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium hover:underline flex items-center gap-1"
              >
                {app.repository?.owner}/{app.repository?.name}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Health Check</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <StatusIcon className={`h-5 w-5 ${statusConfig[status].color}`} />
              <span className="font-medium capitalize">{status}</span>
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              {app.healthConfig?.endpoint || '/health'} every {app.healthConfig?.interval || 60}s
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Deployments */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Deployments</CardTitle>
            <Button size="sm">
              <Plus className="mr-2 h-4 w-4" />
              Add Deployment
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {deployments.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No deployments yet. Add a deployment to start monitoring.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
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
                {deployments.map((deployment) => {
                  const healthStatus = deployment.healthStatus || 'unknown'
                  const HealthIcon = statusConfig[healthStatus].icon
                  return (
                    <TableRow key={deployment.id}>
                      <TableCell className="font-medium">{deployment.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{deployment.generator}</Badge>
                      </TableCell>
                      <TableCell>{deployment.target?.type || '-'}</TableCell>
                      <TableCell>
                        <Badge className={deploymentStatusColors[deployment.status || 'pending']}>
                          {deployment.status}
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
                      <TableCell>
                        <Button variant="ghost" size="sm">View</Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
```

**Step 3: Commit**

```bash
git add orbit-www/src/app/\(authenticated\)/apps/\[id\]/ orbit-www/src/components/features/apps/AppDetail.tsx
git commit -m "feat(catalog): add app detail page with deployments table"
```

---

### Task 6: Add Navigation Link to Apps

**Files:**
- Modify: `orbit-www/src/components/layout/Sidebar.tsx` (or equivalent nav component)

**Step 1: Find and update navigation component**

Look for the sidebar or navigation component that contains links to Templates, etc.

Add an "Applications" link after Templates:

```typescript
{
  name: 'Applications',
  href: '/apps',
  icon: Layers, // or AppWindow from lucide-react
}
```

**Step 2: Verify navigation works**

Run: `cd orbit-www && bun run dev`
Navigate to the sidebar and confirm "Applications" link appears and works

**Step 3: Commit**

```bash
git add orbit-www/src/components/layout/
git commit -m "feat(catalog): add Applications link to navigation"
```

---

### Task 7: Add "Add to Catalog" Prompt After Template Instantiation

**Files:**
- Modify: `orbit-www/src/components/features/templates/WorkflowProgress.tsx`

**Step 1: Update WorkflowProgress to show Add to Catalog option**

Add after the success result section in WorkflowProgress.tsx:

```typescript
// Add import
import { createAppFromTemplate } from '@/app/actions/apps'

// Add state
const [isCreatingApp, setIsCreatingApp] = useState(false)
const [appCreated, setAppCreated] = useState(false)

// Add handler
const handleAddToCatalog = async () => {
  if (!status?.result?.gitUrl) return
  setIsCreatingApp(true)
  try {
    // Extract owner/repo from gitUrl
    const match = status.result.gitUrl.match(/github\.com\/([^/]+)\/([^/]+)/)
    if (!match) throw new Error('Invalid repository URL')

    const result = await createAppFromTemplate({
      name: status.result.repoName || match[2],
      repositoryOwner: match[1],
      repositoryName: match[2],
      repositoryUrl: status.result.gitUrl,
      templateId: templateId, // Pass templateId as prop
      workspaceId: workspaceId, // Pass workspaceId as prop
    })

    if (result.success) {
      setAppCreated(true)
      router.push(`/apps/${result.appId}`)
    }
  } catch (error) {
    console.error('Failed to create app:', error)
  } finally {
    setIsCreatingApp(false)
  }
}

// Update success result JSX to include Add to Catalog button
{status.status === 'completed' && status.result && !appCreated && (
  <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
    {/* ... existing content ... */}
    <AlertDescription>
      <div className="space-y-4 mt-2">
        <div className="flex items-center gap-4">
          {/* ... existing buttons ... */}
        </div>
        <div className="border-t pt-4">
          <p className="text-sm text-muted-foreground mb-2">
            Ready to deploy? Add this app to your catalog and set up deployments.
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push('/templates')}
            >
              Skip for now
            </Button>
            <Button
              size="sm"
              onClick={handleAddToCatalog}
              disabled={isCreatingApp}
            >
              {isCreatingApp ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adding...
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Add to Catalog
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </AlertDescription>
  </Alert>
)}
```

**Step 2: Create the server action**

```typescript
// orbit-www/src/app/actions/apps.ts
'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { getCurrentUser } from '@/lib/auth/session'

interface CreateAppFromTemplateInput {
  name: string
  description?: string
  repositoryOwner: string
  repositoryName: string
  repositoryUrl: string
  templateId: string
  workspaceId: string
  installationId?: string
}

export async function createAppFromTemplate(input: CreateAppFromTemplateInput) {
  const user = await getCurrentUser()
  if (!user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  try {
    const app = await payload.create({
      collection: 'apps',
      data: {
        name: input.name,
        description: input.description,
        workspace: input.workspaceId,
        repository: {
          owner: input.repositoryOwner,
          name: input.repositoryName,
          url: input.repositoryUrl,
          installationId: input.installationId || '',
        },
        origin: {
          type: 'template',
          template: input.templateId,
          instantiatedAt: new Date().toISOString(),
        },
        status: 'unknown',
        syncMode: 'orbit-primary',
      },
    })

    return { success: true, appId: app.id }
  } catch (error) {
    console.error('Failed to create app:', error)
    return { success: false, error: 'Failed to create app' }
  }
}
```

**Step 3: Commit**

```bash
git add orbit-www/src/components/features/templates/WorkflowProgress.tsx orbit-www/src/app/actions/apps.ts
git commit -m "feat(catalog): add 'Add to Catalog' prompt after template instantiation"
```

---

### Task 8: Create Import Repository Flow

**Files:**
- Create: `orbit-www/src/app/(authenticated)/apps/import/page.tsx`
- Create: `orbit-www/src/components/features/apps/ImportAppForm.tsx`

**Step 1: Create import page**

```typescript
// orbit-www/src/app/(authenticated)/apps/import/page.tsx
import { getCurrentUser } from '@/lib/auth/session'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { ImportAppForm } from '@/components/features/apps/ImportAppForm'

export default async function ImportAppPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const payload = await getPayload({ config })

  // Get user's workspaces with GitHub installations
  const workspaceIds = user.workspaces?.map((w) =>
    typeof w.workspace === 'object' ? w.workspace.id : w.workspace
  ) || []

  const { docs: workspaces } = await payload.find({
    collection: 'workspaces',
    where: {
      id: { in: workspaceIds },
    },
    depth: 1,
  })

  return (
    <div className="container mx-auto py-8 px-4 max-w-2xl">
      <h1 className="text-3xl font-bold mb-2">Import Repository</h1>
      <p className="text-muted-foreground mb-8">
        Add an existing repository to your application catalog.
      </p>
      <ImportAppForm workspaces={workspaces} />
    </div>
  )
}
```

**Step 2: Create ImportAppForm component**

```typescript
// orbit-www/src/components/features/apps/ImportAppForm.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Form,
  FormControl,
  FormDescription,
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
import { Card, CardContent } from '@/components/ui/card'
import { Loader2 } from 'lucide-react'
import { importRepository } from '@/app/actions/apps'
import type { Workspace } from '@/payload-types'

const formSchema = z.object({
  workspaceId: z.string().min(1, 'Please select a workspace'),
  repositoryUrl: z.string().url('Please enter a valid GitHub URL'),
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
})

type FormData = z.infer<typeof formSchema>

interface ImportAppFormProps {
  workspaces: Workspace[]
}

export function ImportAppForm({ workspaces }: ImportAppFormProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      workspaceId: workspaces[0]?.id || '',
      repositoryUrl: '',
      name: '',
      description: '',
    },
  })

  const onSubmit = async (data: FormData) => {
    setIsSubmitting(true)
    try {
      const result = await importRepository(data)
      if (result.success && result.appId) {
        router.push(`/apps/${result.appId}`)
      } else {
        form.setError('root', { message: result.error || 'Failed to import repository' })
      }
    } catch (error) {
      form.setError('root', { message: 'An unexpected error occurred' })
    } finally {
      setIsSubmitting(false)
    }
  }

  // Auto-fill name from URL
  const handleUrlChange = (url: string) => {
    form.setValue('repositoryUrl', url)
    const match = url.match(/github\.com\/[^/]+\/([^/]+)/)
    if (match && !form.getValues('name')) {
      form.setValue('name', match[1])
    }
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="workspaceId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Workspace</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a workspace" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {workspaces.map((ws) => (
                        <SelectItem key={ws.id} value={ws.id}>
                          {ws.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="repositoryUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Repository URL</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="https://github.com/org/repo"
                      {...field}
                      onChange={(e) => handleUrlChange(e.target.value)}
                    />
                  </FormControl>
                  <FormDescription>
                    The GitHub repository to import
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Application Name</FormLabel>
                  <FormControl>
                    <Input placeholder="my-service" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="What does this application do?"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {form.formState.errors.root && (
              <p className="text-sm text-destructive">
                {form.formState.errors.root.message}
              </p>
            )}

            <div className="flex gap-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Importing...
                  </>
                ) : (
                  'Import Repository'
                )}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
```

**Step 3: Add importRepository action**

Add to `orbit-www/src/app/actions/apps.ts`:

```typescript
interface ImportRepositoryInput {
  workspaceId: string
  repositoryUrl: string
  name: string
  description?: string
}

export async function importRepository(input: ImportRepositoryInput) {
  const user = await getCurrentUser()
  if (!user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  // Parse repository URL
  const match = input.repositoryUrl.match(/github\.com\/([^/]+)\/([^/]+)/)
  if (!match) {
    return { success: false, error: 'Invalid GitHub repository URL' }
  }

  const [, owner, repoName] = match

  try {
    const app = await payload.create({
      collection: 'apps',
      data: {
        name: input.name,
        description: input.description,
        workspace: input.workspaceId,
        repository: {
          owner,
          name: repoName.replace(/\.git$/, ''),
          url: input.repositoryUrl,
          installationId: '', // Will be set when user connects GitHub
        },
        origin: {
          type: 'imported',
        },
        status: 'unknown',
        syncMode: 'orbit-primary',
      },
    })

    return { success: true, appId: app.id }
  } catch (error) {
    console.error('Failed to import repository:', error)
    return { success: false, error: 'Failed to import repository' }
  }
}
```

**Step 4: Commit**

```bash
git add orbit-www/src/app/\(authenticated\)/apps/import/ orbit-www/src/components/features/apps/ImportAppForm.tsx orbit-www/src/app/actions/apps.ts
git commit -m "feat(catalog): add import repository flow"
```

---

## Phase 1 Complete Checkpoint

At this point you should have:
- [x] App collection with all fields
- [x] Deployment collection with all fields
- [x] Apps catalog page with card grid view
- [x] App detail page with deployments table
- [x] Navigation link to Applications
- [x] "Add to Catalog" prompt after template instantiation
- [x] Import repository flow

**Verify:**
1. Run `bun run dev` and navigate to /apps
2. Confirm empty state shows correctly
3. Create an app from a template and confirm "Add to Catalog" appears
4. Import a repository and confirm it appears in the catalog
5. Click an app and verify detail page renders

---

## Phase 2: Deployment Workflows (Next Plan)

Phase 2 will cover:
- DeploymentGenerator collection
- Docker Compose generator implementation
- DeploymentWorkflow in Temporal
- Deploy flow UI

Create a separate plan document for Phase 2 when ready to proceed.
