# Workspace Detail Page Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the workspace detail page from a 2-column layout to a 3-column dashboard with Applications, Registries, Recent Documents, and simplified sidebar cards.

**Architecture:** Create 5 new presentational components for each card section, update the main page to fetch new data (apps, registry images, recent pages), and restructure the layout from 2-column to 3-column responsive grid.

**Tech Stack:** Next.js 15 App Router, React 19, Payload CMS, TypeScript, Tailwind CSS, shadcn/ui components, date-fns for relative times, Lucide icons.

---

## Task 1: Create WorkspaceQuickLinksCard Component

**Files:**
- Create: `orbit-www/src/components/features/workspace/WorkspaceQuickLinksCard.tsx`

**Step 1: Create the component file**

```tsx
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { BookOpen, LayoutTemplate, Box, ChevronRight } from 'lucide-react'
import Link from 'next/link'

interface WorkspaceQuickLinksCardProps {
  workspaceSlug: string
}

export function WorkspaceQuickLinksCard({ workspaceSlug }: WorkspaceQuickLinksCardProps) {
  const links = [
    {
      label: 'All Knowledge Spaces',
      href: `/workspaces/${workspaceSlug}/knowledge`,
      icon: BookOpen,
    },
    {
      label: 'Templates',
      href: `/templates?workspace=${workspaceSlug}`,
      icon: LayoutTemplate,
    },
    {
      label: 'Registries',
      href: `/settings/registries?workspace=${workspaceSlug}`,
      icon: Box,
    },
  ]

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Quick Links</CardTitle>
        <CardDescription>Helpful shortcuts</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-colors"
          >
            <link.icon className="h-4 w-4 text-muted-foreground" />
            <span className="flex-1 text-sm">{link.label}</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}
```

**Step 2: Verify the component compiles**

Run: `cd orbit-www && bunx tsc --noEmit`
Expected: No errors related to WorkspaceQuickLinksCard

**Step 3: Commit**

```bash
git add orbit-www/src/components/features/workspace/WorkspaceQuickLinksCard.tsx
git commit -m "feat(workspace): add WorkspaceQuickLinksCard component"
```

---

## Task 2: Create WorkspaceMembersCardSimple Component

**Files:**
- Create: `orbit-www/src/components/features/workspace/WorkspaceMembersCardSimple.tsx`

**Step 1: Create the component file**

```tsx
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface Member {
  id: string
  name?: string | null
  email: string
  avatar?: { url?: string | null } | null
}

interface WorkspaceMembersCardSimpleProps {
  members: Member[]
  totalCount: number
}

export function WorkspaceMembersCardSimple({
  members,
  totalCount,
}: WorkspaceMembersCardSimpleProps) {
  // Show up to 8 avatars
  const displayMembers = members.slice(0, 8)
  const remainingCount = totalCount - displayMembers.length

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Members ({totalCount})</CardTitle>
        <CardDescription>People in this workspace</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">
          Owners
        </p>
        <TooltipProvider>
          <div className="flex flex-wrap gap-1">
            {displayMembers.map((member) => (
              <Tooltip key={member.id}>
                <TooltipTrigger asChild>
                  <Avatar className="h-8 w-8 border-2 border-background">
                    {member.avatar?.url && <AvatarImage src={member.avatar.url} />}
                    <AvatarFallback className="text-xs">
                      {(member.name || member.email)?.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{member.name || member.email}</p>
                </TooltipContent>
              </Tooltip>
            ))}
            {remainingCount > 0 && (
              <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                <span className="text-xs text-muted-foreground">+{remainingCount}</span>
              </div>
            )}
          </div>
        </TooltipProvider>
      </CardContent>
    </Card>
  )
}
```

**Step 2: Verify the component compiles**

Run: `cd orbit-www && bunx tsc --noEmit`
Expected: No errors related to WorkspaceMembersCardSimple

**Step 3: Commit**

```bash
git add orbit-www/src/components/features/workspace/WorkspaceMembersCardSimple.tsx
git commit -m "feat(workspace): add WorkspaceMembersCardSimple component"
```

