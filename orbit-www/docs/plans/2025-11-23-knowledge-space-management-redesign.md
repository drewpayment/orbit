# Knowledge Space Management Redesign

**Date:** 2025-11-23
**Status:** Design Complete
**Related:** Editorial Page Editor Redesign (2025-11-23)

## Overview

Redesign the knowledge space management interface to create a Notion-style immersive experience with persistent tree navigation, context menu actions, and editorial aesthetic principles.

## Goals

1. **Immersive Experience**: Auto-minimize app sidebar, maximize space for content
2. **Persistent Navigation**: Notion-style left sidebar with page tree across all pages
3. **Clean Management**: Context menu for rename, move, duplicate, delete operations
4. **Remove Status Clutter**: Eliminate draft/published status displays
5. **Editorial Design**: Apply same clean aesthetic from page editor redesign

## User Requirements

### Hierarchy & Navigation
- Parent/child tree structure with sibling reordering (✓ already built)
- Mixed approach: tree nesting + manual ordering at each level
- Auto-select first page when entering knowledge space
- Persistent sidebar navigation across page views

### Management Actions (via Context Menu)
- **Rename**: Inline edit page title
- **Move to...**: Change parent page
- **Add sub-page**: Create child under current page
- **Duplicate**: Copy page and children
- **Delete**: Remove page (with confirmation)

### Layout Behavior
- Auto-minimize main app sidebar on knowledge space entry
- Permanent left knowledge tree sidebar (256px wide)
- Slim breadcrumb header (40px, like page editor)
- Full-height immersive layout

## Architecture

### Approach: Next.js Nested Layout

**File Structure:**
```
src/app/(frontend)/workspaces/[slug]/knowledge/
├── page.tsx                           # Knowledge base listing (unchanged)
└── [spaceSlug]/
    ├── layout.tsx                     # NEW: Nested layout for space
    ├── page.tsx                       # Redirects to first page
    └── [pageSlug]/
        └── page.tsx                   # Individual page view (minimal changes)
```

**Benefits:**
- Layout fetches space + pages data once, shares with children
- Sidebar persists across navigation (no re-render)
- Clean separation: layout handles chrome, pages handle content
- Best Next.js practices, optimal performance

## Design Details

### 1. Nested Layout (`[spaceSlug]/layout.tsx`)

**Responsibilities:**
- Fetch workspace, space, and pages (server component)
- Auto-minimize app sidebar (`defaultOpen={false}`)
- Render persistent structure:
  - Left knowledge tree sidebar (256px)
  - Main content area with breadcrumb header
  - Full-height layout for immersive feel

**Structure:**
```typescript
export default async function KnowledgeSpaceLayout({
  children,
  params
}: {
  children: React.ReactNode
  params: Promise<{ slug: string; spaceSlug: string }>
}) {
  const { workspace, space, pages } = await fetchSpaceData(params)

  return (
    <SidebarProvider defaultOpen={false}> {/* Auto-minimized */}
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />

        {/* Main knowledge layout */}
        <div className="flex h-[calc(100vh-64px)]">
          {/* Left: Knowledge tree sidebar */}
          <KnowledgeTreeSidebar
            space={space}
            pages={pages}
            workspaceSlug={workspace.slug}
          />

          {/* Right: Content area */}
          <div className="flex-1 flex flex-col">
            {/* Slim breadcrumb header (40px) */}
            <KnowledgeBreadcrumbs workspace={workspace} space={space} />

            {/* Page content */}
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

### 2. Knowledge Tree Sidebar Component

**Design Principles:**
- Remove Card/CardHeader wrapper (too much chrome)
- Clean, borderless tree view
- Remove published/draft stats
- Editorial typography for space name
- Subtle borders instead of heavy card styling

**Structure:**
```typescript
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
    <PageTree
      pages={pages}
      currentPageId={currentPageId}
      onContextMenu={handleContextMenu}
    />
  </nav>

  {/* Bottom actions */}
  <div className="p-2 border-t border-border/40">
    <Button variant="ghost" className="w-full justify-start">
      <Plus className="h-4 w-4 mr-2" />
      New Page
    </Button>
  </div>
