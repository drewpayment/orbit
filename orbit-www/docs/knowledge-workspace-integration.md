# Workspace Knowledge Integration - Implementation Guide

**Status**: ✅ Complete
**Date**: October 15, 2025

## Overview

Added the ability to manage knowledge spaces and pages directly from workspace contexts in both Payload Admin UI and frontend application UI. Users with appropriate role-based access can create, view, and manage knowledge spaces without leaving the workspace context.

## What Was Implemented

### 1. Payload Admin UI Integration

#### Custom Field Component
**File**: `src/components/admin/fields/WorkspaceKnowledgeField.tsx`

A custom Payload field component that displays in the workspace edit page showing:
- All knowledge spaces for the workspace
- Page statistics (total, published, draft) for each space
- Quick actions to create new spaces/pages
- Links to detailed knowledge management interface

**Features**:
- Real-time data fetching from Payload API
- Empty state when no spaces exist
- Per-space statistics and actions
- Visibility badges
- Responsive card-based layout

#### Integration in Workspaces Collection
**File**: `src/collections/Workspaces.ts`

Added a UI field to the Workspaces collection configuration:
```typescript
{
  name: 'knowledge',
  type: 'ui',
  label: 'Knowledge',
  admin: {
    components: {
      Field: '@/components/admin/fields/WorkspaceKnowledgeField#WorkspaceKnowledgeField',
    },
  },
}
```

This field appears as a "Knowledge" section in the workspace edit form.

### 2. Frontend App UI Integration

#### Server-Side Utilities
**File**: `src/lib/knowledge/workspace-knowledge.ts`

Helper functions for fetching knowledge data on the server:

- `getWorkspaceKnowledgeSpaces(workspaceId)`: Fetches all knowledge spaces with statistics
- `canUserManageKnowledgeSpaces(workspaceId, userId)`: Checks if user has permission to create/manage spaces

**Permission Levels**:
- `owner`, `admin`, `contributor` roles can manage knowledge spaces
- Other roles can only view published content

#### Frontend Component
**File**: `src/components/features/workspace/WorkspaceKnowledgeSection.tsx`

A client component for displaying knowledge spaces on workspace pages:

**Features**:
- Grid layout with cards for each space
- Empty state with create button (for authorized users)
- Page statistics display
- Visibility indicators (Private/Internal/Public)
- Hover effects and transitions
- Responsive design (1-3 columns based on screen size)
- Hidden when no spaces exist and user can't create them

## Usage

### In Payload Admin

1. **Navigate to Workspace Edit Page**:
   - Go to `/admin/collections/workspaces`
   - Select any workspace
   - Scroll down to the "Knowledge" section

2. **View Knowledge Spaces**:
   - See all spaces for the workspace
   - View statistics for each space
   - Check visibility settings

3. **Quick Actions**:
   - **Create New Space**: Click "New Space" button (pre-fills workspace)
   - **Create Page**: Click "New Page" for a specific space (pre-fills space)
   - **View Pages**: Navigate to page tree for a space
   - **Edit Space**: Click pencil icon to edit space settings
   - **Knowledge Management**: Click "Open Knowledge Management" for full interface

### In Frontend App

1. **Add to Workspace Page** (example):

```tsx
// app/(frontend)/workspaces/[slug]/page.tsx
import { WorkspaceKnowledgeSection } from '@/components/features/workspace/WorkspaceKnowledgeSection'
import { getWorkspaceKnowledgeSpaces, canUserManageKnowledgeSpaces } from '@/lib/knowledge/workspace-knowledge'
import { getCurrentUser } from '@/lib/auth' // Your auth utility

export default async function WorkspacePage({ params }: { params: { slug: string } }) {
  // ... fetch workspace ...
  
  const currentUser = await getCurrentUser()
  const spaces = await getWorkspaceKnowledgeSpaces(workspace.id)
  const canManage = currentUser 
    ? await canUserManageKnowledgeSpaces(workspace.id, currentUser.id)
    : false

  return (
    <div className="space-y-8">
      {/* Other workspace sections */}
      
      <WorkspaceKnowledgeSection
        workspaceSlug={workspace.slug}
        spaces={spaces}
        canManage={canManage}
      />
    </div>
  )
}
```

