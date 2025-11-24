# Knowledge Space Navigation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create Notion-style immersive knowledge space experience with persistent tree navigation, context menu management, and editorial design.

**Architecture:** Next.js nested layout pattern with server component for data fetching, client components for tree sidebar and context menu interactions. Auto-minimize app sidebar, permanent left tree navigation, slim breadcrumb header.

**Tech Stack:** Next.js 15, React 19, Radix UI (Context Menu), dnd-kit (drag-drop), Tailwind CSS, Payload CMS

---

## Task 1: Create Nested Layout Structure

**Goal:** Set up the foundational nested layout that will wrap all knowledge space pages.

**Files:**
- Create: `src/app/(frontend)/workspaces/[slug]/knowledge/[spaceSlug]/layout.tsx`
- Test: `src/app/(frontend)/workspaces/[slug]/knowledge/[spaceSlug]/layout.test.tsx`

### Step 1: Write the failing test

Create `src/app/(frontend)/workspaces/[slug]/knowledge/[spaceSlug]/layout.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

// Mock Next.js modules
vi.mock('next/navigation', () => ({
  notFound: vi.fn(),
}))

vi.mock('payload', () => ({
  getPayload: vi.fn(),
}))

vi.mock('@payload-config', () => ({
  default: {},
}))

describe('KnowledgeSpaceLayout', () => {
  it('should render with auto-minimized sidebar', async () => {
    const { getPayload } = await import('payload')
    const mockGetPayload = getPayload as any

    mockGetPayload.mockResolvedValue({
      find: vi.fn()
        .mockResolvedValueOnce({ docs: [{ id: '1', slug: 'test-workspace', name: 'Test' }] })
        .mockResolvedValueOnce({ docs: [{ id: '2', slug: 'test-space', name: 'Test Space' }] })
        .mockResolvedValueOnce({ docs: [] }),
    })

    const KnowledgeSpaceLayout = (await import('./layout')).default

    const { container } = render(
      await KnowledgeSpaceLayout({
        children: <div>Test Content</div>,
        params: Promise.resolve({ slug: 'test-workspace', spaceSlug: 'test-space' }),
      })
    )

    // Should render with SidebarProvider defaultOpen={false}
    expect(container.querySelector('[data-state]')).toBeTruthy()
  })
})
```

### Step 2: Run test to verify it fails

Run: `bun run test layout.test.tsx`
Expected: FAIL with "Cannot find module './layout'"

### Step 3: Write minimal implementation

Create `src/app/(frontend)/workspaces/[slug]/knowledge/[spaceSlug]/layout.tsx`:

```typescript
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'

interface LayoutProps {
  children: React.ReactNode
  params: Promise<{
    slug: string
    spaceSlug: string
  }>
}

export default async function KnowledgeSpaceLayout({ children, params }: LayoutProps) {
  const { slug, spaceSlug } = await params
  const payload = await getPayload({ config })

  // Fetch workspace
  const workspaceResult = await payload.find({
    collection: 'workspaces',
    where: { slug: { equals: slug } },
    limit: 1,
  })

  if (!workspaceResult.docs.length) {
    notFound()
  }

  const workspace = workspaceResult.docs[0]

  // Fetch knowledge space
  const spaceResult = await payload.find({
    collection: 'knowledge-spaces',
    where: {
      slug: { equals: spaceSlug },
      workspace: { equals: workspace.id },
    },
    limit: 1,
  })

  if (!spaceResult.docs.length) {
    notFound()
  }

  const space = spaceResult.docs[0]

  // Fetch pages for this space
  const pagesResult = await payload.find({
    collection: 'knowledge-pages',
    where: { knowledgeSpace: { equals: space.id } },
    limit: 1000,
    sort: 'sortOrder',
  })

  const pages = pagesResult.docs

  return (
    <SidebarProvider defaultOpen={false}>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />

        <div className="flex h-[calc(100vh-64px)]">
          {/* TODO: Add KnowledgeTreeSidebar */}
          <div className="w-64 border-r border-border bg-background">
            Sidebar placeholder
          </div>

          <div className="flex-1 flex flex-col">
            {/* TODO: Add KnowledgeBreadcrumbs */}
            <div className="h-10 border-b border-border">
              Breadcrumbs placeholder
            </div>

            <div className="flex-1 overflow-y-auto">
              {children}
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
```

### Step 4: Run test to verify it passes

Run: `bun run test layout.test.tsx`
Expected: PASS

### Step 5: Commit

```bash
git add src/app/\(frontend\)/workspaces/\[slug\]/knowledge/\[spaceSlug\]/layout.tsx
git add src/app/\(frontend\)/workspaces/\[slug\]/knowledge/\[spaceSlug\]/layout.test.tsx
git commit -m "feat: add nested layout for knowledge space

- Auto-minimize app sidebar with defaultOpen={false}
- Full-height layout with sidebar and content areas
- Fetch workspace, space, and pages data
- Placeholder for tree sidebar and breadcrumbs

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Create KnowledgeTreeSidebar Component

**Goal:** Build the Notion-style persistent tree navigation sidebar.

**Files:**
- Create: `src/components/features/knowledge/KnowledgeTreeSidebar.tsx`
- Create: `src/components/features/knowledge/KnowledgeTreeSidebar.test.tsx`

### Step 1: Write the failing test

Create `src/components/features/knowledge/KnowledgeTreeSidebar.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { KnowledgeTreeSidebar } from './KnowledgeTreeSidebar'