---

## Task 3: Create WorkspaceApplicationsCard Component

**Files:**
- Create: `orbit-www/src/components/features/workspace/WorkspaceApplicationsCard.tsx`

**Step 1: Create the component file**

```tsx
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { LayoutGrid, Plus, AlertTriangle, CheckCircle2, XCircle, HelpCircle } from 'lucide-react'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import type { App } from '@/payload-types'

interface WorkspaceApplicationsCardProps {
  apps: App[]
  workspaceSlug: string
}

const statusConfig = {
  healthy: {
    icon: CheckCircle2,
    label: 'Healthy',
    className: 'text-green-500',
  },
  degraded: {
    icon: AlertTriangle,
    label: 'Warning',
    className: 'text-yellow-500',
  },
  down: {
    icon: XCircle,
    label: 'Down',
    className: 'text-red-500',
  },
  unknown: {
    icon: HelpCircle,
    label: 'Unknown',
    className: 'text-gray-500',
  },
} as const

export function WorkspaceApplicationsCard({
  apps,
  workspaceSlug,
}: WorkspaceApplicationsCardProps) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LayoutGrid className="h-5 w-5" />
            <CardTitle className="text-base">Applications</CardTitle>
          </div>
          <Link href="/apps/new">
            <Button size="sm" className="bg-orange-500 hover:bg-orange-600">
              <Plus className="h-4 w-4 mr-1" />
              New App
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {apps.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground mb-4">No applications yet</p>
            <Link href="/apps/new">
              <Button variant="outline" size="sm">
                Create your first app
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-1">
            {/* Header row */}
            <div className="grid grid-cols-[1fr_auto_auto] gap-4 px-2 py-1 text-xs font-medium text-muted-foreground uppercase">
              <span>Status</span>
              <span>Last Deployed</span>
              <span></span>
            </div>
            {/* App rows */}
            {apps.map((app) => {
              const status = app.status || 'unknown'
              const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.unknown
              const StatusIcon = config.icon
              const lastDeployed = app.latestBuild?.builtAt
                ? formatDistanceToNow(new Date(app.latestBuild.builtAt), { addSuffix: true })
                : 'Never'

              return (
                <div
                  key={app.id}
                  className="grid grid-cols-[1fr_auto_auto] gap-4 items-center px-2 py-3 rounded-lg hover:bg-muted/50"
                >
                  <div>
                    <p className="font-medium text-sm">{app.name}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <StatusIcon className={`h-3.5 w-3.5 ${config.className}`} />
                      <span className={`text-xs ${config.className}`}>{config.label}</span>
                    </div>
                  </div>
                  <span className="text-sm text-muted-foreground">{lastDeployed}</span>
                  <Link href={`/apps/${app.id}`}>
                    <Button variant="outline" size="sm">
                      Manage
                    </Button>
                  </Link>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

**Step 2: Verify the component compiles**

Run: `cd orbit-www && bunx tsc --noEmit`
Expected: No errors related to WorkspaceApplicationsCard

**Step 3: Commit**

```bash
git add orbit-www/src/components/features/workspace/WorkspaceApplicationsCard.tsx
git commit -m "feat(workspace): add WorkspaceApplicationsCard component"
```

---

## Task 4: Create WorkspaceRegistriesCard Component

**Files:**
- Create: `orbit-www/src/components/features/workspace/WorkspaceRegistriesCard.tsx`

**Step 1: Create the component file**

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Box, Plus, ChevronRight, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import type { RegistryImage, App, RegistryConfig } from '@/payload-types'

// Registry type icons (simple colored circles for now)
function RegistryTypeIcon({ type }: { type: 'orbit' | 'ghcr' | 'acr' }) {
  const colors = {
    orbit: 'bg-orange-500',
    ghcr: 'bg-purple-500',
    acr: 'bg-blue-500',
  }
  const labels = {
    orbit: 'Orbit',
    ghcr: 'GHCR',
    acr: 'ACR',
  }

  return (
    <div className="flex items-center gap-2">
      <div className={`h-8 w-8 rounded-lg ${colors[type]} flex items-center justify-center`}>
        <Box className="h-4 w-4 text-white" />
      </div>
      <span className="text-xs text-muted-foreground">{labels[type]}</span>
    </div>
  )
}

interface GroupedImage {
  registryType: 'orbit' | 'ghcr' | 'acr'
  registryName: string
  imageUrl: string
  appName: string
  appId: string
}

interface WorkspaceRegistriesCardProps {
  images: GroupedImage[]
  workspaceSlug: string
}

export function WorkspaceRegistriesCard({
  images,
  workspaceSlug,
}: WorkspaceRegistriesCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Box className="h-5 w-5" />
            <CardTitle className="text-base">Registries</CardTitle>
          </div>
          <Link href={`/settings/registries?workspace=${workspaceSlug}&action=new`}>
            <Button size="sm" className="bg-orange-500 hover:bg-orange-600">
              <Plus className="h-4 w-4 mr-1" />
              New Registry
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {images.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground mb-4">No images pushed yet</p>
            <Link href={`/settings/registries?workspace=${workspaceSlug}`}>
              <Button variant="outline" size="sm">
                Configure registries
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-1">
            {/* Header row */}
            <div className="px-2 py-1 text-xs font-medium text-muted-foreground uppercase">
              Image Repository
            </div>
            {/* Image rows */}
            {images.map((image, idx) => (
              <Link
                key={`${image.appId}-${idx}`}
                href={`/apps/${image.appId}`}
                className="flex items-center gap-3 px-2 py-3 rounded-lg hover:bg-muted/50 group"
              >
                <RegistryTypeIcon type={image.registryType} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">
                    {image.registryName} - {image.appName}
                  </p>
                  <a
                    href={image.imageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 truncate"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {image.imageUrl}
                    <ExternalLink className="h-3 w-3 flex-shrink-0" />
                  </a>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

**Step 2: Verify the component compiles**

Run: `cd orbit-www && bunx tsc --noEmit`
Expected: No errors related to WorkspaceRegistriesCard

**Step 3: Commit**

```bash
git add orbit-www/src/components/features/workspace/WorkspaceRegistriesCard.tsx
git commit -m "feat(workspace): add WorkspaceRegistriesCard component"
```

---

## Task 5: Create WorkspaceRecentDocsCard Component

**Files:**
- Create: `orbit-www/src/components/features/workspace/WorkspaceRecentDocsCard.tsx`

**Step 1: Create the component file**

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { FileText, ChevronRight, FolderOpen } from 'lucide-react'
import Link from 'next/link'

interface RecentDoc {
  id: string
  title: string
  spaceSlug: string
  pageSlug: string
}

interface WorkspaceRecentDocsCardProps {
  docs: RecentDoc[]
  workspaceSlug: string
}

export function WorkspaceRecentDocsCard({
  docs,
  workspaceSlug,
}: WorkspaceRecentDocsCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            <CardTitle className="text-base">Recent Documents</CardTitle>
          </div>
          <Link href={`/workspaces/${workspaceSlug}/knowledge`}>
            <Button size="sm" className="bg-orange-500 hover:bg-orange-600">
              <FolderOpen className="h-4 w-4 mr-1" />
              Manage Spaces
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {docs.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground mb-4">No documents yet</p>
            <Link href={`/workspaces/${workspaceSlug}/knowledge/new`}>
              <Button variant="outline" size="sm">
                Create a knowledge space
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-1">
            {docs.map((doc) => (
              <Link
                key={doc.id}
                href={`/workspaces/${workspaceSlug}/knowledge/${doc.spaceSlug}/${doc.pageSlug}`}
                className="flex items-center gap-3 px-2 py-3 rounded-lg hover:bg-muted/50 group"
              >
                <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <span className="flex-1 text-sm truncate">{doc.title}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

**Step 2: Verify the component compiles**

Run: `cd orbit-www && bunx tsc --noEmit`
Expected: No errors related to WorkspaceRecentDocsCard

**Step 3: Commit**

```bash
git add orbit-www/src/components/features/workspace/WorkspaceRecentDocsCard.tsx
git commit -m "feat(workspace): add WorkspaceRecentDocsCard component"
```

---

## Task 6: Create Barrel Export for New Components

**Files:**
- Create: `orbit-www/src/components/features/workspace/index.ts`

**Step 1: Create the barrel export file**

```tsx
export { WorkspaceQuickLinksCard } from './WorkspaceQuickLinksCard'
export { WorkspaceMembersCardSimple } from './WorkspaceMembersCardSimple'
export { WorkspaceApplicationsCard } from './WorkspaceApplicationsCard'
export { WorkspaceRegistriesCard } from './WorkspaceRegistriesCard'
export { WorkspaceRecentDocsCard } from './WorkspaceRecentDocsCard'
export { WorkspaceKnowledgeSection } from './WorkspaceKnowledgeSection'
export { WorkspaceTemplatesSection } from './WorkspaceTemplatesSection'
export { RegistryQuotaWarning } from './RegistryQuotaWarning'
```

**Step 2: Verify the exports compile**

Run: `cd orbit-www && bunx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add orbit-www/src/components/features/workspace/index.ts
git commit -m "feat(workspace): add barrel export for workspace components"
```

---

## Task 7: Update Workspace Detail Page - Data Fetching

**Files:**
- Modify: `orbit-www/src/app/(frontend)/workspaces/[slug]/page.tsx`

**Step 1: Add new imports at top of file**

Replace the existing imports section (lines 1-17) with:

```tsx
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import Link from 'next/link'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { WorkspaceClient } from './workspace-client'
import { checkMembershipStatus } from './actions'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { RegistryQuotaWarning } from '@/components/features/workspace/RegistryQuotaWarning'
import {
  WorkspaceApplicationsCard,
  WorkspaceRegistriesCard,
  WorkspaceRecentDocsCard,
  WorkspaceQuickLinksCard,
  WorkspaceMembersCardSimple,
} from '@/components/features/workspace'
```

**Step 2: Add new data fetching after existing queries (after line ~125)**

After the knowledgeSpaces query and before the templatesResult query, add:

```tsx
  // Fetch apps for this workspace
  const appsResult = await payload.find({
    collection: 'apps',
    where: {
      workspace: {
        equals: workspace.id,
      },
    },
    sort: '-latestBuild.builtAt',
    limit: 10,
    depth: 1,
  })

  // Fetch registry images for this workspace
  const registryImagesResult = await payload.find({
    collection: 'registry-images',
    where: {
      workspace: {
        equals: workspace.id,
      },
    },
    sort: '-pushedAt',
    limit: 10,
    depth: 2,
  })

  // Transform registry images for display
  const registryImages = registryImagesResult.docs.map((img) => {
    const app = typeof img.app === 'object' ? img.app : null
    const registryConfig = app && typeof app.registryConfig === 'object' ? app.registryConfig : null
    const registryType = (registryConfig?.type || 'orbit') as 'orbit' | 'ghcr' | 'acr'
    const registryName = registryConfig?.name || 'Orbit Registry'

    // Build image URL based on registry type
    let imageUrl = ''
    if (registryType === 'ghcr' && registryConfig?.ghcrOwner) {
      imageUrl = `https://ghcr.io/${registryConfig.ghcrOwner}/${app?.name || 'unknown'}:${img.tag}`
    } else if (registryType === 'acr' && registryConfig?.acrLoginServer) {
      imageUrl = `https://${registryConfig.acrLoginServer}/${app?.name || 'unknown'}:${img.tag}`
    } else {
      imageUrl = `localhost:5050/${app?.name || 'unknown'}:${img.tag}`
    }

    return {
      registryType,
      registryName,
      imageUrl,
      appName: app?.name || 'Unknown App',
      appId: app?.id || '',
    }
  })

  // Fetch recent knowledge pages across all spaces in this workspace
  const spaceIds = spacesResult.docs.map((s) => s.id)
  const recentPagesResult = spaceIds.length > 0
    ? await payload.find({
        collection: 'knowledge-pages',
        where: {
          knowledgeSpace: {
            in: spaceIds,
          },
        },
        sort: '-updatedAt',
        limit: 10,
        depth: 1,
      })
    : { docs: [] }

  const recentDocs = recentPagesResult.docs.map((page) => {
    const space = typeof page.knowledgeSpace === 'object' ? page.knowledgeSpace : null
    return {
      id: page.id,
      title: page.title,
      spaceSlug: space?.slug || '',
      pageSlug: page.slug,
    }
  })
