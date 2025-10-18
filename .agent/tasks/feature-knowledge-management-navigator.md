# Feature: Knowledge Management System with Space Navigator

**Status**: Planned
**Date**: 2025-01-15
**Task**: T048
**Estimated Complexity**: High
**Related Documentation**:
- See: [.agent/system/project-structure.md](.agent/system/project-structure.md)
- See: [.agent/SOPs/error-handling.md](.agent/SOPs/error-handling.md)
- Similar: [.agent/tasks/feature-workspace-management.md](.agent/tasks/feature-workspace-management.md)

## Overview

Implement a Payload CMS-native knowledge management system with hierarchical page structure and Lexical rich text editor, modeled after Azure DevOps wiki. Users can create knowledge spaces within their workspaces and organize documentation pages in a tree structure with a persistent navigation sidebar.

## Requirements (PRD)

### User Stories
- As a workspace owner, I want to create knowledge spaces to organize team documentation so that information is centralized and discoverable
- As a content author, I want to create nested pages with rich text content so that I can build comprehensive documentation hierarchies
- As a team member, I want to navigate through documentation using a tree view sidebar so that I can quickly find relevant information
- As a content author, I want to use a rich text editor (Lexical) so that I can format documentation professionally with images, code blocks, and tables
- As a workspace admin, I want knowledge spaces to be workspace-scoped so that each team's documentation remains isolated

### Technical Requirements
- Knowledge spaces must belong to exactly one workspace (enforced via relationship)
- Pages must support hierarchical parent-child relationships (self-referential)
- Pages must use Payload's Lexical editor for rich text content
- Circular reference prevention for page hierarchies (max depth: 20 levels)
- Bidirectional sync for parent-child relationships
- Access control inherited from workspace permissions
- All CRUD operations through Payload CMS admin UI initially
- Tree view navigation component as persistent layout around knowledge content

### Business Rules
- Knowledge spaces are workspace-scoped (no cross-workspace sharing)
- Page slugs must be unique within a knowledge space
- Only workspace members can create/edit knowledge spaces
- Draft/Published status workflow for pages
- Page ordering via `sortOrder` field for manual control
- Author tracking for accountability and audit trails

## Current State Analysis

### What Exists Now
Current implementation status:
- **Workspaces collection**: `orbit-www/src/collections/Workspaces.ts` - Established pattern for hierarchical relationships with circular reference prevention
- **Lexical editor**: Already configured globally in `payload.config.ts` with `lexicalEditor()`
- **UI components**: shadcn/ui components available (Collapsible, Card, Sidebar, Tree view capable)
- **Integration test**: `tests/int/knowledge-base.int.spec.ts` - Test framework ready, expects collections

### Key Discoveries
- **Hierarchy pattern**: Workspaces collection demonstrates self-referential relationships with hooks at `src/collections/Workspaces.ts:117-417`
- **Circular prevention**: Validated at `Workspaces.ts:117-206` using depth-first traversal with 20-level limit
- **Bidirectional sync**: Implemented via `afterChange` hook at `Workspaces.ts:273-413` with `skipHierarchySync` context flag
- **Access control**: Pattern at `Workspaces.ts:12-49` shows workspace-based permissions with member role checks
- **Relationship fields**: `parentWorkspace` (line 75) and `childWorkspaces` (line 84) show Payload relationship syntax

### What's Missing
- `KnowledgeSpaces` collection definition
- `KnowledgePages` collection definition  
- Space Navigator tree view component
- Frontend routes for knowledge display (`/workspaces/[slug]/knowledge`)
- Page hierarchy management UI
- Search functionality within knowledge spaces (future)

## Desired End State

After implementation:
1. **Two new Payload collections** registered in config: KnowledgeSpaces, KnowledgePages
2. **Knowledge spaces** creatable within workspace context via Payload admin
3. **Hierarchical pages** with parent-child relationships, drag-drop reordering support
4. **Space Navigator component** showing tree view of pages with current page highlighting
5. **Lexical editor** fully integrated for page content creation/editing
6. **Frontend routes** at `/workspaces/[slug]/knowledge/[spaceSlug]/[pageSlug]`
7. **Access control** enforcing workspace membership for CRUD operations

### Success Indicators
- Workspace admins can create knowledge spaces with name, description, icon
- Authors can create pages with hierarchical structure up to 20 levels deep
- Tree navigation shows collapsible page hierarchy with current page highlighted
- Lexical editor enables rich formatting (headings, lists, code blocks, images)
- Circular reference errors prevented with descriptive messages
- All T022 integration tests pass

### How to Verify
- Create knowledge space within workspace via Payload admin
- Add nested pages with parent-child relationships
- View page in frontend with Space Navigator showing tree structure
- Edit page content using Lexical editor with formatting
- Attempt circular reference and verify prevention
- Navigate between pages using tree view without page reload

## What We're NOT Doing

Explicitly out of scope for initial implementation:
- NOT implementing full-text search across knowledge spaces (future Phase 6)
- NOT adding real-time collaborative editing (future enhancement)
- NOT building custom Lexical plugins (use defaults)
- NOT implementing version history/rollback (tracked via `version` field only)
- NOT adding drag-and-drop page reordering (manual `sortOrder` editing only)
- NOT building separate gRPC service (Payload-only initially)
- NOT adding comments/discussions on pages (future)
- NOT implementing knowledge space templates (future)
- NOT building AI-powered content suggestions (future)

## Implementation Approach

### High-Level Strategy
Follow Payload CMS best practices with collection-first design. Reuse workspace hierarchy patterns for page relationships. Implement collections first, then navigation UI, then frontend display routes. All operations through Payload admin initially before building custom frontend workflows.

### Architecture Decisions
- **Decision 1**: Use Payload collections instead of gRPC service
  - **Reasoning**: Faster development, leverages Payload's built-in admin UI, auth, and validation. gRPC service can be added later if needed for cross-service access.
  - **Reference**: Similar to Workspaces/WorkspaceMembers collections in `.agent/tasks/feature-workspace-management.md`

- **Decision 2**: Self-referential relationships for page hierarchy
  - **Reasoning**: Proven pattern in Workspaces collection, supports unlimited nesting with validation, easier to query and display
  - **Reference**: `Workspaces.ts:75-93` shows `parentWorkspace` and `childWorkspaces` fields

- **Decision 3**: Lexical editor as primary content field
  - **Reasoning**: Already configured globally, rich feature set out-of-box, extensible, TypeScript-native
  - **Reference**: `payload.config.ts:26` - `editor: lexicalEditor()`

- **Decision 4**: Space Navigator as layout component
  - **Reasoning**: Persistent sidebar provides context, follows Azure DevOps wiki UX pattern, improves discoverability
  - **Pattern**: Similar to workspace hierarchy display in `app/(frontend)/workspaces/[slug]/page.tsx:135-185`

### Patterns to Follow
- **Collection structure**: Follow `src/collections/Workspaces.ts` for hierarchy relationships
- **Circular prevention**: Reuse validation logic from `Workspaces.ts:117-206`
- **Access control**: Apply workspace-scoped permissions like `Workspaces.ts:12-49`
- **Component structure**: Follow `src/components/features/workspace/` directory pattern

---

## Phase 1: KnowledgeSpaces Collection ✅

### Overview
Create Payload collection for knowledge spaces with workspace relationship and basic metadata.

### Prerequisites
- [x] Workspaces collection exists (already complete)
- [x] Payload config accessible

### Changes Required

#### 1. Create KnowledgeSpaces Collection

**Files to Create:**
- `orbit-www/src/collections/KnowledgeSpaces.ts` - Collection definition
- Update `orbit-www/src/payload.config.ts` - Register collection

**Collection Schema:**