describe('KnowledgeTreeSidebar', () => {
  const mockSpace = {
    id: '1',
    name: 'Test Space',
    slug: 'test-space',
    icon: '📚',
    description: 'Test description',
  }

  const mockPages = [
    {
      id: '1',
      title: 'Page 1',
      slug: 'page-1',
      sortOrder: 0,
      parentPage: null,
      status: 'published',
    },
  ]

  it('should render space name with editorial typography', () => {
    render(
      <KnowledgeTreeSidebar
        space={mockSpace as any}
        pages={mockPages as any}
        workspaceSlug="test"
        currentPageId={null}
      />
    )

    expect(screen.getByText('Test Space')).toHaveClass('font-serif-display')
  })

  it('should render new page button', () => {
    render(
      <KnowledgeTreeSidebar
        space={mockSpace as any}
        pages={mockPages as any}
        workspaceSlug="test"
        currentPageId={null}
      />
    )

    expect(screen.getByText('New Page')).toBeInTheDocument()
  })

  it('should not display draft/published status', () => {
    render(
      <KnowledgeTreeSidebar
        space={mockSpace as any}
        pages={mockPages as any}
        workspaceSlug="test"
        currentPageId={null}
      />
    )

    expect(screen.queryByText('published')).not.toBeInTheDocument()
    expect(screen.queryByText('draft')).not.toBeInTheDocument()
  })
})
```

### Step 2: Run test to verify it fails

Run: `bun run test KnowledgeTreeSidebar.test.tsx`
Expected: FAIL with "Cannot find module './KnowledgeTreeSidebar'"

### Step 3: Write minimal implementation

Create `src/components/features/knowledge/KnowledgeTreeSidebar.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { PageTreeNode } from './PageTreeNode'
import { buildPageTree } from '@/lib/knowledge/tree-builder'
import type { KnowledgePage, KnowledgeSpace } from '@/payload-types'

interface KnowledgeTreeSidebarProps {
  space: KnowledgeSpace
  pages: KnowledgePage[]
  workspaceSlug: string
  currentPageId?: string | null
}

export function KnowledgeTreeSidebar({
  space,
  pages,
  workspaceSlug,
  currentPageId,
}: KnowledgeTreeSidebarProps) {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const tree = buildPageTree(pages)

  return (
    <aside className="w-64 border-r border-border bg-background flex flex-col">
      {/* Header with space info */}
      <div className="p-4 border-b border-border/40">
        <div className="flex items-center gap-2 mb-2">
          {space.icon && <span className="text-2xl">{space.icon}</span>}
          <h2 className="font-serif-display font-semibold text-lg">
            {space.name}
          </h2>
        </div>
        {space.description && (
          <p className="text-xs text-muted-foreground">
            {space.description}
          </p>
        )}
      </div>

      {/* Tree navigation */}
      <nav className="flex-1 overflow-y-auto p-2">
        {tree.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-4 text-center">
            <p className="text-sm text-muted-foreground mb-4">
              No pages yet. Create your first page to get started.
            </p>
            <Button size="sm" onClick={() => setIsCreateModalOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Page
            </Button>
          </div>
        ) : (
          <div className="space-y-1">
            {tree.map(node => (
              <PageTreeNode
                key={node.id}
                node={node}
                currentPageId={currentPageId}
                depth={0}
                workspaceSlug={workspaceSlug}
                spaceSlug={space.slug}
              />
            ))}
          </div>
        )}
      </nav>

      {/* Bottom actions */}
      <div className="p-2 border-t border-border/40">
        <Button
          variant="ghost"
          className="w-full justify-start"
          onClick={() => setIsCreateModalOpen(true)}
        >
          <Plus className="h-4 w-4 mr-2" />
          New Page
        </Button>
      </div>
    </aside>
  )
}
```

### Step 4: Run test to verify it passes

Run: `bun run test KnowledgeTreeSidebar.test.tsx`
Expected: PASS

### Step 5: Commit

```bash
git add src/components/features/knowledge/KnowledgeTreeSidebar.tsx
git add src/components/features/knowledge/KnowledgeTreeSidebar.test.tsx
git commit -m "feat: create KnowledgeTreeSidebar component

- Clean, borderless design (no Card wrapper)
- Editorial typography for space name
- Remove draft/published status displays
- Empty state with create prompt
- Fixed 256px width

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Create KnowledgeBreadcrumbs Component

**Goal:** Build the slim breadcrumb header matching the page editor design.

**Files:**
- Create: `src/components/features/knowledge/KnowledgeBreadcrumbs.tsx`
- Create: `src/components/features/knowledge/KnowledgeBreadcrumbs.test.tsx`

### Step 1: Write the failing test

Create `src/components/features/knowledge/KnowledgeBreadcrumbs.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { KnowledgeBreadcrumbs } from './KnowledgeBreadcrumbs'

describe('KnowledgeBreadcrumbs', () => {
  const mockWorkspace = {
    id: '1',
    slug: 'test-workspace',
    name: 'Test Workspace',
  }

  const mockSpace = {
    id: '2',
    slug: 'test-space',
    name: 'Test Space',
  }

  it('should render breadcrumb trail', () => {
    render(
      <KnowledgeBreadcrumbs
        workspace={mockWorkspace as any}
        space={mockSpace as any}
      />
    )

    expect(screen.getByText('Knowledge Base')).toBeInTheDocument()
    expect(screen.getByText('Test Space')).toBeInTheDocument()
  })

  it('should have 40px height', () => {
    const { container } = render(
      <KnowledgeBreadcrumbs
        workspace={mockWorkspace as any}
        space={mockSpace as any}
      />
    )

    const header = container.firstChild as HTMLElement
    expect(header).toHaveClass('h-10')
  })

  it('should display current page when provided', () => {
    const mockPage = {
      id: '3',
      title: 'Current Page',
      slug: 'current-page',
    }

    render(
      <KnowledgeBreadcrumbs
        workspace={mockWorkspace as any}
        space={mockSpace as any}
        currentPage={mockPage as any}
      />
    )

    expect(screen.getByText('Current Page')).toBeInTheDocument()
  })
})
```

### Step 2: Run test to verify it fails

Run: `bun run test KnowledgeBreadcrumbs.test.tsx`
Expected: FAIL with "Cannot find module './KnowledgeBreadcrumbs'"

