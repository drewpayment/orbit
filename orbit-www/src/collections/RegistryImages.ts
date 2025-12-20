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
    // System-managed collection - read access for authenticated users
    // Workspace filtering should be done at query time, not access level
    read: ({ req: { user } }) => !!user,
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
}