</aside>
```

**Features:**
- Drag-and-drop reordering (keep existing dnd-kit implementation)
- Expand/collapse for nested pages
- Active page highlighting (`bg-accent`)
- Right-click context menu
- Create page button at bottom

### 3. Context Menu System

**Using Radix UI ContextMenu:**
```typescript
<ContextMenu>
  <ContextMenuTrigger>
    <PageTreeNode node={node} />
  </ContextMenuTrigger>

  <ContextMenuContent className="w-56">
    <ContextMenuItem onClick={() => handleRename(node.id)}>
      <Edit className="h-4 w-4 mr-2" />
      Rename
    </ContextMenuItem>

    <ContextMenuItem onClick={() => handleMove(node.id)}>
      <FolderTree className="h-4 w-4 mr-2" />
      Move to...
    </ContextMenuItem>

    <ContextMenuSeparator />

    <ContextMenuItem onClick={() => handleAddSubPage(node.id)}>
      <FilePlus className="h-4 w-4 mr-2" />
      Add sub-page
    </ContextMenuItem>

    <ContextMenuItem onClick={() => handleDuplicate(node.id)}>
      <Copy className="h-4 w-4 mr-2" />
      Duplicate
    </ContextMenuItem>

    <ContextMenuSeparator />

    <ContextMenuItem className="text-destructive">
      <Trash className="h-4 w-4 mr-2" />
      Delete
    </ContextMenuItem>
  </ContextMenuContent>
</ContextMenu>
```

**Action Implementations:**
- **Rename**: Switch to inline input, save on blur/enter, update via server action
- **Move to...**: Modal with tree picker (exclude self + descendants)
- **Add sub-page**: Open create modal with parent pre-selected
- **Duplicate**: Create copy with "(Copy)" suffix, preserve hierarchy
- **Delete**: Confirmation dialog, warn if has children

**Required Server Actions:**
```typescript
// app/actions/knowledge.ts
async function renamePage(pageId: string, newTitle: string)
async function movePage(pageId: string, newParentId: string | null)
async function duplicatePage(pageId: string)
async function deletePage(pageId: string)
```

### 4. Breadcrumb Header

**Design:**
- 40px height (same as page editor)
- Sticky at top
- Shows: Knowledge Base > Space Name > Page Title
- Minimal, clean styling

```typescript
<div className="sticky top-0 z-10 flex h-10 items-center border-b border-border bg-background px-8">
  <div className="flex items-center gap-2 text-sm text-muted-foreground">
    <Link href={`/workspaces/${workspace.slug}/knowledge`}>
      Knowledge Base
    </Link>
    <span>/</span>
    <Link href={`/workspaces/${workspace.slug}/knowledge/${space.slug}`}>
      {space.name}
    </Link>
    <span>/</span>
    <span className="text-foreground">{currentPage?.title}</span>
  </div>