### Step 3: Write minimal implementation

Create `src/components/features/knowledge/KnowledgeBreadcrumbs.tsx`:

```typescript
import Link from 'next/link'
import type { Workspace, KnowledgeSpace, KnowledgePage } from '@/payload-types'

interface KnowledgeBreadcrumbsProps {
  workspace: Workspace
  space: KnowledgeSpace
  currentPage?: KnowledgePage | null
}

export function KnowledgeBreadcrumbs({
  workspace,
  space,
  currentPage,
}: KnowledgeBreadcrumbsProps) {
  return (
    <div className="sticky top-0 z-10 flex h-10 items-center border-b border-border bg-background px-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link
          href={`/workspaces/${workspace.slug}/knowledge`}
          className="hover:text-foreground transition-colors"
        >
          Knowledge Base
        </Link>
        <span>/</span>
        <Link
          href={`/workspaces/${workspace.slug}/knowledge/${space.slug}`}
          className="hover:text-foreground transition-colors"
        >
          {space.name}
        </Link>
        {currentPage && (
          <>
            <span>/</span>
            <span className="text-foreground">{currentPage.title}</span>
          </>
        )}
      </div>
    </div>
  )
}
```

### Step 4: Run test to verify it passes

Run: `bun run test KnowledgeBreadcrumbs.test.tsx`
Expected: PASS

### Step 5: Commit

```bash
git add src/components/features/knowledge/KnowledgeBreadcrumbs.tsx
git add src/components/features/knowledge/KnowledgeBreadcrumbs.test.tsx
git commit -m "feat: create KnowledgeBreadcrumbs component

- 40px height matching page editor
- Sticky positioning
- Shows: Knowledge Base > Space Name > Page Title
- Minimal, clean styling

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Integrate Sidebar and Breadcrumbs into Layout

**Goal:** Connect the new components to the nested layout.

**Files:**
- Modify: `src/app/(frontend)/workspaces/[slug]/knowledge/[spaceSlug]/layout.tsx`

### Step 1: Update layout to use real components

Replace placeholders in `layout.tsx`:

```typescript
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { KnowledgeTreeSidebar } from '@/components/features/knowledge/KnowledgeTreeSidebar'
import { KnowledgeBreadcrumbs } from '@/components/features/knowledge/KnowledgeBreadcrumbs'

interface LayoutProps {
  children: React.ReactNode
  params: Promise<{
    slug: string
    spaceSlug: string
  }>
}