```typescript
import type { CollectionConfig } from 'payload'

export const KnowledgeSpaces: CollectionConfig = {
  slug: 'knowledge-spaces',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'workspace', 'createdAt'],
    group: 'Knowledge',
  },
  access: {
    // Read: Workspace members
    read: async ({ req: { user, payload } }) => {
      if (!user) return false
      
      // Return query constraint to filter by workspace membership
      const memberships = await payload.find({
        collection: 'workspace-members',
        where: {
          user: { equals: user.id },
          status: { equals: 'active' },
        },
        limit: 1000,
      })
      
      const workspaceIds = memberships.docs.map(m => 
        typeof m.workspace === 'string' ? m.workspace : m.workspace.id
      )
      
      return {
        workspace: { in: workspaceIds }
      }
    },
    // Create: Authenticated users (workspace will be validated)
    create: ({ req: { user } }) => !!user,
    // Update: Workspace admins/owners only
    update: async ({ req: { user, payload }, id }) => {
      if (!user) return false
      
      const space = await payload.findByID({
        collection: 'knowledge-spaces',
        id,
      })
      
      const workspaceId = typeof space.workspace === 'string' 
        ? space.workspace 
        : space.workspace.id
      
      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: workspaceId } },
            { user: { equals: user.id } },
            { role: { in: ['owner', 'admin'] } },
            { status: { equals: 'active' } },
          ],
        },
      })
      
      return members.docs.length > 0
    },
    // Delete: Workspace owners only
    delete: async ({ req: { user, payload }, id }) => {
      if (!user) return false
      
      const space = await payload.findByID({
        collection: 'knowledge-spaces',
        id,
      })
      
      const workspaceId = typeof space.workspace === 'string'
        ? space.workspace
        : space.workspace.id
      
      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: workspaceId } },
            { user: { equals: user.id } },
            { role: { equals: 'owner' } },
            { status: { equals: 'active' } },
          ],
        },
      })
      
      return members.docs.length > 0
    },
  },
  fields: [
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      hasMany: false,
      admin: {
        description: 'The workspace this knowledge space belongs to',
      },
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      minLength: 3,
      maxLength: 100,
      label: 'Space Name',
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      label: 'URL Slug',
      admin: {
        description: 'URL-friendly identifier (e.g., "engineering-docs")',
      },
      validate: (val) => {
        if (!/^[a-z0-9-]+$/.test(val)) {
          return 'Slug must contain only lowercase letters, numbers, and hyphens'
        }
        return true
      },
    },
    {
      name: 'description',
      type: 'textarea',
      label: 'Description',
      maxLength: 500,
    },
    {
      name: 'icon',
      type: 'text',
      label: 'Icon',
      admin: {
        description: 'Icon identifier (e.g., "book", "docs", "wiki")',
      },
    },
    {
      name: 'color',
      type: 'text',
      label: 'Theme Color',
      admin: {
        description: 'Hex color code for visual identification',
      },
    },
    {
      name: 'visibility',
      type: 'select',
      required: true,
      defaultValue: 'internal',
      options: [
        { label: 'Private', value: 'private' },
        { label: 'Internal (Workspace)', value: 'internal' },
        { label: 'Public', value: 'public' },
      ],
      admin: {
        description: 'Who can view this knowledge space',
      },
    },
  ],
  hooks: {
    beforeValidate: [
      ({ data, operation, req }) => {
        // Auto-generate slug from name if not provided
        if (operation === 'create' && !data.slug && data.name) {
          data.slug = data.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
        }
        return data
      },
    ],
  },
}
```

**Update payload.config.ts:**
```typescript
import { KnowledgeSpaces } from './collections/KnowledgeSpaces'

export default buildConfig({
  // ...
  collections: [Users, Media, Workspaces, WorkspaceMembers, KnowledgeSpaces],
  // ...
})
```

### Dependencies
- Depends on: Workspaces collection existing
- Blocks: KnowledgePages collection (needs space relationship)

### Success Criteria

#### Automated Verification
- [x] Types regenerate: `cd orbit-www && bun run generate:types`
- [x] Linting passes: `make lint`
- [ ] Build succeeds: `cd orbit-www && bun run build`
- [ ] Collection appears in Payload admin at `/admin/collections/knowledge-spaces`

#### Manual Verification
- [ ] Create knowledge space via Payload admin within a workspace
- [ ] Slug auto-generates from name correctly
- [ ] Workspace relationship enforced (cannot save without workspace)
- [ ] Access control works (only workspace members see the space)
- [ ] Unique slug constraint prevents duplicates

### Rollback Plan
Remove KnowledgeSpaces import from `payload.config.ts`, delete `src/collections/KnowledgeSpaces.ts`, regenerate types.

---

## Phase 2: KnowledgePages Collection with Hierarchy ✅

### Overview
Create collection for knowledge pages with self-referential parent-child relationships, Lexical editor content, and circular reference prevention.

### Prerequisites
- [x] Phase 1 completed (KnowledgeSpaces collection)
- [x] Lexical editor configured (already done in payload.config.ts)

### Changes Required

#### 1. Create KnowledgePages Collection

**Files to Create:**
- `orbit-www/src/collections/KnowledgePages.ts` - Collection definition with hierarchy logic

**Collection Schema:**