2. **Component Behavior**:
   - **No spaces + can't manage**: Section hidden
   - **No spaces + can manage**: Shows empty state with "Create Knowledge Space" button
   - **Has spaces**: Shows grid of space cards with links to view pages

## Routes You'll Need to Create

To fully support the frontend integration, create these routes:

### 1. Knowledge Space List Page
**Route**: `/app/(frontend)/workspaces/[workspaceSlug]/knowledge/page.tsx`

Shows all knowledge spaces for a workspace:
```tsx
import { getWorkspaceKnowledgeSpaces } from '@/lib/knowledge/workspace-knowledge'

export default async function WorkspaceKnowledgePage({ params }) {
  const spaces = await getWorkspaceKnowledgeSpaces(workspaceId)
  
  return (
    <div>
      {/* List all spaces */}
      {spaces.map(space => (
        <SpaceCard key={space.id} space={space} />
      ))}
    </div>
  )
}
```

### 2. Knowledge Space Create Page
**Route**: `/app/(frontend)/workspaces/[workspaceSlug]/knowledge/new/page.tsx`

Form to create a new knowledge space:
```tsx
'use client'

export default function NewKnowledgeSpacePage({ params }) {
  async function handleSubmit(data) {
    const response = await fetch('/api/knowledge-spaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace: workspaceId,
        ...data,
      }),
    })
    
    if (response.ok) {
      router.push(`/workspaces/${params.workspaceSlug}/knowledge`)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {/* Form fields for name, slug, description, etc. */}
    </form>
  )
}
```

### 3. Knowledge Space Detail Page
**Route**: `/app/(frontend)/workspaces/[workspaceSlug]/knowledge/[spaceSlug]/page.tsx`

Landing page for a specific knowledge space:
```tsx
import { SpaceNavigator } from '@/components/features/knowledge/SpaceNavigator'

export default async function KnowledgeSpacePage({ params }) {
  // Fetch space and pages
  const space = await getKnowledgeSpace(params.spaceSlug)
  const pages = await getKnowledgePages(space.id)
  
  return (
    <div className="grid grid-cols-[280px_1fr] gap-8">
      <SpaceNavigator knowledgeSpace={space} pages={pages} />
      <div>
        {/* Space overview or root pages list */}
      </div>
    </div>
  )
}
```

### 4. Knowledge Page View
**Route**: `/app/(frontend)/workspaces/[workspaceSlug]/knowledge/[spaceSlug]/[pageSlug]/page.tsx`

Display individual knowledge page:
```tsx
import { serializeLexical } from '@/lib/lexical/serialize'

export default async function KnowledgePageView({ params }) {
  const page = await getKnowledgePage(params.pageSlug)
  
  return (
    <div className="grid grid-cols-[280px_1fr] gap-8">
      <SpaceNavigator 
        knowledgeSpace={page.knowledgeSpace} 
        pages={allPages}
        currentPageId={page.id}
      />
      <article className="prose prose-slate max-w-none">
        <h1>{page.title}</h1>
        {serializeLexical(page.content)}
      </article>
    </div>
  )
}
```

## Access Control

### Payload Admin
Access is automatically controlled by Payload's collection-level access control:
- Only workspace members see their workspaces
- Only admins/owners can create/edit spaces
- Page authors or admins can edit pages

### Frontend App
Use the provided utility functions:

```tsx
// Check if user can manage spaces
const canManage = await canUserManageKnowledgeSpaces(workspaceId, userId)

// Show/hide create buttons based on permission
{canManage && (
  <Button>Create Space</Button>
)}
```

**Roles with Management Access**:
- Owner
- Admin  
- Contributor

**View-Only Roles**:
- Viewer (published content only)

## API Endpoints

All operations use Payload's auto-generated REST API:

### Knowledge Spaces
- `GET /api/knowledge-spaces` - List spaces
- `GET /api/knowledge-spaces/:id` - Get space
- `POST /api/knowledge-spaces` - Create space
- `PATCH /api/knowledge-spaces/:id` - Update space
- `DELETE /api/knowledge-spaces/:id` - Delete space