```

**Step 3: Verify the data fetching compiles**

Run: `cd orbit-www && bunx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/workspaces/\[slug\]/page.tsx
git commit -m "feat(workspace): add data fetching for apps, registries, recent docs"
```

---

## Task 8: Update Workspace Detail Page - Refactor Layout

**Files:**
- Modify: `orbit-www/src/app/(frontend)/workspaces/[slug]/page.tsx`

**Step 1: Replace the entire JSX return block**

Replace lines 161 to end with the new 3-column layout:

```tsx
  // Extract members for simplified display
  const memberUsers = members
    .map((m) => {
      const user = typeof m.user === 'object' ? m.user : null
      if (!user) return null
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar && typeof user.avatar === 'object' ? user.avatar : null,
      }
    })
    .filter((u): u is NonNullable<typeof u> => u !== null)

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-4 p-8">
          <div className="container mx-auto">
            {/* Workspace Header */}
            <div className="mb-8">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-6">
                  {workspace.avatar && typeof workspace.avatar === 'object' && 'url' in workspace.avatar && workspace.avatar.url && (
                    <Avatar className="h-16 w-16">
                      <AvatarImage src={workspace.avatar.url} alt={workspace.name} />
                      <AvatarFallback>{workspace.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                  )}
                  <div>
                    <h1 className="text-4xl font-bold text-foreground">
                      {workspace.name}
                    </h1>
                    <p className="text-lg text-muted-foreground">
                      /{workspace.slug}
                    </p>
                    {workspace.description && (
                      <p className="text-muted-foreground mt-2 max-w-2xl">{workspace.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {membershipStatus?.role && (
                    <Badge variant="secondary">{membershipStatus.role}</Badge>
                  )}
                  <WorkspaceClient workspaceId={workspace.id} membershipStatus={membershipStatus} />
                </div>
              </div>
            </div>

            {/* Registry Quota Warning */}
            <div className="mb-8">
              <RegistryQuotaWarning workspaceId={workspace.id} />
            </div>

            {/* 3-Column Dashboard Layout */}
            <div className="grid gap-6 lg:grid-cols-[1fr_1fr_280px]">
              {/* Left Column - Applications */}
              <div className="space-y-6">
                <WorkspaceApplicationsCard
                  apps={appsResult.docs}
                  workspaceSlug={workspace.slug}
                />
              </div>

              {/* Middle Column - Registries + Recent Docs */}
              <div className="space-y-6">
                <WorkspaceRegistriesCard
                  images={registryImages}
                  workspaceSlug={workspace.slug}
                />
                <WorkspaceRecentDocsCard
                  docs={recentDocs}
                  workspaceSlug={workspace.slug}
                />
              </div>

              {/* Right Column - Sidebar Cards */}
              <div className="space-y-6">
                {/* Hierarchy Card */}
                {(parentWorkspace || childWorkspaces.length > 0) && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Workspace Hierarchy</CardTitle>
                      <CardDescription>Related workspaces</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {parentWorkspace && (
                          <div>
                            <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                              Parent Workspace
                            </p>
                            <Link
                              href={`/workspaces/${parentWorkspace.slug}`}
                              className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-colors"
                            >
                              <Avatar className="h-8 w-8">
                                {parentWorkspace.avatar && typeof parentWorkspace.avatar === 'object' && 'url' in parentWorkspace.avatar && parentWorkspace.avatar.url && (
                                  <AvatarImage src={parentWorkspace.avatar.url} alt={parentWorkspace.name} />
                                )}
                                <AvatarFallback>
                                  {parentWorkspace.name.slice(0, 2).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">
                                  {parentWorkspace.name}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  /{parentWorkspace.slug}
                                </p>
                              </div>
                            </Link>
                          </div>
                        )}

                        {childWorkspaces.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                              Child Workspaces ({childWorkspaces.length})
                            </p>
                            <div className="space-y-1">
                              {childWorkspaces.map((child) => (
                                <Link
                                  key={child.id}
                                  href={`/workspaces/${child.slug}`}
                                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-colors"
                                >
                                  <Avatar className="h-8 w-8">
                                    {child.avatar && typeof child.avatar === 'object' && 'url' in child.avatar && child.avatar.url && (
                                      <AvatarImage src={child.avatar.url} alt={child.name} />
                                    )}
                                    <AvatarFallback>
                                      {child.name.slice(0, 2).toUpperCase()}
                                    </AvatarFallback>
                                  </Avatar>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate">
                                      {child.name}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      /{child.slug}
                                    </p>
                                  </div>
                                </Link>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Members Card */}
                <WorkspaceMembersCardSimple
                  members={memberUsers}
                  totalCount={members.length}
                />

                {/* Quick Links Card */}
                <WorkspaceQuickLinksCard workspaceSlug={workspace.slug} />
              </div>
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
```

**Step 2: Remove unused imports and code**

Remove these imports that are no longer needed:
- `WorkspaceKnowledgeSection`
- `WorkspaceTemplatesSection`

Remove the templates query (templatesResult and workspaceTemplates) as it's no longer displayed.

Remove the knowledgeSpaces transformation (we still need spacesResult for the spaceIds query but not the detailed transformation).

Remove these unused variables:
- `ownerMembers`, `adminMembers`, `regularMembers`
- `canManageKnowledge`, `canManageTemplates`
- `workspaceTemplates`
- Full `knowledgeSpaces` array (keep only what's needed for spaceIds)

**Step 3: Verify everything compiles**

Run: `cd orbit-www && bunx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/workspaces/\[slug\]/page.tsx
git commit -m "feat(workspace): refactor to 3-column dashboard layout"
```

---

## Task 9: Manual Testing Verification

**Step 1: Start the development server**

Run: `cd orbit-www && bun run dev`
Expected: Server starts without errors

**Step 2: Test the workspace detail page**

Open: `http://localhost:3000/workspaces/[your-workspace-slug]`

Verify:
- [ ] Page loads without errors
- [ ] Header shows workspace name, slug, description, and role badge
- [ ] 3-column layout displays correctly on desktop
- [ ] Applications card shows apps with status badges and "Manage" links
- [ ] Registries card shows images (or empty state)
- [ ] Recent Documents card shows pages (or empty state)
- [ ] Workspace Hierarchy card shows parent/children (if applicable)
- [ ] Members card shows avatar row with tooltips
- [ ] Quick Links navigate to correct pages
- [ ] Layout collapses properly on smaller screens

**Step 3: Test empty states**

Test with a workspace that has:
- No applications
- No registry images
- No knowledge pages

Verify empty states display correctly with action buttons.

**Step 4: Commit final verification**

```bash
git add -A
git commit -m "feat(workspace): complete workspace detail page redesign

Implements 3-column dashboard layout with:
- Applications card with status badges
- Registries card showing pushed images
- Recent Documents from knowledge spaces
- Simplified Members card (avatars only)
- Quick Links for common navigation

Closes workspace-detail-page-redesign"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Create WorkspaceQuickLinksCard | 1 new |
| 2 | Create WorkspaceMembersCardSimple | 1 new |
| 3 | Create WorkspaceApplicationsCard | 1 new |
| 4 | Create WorkspaceRegistriesCard | 1 new |
| 5 | Create WorkspaceRecentDocsCard | 1 new |
| 6 | Create barrel export | 1 new |
| 7 | Update page - data fetching | 1 modified |
| 8 | Update page - layout refactor | 1 modified |
| 9 | Manual testing verification | N/A |

**Total: 6 new files, 1 modified file**