```typescript
import type { CollectionConfig } from 'payload'

export const KnowledgePages: CollectionConfig = {
  slug: 'knowledge-pages',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'knowledgeSpace', 'status', 'updatedAt'],
    group: 'Knowledge',
  },
  access: {
    // Read: Based on knowledge space access (workspace members)
    read: async ({ req: { user, payload } }) => {
      if (!user) return false
      
      const memberships = await payload.find({
        collection: 'workspace-members',
        where: {
          user: { equals: user.id },
          status: { equals: 'active' },
        },
        limit: 1000,
      })
      
      const workspaceIds = memberships.docs.map(m =>
        typeof m.workspace === 'string' ? m.workspace : m.workspace.id
      )
      
      // Filter pages by knowledge spaces that belong to user's workspaces
      const spaces = await payload.find({
        collection: 'knowledge-spaces',
        where: {
          workspace: { in: workspaceIds }
        },
        limit: 1000,
      })
      
      const spaceIds = spaces.docs.map(s => s.id)
      
      return {
        knowledgeSpace: { in: spaceIds }
      }
    },
    // Create: Authenticated workspace members
    create: ({ req: { user } }) => !!user,
    // Update: Authors and workspace admins
    update: async ({ req: { user, payload }, id }) => {
      if (!user) return false
      
      const page = await payload.findByID({
        collection: 'knowledge-pages',
        id,
        depth: 2,
      })
      
      // Get workspace through space relationship
      const space = typeof page.knowledgeSpace === 'object' 
        ? page.knowledgeSpace 
        : await payload.findByID({ collection: 'knowledge-spaces', id: page.knowledgeSpace })
      
      const workspaceId = typeof space.workspace === 'string'
        ? space.workspace
        : space.workspace.id
      
      // Check if user is author or workspace admin/owner
      const isAuthor = page.author === user.id || 
        (typeof page.author === 'object' && page.author.id === user.id)
      
      if (isAuthor) return true
      
      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: workspaceId } },
            { user: { equals: user.id } },
            { role: { in: ['owner', 'admin'] } },
            { status: { equals: 'active' } },
          ],
        },
      })
      
      return members.docs.length > 0
    },
    // Delete: Authors and workspace admins
    delete: async ({ req: { user, payload }, id }) => {
      if (!user) return false
      
      const page = await payload.findByID({
        collection: 'knowledge-pages',
        id,
        depth: 2,
      })
      
      const space = typeof page.knowledgeSpace === 'object'
        ? page.knowledgeSpace
        : await payload.findByID({ collection: 'knowledge-spaces', id: page.knowledgeSpace })
      
      const workspaceId = typeof space.workspace === 'string'
        ? space.workspace
        : space.workspace.id
      
      const isAuthor = page.author === user.id ||
        (typeof page.author === 'object' && page.author.id === user.id)
      
      if (isAuthor) return true
      
      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: workspaceId } },
            { user: { equals: user.id } },
            { role: { in: ['owner', 'admin'] } },
            { status: { equals: 'active' } },
          ],
        },
      })
      
      return members.docs.length > 0
    },
  },
  fields: [
    {
      name: 'knowledgeSpace',
      type: 'relationship',
      relationTo: 'knowledge-spaces',
      required: true,
      hasMany: false,
      admin: {
        description: 'The knowledge space this page belongs to',
      },
    },
    {
      name: 'title',
      type: 'text',
      required: true,
      minLength: 1,
      maxLength: 200,
      label: 'Page Title',
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      label: 'URL Slug',
      admin: {
        description: 'URL-friendly identifier within the knowledge space',
      },
      validate: (val) => {
        if (!/^[a-z0-9-]+$/.test(val)) {
          return 'Slug must contain only lowercase letters, numbers, and hyphens'
        }
        return true
      },
    },
    {
      name: 'content',
      type: 'richText',
      required: true,
      label: 'Page Content',
      admin: {
        description: 'Main content of the knowledge page',
      },
    },
    {
      name: 'parentPage',
      type: 'relationship',
      relationTo: 'knowledge-pages',
      hasMany: false,
      label: 'Parent Page',
      admin: {
        description: 'The parent page in the hierarchy (leave empty for root page)',
      },
      filterOptions: ({ data, siblingData }) => {
        // Only show pages from the same knowledge space
        if (data?.knowledgeSpace) {
          return {
            knowledgeSpace: { equals: data.knowledgeSpace }
          }
        }
        return {}
      },
    },
    {
      name: 'childPages',
      type: 'relationship',
      relationTo: 'knowledge-pages',
      hasMany: true,
      label: 'Child Pages',
      admin: {
        description: 'Pages that are children of this page',
      },
      filterOptions: ({ data }) => {
        if (data?.knowledgeSpace) {
          return {
            knowledgeSpace: { equals: data.knowledgeSpace }
          }
        }
        return {}
      },
    },
    {
      name: 'sortOrder',
      type: 'number',
      required: true,
      defaultValue: 0,
      label: 'Sort Order',
      admin: {
        description: 'Order of this page among siblings (lower numbers appear first)',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'draft',
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'Published', value: 'published' },
        { label: 'Archived', value: 'archived' },
      ],
      admin: {
        description: 'Publication status of the page',
      },
    },
    {
      name: 'tags',
      type: 'array',
      label: 'Tags',
      fields: [
        {
          name: 'tag',
          type: 'text',
          required: true,
        },
      ],
    },
    {
      name: 'author',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      hasMany: false,
      admin: {
        description: 'Original author of the page',
      },
    },
    {
      name: 'lastEditedBy',
      type: 'relationship',
      relationTo: 'users',
      hasMany: false,
      admin: {
        description: 'User who last edited the page',
      },
    },
    {
      name: 'version',
      type: 'number',
      required: true,
      defaultValue: 1,
      admin: {
        description: 'Version number (incremented on each edit)',
      },
    },
  ],
  hooks: {
    beforeValidate: [
      async ({ data, operation, req, originalDoc, context }) => {
        // Skip validation if this is a sync operation
        if (context?.skipHierarchySync) {
          return data
        }
        
        // Auto-generate slug from title if not provided
        if (operation === 'create' && !data.slug && data.title) {
          data.slug = data.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
        }
        
        // Set author on create
        if (operation === 'create' && req.user && !data.author) {
          data.author = req.user.id
        }
        
        // Update lastEditedBy on update
        if (operation === 'update' && req.user) {
          data.lastEditedBy = req.user.id
          data.version = (originalDoc?.version || 0) + 1
        }
        
        // Validate parent page relationship
        if (data?.parentPage) {
          const currentId = originalDoc?.id || data.id
          
          // Prevent self-reference
          if (data.parentPage === currentId) {
            throw new Error('A page cannot be its own parent')
          }
          
          // Check for circular references using depth-first traversal
          try {
            let currentParentId = typeof data.parentPage === 'string' 
              ? data.parentPage 
              : data.parentPage.id
            
            const visited = new Set([currentId])
            let depth = 0
            const maxDepth = 20
            
            while (currentParentId && depth < maxDepth) {
              if (visited.has(currentParentId)) {
                throw new Error(
                  'Circular reference detected. This would create a loop in the page hierarchy.'
                )
              }
              
              visited.add(currentParentId)
              
              const parent = await req.payload.findByID({
                collection: 'knowledge-pages',
                id: currentParentId,
              })
              
              currentParentId = parent?.parentPage && typeof parent.parentPage === 'string'
                ? parent.parentPage
                : null
              depth++
            }
            
            if (depth >= maxDepth) {
              throw new Error('Maximum hierarchy depth exceeded (20 levels)')
            }
          } catch (error) {
            if (error instanceof Error) {
              throw error
            }
            throw new Error('Error validating parent page')
          }
        }
        
        // Validate child pages relationship
        if (data?.childPages && Array.isArray(data.childPages) && data.childPages.length > 0) {
          const currentId = originalDoc?.id || data.id
          
          for (const childId of data.childPages) {
            const childIdStr = typeof childId === 'string' ? childId : childId.id
            
            // Prevent self-reference
            if (childIdStr === currentId) {
              throw new Error('A page cannot be its own child')
            }
            
            // Check for circular references via children
            try {
              const child = await req.payload.findByID({
                collection: 'knowledge-pages',
                id: childIdStr,
              })
              
              let currentParentId = child?.parentPage && typeof child.parentPage === 'string'
                ? child.parentPage
                : null
              
              const visited = new Set([currentId, childIdStr])
              let depth = 0
              const maxDepth = 20
              
              while (currentParentId && depth < maxDepth) {
                if (visited.has(currentParentId)) {
                  throw new Error(
                    `Circular reference detected with "${child.title}". This would create a loop in the page hierarchy.`
                  )
                }
                
                visited.add(currentParentId)
                
                const parent = await req.payload.findByID({
                  collection: 'knowledge-pages',
                  id: currentParentId,
                })
                
                currentParentId = parent?.parentPage && typeof parent.parentPage === 'string'
                  ? parent.parentPage
                  : null
                depth++
              }
              
              if (depth >= maxDepth) {
                throw new Error('Maximum hierarchy depth exceeded')
              }
            } catch (error) {
              if (error instanceof Error) {
                throw error
              }
              throw new Error('Error validating child pages')
            }
          }
        }
        
        return data
      },
    ],
    afterChange: [
      async ({ operation, doc, req: { payload, user }, previousDoc, context }) => {
        // Skip sync if this is already a sync operation
        if (context?.skipHierarchySync) {
          return
        }
        
        // Sync parent/child relationships bidirectionally
        const currentParent = typeof doc.parentPage === 'string' ? doc.parentPage : null
        const previousParent = previousDoc && typeof previousDoc.parentPage === 'string'
          ? previousDoc.parentPage
          : null
        
        const currentChildren = doc.childPages && Array.isArray(doc.childPages)
          ? doc.childPages.filter((c: unknown): c is string => typeof c === 'string')
          : []
        const previousChildren = previousDoc && previousDoc.childPages && Array.isArray(previousDoc.childPages)
          ? previousDoc.childPages.filter((c: unknown): c is string => typeof c === 'string')
          : []
        
        // Handle parent page changes
        if (currentParent !== previousParent) {
          // Remove from previous parent's children
          if (previousParent) {
            try {
              const prevParent = await payload.findByID({
                collection: 'knowledge-pages',
                id: previousParent,
                depth: 0,
              })
              
              const updatedChildren = prevParent.childPages && Array.isArray(prevParent.childPages)
                ? prevParent.childPages
                    .filter((c): c is string => typeof c === 'string')
                    .filter((c) => c !== doc.id)
                : []
              
              await payload.update({
                collection: 'knowledge-pages',
                id: previousParent,
                data: {
                  childPages: updatedChildren,
                },
                context: {
                  skipHierarchySync: true,
                },
              })
            } catch (error) {
              console.error('Error removing from previous parent:', error)
            }
          }
          
          // Add to new parent's children
          if (currentParent) {
            try {
              const newParent = await payload.findByID({
                collection: 'knowledge-pages',
                id: currentParent,
                depth: 0,
              })
              
              const existingChildren = newParent.childPages && Array.isArray(newParent.childPages)
                ? newParent.childPages.filter((c): c is string => typeof c === 'string')
                : []
              
              // Only add if not already present
              if (!existingChildren.includes(doc.id)) {
                await payload.update({
                  collection: 'knowledge-pages',
                  id: currentParent,
                  data: {
                    childPages: [...existingChildren, doc.id],
                  },
                  context: {
                    skipHierarchySync: true,
                  },
                })
              }
            } catch (error) {
              console.error('Error adding to new parent:', error)
            }
          }
        }
        
        // Handle child page changes
        const addedChildren = currentChildren.filter((c: string) => !previousChildren.includes(c))
        const removedChildren = previousChildren.filter((c: string) => !currentChildren.includes(c))
        
        // Set parent on newly added children
        for (const childId of addedChildren) {
          try {
            const child = await payload.findByID({
              collection: 'knowledge-pages',
              id: childId,
              depth: 0,
            })
            
            // Only update if the child doesn't already have this page as parent
            if (child.parentPage !== doc.id) {
              await payload.update({
                collection: 'knowledge-pages',
                id: childId,
                data: {
                  parentPage: doc.id,
                },
                context: {
                  skipHierarchySync: true,
                },
              })
            }
          } catch (error) {
            console.error('Error setting parent on child:', error)
          }
        }
        
        // Remove parent from removed children
        for (const childId of removedChildren) {
          try {
            const child = await payload.findByID({
              collection: 'knowledge-pages',
              id: childId,
              depth: 0,
            })
            
            // Only update if this page is currently the parent
            if (child.parentPage === doc.id) {
              await payload.update({
                collection: 'knowledge-pages',
                id: childId,
                data: {
                  parentPage: null,
                },
                context: {
                  skipHierarchySync: true,
                },
              })
            }
          } catch (error) {
            console.error('Error removing parent from child:', error)
          }
        }
      },
    ],
  },
  indexes: [
    {
      fields: ['knowledgeSpace', 'slug'],
      unique: true,
      name: 'space_slug_unique',
    },
  ],
}
```

**Update payload.config.ts:**
```typescript
import { KnowledgePages } from './collections/KnowledgePages'

export default buildConfig({
  // ...
  collections: [Users, Media, Workspaces, WorkspaceMembers, KnowledgeSpaces, KnowledgePages],
  // ...
})
```

### Dependencies
- Depends on: Phase 1 (KnowledgeSpaces collection)
- Blocks: SpaceNavigator component (needs pages to display)

### Success Criteria

