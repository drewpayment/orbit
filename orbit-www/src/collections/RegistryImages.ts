import type { CollectionConfig } from 'payload'

export const RegistryImages: CollectionConfig = {
  slug: 'registry-images',
  admin: {
    useAsTitle: 'tag',
    group: 'System',
    defaultColumns: ['app', 'tag', 'sizeBytes', 'pushedAt'],
    hidden: true, // Internal collection, not shown in admin
  },
  access: {
    // Only system/admin can manage registry images
    read: ({ req: { user } }) => {
      if (!user) return false
      return { workspace: { in: user.workspaces?.map((w: { workspace: string | { id: string } }) =>
        typeof w.workspace === 'string' ? w.workspace : w.workspace.id
      ) || [] } }
    },
    create: () => false, // Only created by system
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
    },
    {
      name: 'app',
      type: 'relationship',
      relationTo: 'apps',
      required: true,
      index: true,
    },
    {
      name: 'tag',
      type: 'text',
      required: true,
      index: true,
    },
    {
      name: 'digest',
      type: 'text',
      required: true,
      admin: {
        description: 'SHA256 digest of the image manifest',
      },
    },
    {
      name: 'sizeBytes',
      type: 'number',
      required: true,
      admin: {
        description: 'Image size in bytes',
      },
    },
    {
      name: 'pushedAt',
      type: 'date',
      required: true,
      index: true,
      admin: {
        description: 'When the image was pushed to registry',
      },
    },
  ],
  indexes: [
    {
      name: 'workspace_pushedAt',
      fields: ['workspace', 'pushedAt'],
    },
    {
      name: 'workspace_app_tag',
      fields: ['workspace', 'app', 'tag'],
      unique: true,
    },
  ],
}
