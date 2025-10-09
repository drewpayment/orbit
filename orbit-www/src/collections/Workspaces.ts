import type { CollectionConfig } from 'payload'

export const Workspaces: CollectionConfig = {
  slug: 'workspaces',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'slug', 'createdAt'],
  },
  access: {
    // Everyone can read workspaces
    read: () => true,
    // Only authenticated users can create workspaces
    create: ({ req: { user } }) => !!user,
    // Only workspace owners/admins can update
    update: async ({ req: { user, payload }, id }) => {
      if (!user) return false

      // Check if user is owner or admin of this workspace
      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: id } },
            { user: { equals: user.id } },
            { role: { in: ['owner', 'admin'] } },
            { status: { equals: 'active' } },
          ],
        },
      })

      return members.docs.length > 0
    },
    // Only workspace owners can delete
    delete: async ({ req: { user, payload }, id }) => {
      if (!user) return false

      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: id } },
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
      name: 'name',
      type: 'text',
      required: true,
      label: 'Workspace Name',
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      label: 'Workspace Slug',
      admin: {
        description: 'URL-friendly identifier for this workspace',
      },
    },
    {
      name: 'description',
      type: 'textarea',
      label: 'Description',
    },
    {
      name: 'avatar',
      type: 'upload',
      relationTo: 'media',
      label: 'Workspace Avatar/Logo',
    },
    {
      name: 'parentWorkspace',
      type: 'relationship',
      relationTo: 'workspaces',
      label: 'Parent Workspace',
      admin: {
        description: 'The parent workspace this workspace belongs to',
      },
    },
    {
      name: 'childWorkspaces',
      type: 'relationship',
      relationTo: 'workspaces',
      hasMany: true,
      label: 'Child Workspaces',
      admin: {
        description: 'Workspaces that belong to this workspace',
      },
    },
    {
      name: 'settings',
      type: 'group',
      label: 'Workspace Settings',
      fields: [
        {
          name: 'enabledPlugins',
          type: 'array',
          label: 'Enabled Plugins',
          fields: [
            {
              name: 'pluginId',
              type: 'text',
              required: true,
            },
            {
              name: 'config',
              type: 'json',
              label: 'Plugin Configuration',
            },
          ],
        },
        {
          name: 'customization',
          type: 'json',
          label: 'UI Customization',
          admin: {
            description: 'Custom theme colors, branding, etc.',
          },
        },
      ],
    },
  ],
  hooks: {
    beforeValidate: [
      async ({ data, req, originalDoc, context }) => {
        // Skip validation if this is a sync operation to prevent infinite loops
        if (context?.skipHierarchySync) {
          return data
        }

        // Validate parent workspace relationship
        if (data?.parentWorkspace) {
          const currentId = originalDoc?.id || data.id

          // Prevent self-reference
          if (data.parentWorkspace === currentId) {
            throw new Error('A workspace cannot be its own parent')
          }

          // Check for circular references
          try {
            let currentParentId = data.parentWorkspace
            const visited = new Set([currentId])
            let depth = 0
            const maxDepth = 20

            while (currentParentId && depth < maxDepth) {
              if (visited.has(currentParentId)) {
                throw new Error(
                  'Circular reference detected. This would create a loop in the workspace hierarchy.'
                )
              }

              visited.add(currentParentId)

              const parent = await req.payload.findByID({
                collection: 'workspaces',
                id: currentParentId,
              })

              currentParentId =
                parent?.parentWorkspace && typeof parent.parentWorkspace === 'string'
                  ? parent.parentWorkspace
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
            throw new Error('Error validating parent workspace')
          }
        }

        // Validate child workspaces relationship
        if (data?.childWorkspaces && Array.isArray(data.childWorkspaces) && data.childWorkspaces.length > 0) {
          const currentId = originalDoc?.id || data.id

          // Prevent self-reference
          if (data.childWorkspaces.includes(currentId)) {
            throw new Error('A workspace cannot be its own child')
          }

          // Check each child for circular references
          for (const childId of data.childWorkspaces) {
            if (typeof childId !== 'string') continue

            try {
              const child = await req.payload.findByID({
                collection: 'workspaces',
                id: childId,
              })

              // Check if the child has this workspace in its parent chain
              let currentParentId =
                child?.parentWorkspace && typeof child.parentWorkspace === 'string'
                  ? child.parentWorkspace
                  : null
              const visited = new Set([currentId, childId])
              let depth = 0
              const maxDepth = 20

              while (currentParentId && depth < maxDepth) {
                if (visited.has(currentParentId)) {
                  throw new Error(
                    `Circular reference detected with "${child.name}". This would create a loop in the workspace hierarchy.`
                  )
                }

                visited.add(currentParentId)

                const parent = await req.payload.findByID({
                  collection: 'workspaces',
                  id: currentParentId,
                })

                currentParentId =
                  parent?.parentWorkspace && typeof parent.parentWorkspace === 'string'
                    ? parent.parentWorkspace
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
              throw new Error('Error validating child workspaces')
            }
          }
        }

        return data
      },
    ],
    afterChange: [
      async ({ operation, doc, req: { payload, user }, previousDoc, context }) => {
        // When a workspace is created, automatically add the creator as owner
        if (operation === 'create' && user) {
          await payload.create({
            collection: 'workspace-members',
            data: {
              workspace: doc.id,
              user: user.id,
              role: 'owner',
              status: 'active',
              requestedAt: new Date().toISOString(),
              approvedAt: new Date().toISOString(),
            },
          })
        }

        // Skip sync if this is already a sync operation to prevent infinite loops
        if (context?.skipHierarchySync) {
          return
        }

        // Sync parent/child relationships bidirectionally
        const currentParent = typeof doc.parentWorkspace === 'string' ? doc.parentWorkspace : null
        const previousParent =
          previousDoc && typeof previousDoc.parentWorkspace === 'string'
            ? previousDoc.parentWorkspace
            : null

        const currentChildren =
          doc.childWorkspaces && Array.isArray(doc.childWorkspaces)
            ? doc.childWorkspaces.filter((c: unknown): c is string => typeof c === 'string')
            : []
        const previousChildren =
          previousDoc && previousDoc.childWorkspaces && Array.isArray(previousDoc.childWorkspaces)
            ? previousDoc.childWorkspaces.filter((c: unknown): c is string => typeof c === 'string')
            : []

        // Handle parent workspace changes
        if (currentParent !== previousParent) {
          // Remove from previous parent's children
          if (previousParent) {
            try {
              const prevParent = await payload.findByID({
                collection: 'workspaces',
                id: previousParent,
                depth: 0,
              })

              const updatedChildren =
                prevParent.childWorkspaces && Array.isArray(prevParent.childWorkspaces)
                  ? prevParent.childWorkspaces
                      .filter((c): c is string => typeof c === 'string')
                      .filter((c) => c !== doc.id)
                  : []

              await payload.update({
                collection: 'workspaces',
                id: previousParent,
                data: {
                  childWorkspaces: updatedChildren,
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
                collection: 'workspaces',
                id: currentParent,
                depth: 0,
              })

              const existingChildren =
                newParent.childWorkspaces && Array.isArray(newParent.childWorkspaces)
                  ? newParent.childWorkspaces.filter((c): c is string => typeof c === 'string')
                  : []

              // Only add if not already present
              if (!existingChildren.includes(doc.id)) {
                await payload.update({
                  collection: 'workspaces',
                  id: currentParent,
                  data: {
                    childWorkspaces: [...existingChildren, doc.id],
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

        // Handle child workspace changes
        const addedChildren = currentChildren.filter((c: string) => !previousChildren.includes(c))
        const removedChildren = previousChildren.filter((c: string) => !currentChildren.includes(c))

        // Set parent on newly added children
        for (const childId of addedChildren) {
          try {
            const child = await payload.findByID({
              collection: 'workspaces',
              id: childId,
              depth: 0,
            })

            // Only update if the child doesn't already have this workspace as parent
            if (child.parentWorkspace !== doc.id) {
              await payload.update({
                collection: 'workspaces',
                id: childId,
                data: {
                  parentWorkspace: doc.id,
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
              collection: 'workspaces',
              id: childId,
              depth: 0,
            })

            // Only update if this workspace is currently the parent
            if (child.parentWorkspace === doc.id) {
              await payload.update({
                collection: 'workspaces',
                id: childId,
                data: {
                  parentWorkspace: null,
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
