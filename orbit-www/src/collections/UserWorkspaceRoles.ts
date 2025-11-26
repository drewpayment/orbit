import type { CollectionConfig } from 'payload'

export const UserWorkspaceRoles: CollectionConfig = {
  slug: 'user-workspace-roles',
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['user', 'workspace', 'role'],
    group: 'Access Control',
  },
  access: {
    // Users can read their own role assignments
    read: async ({ req: { user, payload }, id }) => {
      if (!user) return false
      if (!id) {
        // For list queries, return constraint
        return {
          user: { equals: user.id },
        }
      }
      const assignment = await payload.findByID({
        collection: 'user-workspace-roles',
        id,
        overrideAccess: true,
      })
      return assignment.user === user.id
    },
    create: ({ req: { user } }) => !!user,
    update: ({ req: { user } }) => !!user,
    delete: ({ req: { user } }) => !!user,
  },
  fields: [
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      hasMany: false,
      index: true,
    },
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      hasMany: false,
      index: true,
      admin: {
        description: 'Leave empty for platform-level roles',
      },
    },
    {
      name: 'role',
      type: 'relationship',
      relationTo: 'roles',
      required: true,
      hasMany: false,
    },
  ],
  indexes: [
    {
      fields: ['user', 'workspace', 'role'],
      unique: true,
    },
  ],
}
