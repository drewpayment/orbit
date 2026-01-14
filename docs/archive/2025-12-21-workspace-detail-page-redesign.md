# Workspace Detail Page Redesign

## Overview

Refactor the workspace detail page from a 2-column layout to a 3-column dashboard layout that provides a quick overview of Applications, Registry Images, Recent Documents, and workspace metadata.

## Current State

The existing workspace detail page (`orbit-www/src/app/(frontend)/workspaces/[slug]/page.tsx`) uses a 2-column layout:
- Main content (2/3): Welcome card, Knowledge Spaces section, Templates section
- Sidebar (1/3): Workspace Hierarchy, Members (grouped by role)

## Target Design

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Header: Workspace Name, Slug, Description, Owner Badge                 │
├─────────────────────┬─────────────────────┬─────────────────────────────┤
│                     │                     │                             │
│   Applications      │    Registries       │   Workspace Hierarchy       │
│   ─────────────     │    ──────────       │   (child workspaces)        │
│   Table with:       │    Image list:      │                             │
│   - Name            │    - Registry icon  │   Members (N)               │
│   - Status badge    │    - Repo name      │   Avatar row only           │
│   - Last deployed   │    - URL link       │                             │
│   - Manage button   │                     │   Quick Links               │
│                     │                     │   - All Knowledge Spaces    │
│   [+ New App]       │   [+ New Registry]  │   - Templates               │
│                     │                     │   - Registries Settings     │
│                     ├─────────────────────│                             │
│                     │                     │                             │
│                     │  Recent Documents   │                             │
│                     │  ─────────────────  │                             │
│                     │  - Page icon + name │                             │
│                     │  - Chevron link     │                             │
│                     │                     │                             │
│                     │  [Manage Spaces]    │                             │
│                     │                     │                             │
└─────────────────────┴─────────────────────┴─────────────────────────────┘
```

**Responsive behavior:** 3 columns → 2 columns → 1 column as viewport shrinks.

## Component Specifications

### Header Section

- **Workspace name** - Large heading (h1)
- **Slug** - Displayed below name (e.g., "/engineering")
- **Description** - Paragraph text describing the workspace
- **Role badge** - Top-right corner showing current user's role (owner/admin/member)

### Applications Card

**Location:** Left column

**Header:**
- Grid icon + "Applications" title
- "+ New App" button (orange) → links to `/apps/new`

**Table columns:**
| Column | Description |
|--------|-------------|
| Name | App name with status badge below |
| Status | Colored indicator: green dot (Healthy), yellow triangle (Warning/Degraded), red dot (Down), gray dot (Unknown) |
| Last Deployed | Relative time from `latestBuild.builtAt` (e.g., "2h ago", "1d ago") |
| Action | "Manage" button → links to `/apps/[id]` |

**Data source:** Apps collection filtered by `workspace`, ordered by `latestBuild.builtAt` desc

**Empty state:** "No applications yet" with link to create one

### Registries Card

**Location:** Middle column (top)

**Header:**
- Box/registry icon + "Registries" title
- "+ New Registry" button (orange) → links to `/settings/registries?workspace=[slug]&action=new`

**List items:**
- Registry type icon (Orbit, GHCR, or ACR)
- Repository name (e.g., "GHCR - engineering-images")
- URL with external link icon
- Chevron for navigation

**Data source:** RegistryImages collection filtered by workspace, grouped by registry

**Empty state:** "No images pushed yet"

### Recent Documents Card

**Location:** Middle column (bottom)

**Header:**
- Document icon + "Recent Documents" title
- "Manage Spaces" button (orange) → links to `/workspaces/[slug]/knowledge`

**List items:**
- Document type icon (text/lines icon)
- Page title
- Chevron arrow → links to `/workspaces/[slug]/knowledge/[spaceSlug]/[pageSlug]`

**Data source:** KnowledgePages where space belongs to this workspace, ordered by `updatedAt` desc, limit 10

**Empty state:** "No documents yet" with link to create a knowledge space

### Workspace Hierarchy Card

**Location:** Right column (top)

**Header:**
- "Workspace Hierarchy" title
- "Related workspaces" subtitle

**Content:**
- "Child Workspaces (N)" label
- List of child workspace avatars + names
- Each item links to that workspace's detail page

**Visibility:** Only shown if workspace has parent or children

### Members Card

**Location:** Right column (middle)

**Header:**
- "Members (N)" title with total count
- "People in this workspace" subtitle

**Content:**
- "Owners" label
- Row of owner avatars only (no names, tooltip on hover)

**Simplified from current:** No longer grouped by role with full names

### Quick Links Card

**Location:** Right column (bottom)

**Header:**
- "Quick Links" title
- "Helpful shortcuts" subtitle

**Static links:**
| Link | Destination |
|------|-------------|
| All Knowledge Spaces | `/workspaces/[slug]/knowledge` |
| Templates | `/templates?workspace=[slug]` |
| Registries | `/settings/registries?workspace=[slug]` |

## Data Fetching

All data fetched server-side in the page component:

```typescript
// 1. Workspace with relationships
const workspace = await payload.findByID({
  collection: 'workspaces',
  id: workspaceId,
  depth: 2
});