export default async function KnowledgeSpaceLayout({ children, params }: LayoutProps) {
  const { slug, spaceSlug } = await params
  const payload = await getPayload({ config })

  // Fetch workspace
  const workspaceResult = await payload.find({
    collection: 'workspaces',
    where: { slug: { equals: slug } },
    limit: 1,
  })

  if (!workspaceResult.docs.length) {
    notFound()
  }

  const workspace = workspaceResult.docs[0]

  // Fetch knowledge space
  const spaceResult = await payload.find({
    collection: 'knowledge-spaces',
    where: {
      slug: { equals: spaceSlug },
      workspace: { equals: workspace.id },
    },
    limit: 1,
  })

  if (!spaceResult.docs.length) {
    notFound()
  }

  const space = spaceResult.docs[0]

  // Fetch pages for this space
  const pagesResult = await payload.find({
    collection: 'knowledge-pages',
    where: { knowledgeSpace: { equals: space.id } },
    limit: 1000,
    sort: 'sortOrder',
  })

  const pages = pagesResult.docs

  return (
    <SidebarProvider defaultOpen={false}>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />

        <div className="flex h-[calc(100vh-64px)]">
          <KnowledgeTreeSidebar
            space={space}
            pages={pages}
            workspaceSlug={workspace.slug}
          />

          <div className="flex-1 flex flex-col">
            <KnowledgeBreadcrumbs workspace={workspace} space={space} />

            <div className="flex-1 overflow-y-auto">
              {children}
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
```

### Step 2: Run layout test

Run: `bun run test layout.test.tsx`
Expected: PASS (or update test if needed)

### Step 3: Commit

```bash
git add src/app/\(frontend\)/workspaces/\[slug\]/knowledge/\[spaceSlug\]/layout.tsx
git commit -m "feat: integrate sidebar and breadcrumbs into layout

- Replace placeholders with real components
- Connect KnowledgeTreeSidebar with space and pages data
- Add KnowledgeBreadcrumbs for navigation

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: Add Space Landing Page Redirect

**Goal:** Auto-redirect to first page when entering knowledge space.

**Files:**
- Modify: `src/app/(frontend)/workspaces/[slug]/knowledge/[spaceSlug]/page.tsx`

### Step 1: Write the failing test

Create `src/app/(frontend)/workspaces/[slug]/knowledge/[spaceSlug]/page.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { redirect } from 'next/navigation'

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  notFound: vi.fn(),
}))

vi.mock('payload', () => ({
  getPayload: vi.fn(),
}))

describe('KnowledgeSpacePage', () => {
  it('should redirect to first page when pages exist', async () => {
    const { getPayload } = await import('payload')
    const mockGetPayload = getPayload as any

    mockGetPayload.mockResolvedValue({
      find: vi.fn()
        .mockResolvedValueOnce({ docs: [{ id: '1', slug: 'test' }] })
        .mockResolvedValueOnce({ docs: [{ id: '2', slug: 'space' }] })
        .mockResolvedValueOnce({
          docs: [{ id: '3', slug: 'first-page', title: 'First' }]
        }),
    })

    const KnowledgeSpacePage = (await import('./page')).default

    await KnowledgeSpacePage({
      params: Promise.resolve({ slug: 'test', spaceSlug: 'space' }),
    })

    expect(redirect).toHaveBeenCalledWith('/workspaces/test/knowledge/space/first-page')
  })
})
```

### Step 2: Run test to verify it fails

Run: `bun run test src/app/\(frontend\)/workspaces/\[slug\]/knowledge/\[spaceSlug\]/page.test.tsx`
Expected: FAIL

### Step 3: Update implementation

Modify `src/app/(frontend)/workspaces/[slug]/knowledge/[spaceSlug]/page.tsx`:

```typescript
import { notFound, redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'

interface PageProps {
  params: Promise<{
    slug: string
    spaceSlug: string
  }>
}

export default async function KnowledgeSpacePage({ params }: PageProps) {
  const { slug, spaceSlug } = await params
  const payload = await getPayload({ config })

  // Fetch workspace
  const workspaceResult = await payload.find({
    collection: 'workspaces',
    where: { slug: { equals: slug } },
    limit: 1,
  })

  if (!workspaceResult.docs.length) {
    notFound()
  }

  const workspace = workspaceResult.docs[0]

  // Fetch knowledge space
  const spaceResult = await payload.find({
    collection: 'knowledge-spaces',
    where: {
      slug: { equals: spaceSlug },
      workspace: { equals: workspace.id },
    },
    limit: 1,
  })

  if (!spaceResult.docs.length) {
    notFound()
  }

  const space = spaceResult.docs[0]

  // Fetch pages for this space
  const pagesResult = await payload.find({
    collection: 'knowledge-pages',
    where: { knowledgeSpace: { equals: space.id } },
    limit: 1,
    sort: 'sortOrder',
  })

  // Redirect to first page if pages exist
  if (pagesResult.docs.length > 0) {
    const firstPage = pagesResult.docs[0]
    redirect(`/workspaces/${slug}/knowledge/${spaceSlug}/${firstPage.slug}`)
  }

  // Empty state if no pages
  return (
    <div className="flex flex-col items-center justify-center h-full p-8">
      <h2 className="text-2xl font-serif-display font-semibold mb-4">
        No pages yet
      </h2>
      <p className="text-muted-foreground text-center max-w-md">
        Create your first page to get started with {space.name}.
      </p>
    </div>
  )
}
```

### Step 4: Run test to verify it passes

Run: `bun run test src/app/\(frontend\)/workspaces/\[slug\]/knowledge/\[spaceSlug\]/page.test.tsx`
Expected: PASS

### Step 5: Commit

```bash
git add src/app/\(frontend\)/workspaces/\[slug\]/knowledge/\[spaceSlug\]/page.tsx
git add src/app/\(frontend\)/workspaces/\[slug\]/knowledge/\[spaceSlug\]/page.test.tsx
git commit -m "feat: auto-redirect to first page in knowledge space

- Redirect to first page when pages exist
- Show empty state when no pages
- Matches Notion-style navigation behavior

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: Add Server Actions for Page Management

**Goal:** Create server actions for rename, move, duplicate, and delete operations.

**Files:**
- Create: `src/app/actions/knowledge.ts` (or modify if exists)
- Create: `src/app/actions/knowledge.test.ts`

### Step 1: Write the failing tests

Create `src/app/actions/knowledge.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renamePage, movePage, duplicatePage, deletePage } from './knowledge'

vi.mock('payload', () => ({
  getPayload: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

describe('Knowledge Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('renamePage', () => {
    it('should update page title and slug', async () => {
      const { getPayload } = await import('payload')
      const mockPayload = {
        update: vi.fn().mockResolvedValue({ id: '1' }),
      }
      ;(getPayload as any).mockResolvedValue(mockPayload)

      await renamePage('1', 'New Title', 'test', 'space')

      expect(mockPayload.update).toHaveBeenCalledWith({
        collection: 'knowledge-pages',
        id: '1',
        data: {
          title: 'New Title',
        },
      })
    })
  })

  describe('movePage', () => {
    it('should update parent page relationship', async () => {
      const { getPayload } = await import('payload')
      const mockPayload = {
        update: vi.fn().mockResolvedValue({ id: '1' }),
      }
      ;(getPayload as any).mockResolvedValue(mockPayload)

      await movePage('1', '2', 'test', 'space')

      expect(mockPayload.update).toHaveBeenCalledWith({
        collection: 'knowledge-pages',
        id: '1',
        data: {
          parentPage: '2',
        },
      })
    })
  })
})
```

### Step 2: Run test to verify it fails

Run: `bun run test knowledge.test.ts`
Expected: FAIL with "Cannot find module './knowledge'"

### Step 3: Write minimal implementation

Update or create `src/app/actions/knowledge.ts`:

```typescript
'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { revalidatePath } from 'next/cache'

export async function renamePage(
  pageId: string,
  newTitle: string,
  workspaceSlug: string,
  spaceSlug: string
) {
  const payload = await getPayload({ config })

  await payload.update({
    collection: 'knowledge-pages',
    id: pageId,
    data: {
      title: newTitle,
    },
  })

  revalidatePath(`/workspaces/${workspaceSlug}/knowledge/${spaceSlug}`)
}

export async function movePage(
  pageId: string,
  newParentId: string | null,
  workspaceSlug: string,
  spaceSlug: string
) {
  const payload = await getPayload({ config })

  await payload.update({
    collection: 'knowledge-pages',
    id: pageId,
    data: {
      parentPage: newParentId,
    },
  })

  revalidatePath(`/workspaces/${workspaceSlug}/knowledge/${spaceSlug}`)
}

export async function duplicatePage(
  pageId: string,
  workspaceSlug: string,
  spaceSlug: string
) {
  const payload = await getPayload({ config })

  // Get original page
  const original = await payload.findByID({
    collection: 'knowledge-pages',
    id: pageId,
  })

  // Create duplicate
  const duplicate = await payload.create({
    collection: 'knowledge-pages',
    data: {
      title: `${original.title} (Copy)`,
      content: original.content,
      knowledgeSpace: original.knowledgeSpace,
      parentPage: original.parentPage,
      author: original.author,
      status: 'draft',
    },
  })

  revalidatePath(`/workspaces/${workspaceSlug}/knowledge/${spaceSlug}`)
  return duplicate
}

export async function deletePage(
  pageId: string,
  workspaceSlug: string,
  spaceSlug: string
) {
  const payload = await getPayload({ config })

  await payload.delete({
    collection: 'knowledge-pages',
    id: pageId,
  })

  revalidatePath(`/workspaces/${workspaceSlug}/knowledge/${spaceSlug}`)
}
```

### Step 4: Run test to verify it passes

Run: `bun run test knowledge.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add src/app/actions/knowledge.ts
git add src/app/actions/knowledge.test.ts
git commit -m "feat: add server actions for page management

- renamePage: Update page title
- movePage: Change parent page relationship
- duplicatePage: Create copy with '(Copy)' suffix
- deletePage: Remove page from system

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: Create Context Menu Component

**Goal:** Build the right-click context menu for page management.

**Files:**
- Create: `src/components/features/knowledge/PageContextMenu.tsx`
- Create: `src/components/features/knowledge/PageContextMenu.test.tsx`

### Step 1: Write the failing test

Create `src/components/features/knowledge/PageContextMenu.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { PageContextMenu } from './PageContextMenu'

describe('PageContextMenu', () => {
  const mockPage = {
    id: '1',
    title: 'Test Page',
    slug: 'test-page',
  }

  it('should render context menu trigger', () => {
    render(
      <PageContextMenu page={mockPage as any}>
        <div>Page Item</div>
      </PageContextMenu>
    )

    expect(screen.getByText('Page Item')).toBeInTheDocument()
  })

  it('should show menu items on right-click', () => {
    render(
      <PageContextMenu page={mockPage as any}>
        <div>Page Item</div>
      </PageContextMenu>
    )

    const trigger = screen.getByText('Page Item')
    fireEvent.contextMenu(trigger)

    expect(screen.getByText('Rename')).toBeInTheDocument()
    expect(screen.getByText('Move to...')).toBeInTheDocument()
    expect(screen.getByText('Add sub-page')).toBeInTheDocument()
    expect(screen.getByText('Duplicate')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })
})
```

### Step 2: Run test to verify it fails

Run: `bun run test PageContextMenu.test.tsx`
Expected: FAIL

### Step 3: Write minimal implementation

Create `src/components/features/knowledge/PageContextMenu.tsx`:

```typescript
'use client'

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Edit, FolderTree, FilePlus, Copy, Trash } from 'lucide-react'
import type { KnowledgePage } from '@/payload-types'

interface PageContextMenuProps {
  page: KnowledgePage
  children: React.ReactNode
  onRename?: (pageId: string) => void
  onMove?: (pageId: string) => void
  onAddSubPage?: (pageId: string) => void
  onDuplicate?: (pageId: string) => void
  onDelete?: (pageId: string) => void
}

export function PageContextMenu({
  page,
  children,
  onRename,
  onMove,
  onAddSubPage,
  onDuplicate,
  onDelete,
}: PageContextMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>

      <ContextMenuContent className="w-56">
        <ContextMenuItem onClick={() => onRename?.(page.id)}>
          <Edit className="h-4 w-4 mr-2" />
          Rename
        </ContextMenuItem>

        <ContextMenuItem onClick={() => onMove?.(page.id)}>
          <FolderTree className="h-4 w-4 mr-2" />
          Move to...
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem onClick={() => onAddSubPage?.(page.id)}>
          <FilePlus className="h-4 w-4 mr-2" />
          Add sub-page
        </ContextMenuItem>

        <ContextMenuItem onClick={() => onDuplicate?.(page.id)}>
          <Copy className="h-4 w-4 mr-2" />
          Duplicate
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem
          onClick={() => onDelete?.(page.id)}
          className="text-destructive focus:text-destructive"
        >
          <Trash className="h-4 w-4 mr-2" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
```

### Step 4: Run test to verify it passes

Run: `bun run test PageContextMenu.test.tsx`
Expected: PASS

### Step 5: Commit

```bash
git add src/components/features/knowledge/PageContextMenu.tsx
git add src/components/features/knowledge/PageContextMenu.test.tsx
git commit -m "feat: create PageContextMenu component

- Right-click menu for page management
- Actions: rename, move, add sub-page, duplicate, delete
- Clean Radix UI styling
- Callback props for action handling

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: Integrate Context Menu with PageTreeNode

**Goal:** Wrap PageTreeNode with context menu functionality.

**Files:**
- Modify: `src/components/features/knowledge/PageTreeNode.tsx`

### Step 1: Add context menu wrapper

Update `PageTreeNode.tsx` to wrap with `PageContextMenu`:

```typescript
// Import at top
import { PageContextMenu } from './PageContextMenu'

// In the component return, wrap the node content:
<PageContextMenu
  page={node as any}
  onRename={handleRename}
  onMove={handleMove}
  onAddSubPage={handleAddSubPage}
  onDuplicate={handleDuplicate}
  onDelete={handleDelete}
>
  {/* Existing node content */}
  <div className={/* existing classes */}>
    {/* existing content */}
  </div>
</PageContextMenu>

// Add handler functions (placeholders for now):
const handleRename = (pageId: string) => {
  console.log('Rename:', pageId)
}

const handleMove = (pageId: string) => {
  console.log('Move:', pageId)
}

const handleAddSubPage = (pageId: string) => {
  console.log('Add sub-page:', pageId)
}

const handleDuplicate = async (pageId: string) => {
  console.log('Duplicate:', pageId)
}

const handleDelete = (pageId: string) => {
  console.log('Delete:', pageId)
}
```

### Step 2: Test context menu integration

Run: `bun run test PageTreeNode`
Expected: PASS (or update tests if needed)

### Step 3: Commit

```bash
git add src/components/features/knowledge/PageTreeNode.tsx
git commit -m "feat: integrate context menu with PageTreeNode

- Wrap page nodes with PageContextMenu
- Add placeholder handlers for actions
- Enable right-click management

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9: Implement Inline Rename Functionality

**Goal:** Add inline editing for page titles via context menu rename action.

**Files:**
- Modify: `src/components/features/knowledge/PageTreeNode.tsx`
- Modify: `src/components/features/knowledge/KnowledgeTreeSidebar.tsx`

### Step 1: Add rename state management

Update `PageTreeNode.tsx`:

```typescript
'use client'

import { useState, useRef, useEffect } from 'react'
import { renamePage } from '@/app/actions/knowledge'

// Add state for inline editing
const [isRenaming, setIsRenaming] = useState(false)
const [newTitle, setNewTitle] = useState(node.title)
const inputRef = useRef<HTMLInputElement>(null)

// Update handleRename
const handleRename = (pageId: string) => {
  setIsRenaming(true)
  setNewTitle(node.title)
}

// Handle rename save
const saveRename = async () => {
  if (newTitle.trim() && newTitle !== node.title) {
    await renamePage(node.id, newTitle, workspaceSlug, spaceSlug as string)
  }
  setIsRenaming(false)
}

// Focus input when renaming
useEffect(() => {
  if (isRenaming && inputRef.current) {
    inputRef.current.focus()
    inputRef.current.select()
  }
}, [isRenaming])

// In render, conditionally show input or text:
{isRenaming ? (
  <input
    ref={inputRef}
    type="text"
    value={newTitle}
    onChange={(e) => setNewTitle(e.target.value)}
    onBlur={saveRename}
    onKeyDown={(e) => {
      if (e.key === 'Enter') saveRename()
      if (e.key === 'Escape') setIsRenaming(false)
    }}
    className="px-2 py-1 text-sm bg-background border border-border rounded"
    onClick={(e) => e.stopPropagation()}
  />
) : (
  <span className="truncate">{node.title}</span>
)}
```

### Step 2: Test inline rename

Manual test: Right-click page → Rename → Edit title → Press Enter
Expected: Title updates, tree refreshes

### Step 3: Commit

```bash
git add src/components/features/knowledge/PageTreeNode.tsx
git commit -m "feat: implement inline rename functionality

- Switch to input field when rename triggered
- Save on blur or Enter key
- Cancel on Escape key
- Auto-focus and select text for editing

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 10: Create Move Page Modal

**Goal:** Build modal for selecting new parent page.

**Files:**
- Create: `src/components/features/knowledge/MovePageModal.tsx`
- Create: `src/components/features/knowledge/MovePageModal.test.tsx`

### Step 1: Write the failing test

Create `src/components/features/knowledge/MovePageModal.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MovePageModal } from './MovePageModal'

