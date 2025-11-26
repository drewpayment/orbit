// orbit-www/src/collections/Roles.ts
import type { CollectionConfig } from 'payload'

export const Roles: CollectionConfig = {
  slug: 'roles',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'slug', 'scope', 'isSystem'],
    group: 'Access Control',
  },
  access: {
    read: () => true,
    create: ({ req: { user } }) => !!user,
    update: ({ req: { user } }) => !!user,
    // Prevent deletion of system roles
    delete: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false
      const role = await payload.findByID({
        collection: 'roles',
        id,
      })
      return !role.isSystem
    },
  },
  fields: [
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      label: 'Role Slug',
      admin: {
        description: 'Unique identifier (e.g., "workspace-admin")',
      },
      validate: (val: unknown) => {
        if (typeof val !== 'string' || !/^[a-z][a-z0-9-]*$/.test(val)) {
          return 'Slug must start with letter and contain only lowercase letters, numbers, and hyphens'
        }
        return true
      },
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      label: 'Display Name',
    },
    {
      name: 'description',
      type: 'textarea',
      label: 'Description',
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
    },
    {
      name: 'permissions',
      type: 'relationship',
      relationTo: 'permissions',
      hasMany: true,
      label: 'Permissions',
      admin: {
        description: 'Permissions granted by this role',
      },
    },
    {
      name: 'isDefault',
      type: 'checkbox',
      defaultValue: false,
      label: 'Default Role',
      admin: {
        description: 'Auto-assigned to new workspace members',
      },
    },
    {
      name: 'isSystem',
      type: 'checkbox',
      defaultValue: false,
      label: 'System Role',
      admin: {
        description: 'Built-in role that cannot be deleted',
        readOnly: true,
      },
    },
  ],
}
