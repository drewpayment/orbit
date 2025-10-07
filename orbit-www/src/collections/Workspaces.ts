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
    afterChange: [
      async ({ operation, doc, req: { payload, user } }) => {
        // When a workspace is created, automatically add the creator as owner
        if (operation === 'create' && user) {
          await payload.create({
            collection: 'workspace-members',
            data: {
              workspace: doc.id,
              user: user.id,
              role: 'owner',
              status: 'active',
              approvedAt: new Date().toISOString(),
            },
          })
        }
      },
    ],
  },
}