// 2. Applications for this workspace
const apps = await payload.find({
  collection: 'apps',
  where: { workspace: { equals: workspaceId } },
  sort: '-latestBuild.builtAt',
  limit: 10
});

// 3. Registry images for this workspace
const registryImages = await payload.find({
  collection: 'registry-images',
  where: { workspace: { equals: workspaceId } },
  limit: 20
});

// 4. Recent knowledge pages
const recentPages = await payload.find({
  collection: 'knowledge-pages',
  where: { 'space.workspace': { equals: workspaceId } },
  sort: '-updatedAt',
  limit: 10
});

// 5. Members (existing query, simplified display)
const members = await getWorkspaceMembers(workspaceId);

// 6. Child workspaces
const childWorkspaces = await payload.find({
  collection: 'workspaces',
  where: { parent: { equals: workspaceId } }
});
```

## Files to Create

| File | Purpose |
|------|---------|
| `components/features/workspace/WorkspaceApplicationsCard.tsx` | Applications table with status badges |
| `components/features/workspace/WorkspaceRegistriesCard.tsx` | Registry images list grouped by type |
| `components/features/workspace/WorkspaceRecentDocsCard.tsx` | Recent knowledge pages list |
| `components/features/workspace/WorkspaceQuickLinksCard.tsx` | Static navigation links |
| `components/features/workspace/WorkspaceMembersCardSimple.tsx` | Simplified avatar-only members display |

## Files to Modify

| File | Changes |
|------|---------|
| `app/(frontend)/workspaces/[slug]/page.tsx` | Refactor to 3-column layout, new data fetching, use new components |

## Components to Remove/Replace

| Current | Replacement |
|---------|-------------|
| Welcome Card | Remove (not in new design) |
| `WorkspaceKnowledgeSection` | Replace with `WorkspaceRecentDocsCard` |
| `WorkspaceTemplatesSection` | Remove (moved to Quick Links) |
| Current Members Card | Replace with `WorkspaceMembersCardSimple` |

## Design Tokens

Following the mockup's visual style:

- **Card background:** Dark card style (existing Card component)
- **Orange accent:** Used for primary action buttons (+ New App, + New Registry, Manage Spaces)
- **Status colors:**
  - Healthy: `text-green-500`
  - Warning/Degraded: `text-yellow-500`
  - Down: `text-red-500`
  - Unknown: `text-gray-500`
- **Registry icons:** Custom icons for Orbit, GHCR, ACR

## Responsive Breakpoints

```css
/* Mobile: 1 column */
grid-template-columns: 1fr;

/* Tablet (md): 2 columns */
grid-template-columns: 1fr 1fr;
/* Sidebar cards stack below */

/* Desktop (lg): 3 columns */
grid-template-columns: 1fr 1fr 280px;
```

## Success Criteria

1. Workspace detail page renders with 3-column layout on desktop
2. Applications card shows apps with status, last deployed time, and manage link
3. Registries card shows pushed images grouped by registry type (Orbit, GHCR, ACR)
4. Recent Documents shows latest knowledge pages with links
5. Members card displays simplified avatar-only view
6. Quick Links provides navigation to Knowledge Spaces, Templates, and Registries
7. All action buttons link to correct destinations
8. Layout responds correctly on tablet and mobile
9. Empty states display appropriately when no data exists
