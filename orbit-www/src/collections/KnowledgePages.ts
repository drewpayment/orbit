import type { CollectionConfig } from 'payload'

export const KnowledgePages: CollectionConfig = {
  slug: 'knowledge-pages',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'knowledgeSpace', 'status', 'updatedAt'],
    // Don't set a group - this keeps it out of the sidebar navigation
    // but still allows direct URL access for creating/editing
    description: 'Pages are managed within their Knowledge Space. Use the Knowledge Space interface to create and edit pages.',
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
      if (!user || !id) return false
      
      const page = await payload.findByID({
        collection: 'knowledge-pages',
        id,
        depth: 2,
      })
      
      // Get workspace through space relationship
      const space = typeof page.knowledgeSpace === 'object' 
        ? page.knowledgeSpace 
        : await payload.findByID({ collection: 'knowledge-spaces', id: page.knowledgeSpace as string })
      
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
      if (!user || !id) return false
      
      const page = await payload.findByID({
        collection: 'knowledge-pages',
        id,
        depth: 2,
      })
      
      const space = typeof page.knowledgeSpace === 'object'
        ? page.knowledgeSpace
        : await payload.findByID({ collection: 'knowledge-spaces', id: page.knowledgeSpace as string })
      
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
      validate: (val: unknown) => {
        if (typeof val !== 'string' || !/^[a-z0-9-]+$/.test(val)) {
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
      filterOptions: ({ data }) => {
        // Only show pages from the same knowledge space
        if (data?.knowledgeSpace) {
          return {
            knowledgeSpace: { equals: data.knowledgeSpace }
          }
        }
        return false
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
        return false
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
        
        if (!data) return data
        
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
      async ({ doc, req: { payload }, previousDoc, context }) => {
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
}
