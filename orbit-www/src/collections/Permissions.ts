import type { CollectionConfig } from 'payload'

export const Permissions: CollectionConfig = {
  slug: 'permissions',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'slug', 'category', 'scope'],
    group: 'Access Control',
  },
  access: {
    // Read: all users | Write: authenticated users (TODO: restrict to admins via UserWorkspaceRoles)
    read: () => true,
    create: ({ req: { user } }) => !!user,
    update: ({ req: { user } }) => !!user,
    delete: ({ req: { user } }) => !!user,
  },
  fields: [
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      label: 'Permission Slug',
      admin: {
        description: 'Unique identifier (e.g., "template:create", "repository:delete")',
      },
      validate: (val: unknown) => {
        if (typeof val !== 'string' || !/^[a-z]+:[a-z]+$/.test(val)) {
          return 'Slug must be in format "resource:action" (e.g., "template:create")'
        }
        return true
      },
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      label: 'Display Name',
      admin: {
        description: 'Human-readable name (e.g., "Create Templates")',
      },
    },
    {
      name: 'description',
      type: 'textarea',
      label: 'Description',
      admin: {
        description: 'What this permission allows',
      },
    },
    {
      name: 'category',
      type: 'select',
      required: true,
      options: [
        { label: 'Template', value: 'template' },
        { label: 'Repository', value: 'repository' },
        { label: 'Workspace', value: 'workspace' },
        { label: 'Knowledge', value: 'knowledge' },
        { label: 'Admin', value: 'admin' },
      ],
      admin: {
        description: 'Category for grouping permissions',
      },
    },
    {
      name: 'scope',
      type: 'select',
      required: true,
      defaultValue: 'workspace',
      options: [
        { label: 'Platform', value: 'platform' },
        { label: 'Workspace', value: 'workspace' },
      ],
      admin: {
        description: 'Where this permission applies',
      },
    },
  ],
}