describe('MovePageModal', () => {
  const mockPages = [
    { id: '1', title: 'Page 1', slug: 'page-1', parentPage: null },
    { id: '2', title: 'Page 2', slug: 'page-2', parentPage: null },
  ]

  it('should render modal when open', () => {
    render(
      <MovePageModal
        open={true}
        onOpenChange={vi.fn()}
        currentPage={mockPages[0] as any}
        pages={mockPages as any}
        onMove={vi.fn()}
      />
    )

    expect(screen.getByText('Move Page')).toBeInTheDocument()
  })

  it('should exclude current page and descendants from selection', () => {
    render(
      <MovePageModal
        open={true}
        onOpenChange={vi.fn()}
        currentPage={mockPages[0] as any}
        pages={mockPages as any}
        onMove={vi.fn()}
      />
    )

    // Should not show current page as option
    expect(screen.queryByText('Page 1')).not.toBeInTheDocument()
    // Should show other pages
    expect(screen.getByText('Page 2')).toBeInTheDocument()
  })
})
```

### Step 2: Run test to verify it fails

Run: `bun run test MovePageModal.test.tsx`
Expected: FAIL

### Step 3: Write minimal implementation

Create `src/components/features/knowledge/MovePageModal.tsx`:

```typescript
'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { KnowledgePage } from '@/payload-types'