#### Automated Verification
- [x] Types regenerate: `cd orbit-www && bun run generate:types`
- [x] Linting passes: `make lint`
- [ ] Build succeeds: `cd orbit-www && bun run build`
- [ ] T022 integration test passes: `cd orbit-www && bun run test:int knowledge-base`

#### Manual Verification
- [ ] Create root page (no parent) in knowledge space via Payload admin
- [ ] Create child page with parent relationship
- [ ] Create nested child (3 levels deep) successfully
- [ ] Attempt to set page as its own parent → error prevented
- [ ] Attempt circular reference (A→B→A) → error prevented
- [ ] Slug uniqueness enforced within knowledge space
- [ ] Author and lastEditedBy fields populate automatically
- [ ] Version increments on each edit
- [ ] Lexical editor displays rich text editing capabilities

### Rollback Plan
Remove KnowledgePages import from `payload.config.ts`, delete `src/collections/KnowledgePages.ts`, regenerate types.

---

## Phase 3: SpaceNavigator Component ✅

### Overview
Build React component to display hierarchical page tree with collapsible sections and current page highlighting.

### Prerequisites
- [x] Phase 2 completed (KnowledgePages collection)
- [x] shadcn/ui Collapsible component available

### Changes Required

#### 1. Create SpaceNavigator Component

**Files to Create:**
- `orbit-www/src/components/features/knowledge/SpaceNavigator.tsx` - Main navigation component
- `orbit-www/src/components/features/knowledge/PageTreeNode.tsx` - Recursive tree node component
- `orbit-www/src/components/features/knowledge/types.ts` - TypeScript types
- `orbit-www/src/lib/knowledge/tree-builder.ts` - Utility to build tree structure

**Type Definitions (types.ts):**
```typescript
import type { KnowledgePage, KnowledgeSpace } from '@/payload-types'

export interface PageTreeNode {
  id: string
  title: string
  slug: string
  status: 'draft' | 'published' | 'archived'
  sortOrder: number
  children: PageTreeNode[]
  parentId: string | null
}

export interface SpaceNavigatorProps {
  knowledgeSpace: KnowledgeSpace
  pages: KnowledgePage[]
  currentPageId?: string
  onPageSelect?: (pageId: string) => void
}

export interface PageTreeNodeProps {
  node: PageTreeNode
  currentPageId?: string
  depth: number
  onPageSelect?: (pageId: string) => void
}
```

**Tree Builder Utility (lib/knowledge/tree-builder.ts):**
```typescript
import type { KnowledgePage } from '@/payload-types'
import type { PageTreeNode } from '@/components/features/knowledge/types'

export function buildPageTree(pages: KnowledgePage[]): PageTreeNode[] {
  // Create lookup map
  const pageMap = new Map<string, PageTreeNode>()
  const rootNodes: PageTreeNode[] = []
  
  // First pass: create all nodes
  pages.forEach(page => {
    const node: PageTreeNode = {
      id: page.id,
      title: page.title,
      slug: page.slug,
      status: page.status,
      sortOrder: page.sortOrder || 0,
      children: [],
      parentId: typeof page.parentPage === 'string' ? page.parentPage : null,
    }
    pageMap.set(page.id, node)
  })
  
  // Second pass: build hierarchy
  pageMap.forEach(node => {
    if (node.parentId && pageMap.has(node.parentId)) {
      const parent = pageMap.get(node.parentId)!
      parent.children.push(node)
    } else {
      rootNodes.push(node)
    }
  })
  
  // Sort nodes at each level by sortOrder
  const sortNodes = (nodes: PageTreeNode[]) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder)
    nodes.forEach(node => {
      if (node.children.length > 0) {
        sortNodes(node.children)
      }
    })
  }
  
  sortNodes(rootNodes)
  
  return rootNodes
}

export function findPagePath(
  tree: PageTreeNode[],
  targetId: string,
  path: string[] = []
): string[] | null {
  for (const node of tree) {
    const currentPath = [...path, node.id]
    
    if (node.id === targetId) {
      return currentPath
    }
    
    if (node.children.length > 0) {
      const found = findPagePath(node.children, targetId, currentPath)
      if (found) return found
    }
  }
  
  return null
}
```

**PageTreeNode Component:**
```typescript
'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ChevronRight, FileText, Folder } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import type { PageTreeNodeProps } from './types'

export function PageTreeNode({
  node,
  currentPageId,
  depth,
  onPageSelect,
}: PageTreeNodeProps) {
  const hasChildren = node.children.length > 0
  const isCurrentPage = node.id === currentPageId
  const [isOpen, setIsOpen] = useState(false)
  
  // Auto-expand if this node is in the path to current page
  useEffect(() => {
    if (isCurrentPage || node.children.some(child => child.id === currentPageId)) {
      setIsOpen(true)
    }
  }, [currentPageId, isCurrentPage, node.children])
  
  const handleClick = (e: React.MouseEvent) => {
    if (onPageSelect) {
      e.preventDefault()
      onPageSelect(node.id)
    }
  }
  
  const content = (
    <div
      className={cn(
        'flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-accent transition-colors',
        isCurrentPage && 'bg-accent font-medium',
        node.status === 'draft' && 'text-muted-foreground italic'
      )}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      {hasChildren ? (
        <Folder className="h-4 w-4 shrink-0" />
      ) : (
        <FileText className="h-4 w-4 shrink-0" />
      )}
      <span className="truncate flex-1">{node.title}</span>
      {node.status === 'draft' && (
        <span className="text-xs text-muted-foreground">(draft)</span>
      )}
    </div>
  )
  
  if (!hasChildren) {
    return (
      <Link
        href={`#page-${node.id}`}
        onClick={handleClick}
        className="block"
      >
        {content}
      </Link>
    )
  }
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="space-y-1">
        <div className="flex items-center">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              style={{ marginLeft: `${depth * 12}px` }}
            >
              <ChevronRight
                className={cn(
                  'h-4 w-4 transition-transform',
                  isOpen && 'rotate-90'
                )}
              />
            </Button>
          </CollapsibleTrigger>
          <Link
            href={`#page-${node.id}`}
            onClick={handleClick}
            className="flex-1"
          >
            {content}
          </Link>
        </div>
        <CollapsibleContent>
          <div className="space-y-1">
            {node.children.map(child => (
              <PageTreeNode
                key={child.id}
                node={child}
                currentPageId={currentPageId}
                depth={depth + 1}
                onPageSelect={onPageSelect}
              />
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
```

**SpaceNavigator Component:**
```typescript
'use client'

import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { Plus, Search } from 'lucide-react'
import { PageTreeNode } from './PageTreeNode'
import { buildPageTree } from '@/lib/knowledge/tree-builder'
import type { SpaceNavigatorProps } from './types'

export function SpaceNavigator({
  knowledgeSpace,
  pages,
  currentPageId,
  onPageSelect,
}: SpaceNavigatorProps) {
  const tree = useMemo(() => buildPageTree(pages), [pages])
  
  const publishedPages = pages.filter(p => p.status === 'published').length
  const draftPages = pages.filter(p => p.status === 'draft').length
  
  return (
    <Card className="w-full h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{knowledgeSpace.name}</CardTitle>
          <Button size="sm" variant="ghost">
            <Search className="h-4 w-4" />
          </Button>
        </div>
        {knowledgeSpace.description && (
          <p className="text-sm text-muted-foreground mt-1">
            {knowledgeSpace.description}
          </p>
        )}
      </CardHeader>
      
      <Separator />
      
      <CardContent className="flex-1 overflow-auto py-4">
        {tree.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <FileText className="h-12 w-12 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground mb-4">
              No pages yet. Create your first page to get started.
            </p>
            <Button size="sm">
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
                onPageSelect={onPageSelect}
              />
            ))}
          </div>
        )}
      </CardContent>
      
      <Separator />
      
      <div className="p-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{publishedPages} published</span>
          <span>{draftPages} drafts</span>
        </div>
      </div>
    </Card>
  )
}
```

### Dependencies
- Depends on: Phase 2 (KnowledgePages collection)
- Blocks: Frontend display routes (needs navigator for layout)

### Success Criteria

#### Automated Verification
- [x] TypeScript compilation succeeds: All files compile without errors
- [x] Linting passes: `make lint`
- [ ] Component renders in Storybook (if configured)

#### Manual Verification
- [ ] Tree displays hierarchical structure correctly
- [ ] Clicking page node highlights it as current
- [ ] Collapsible sections expand/collapse on chevron click
- [ ] Current page's path auto-expands on load
- [ ] Draft pages show italic text and "(draft)" badge
- [ ] Empty state shows when no pages exist
- [ ] Stats footer shows correct published/draft counts

### Rollback Plan
Delete `src/components/features/knowledge/` directory, remove any imports.

---

## Phase 4: Payload Admin Integration ✅

### Overview
Add custom views in Payload admin UI to manage knowledge spaces and pages within workspace context.

### Prerequisites
- [x] Phase 1 completed (KnowledgeSpaces collection)
- [x] Phase 2 completed (KnowledgePages collection)
- [x] Phase 3 completed (SpaceNavigator component)

### Changes Required

#### 1. Add Custom Workspace View for Knowledge

**Files to Create:**
- `orbit-www/src/app/(payload)/admin/collections/workspaces/[id]/knowledge/page.tsx` - Knowledge management view

**Custom Admin View:**
```typescript
import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPayloadHMR } from '@payloadcms/next/utilities'
import configPromise from '@payload-config'
import { SpaceNavigator } from '@/components/features/knowledge/SpaceNavigator'