### Knowledge Pages
- `GET /api/knowledge-pages` - List pages
- `GET /api/knowledge-pages/:id` - Get page
- `POST /api/knowledge-pages` - Create page
- `PATCH /api/knowledge-pages/:id` - Update page
- `DELETE /api/knowledge-pages/:id` - Delete page

### Query Examples

**Filter by workspace**:
```
GET /api/knowledge-spaces?where[workspace][equals]=workspace-id
```

**Filter by space**:
```
GET /api/knowledge-pages?where[knowledgeSpace][equals]=space-id
```

**Filter by status**:
```
GET /api/knowledge-pages?where[status][equals]=published
```

**Pre-fill form with workspace**:
```
/admin/collections/knowledge-spaces/create?workspace=workspace-id
```

## Testing Checklist

### Payload Admin
- [ ] Navigate to workspace edit page
- [ ] Verify "Knowledge" section appears
- [ ] With no spaces: See empty state and "Create Knowledge Space" button
- [ ] Click "Create Knowledge Space" → workspace pre-filled
- [ ] Create space and return to workspace page
- [ ] Verify space appears in "Knowledge" section with stats
- [ ] Click "New Page" for a space → space pre-filled
- [ ] Create page and verify stats update
- [ ] Click "View Pages" → navigates to knowledge management page
- [ ] Click pencil icon → navigates to space edit form
- [ ] Click "Open Knowledge Management" → navigates to full interface

### Frontend App
- [ ] Add component to workspace page
- [ ] As non-member: Section hidden when no spaces exist
- [ ] As contributor: See "Create Knowledge Space" when no spaces
- [ ] As viewer: Section hidden if no published spaces
- [ ] Create space via frontend form
- [ ] Verify space appears in grid
- [ ] Click space card → navigates to space detail page
- [ ] View published pages in space
- [ ] Verify visibility indicators (Private/Internal/Public)
- [ ] Test responsive layout (mobile, tablet, desktop)

## Files Created/Modified

### New Files
1. `src/components/admin/fields/WorkspaceKnowledgeField.tsx` (262 lines)
   - Custom Payload field component for admin UI
   
2. `src/lib/knowledge/workspace-knowledge.ts` (81 lines)
   - Server-side utilities for fetching knowledge data
   
3. `src/components/features/workspace/WorkspaceKnowledgeSection.tsx` (176 lines)
   - Frontend component for workspace pages

### Modified Files
1. `src/collections/Workspaces.ts`
   - Added `knowledge` UI field to display custom component

## Benefits

1. **Integrated Experience**: Users don't leave workspace context to manage knowledge
2. **Quick Actions**: One-click access to create spaces/pages with pre-filled data
3. **At-a-Glance Stats**: See page counts and status without navigating away
4. **Role-Based Access**: Automatic permission checks ensure security
5. **Responsive Design**: Works on all screen sizes
6. **Consistent UI**: Uses shadcn/ui components matching the rest of the app

## Future Enhancements

1. **Inline Editing**: Edit space name/description directly in workspace page
2. **Drag-and-Drop**: Reorder spaces in the workspace
3. **Templates**: Quick-create spaces from templates
4. **Recent Activity**: Show recent page edits/views
5. **Search**: Search pages across all spaces in workspace
6. **Bulk Actions**: Archive, export, or delete multiple spaces at once

## Next Steps

1. ✅ **Payload Admin integration complete** - Test in Payload admin UI
2. 🔲 **Create frontend routes** - Implement the 4 routes listed above
3. 🔲 **Add to workspace pages** - Integrate `WorkspaceKnowledgeSection` component
4. 🔲 **Test access control** - Verify role-based permissions work correctly
5. 🔲 **Style refinements** - Adjust colors, spacing, icons to match design system

## Support

For questions or issues:
- Check Payload docs: https://payloadcms.com/docs
- Review implementation in `src/components/admin/fields/WorkspaceKnowledgeField.tsx`
- Test API endpoints in browser DevTools Network tab