</div>
```

### 5. Space Landing Page Behavior

**`[spaceSlug]/page.tsx` Implementation:**
```typescript
export default async function KnowledgeSpacePage({ params }: PageProps) {
  const { slug, spaceSlug } = await params
  const payload = await getPayload({ config })

  // Fetch space and pages
  const { workspace, space, pages } = await fetchSpaceData(slug, spaceSlug)

  // Redirect to first page if pages exist
  if (pages.length > 0) {
    const firstPage = pages[0]
    redirect(`/workspaces/${slug}/knowledge/${spaceSlug}/${firstPage.slug}`)
  }

  // Empty state if no pages
  return <EmptyKnowledgeSpaceState />
}
```

### 6. Styling & Editorial Principles

**Typography:**
- Space name: `font-serif-display` (Crimson Pro)
- Page titles: `font-sans` (Geist Sans)
- Descriptions: `text-muted-foreground text-xs`
- Breadcrumbs: `text-sm` sans-serif

**Spacing:**
- Remove all Card components
- Subtle borders: `border-border/40`
- Sidebar padding: `p-4` for header/footer, `p-2` for tree
- Content area: `px-12` horizontal padding
- Tree items: `py-1 px-2`

**Colors:**
- Use existing design system tokens
- Active page: `bg-accent text-accent-foreground`
- Hover: `hover:bg-accent/50`
- No custom colors

**Animations:**
- Tree expand/collapse: 200ms transitions
- Respect `prefers-reduced-motion`
- Context menu: Radix defaults

**Responsive:**
- Mobile: Sidebar collapses to hamburger
- Breadcrumbs remain visible
- Tree accessible via slide-out panel

## Components to Create/Modify

### New Components
1. **`KnowledgeTreeSidebar.tsx`** - Main sidebar component
2. **`KnowledgeBreadcrumbs.tsx`** - Breadcrumb header
3. **`PageContextMenu.tsx`** - Right-click menu wrapper
4. **`MovePageModal.tsx`** - Modal for moving pages
5. **`DeletePageDialog.tsx`** - Confirmation for deletion

### Modified Components
1. **`SpaceNavigator.tsx`** - Refactor for new sidebar design
2. **`PageTreeNode.tsx`** - Add context menu integration
3. **`[spaceSlug]/page.tsx`** - Add redirect logic
4. **`[pageSlug]/page.tsx`** - Simplify (layout handles chrome)

### New Files
1. **`[spaceSlug]/layout.tsx`** - Nested layout
2. **`app/actions/knowledge.ts`** - Server actions for management

## Data Flow

### Page Navigation
1. User clicks page in tree
2. Client-side navigation to `/workspaces/{slug}/knowledge/{spaceSlug}/{pageSlug}`
3. Layout persists (no re-fetch)
4. Page component renders with new content
5. Tree updates active state

### Page Management
1. User right-clicks page → context menu appears
2. Select action → trigger handler
3. Handler calls server action
4. Server action updates database
5. Revalidate path to refresh data
6. Router refreshes, layout re-fetches pages
7. Tree updates with new structure

### Auto-Minimize Sidebar
1. User navigates to knowledge space route
2. `SidebarProvider` uses `defaultOpen={false}`
3. App sidebar renders in minimized state
4. User can manually expand if needed
5. State persists during knowledge navigation
6. Leaving knowledge area resets to default (expanded)

## Migration Notes

### Existing Features to Preserve
- ✅ Drag-and-drop reordering (dnd-kit)
- ✅ Parent/child relationships
- ✅ Create page modal
- ✅ Tree builder logic (`buildPageTree`)
- ✅ Keyboard navigation

### Features to Remove
- ❌ Draft/published status displays
- ❌ Statistics card (published/draft counts)
- ❌ Card/CardHeader wrappers
- ❌ Two-panel layout (sidebar + welcome content)

### Features to Add
- ✨ Context menu actions
- ✨ Inline rename
- ✨ Move to... functionality
- ✨ Duplicate pages
- ✨ Delete with confirmation
- ✨ Auto-redirect to first page
- ✨ Nested layout architecture

## Testing Strategy

### Unit Tests
- Context menu actions trigger correct handlers
- Inline rename updates page title
- Move page updates parent relationships
- Delete confirmation shows for pages with children
- Tree builder handles deeply nested structures

### Integration Tests
- Navigate to space → redirects to first page
- Right-click page → menu appears
- Rename page → updates in tree and URL
- Move page → preserves hierarchy
- Delete page → removes from tree
- Drag-drop → updates sort order

### E2E Tests
- Full navigation flow through knowledge space
- Create → edit → move → delete page lifecycle
- Sidebar auto-minimizes on entry
- Breadcrumbs update correctly
- Keyboard navigation works

## Success Criteria

1. ✅ App sidebar auto-minimizes when entering knowledge space
2. ✅ Persistent tree navigation across all pages
3. ✅ Context menu provides rename, move, duplicate, delete
4. ✅ No draft/published status visible anywhere
5. ✅ Clean, immersive editorial aesthetic
6. ✅ First page auto-selected when entering space
7. ✅ All existing drag-drop functionality preserved
8. ✅ Responsive design works on mobile/tablet
9. ✅ Keyboard accessibility maintained
10. ✅ Performance: No layout shifts, smooth navigation

## Future Enhancements (Out of Scope)

- Search within knowledge space
- Keyboard shortcuts for page management
- Undo/redo for page operations
- Version history for pages
- Page templates
- Bulk operations (multi-select)
- Advanced filtering/sorting options