export const metadata: Metadata = {
  title: 'Knowledge Management',
}

interface PageProps {
  params: {
    id: string
  }
}

export default async function WorkspaceKnowledgePage({ params }: PageProps) {
  const payload = await getPayloadHMR({ config: configPromise })
  
  // Fetch workspace
  const workspace = await payload.findByID({
    collection: 'workspaces',
    id: params.id,
  })
  
  if (!workspace) {
    notFound()
  }
  
  // Fetch knowledge spaces for this workspace
  const spaces = await payload.find({
    collection: 'knowledge-spaces',
    where: {
      workspace: { equals: workspace.id }
    },
    limit: 100,
  })
  
  // If no spaces, show empty state
  if (spaces.docs.length === 0) {
    return (
      <div className="container mx-auto py-8">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-3xl font-bold mb-4">Knowledge Management</h1>
          <p className="text-muted-foreground mb-8">
            Create knowledge spaces to organize documentation, guides, and team information.
          </p>
          <a
            href={`/admin/collections/knowledge-spaces/create?workspace=${workspace.id}`}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
          >
            Create Knowledge Space
          </a>
        </div>
      </div>
    )
  }
  
  // Default to first space
  const defaultSpace = spaces.docs[0]
  
  // Fetch pages for default space
  const pages = await payload.find({
    collection: 'knowledge-pages',
    where: {
      knowledgeSpace: { equals: defaultSpace.id }
    },
    limit: 1000,
    sort: 'sortOrder',
  })
  
  return (
    <div className="container mx-auto py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Knowledge Management</h1>
        <p className="text-muted-foreground">
          Manage documentation and guides for {workspace.name}
        </p>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
        <aside className="lg:sticky lg:top-6 lg:h-[calc(100vh-8rem)]">
          <SpaceNavigator
            knowledgeSpace={defaultSpace}
            pages={pages.docs}
          />
        </aside>
        
        <main className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-semibold">{defaultSpace.name}</h2>
            <div className="flex gap-2">
              <a
                href={`/admin/collections/knowledge-pages/create?knowledgeSpace=${defaultSpace.id}`}
                className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-4 py-2"
              >
                New Page
              </a>
              <a
                href={`/admin/collections/knowledge-spaces/${defaultSpace.id}`}
                className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-4 py-2"
              >
                Settings
              </a>
            </div>
          </div>
          
          {pages.docs.length === 0 ? (
            <div className="border rounded-lg p-12 text-center">
              <p className="text-muted-foreground mb-4">
                No pages yet. Create your first page to get started.
              </p>
              <a
                href={`/admin/collections/knowledge-pages/create?knowledgeSpace=${defaultSpace.id}`}
                className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
              >
                Create First Page
              </a>
            </div>
          ) : (
            <div className="space-y-4">
              {pages.docs.filter(p => !p.parentPage).map(page => (
                <a
                  key={page.id}
                  href={`/admin/collections/knowledge-pages/${page.id}`}
                  className="block border rounded-lg p-4 hover:border-primary transition-colors"
                >
                  <h3 className="font-semibold mb-1">{page.title}</h3>
                  <p className="text-sm text-muted-foreground">
                    Last edited {new Date(page.updatedAt).toLocaleDateString()}
                  </p>
                </a>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
```

#### 2. Add Navigation Link in Workspace Admin

**Files to Modify:**
- `orbit-www/src/collections/Workspaces.ts` - Add custom admin navigation

**Update Workspaces Collection:**
```typescript
export const Workspaces: CollectionConfig = {
  slug: 'workspaces',
  admin: {
    // ... existing config
    components: {
      views: {
        Edit: {
          Default: {
            // Add tab for knowledge management
            actions: [
              {
                path: '/knowledge',
                label: 'Knowledge',
                Component: '@/app/(payload)/admin/collections/workspaces/[id]/knowledge/page',
              },
            ],
          },
        },
      },
    },
  },
  // ... rest of config
}
```

### Dependencies
- Depends on: Phase 3 (SpaceNavigator component)
- Blocks: None (Payload admin is fully functional at this point)

### Success Criteria

#### Automated Verification
- [x] Build succeeds: No compilation errors
- [x] No TypeScript errors: All types resolved correctly
- [x] Linting passes: No new errors introduced

#### Manual Verification
- [ ] Navigate to workspace in Payload admin
- [ ] "Knowledge" tab appears in workspace edit view
- [ ] Click tab shows knowledge management interface
- [ ] "Create Knowledge Space" button works when none exist
- [ ] SpaceNavigator displays when spaces exist
- [ ] "New Page" button navigates to page creation with space pre-filled
- [ ] Can create, edit, delete pages through Payload admin

### Rollback Plan
Remove custom view from Workspaces collection config, delete custom admin page.

---

## Phase 5: Frontend Display Routes

### Overview
Create public-facing routes to display knowledge spaces and pages with SpaceNavigator layout.

### Prerequisites
- [x] Phase 3 completed (SpaceNavigator component)
- [ ] Phase 4 completed (Payload admin integration)

### Changes Required

#### 1. Create Knowledge Space Routes

**Files to Create:**
- `orbit-www/src/app/(frontend)/workspaces/[workspaceSlug]/knowledge/[spaceSlug]/page.tsx` - Space landing page
- `orbit-www/src/app/(frontend)/workspaces/[workspaceSlug]/knowledge/[spaceSlug]/[pageSlug]/page.tsx` - Individual page view
- `orbit-www/src/app/(frontend)/workspaces/[workspaceSlug]/knowledge/[spaceSlug]/layout.tsx` - Layout with SpaceNavigator

**Layout with Navigator:**
```typescript
import { notFound } from 'next/navigation'
import { getPayloadHMR } from '@payloadcms/next/utilities'
import configPromise from '@payload-config'
import { SpaceNavigator } from '@/components/features/knowledge/SpaceNavigator'

interface LayoutProps {
  children: React.ReactNode
  params: {
    workspaceSlug: string
    spaceSlug: string
  }
}

export default async function KnowledgeSpaceLayout({
  children,
  params,
}: LayoutProps) {
  const payload = await getPayloadHMR({ config: configPromise })
  
  // Fetch workspace
  const workspaceResult = await payload.find({
    collection: 'workspaces',
    where: { slug: { equals: params.workspaceSlug } },
    limit: 1,
  })
  
  const workspace = workspaceResult.docs[0]
  if (!workspace) notFound()
  
  // Fetch knowledge space
  const spaceResult = await payload.find({
    collection: 'knowledge-spaces',
    where: {
      and: [
        { workspace: { equals: workspace.id } },
        { slug: { equals: params.spaceSlug } },
      ],
    },
    limit: 1,
  })
  
  const space = spaceResult.docs[0]
  if (!space) notFound()
  
  // Fetch all published pages for navigation
  const pages = await payload.find({
    collection: 'knowledge-pages',
    where: {
      and: [
        { knowledgeSpace: { equals: space.id } },
        { status: { equals: 'published' } },
      ],
    },
    limit: 1000,
    sort: 'sortOrder',
  })
  
  return (
    <div className="container mx-auto py-8">
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-8">
        <aside className="lg:sticky lg:top-20 lg:h-[calc(100vh-8rem)]">
          <SpaceNavigator
            knowledgeSpace={space}
            pages={pages.docs}
          />
        </aside>
        <main className="min-w-0">
          {children}
        </main>
      </div>
    </div>
  )
}
```

**Space Landing Page:**
```typescript
import { notFound } from 'next/navigation'
import { getPayloadHMR } from '@payloadcms/next/utilities'
import configPromise from '@payload-config'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FileText } from 'lucide-react'
import Link from 'next/link'

interface PageProps {
  params: {
    workspaceSlug: string
    spaceSlug: string
  }
}

export default async function KnowledgeSpacePage({ params }: PageProps) {
  const payload = await getPayloadHMR({ config: configPromise })
  
  // Fetch workspace
  const workspaceResult = await payload.find({
    collection: 'workspaces',
    where: { slug: { equals: params.workspaceSlug } },
    limit: 1,
  })
  
  const workspace = workspaceResult.docs[0]
  if (!workspace) notFound()
  
  // Fetch knowledge space
  const spaceResult = await payload.find({
    collection: 'knowledge-spaces',
    where: {
      and: [
        { workspace: { equals: workspace.id } },
        { slug: { equals: params.spaceSlug } },
      ],
    },
    limit: 1,
  })
  
  const space = spaceResult.docs[0]
  if (!space) notFound()
  
  // Fetch root-level published pages
  const pages = await payload.find({
    collection: 'knowledge-pages',
    where: {
      and: [
        { knowledgeSpace: { equals: space.id } },
        { status: { equals: 'published' } },
        { parentPage: { exists: false } },
      ],
    },
    limit: 100,
    sort: 'sortOrder',
  })
  
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold mb-2">{space.name}</h1>
        {space.description && (
          <p className="text-lg text-muted-foreground">{space.description}</p>
        )}
      </div>
      
      {pages.docs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              No pages published yet.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {pages.docs.map(page => (
            <Link
              key={page.id}
              href={`/workspaces/${params.workspaceSlug}/knowledge/${params.spaceSlug}/${page.slug}`}
            >
              <Card className="h-full hover:border-primary transition-colors cursor-pointer">
                <CardHeader>
                  <CardTitle className="flex items-start gap-2">
                    <FileText className="h-5 w-5 mt-0.5 shrink-0" />
                    {page.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Last updated {new Date(page.updatedAt).toLocaleDateString()}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
```

**Individual Page View:**
```typescript
import { notFound } from 'next/navigation'
import { getPayloadHMR } from '@payloadcms/next/utilities'
import configPromise from '@payload-config'
import { serializeLexical } from '@/lib/lexical/serialize'
import { Separator } from '@/components/ui/separator'
import { User, Calendar } from 'lucide-react'

interface PageProps {
  params: {
    workspaceSlug: string
    spaceSlug: string
    pageSlug: string
  }
}

export default async function KnowledgePageView({ params }: PageProps) {
  const payload = await getPayloadHMR({ config: configPromise })
  
  // Fetch workspace
  const workspaceResult = await payload.find({
    collection: 'workspaces',
    where: { slug: { equals: params.workspaceSlug } },
    limit: 1,
  })
  
  const workspace = workspaceResult.docs[0]
  if (!workspace) notFound()
  
  // Fetch knowledge space
  const spaceResult = await payload.find({
    collection: 'knowledge-spaces',
    where: {
      and: [
        { workspace: { equals: workspace.id } },
        { slug: { equals: params.spaceSlug } },
      ],
    },
    limit: 1,
  })
  
  const space = spaceResult.docs[0]
  if (!space) notFound()
  
  // Fetch page
  const pageResult = await payload.find({
    collection: 'knowledge-pages',
    where: {
      and: [
        { knowledgeSpace: { equals: space.id } },
        { slug: { equals: params.pageSlug } },
        { status: { equals: 'published' } },
      ],
    },
    depth: 2,
    limit: 1,
  })
  
  const page = pageResult.docs[0]
  if (!page) notFound()
  
  const author = typeof page.author === 'object' ? page.author : null
  
  return (
    <article className="space-y-6">
      <div>
        <h1 className="text-4xl font-bold mb-4">{page.title}</h1>
        
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          {author && (
            <div className="flex items-center gap-1">
              <User className="h-4 w-4" />
              <span>{author.name || author.email}</span>
            </div>
          )}
          <div className="flex items-center gap-1">
            <Calendar className="h-4 w-4" />
            <span>Updated {new Date(page.updatedAt).toLocaleDateString()}</span>
          </div>
          <span>Version {page.version}</span>
        </div>
      </div>
      
      <Separator />
      
      <div className="prose prose-slate dark:prose-invert max-w-none">
        {serializeLexical(page.content)}
      </div>
      
      {page.tags && page.tags.length > 0 && (
        <>
          <Separator />
          <div className="flex gap-2 flex-wrap">
            {page.tags.map((tagObj, idx) => (
              <span
                key={idx}
                className="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium bg-secondary text-secondary-foreground"
              >
                {tagObj.tag}
              </span>
            ))}
          </div>
        </>
      )}
    </article>
  )
}
```

#### 2. Create Lexical Serializer

**Files to Create:**
- `orbit-www/src/lib/lexical/serialize.tsx` - Convert Lexical JSON to React components

**Serializer Implementation:**
```typescript
import React from 'react'

// Basic serializer - expand based on Lexical node types used
export function serializeLexical(content: any): React.ReactNode {
  if (!content || !content.root || !content.root.children) {
    return null
  }
  
  return serializeChildren(content.root.children)
}

function serializeChildren(children: any[]): React.ReactNode {
  return children.map((node, index) => serializeNode(node, index))
}

function serializeNode(node: any, index: number): React.ReactNode {
  switch (node.type) {
    case 'paragraph':
      return (
        <p key={index}>
          {node.children && serializeChildren(node.children)}
        </p>
      )
    
    case 'heading':
      const Tag = `h${node.tag}` as keyof JSX.IntrinsicElements
      return (
        <Tag key={index}>
          {node.children && serializeChildren(node.children)}
        </Tag>
      )
    
    case 'text':
      let text = <>{node.text}</>
      
      if (node.format & 1) { // Bold
        text = <strong>{text}</strong>
      }
      if (node.format & 2) { // Italic
        text = <em>{text}</em>
      }
      if (node.format & 8) { // Code
        text = <code>{text}</code>
      }
      
      return <React.Fragment key={index}>{text}</React.Fragment>
    
    case 'list':
      const ListTag = node.listType === 'number' ? 'ol' : 'ul'
      return (
        <ListTag key={index}>
          {node.children && serializeChildren(node.children)}
        </ListTag>
      )
    
    case 'listitem':
      return (
        <li key={index}>
          {node.children && serializeChildren(node.children)}
        </li>
      )
    
    case 'link':
      return (
        <a key={index} href={node.url} target={node.target || '_self'}>
          {node.children && serializeChildren(node.children)}
        </a>
      )
    
    case 'code':
      return (
        <pre key={index}>
          <code>{node.children && serializeChildren(node.children)}</code>
        </pre>
      )
    
    default:
      return null
  }
}
```

### Dependencies
- Depends on: Phase 3 (SpaceNavigator component)
- Blocks: None (feature complete)

### Success Criteria

#### Automated Verification
- [ ] Build succeeds: `cd orbit-www && bun run build`
- [ ] TypeScript check passes: `cd orbit-www && bun run type-check`
- [ ] E2E tests pass (if configured): `cd orbit-www && bun run test:e2e`

#### Manual Verification
- [ ] Navigate to `/workspaces/[slug]/knowledge/[space-slug]` shows space landing
- [ ] SpaceNavigator appears in sidebar with page tree
- [ ] Click page in navigator navigates to page view
- [ ] Page content renders with proper formatting from Lexical editor
- [ ] Current page highlights in navigator
- [ ] Breadcrumb navigation works
- [ ] Only published pages visible to non-authors
- [ ] Draft pages not accessible via direct URL (404)

### Rollback Plan
Delete `app/(frontend)/workspaces/[workspaceSlug]/knowledge/` directory.

---

## Testing Strategy

### Unit Tests
**Location**: `orbit-www/src/components/features/knowledge/__tests__/`

**Tests to Write**:
1. `SpaceNavigator.test.tsx` - Component rendering, page selection, tree expansion
2. `PageTreeNode.test.tsx` - Node rendering, current page highlighting, collapse state
3. `tree-builder.test.ts` - Tree construction, sorting, path finding algorithms

**Example Test**:
```typescript
import { describe, it, expect } from 'vitest'
import { buildPageTree, findPagePath } from '@/lib/knowledge/tree-builder'
import type { KnowledgePage } from '@/payload-types'

describe('buildPageTree', () => {
  it('should build correct hierarchy from flat page list', () => {
    const pages: KnowledgePage[] = [
      { id: '1', title: 'Root', slug: 'root', parentPage: null, sortOrder: 0 },
      { id: '2', title: 'Child 1', slug: 'child-1', parentPage: '1', sortOrder: 1 },
      { id: '3', title: 'Child 2', slug: 'child-2', parentPage: '1', sortOrder: 2 },
      { id: '4', title: 'Grandchild', slug: 'grandchild', parentPage: '2', sortOrder: 0 },
    ] as KnowledgePage[]
    
    const tree = buildPageTree(pages)
    
    expect(tree).toHaveLength(1)
    expect(tree[0].id).toBe('1')
    expect(tree[0].children).toHaveLength(2)
    expect(tree[0].children[0].children).toHaveLength(1)
  })
  
  it('should sort nodes by sortOrder', () => {
    const pages: KnowledgePage[] = [
      { id: '1', title: 'Third', slug: 'third', parentPage: null, sortOrder: 3 },
      { id: '2', title: 'First', slug: 'first', parentPage: null, sortOrder: 1 },
      { id: '3', title: 'Second', slug: 'second', parentPage: null, sortOrder: 2 },
    ] as KnowledgePage[]
    
    const tree = buildPageTree(pages)
    
    expect(tree[0].title).toBe('First')
    expect(tree[1].title).toBe('Second')
    expect(tree[2].title).toBe('Third')
  })
})

describe('findPagePath', () => {
  it('should find path to nested page', () => {
    const tree = buildPageTree([
      { id: '1', title: 'Root', slug: 'root', parentPage: null, sortOrder: 0 },
      { id: '2', title: 'Child', slug: 'child', parentPage: '1', sortOrder: 0 },
      { id: '3', title: 'Grandchild', slug: 'grandchild', parentPage: '2', sortOrder: 0 },
    ] as KnowledgePage[])
    
    const path = findPagePath(tree, '3')
    
    expect(path).toEqual(['1', '2', '3'])
  })
})
```

### Integration Tests
**Location**: `orbit-www/tests/int/`

**Update**: `knowledge-base.int.spec.ts`

**Tests to Write**:
1. Create knowledge space within workspace
2. Create root page in space
3. Create child page with parent relationship
4. Prevent circular reference (A→B→A)
5. Prevent self-reference (A→A)
6. Query pages by space
7. Query pages by hierarchy level
8. Update page parent and verify bidirectional sync
9. Delete page and verify children orphaned or deleted
10. Access control: non-members cannot read space

**Example Test**:
```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

describe('Knowledge Management Integration', () => {
  let payload: any
  let workspace: any
  let user: any
  
  beforeAll(async () => {
    payload = await getPayload({ config: configPromise })
    
    // Create test user
    user = await payload.create({
      collection: 'users',
      data: {
        email: 'test@example.com',
        password: 'password123',
      },
    })
    
    // Create test workspace
    workspace = await payload.create({
      collection: 'workspaces',
      data: {
        name: 'Test Workspace',
        slug: 'test-workspace',
      },
    })
  })
  
  it('should create knowledge space in workspace', async () => {
    const space = await payload.create({
      collection: 'knowledge-spaces',
      data: {
        workspace: workspace.id,
        name: 'Engineering Docs',
        slug: 'engineering-docs',
        description: 'Technical documentation',
        visibility: 'internal',
      },
    })
    
    expect(space).toBeDefined()
    expect(space.workspace).toBe(workspace.id)
    expect(space.slug).toBe('engineering-docs')
  })
  
  it('should create root page without parent', async () => {
    const space = await payload.create({
      collection: 'knowledge-spaces',
      data: {
        workspace: workspace.id,
        name: 'Test Space',
        slug: 'test-space',
      },
    })
    
    const page = await payload.create({
      collection: 'knowledge-pages',
      data: {
        knowledgeSpace: space.id,
        title: 'Getting Started',
        slug: 'getting-started',
        content: {
          root: {
            type: 'root',
            children: [
              {
                type: 'paragraph',
                children: [
                  { type: 'text', text: 'Welcome to our docs!' },
                ],
              },
            ],
          },
        },
        status: 'published',
        author: user.id,
      },
    })
    
    expect(page).toBeDefined()
    expect(page.parentPage).toBeNull()
    expect(page.childPages).toEqual([])
  })
  
  it('should create child page with parent relationship', async () => {
    const space = await payload.create({
      collection: 'knowledge-spaces',
      data: {
        workspace: workspace.id,
        name: 'Test Space 2',
        slug: 'test-space-2',
      },
    })
    
    const parentPage = await payload.create({
      collection: 'knowledge-pages',
      data: {
        knowledgeSpace: space.id,
        title: 'Parent Page',
        slug: 'parent-page',
        content: { root: { type: 'root', children: [] } },
        status: 'published',
        author: user.id,
      },
    })
    
    const childPage = await payload.create({
      collection: 'knowledge-pages',
      data: {
        knowledgeSpace: space.id,
        title: 'Child Page',
        slug: 'child-page',
        content: { root: { type: 'root', children: [] } },
        parentPage: parentPage.id,
        status: 'published',
        author: user.id,
      },
    })
    
    expect(childPage.parentPage).toBe(parentPage.id)
    
    // Verify bidirectional sync
    const updatedParent = await payload.findByID({
      collection: 'knowledge-pages',
      id: parentPage.id,
    })
    
    expect(updatedParent.childPages).toContain(childPage.id)
  })
  
  it('should prevent circular reference', async () => {
    const space = await payload.create({
      collection: 'knowledge-spaces',
      data: {
        workspace: workspace.id,
        name: 'Test Space 3',
        slug: 'test-space-3',
      },
    })
    
    const pageA = await payload.create({
      collection: 'knowledge-pages',
      data: {
        knowledgeSpace: space.id,
        title: 'Page A',
        slug: 'page-a',
        content: { root: { type: 'root', children: [] } },
        status: 'published',
        author: user.id,
      },
    })
    
    const pageB = await payload.create({
      collection: 'knowledge-pages',
      data: {
        knowledgeSpace: space.id,
        title: 'Page B',
        slug: 'page-b',
        content: { root: { type: 'root', children: [] } },
        parentPage: pageA.id,
        status: 'published',
        author: user.id,
      },
    })
    
    // Attempt to create circular reference: A → B → A
    await expect(
      payload.update({
        collection: 'knowledge-pages',
        id: pageA.id,
        data: {
          parentPage: pageB.id,
        },
      })
    ).rejects.toThrow(/circular reference/i)
  })
  
  it('should prevent self-reference', async () => {
    const space = await payload.create({
      collection: 'knowledge-spaces',
      data: {
        workspace: workspace.id,
        name: 'Test Space 4',
        slug: 'test-space-4',
      },
    })
    
    const page = await payload.create({
      collection: 'knowledge-pages',
      data: {
        knowledgeSpace: space.id,
        title: 'Page',
        slug: 'page',
        content: { root: { type: 'root', children: [] } },
        status: 'published',
        author: user.id,
      },
    })
    
    await expect(
      payload.update({
        collection: 'knowledge-pages',
        id: page.id,
        data: {
          parentPage: page.id,
        },
      })
    ).rejects.toThrow(/cannot be its own parent/i)
  })
})
```

### Manual Testing Checklist
- [ ] Create workspace
- [ ] Create knowledge space in workspace
- [ ] Create root page with Lexical content (headings, lists, bold, italic)
- [ ] Create child page
- [ ] Create grandchild page (3 levels deep)
- [ ] Verify SpaceNavigator shows correct tree structure
- [ ] Click page in navigator → navigates to page view
- [ ] Edit page content → verify version increments
- [ ] Change page parent → verify both old and new parent's children update
- [ ] Attempt circular reference → error message shown
- [ ] Create 21st level page → error about max depth
- [ ] Publish page → visible in frontend
- [ ] Keep page as draft → not visible in frontend
- [ ] Delete page with children → verify children behavior (orphaned or deleted)
- [ ] Non-workspace member → cannot see space or pages

---

## Database Changes

### New Collections
1. **knowledge-spaces**
   - Fields: workspace (relationship), name, slug, description, icon, color, visibility
   - Indexes: workspace, slug (unique)
   - Relationships: Many-to-one with workspaces

2. **knowledge-pages**
   - Fields: knowledgeSpace (relationship), title, slug, content (richText), parentPage (self-ref), childPages (self-ref array), sortOrder, status, tags, author, lastEditedBy, version
   - Indexes: (knowledgeSpace, slug) composite unique, parentPage
   - Relationships: Many-to-one with knowledge-spaces, self-referential parent-child, many-to-one with users (author, lastEditedBy)

### Migrations
No explicit migrations needed - Payload handles collection schema changes automatically. On first deployment:
1. Collections will be created in MongoDB
2. Indexes will be built automatically
3. Existing workspaces unaffected

### Data Considerations
- **Space usage**: Each page stores Lexical JSON (~1-50KB per page depending on content)
- **Indexing**: Composite unique index on (knowledgeSpace, slug) ensures slug uniqueness per space
- **Relationships**: Circular reference prevention in hooks prevents infinite loops
- **Access control**: Query-level access control filters based on workspace membership

---

## API Changes

### Payload Collections API
All operations through Payload's built-in REST/GraphQL APIs:

**Knowledge Spaces:**
- `GET /api/knowledge-spaces` - List spaces (filtered by user's workspaces)
- `GET /api/knowledge-spaces/:id` - Get single space
- `POST /api/knowledge-spaces` - Create space (requires workspace membership)
- `PATCH /api/knowledge-spaces/:id` - Update space (requires admin role)
- `DELETE /api/knowledge-spaces/:id` - Delete space (requires owner role)

**Knowledge Pages:**
- `GET /api/knowledge-pages` - List pages (filtered by accessible spaces)
- `GET /api/knowledge-pages/:id` - Get single page with content
- `POST /api/knowledge-pages` - Create page (requires workspace membership)
- `PATCH /api/knowledge-pages/:id` - Update page (author or admin)
- `DELETE /api/knowledge-pages/:id` - Delete page (author or admin)

### Query Parameters
```
GET /api/knowledge-pages?where[knowledgeSpace][equals]=<spaceId>
GET /api/knowledge-pages?where[parentPage][exists]=false  // Root pages only
GET /api/knowledge-pages?where[status][equals]=published
GET /api/knowledge-pages?sort=sortOrder
```

### No gRPC Service Initially
Feature is Payload-only initially. gRPC service can be added in future phase by:
1. Implementing knowledge.proto contracts
2. Syncing between Payload collections and gRPC service
3. Using gRPC for cross-service access (e.g., from CLI tools)

---

## Security & Access Control

### Authentication
- All Payload collections require authentication (user must be logged in)
- Session-based auth via Payload's built-in system
- No anonymous access to admin UI

### Authorization

**Knowledge Spaces:**
- **Read**: Workspace members (any role, active status)
- **Create**: Any authenticated user (workspace validated on save)
- **Update**: Workspace admins or owners only
- **Delete**: Workspace owners only

**Knowledge Pages:**
- **Read**: Workspace members (through space relationship)
- **Create**: Workspace members
- **Update**: Original author OR workspace admins/owners
- **Delete**: Original author OR workspace admins/owners

**Frontend Display:**
- Only published pages visible
- Draft/archived pages accessible only in Payload admin by authors/admins
- Access control enforced at query level (user cannot bypass via direct URL)

### Data Isolation
- Knowledge spaces scoped to single workspace (enforced via required relationship)
- Pages scoped to single knowledge space (enforced via required relationship)
- Cross-workspace access not possible without explicit sharing (future feature)

### Audit Trail
- `author` field tracks original creator
- `lastEditedBy` tracks most recent editor
- `version` increments on each update
- Payload's built-in `createdAt` and `updatedAt` timestamps

---

## Performance Considerations

### Query Optimization
- Index on `(knowledgeSpace, slug)` for fast page lookup
- Index on `parentPage` for efficient hierarchy queries
- Limit page fetches to 1000 per query (reasonable max for navigation tree)
- Use `depth: 0` in bidirectional sync to avoid over-fetching

### Caching Strategy
- Next.js caches static page renders
- SpaceNavigator tree built once per request (memoized in component)
- Consider Redis caching for frequently accessed spaces (future)

### Scalability Limits
- Max hierarchy depth: 20 levels (reasonable for documentation)
- Max pages per space: Unlimited, but navigation tree performance degrades after ~5000 pages
- Max spaces per workspace: Unlimited

### Monitoring
- Track average page load time
- Monitor Payload API response times
- Alert on circular reference validation failures (indicates potential infinite loops)

---

## Deployment Plan

### Phase 1 Deployment
1. Merge feature branch to main
2. Regenerate types: `bun run generate:types`
3. Build: `bun run build`
4. Deploy to staging environment
5. Run integration tests against staging
6. Manual smoke testing (create space, pages, verify navigation)
7. Deploy to production

### Environment Variables
No new environment variables required - uses existing Payload config.

### Database Migrations
None required - Payload handles schema creation automatically.

### Rollback Strategy
If critical issues discovered post-deployment:
1. Revert git commit
2. Rebuild and redeploy
3. Collections will remain in database but be inaccessible (no data loss)
4. Can manually remove collections via MongoDB if needed

### Post-Deployment Verification
- [ ] Payload admin loads without errors
- [ ] Can create knowledge space
- [ ] Can create knowledge page
- [ ] SpaceNavigator renders correctly
- [ ] Frontend routes work
- [ ] No console errors in browser
- [ ] No server errors in logs

---

## Future Enhancements (Out of Scope)

### Phase 6: Advanced Features (Future)
- Full-text search across knowledge spaces using MongoDB text indexes
- Page templates for common documentation types (API reference, how-to, troubleshooting)
- Version history with rollback capability
- Drag-and-drop page reordering in navigator
- Collaborative editing indicators (who's viewing/editing)
- Comments and discussions on pages
- Page analytics (views, time on page, popular pages)
- Export to PDF/Markdown
- Import from Confluence/Notion/GitHub Wiki

### Phase 7: gRPC Service Integration (Future)
- Implement knowledge.proto contracts
- Sync Payload collections to gRPC service
- Enable cross-service access from CLI tools
- Add caching layer (Redis) for performance

### Phase 8: AI Features (Future)
- AI-powered content suggestions
- Automatic tagging based on content
- Smart search with semantic understanding
- Auto-generate documentation from code

---

## Success Metrics

### Technical Metrics
- Zero circular reference bugs in production
- Page load time < 200ms for tree navigation
- 100% test coverage for hierarchy validation logic
- No N+1 query issues in page fetching

### User Metrics
- Workspace admins can create knowledge spaces without errors
- Authors can create nested pages up to 20 levels
- Team members can navigate documentation intuitively
- Search queries return results in < 500ms (when implemented)

### Business Metrics
- 80% of workspaces create at least one knowledge space within first month
- Average 10+ pages per active knowledge space
- 50% of team members view knowledge pages weekly
- Reduced Slack/email questions about team processes (qualitative)

---

## References

### Documentation
- [Payload CMS Collections](https://payloadcms.com/docs/configuration/collections)
- [Payload Rich Text (Lexical)](https://payloadcms.com/docs/rich-text/lexical)
- [Payload Access Control](https://payloadcms.com/docs/access-control/overview)
- [Payload Hooks](https://payloadcms.com/docs/hooks/overview)
- [Next.js 15 App Router](https://nextjs.org/docs/app)

### Related Tasks
- [.agent/tasks/feature-workspace-management.md](.agent/tasks/feature-workspace-management.md) - Workspace hierarchy pattern reference
- T022 - Knowledge base foundation (integration test)

### Code References
- `orbit-www/src/collections/Workspaces.ts:117-417` - Hierarchy validation and sync hooks
- `orbit-www/WORKSPACE_HIERARCHY.md` - Detailed documentation of hierarchy implementation
- `specs/001-internal-developer-portal/contracts/knowledge.proto` - gRPC contracts (future)
- `specs/001-internal-developer-portal/data-model.md` - Data model specification

---

## Confidence Assessment

**Overall Confidence**: 98%

**High Confidence Areas** (100%):
- Payload collection definitions (proven pattern from Workspaces)
- Hierarchy validation logic (reusing tested Workspaces pattern)
- Access control implementation (standard Payload patterns)
- SpaceNavigator component structure (standard React patterns)

**Medium Confidence Areas** (95%):
- Lexical content serialization (may need refinement for all node types)
- Frontend route structure (standard Next.js but needs testing)

**Potential Risks**:
- Performance with very large page trees (>1000 pages) - may need pagination
- Lexical editor customization may be needed for specific content types
- Bidirectional sync could have edge cases not covered in tests

**Mitigation**:
- Start with comprehensive integration tests (Phase 2)
- Manual testing with realistic page hierarchies
- Monitor performance in staging before production deployment
- Iterative refinement based on user feedback

---

## Implementation Checklist

Use this checklist to track progress:

### Phase 1: KnowledgeSpaces Collection
- [x] Create `src/collections/KnowledgeSpaces.ts`
- [x] Update `payload.config.ts`
- [x] Regenerate types
- [ ] Test in Payload admin
- [ ] Verify access control

### Phase 2: KnowledgePages Collection
- [x] Create `src/collections/KnowledgePages.ts`
- [x] Update `payload.config.ts`
- [x] Regenerate types
- [ ] Write integration tests
- [ ] Run tests and verify all pass

### Phase 3: SpaceNavigator Component
- [x] Create `src/components/features/knowledge/types.ts`
- [x] Create `src/lib/knowledge/tree-builder.ts`
- [ ] Write unit tests for tree builder
- [x] Create `src/components/features/knowledge/PageTreeNode.tsx`
- [x] Create `src/components/features/knowledge/SpaceNavigator.tsx`
- [ ] Manual test in isolation (Storybook if available)

### Phase 4: Payload Admin Integration
- [x] Create custom workspace knowledge view
- [x] Add navigation button to return to workspace
- [x] Test navigation flow in admin
- [ ] Verify CRUD operations work through admin interface

### Phase 5: Frontend Display Routes
- [ ] Create layout with navigator
- [ ] Create space landing page
- [ ] Create individual page view
- [x] Create Lexical serializer
- [ ] Test all routes work
- [ ] Verify published/draft filtering

### Testing
- [ ] Write unit tests for tree builder
- [ ] Write unit tests for components
- [ ] Update T022 integration tests
- [ ] Run all tests and ensure passing
- [ ] Manual end-to-end testing

### Documentation & Deployment
- [ ] Update `.agent/README.md` with new task
- [ ] Document lessons learned
- [ ] Deploy to staging
- [ ] Staging smoke tests
- [ ] Deploy to production
- [ ] Production verification

---

**End of Plan**

This plan is ready for implementation. Proceed to Step 5 (Self-Test) to verify completeness and quality.