interface MovePageModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentPage: KnowledgePage
  pages: KnowledgePage[]
  onMove: (pageId: string, newParentId: string | null) => Promise<void>
}

export function MovePageModal({
  open,
  onOpenChange,
  currentPage,
  pages,
  onMove,
}: MovePageModalProps) {
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null)
  const [isMoving, setIsMoving] = useState(false)

  // Exclude current page and its descendants
  const availablePages = pages.filter((p) => {
    if (p.id === currentPage.id) return false
    // TODO: Add logic to exclude descendants
    return true
  })

  const handleMove = async () => {
    setIsMoving(true)
    try {
      await onMove(currentPage.id, selectedParentId)
      onOpenChange(false)
    } finally {
      setIsMoving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move Page</DialogTitle>
        </DialogHeader>

        <div className="py-4">
          <p className="text-sm text-muted-foreground mb-4">
            Select a new parent page for "{currentPage.title}"
          </p>

          <ScrollArea className="h-64 border rounded-md">
            <div className="p-2">
              <button
                onClick={() => setSelectedParentId(null)}
                className={`w-full text-left px-3 py-2 rounded hover:bg-accent ${
                  selectedParentId === null ? 'bg-accent' : ''
                }`}
              >
                Root (No parent)
              </button>

              {availablePages.map((page) => (
                <button
                  key={page.id}
                  onClick={() => setSelectedParentId(page.id)}
                  className={`w-full text-left px-3 py-2 rounded hover:bg-accent ${
                    selectedParentId === page.id ? 'bg-accent' : ''
                  }`}
                >
                  {page.title}
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleMove} disabled={isMoving}>
            {isMoving ? 'Moving...' : 'Move Page'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

### Step 4: Run test to verify it passes

Run: `bun run test MovePageModal.test.tsx`
Expected: PASS

### Step 5: Commit

```bash
git add src/components/features/knowledge/MovePageModal.tsx
git add src/components/features/knowledge/MovePageModal.test.tsx
git commit -m "feat: create MovePageModal component

- Modal for selecting new parent page
- Exclude current page from selection
- Support root (no parent) option
- Handle move operation with loading state

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 11: Create Delete Confirmation Dialog

**Goal:** Add confirmation dialog for page deletion.

**Files:**
- Create: `src/components/features/knowledge/DeletePageDialog.tsx`
- Create: `src/components/features/knowledge/DeletePageDialog.test.tsx`

### Step 1: Write the failing test

Create `src/components/features/knowledge/DeletePageDialog.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { DeletePageDialog } from './DeletePageDialog'

describe('DeletePageDialog', () => {
  const mockPage = {
    id: '1',
    title: 'Test Page',
    childPages: [],
  }

  it('should render confirmation dialog', () => {
    render(
      <DeletePageDialog
        open={true}
        onOpenChange={vi.fn()}
        page={mockPage as any}
        onDelete={vi.fn()}
      />
    )

    expect(screen.getByText('Delete Page')).toBeInTheDocument()
    expect(screen.getByText(/Are you sure/)).toBeInTheDocument()
  })

  it('should warn when page has children', () => {
    const pageWithChildren = {
      ...mockPage,
      childPages: [{ id: '2', title: 'Child' }],
    }

    render(
      <DeletePageDialog
        open={true}
        onOpenChange={vi.fn()}
        page={pageWithChildren as any}
        onDelete={vi.fn()}
      />
    )

    expect(screen.getByText(/has child pages/)).toBeInTheDocument()
  })
})
```

### Step 2: Run test to verify it fails

Run: `bun run test DeletePageDialog.test.tsx`
Expected: FAIL

### Step 3: Write minimal implementation

Create `src/components/features/knowledge/DeletePageDialog.tsx`:

```typescript
'use client'

import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { KnowledgePage } from '@/payload-types'

interface DeletePageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  page: KnowledgePage
  onDelete: (pageId: string) => Promise<void>
}

export function DeletePageDialog({
  open,
  onOpenChange,
  page,
  onDelete,
}: DeletePageDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false)
  const hasChildren = page.childPages && page.childPages.length > 0

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      await onDelete(page.id)
      onOpenChange(false)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Page</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete "{page.title}"?
            {hasChildren && (
              <span className="block mt-2 text-destructive font-semibold">
                Warning: This page has child pages that will also be deleted.
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={isDeleting}
            className="bg-destructive hover:bg-destructive/90"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

### Step 4: Run test to verify it passes

Run: `bun run test DeletePageDialog.test.tsx`
Expected: PASS

### Step 5: Commit

```bash
git add src/components/features/knowledge/DeletePageDialog.tsx
git add src/components/features/knowledge/DeletePageDialog.test.tsx
git commit -m "feat: create DeletePageDialog component

- Confirmation dialog for page deletion
- Warning when page has children
- Loading state during deletion
- Destructive action styling

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 12: Wire Up All Context Menu Actions

**Goal:** Connect context menu handlers to server actions and modals.

**Files:**
- Modify: `src/components/features/knowledge/KnowledgeTreeSidebar.tsx`
- Modify: `src/components/features/knowledge/PageTreeNode.tsx`

### Step 1: Add modal state and handlers to KnowledgeTreeSidebar

Update `KnowledgeTreeSidebar.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { MovePageModal } from './MovePageModal'
import { DeletePageDialog } from './DeletePageDialog'
import { movePage, duplicatePage, deletePage } from '@/app/actions/knowledge'

export function KnowledgeTreeSidebar({
  space,
  pages,
  workspaceSlug,
  currentPageId,
}: KnowledgeTreeSidebarProps) {
  const router = useRouter()
  const [movePageId, setMovePageId] = useState<string | null>(null)
  const [deletePageId, setDeletePageId] = useState<string | null>(null)

  const handleMove = async (pageId: string, newParentId: string | null) => {
    await movePage(pageId, newParentId, workspaceSlug, space.slug as string)
    router.refresh()
  }

  const handleDuplicate = async (pageId: string) => {
    const duplicate = await duplicatePage(pageId, workspaceSlug, space.slug as string)
    router.push(`/workspaces/${workspaceSlug}/knowledge/${space.slug}/${duplicate.slug}`)
  }

  const handleDelete = async (pageId: string) => {
    await deletePage(pageId, workspaceSlug, space.slug as string)
    router.push(`/workspaces/${workspaceSlug}/knowledge/${space.slug}`)
  }

  const movePageData = pages.find(p => p.id === movePageId)
  const deletePageData = pages.find(p => p.id === deletePageId)

  return (
    <>
      <aside className="w-64 border-r border-border bg-background flex flex-col">
        {/* existing sidebar content */}
        {/* Pass handlers to PageTreeNode via context */}
      </aside>

      {movePageData && (
        <MovePageModal
          open={!!movePageId}
          onOpenChange={() => setMovePageId(null)}
          currentPage={movePageData}
          pages={pages}
          onMove={handleMove}
        />
      )}

      {deletePageData && (
        <DeletePageDialog
          open={!!deletePageId}
          onOpenChange={() => setDeletePageId(null)}
          page={deletePageData}
          onDelete={handleDelete}
        />
      )}
    </>
  )
}
```

### Step 2: Connect handlers in PageTreeNode

Update `PageTreeNode.tsx` to receive and use handlers from parent:

```typescript
const handleMove = (pageId: string) => {
  // Call parent's setMovePageId
  onMoveClick?.(pageId)
}

const handleDuplicate = async (pageId: string) => {
  // Call parent's handleDuplicate
  await onDuplicateClick?.(pageId)
}

const handleDelete = (pageId: string) => {
  // Call parent's setDeletePageId
  onDeleteClick?.(pageId)
}
```

### Step 3: Test full flow

Manual test:
1. Right-click page → Move to... → Select parent → Confirm
2. Right-click page → Duplicate → New page created
3. Right-click page → Delete → Confirm → Page removed

Expected: All operations work correctly

### Step 4: Commit

```bash
git add src/components/features/knowledge/KnowledgeTreeSidebar.tsx
git add src/components/features/knowledge/PageTreeNode.tsx
git commit -m "feat: wire up all context menu actions

- Connect move, duplicate, delete handlers
- Integrate modals with tree sidebar
- Refresh router after operations
- Complete page management flow

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 13: Update Page View to Use Current Page in Breadcrumbs

**Goal:** Pass current page data to breadcrumbs in the layout.

**Files:**
- Modify: `src/app/(frontend)/workspaces/[slug]/knowledge/[spaceSlug]/[pageSlug]/page.tsx`

### Step 1: Update page component to include breadcrumb data

Modify `[pageSlug]/page.tsx` to ensure the layout receives current page info:

Since the layout needs access to the current page for breadcrumbs, we can use a client component wrapper or update the layout to detect from URL. For simplicity, let's use URL-based detection in the layout:

Modify `layout.tsx`:

```typescript
// Add at top
import { headers } from 'next/headers'

// In component
const headersList = await headers()
const pathname = headersList.get('x-pathname') || ''
const pageSlug = pathname.split('/').pop()

// Fetch current page if pageSlug exists
let currentPage = null
if (pageSlug && pageSlug !== spaceSlug) {
  const currentPageResult = await payload.find({
    collection: 'knowledge-pages',
    where: {
      slug: { equals: pageSlug },
      knowledgeSpace: { equals: space.id },
    },
    limit: 1,
  })
  currentPage = currentPageResult.docs[0] || null
}

// Pass to breadcrumbs
<KnowledgeBreadcrumbs
  workspace={workspace}
  space={space}
  currentPage={currentPage}
/>
```

Alternative: Use middleware to add pathname to headers, or use client-side detection.

### Step 2: Test breadcrumbs show current page

Manual test: Navigate to a page, verify breadcrumbs show: Knowledge Base > Space > Page Title

### Step 3: Commit

```bash
git add src/app/\(frontend\)/workspaces/\[slug\]/knowledge/\[spaceSlug\]/layout.tsx
git commit -m "feat: add current page to breadcrumbs

- Detect current page from URL in layout
- Pass to KnowledgeBreadcrumbs component
- Show full navigation path

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 14: Remove Draft/Published Status from All Components

**Goal:** Ensure no draft/published status is displayed anywhere.

**Files:**
- Verify: `src/components/features/knowledge/SpaceNavigator.tsx`
- Verify: `src/components/features/knowledge/PageTreeNode.tsx`
- Verify: `src/app/(frontend)/workspaces/[slug]/knowledge/[spaceSlug]/page.tsx` (old)

### Step 1: Audit components for status displays

Search for status badges:

```bash
grep -r "status === 'published'" src/components/features/knowledge/
grep -r "status === 'draft'" src/components/features/knowledge/
grep -r "Draft" src/components/features/knowledge/
```

### Step 2: Remove any remaining status displays

Update any components still showing status to remove those sections.

### Step 3: Commit

```bash
git commit -am "refactor: remove all draft/published status displays

- No status badges in tree navigation
- No status counts in sidebar
- Clean, status-free UI as designed

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 15: Final Integration Testing

**Goal:** Verify the complete knowledge space navigation experience.

### Step 1: Run all tests

```bash
bun run test
```

Expected: All new tests passing

### Step 2: Manual testing checklist

Test the following scenarios:

1. **Navigation**
   - [ ] Enter knowledge space → auto-redirects to first page
   - [ ] App sidebar is minimized
   - [ ] Left tree sidebar is visible and persistent
   - [ ] Breadcrumbs show correct path
   - [ ] Click different pages → content updates, sidebar persists

2. **Context Menu Actions**
   - [ ] Right-click page → menu appears
   - [ ] Rename: Edit inline, save on Enter/blur, cancel on Escape
   - [ ] Move to...: Modal opens, select parent, page moves
   - [ ] Add sub-page: Creates child under selected page
   - [ ] Duplicate: Creates copy with "(Copy)" suffix
   - [ ] Delete: Shows confirmation, warns if has children, deletes

3. **Drag and Drop**
   - [ ] Existing drag-drop still works
   - [ ] Pages can be reordered within level

4. **Design**
   - [ ] No draft/published status anywhere
   - [ ] Editorial typography applied correctly
   - [ ] Clean, minimal borders
   - [ ] No Card wrappers
   - [ ] Responsive on mobile (sidebar collapses)

### Step 3: Document any issues

Create issues for any bugs found during testing.

### Step 4: Commit

```bash
git commit --allow-empty -m "test: complete integration testing

All manual test scenarios passed:
- Navigation and auto-redirect
- Context menu actions
- Drag-and-drop preservation
- Editorial design principles
- Responsive behavior

Ready for code review.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Success Criteria Checklist

Before marking this plan as complete, verify:

- [ ] App sidebar auto-minimizes (`defaultOpen={false}`)
- [ ] Persistent tree navigation across pages (nested layout)
- [ ] Context menu with all actions (rename, move, duplicate, delete)
- [ ] No draft/published status visible
- [ ] Clean editorial aesthetic throughout
- [ ] Auto-redirect to first page
- [ ] Existing drag-drop preserved
- [ ] All tests passing
- [ ] Responsive design works
- [ ] Keyboard accessibility maintained

---

## References

**Design Document:** `docs/plans/2025-11-23-knowledge-space-management-redesign.md`

**Related Work:** Editorial Page Editor Redesign (completed)

**Skills Used:**
- @superpowers:test-driven-development - TDD workflow throughout
- @superpowers:verification-before-completion - Verify tests before claiming done
- @superpowers:code-reviewer - Review after each task

---

Plan complete and ready for execution!
