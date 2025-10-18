import type { CollectionConfig } from 'payload'

export const WorkspaceMembers: CollectionConfig = {
  slug: 'workspace-members',
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['workspace', 'user', 'role', 'status'],
  },
  access: {
    // Users can read memberships of workspaces they belong to
    read: async ({ req: { user, payload }, id }) => {
      if (!user) return false

      // If querying a specific membership
      if (id) {
        const membership = await payload.findByID({
          collection: 'workspace-members',
          id,
          overrideAccess: true, // Bypass access control to prevent infinite loop
        })

        // Can read if it's your own membership or you're an admin of the workspace
        if (membership.user === user.id) return true

        const adminMembership = await payload.find({
          collection: 'workspace-members',
          where: {
            and: [
              { workspace: { equals: membership.workspace } },
              { user: { equals: user.id } },
              { role: { in: ['owner', 'admin'] } },
              { status: { equals: 'active' } },
            ],
          },
          overrideAccess: true, // Bypass access control to prevent infinite loop
        })

        return adminMembership.docs.length > 0
      }

      // Allow listing (will be filtered by where clauses in queries)
      return true
    },
    // Only the user themselves can create membership requests
    create: ({ req: { user } }) => !!user,
    // Only workspace admins/owners can update (for approvals)
    update: async ({ req: { user, payload }, id }) => {
      if (!user) return false
      if (!id) return false

      const membership = await payload.findByID({
        collection: 'workspace-members',
        id,
        overrideAccess: true, // Bypass access control to prevent infinite loop
      })

      const adminMembership = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: membership.workspace } },
            { user: { equals: user.id } },
            { role: { in: ['owner', 'admin'] } },
            { status: { equals: 'active' } },
          ],
        },
        overrideAccess: true, // Bypass access control to prevent infinite loop
      })

      return adminMembership.docs.length > 0
    },
    // Only workspace owners can delete memberships
    delete: async ({ req: { user, payload }, id }) => {
      if (!user) return false
      if (!id) return false

      const membership = await payload.findByID({
        collection: 'workspace-members',
        id,
        overrideAccess: true, // Bypass access control to prevent infinite loop
      })

      // Allow users to delete their own membership (leave workspace)
      if (membership.user === user.id) return true

      const ownerMembership = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: membership.workspace } },
            { user: { equals: user.id } },
            { role: { equals: 'owner' } },
            { status: { equals: 'active' } },
          ],
        },
        overrideAccess: true, // Bypass access control to prevent infinite loop
      })

      return ownerMembership.docs.length > 0
    },
  },
  fields: [
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      hasMany: false,
    },
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      hasMany: false,
    },
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'member',
      options: [
        {
          label: 'Owner',
          value: 'owner',
        },
        {
          label: 'Admin',
          value: 'admin',
        },
        {
          label: 'Member',
          value: 'member',
        },
      ],
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      options: [
        {
          label: 'Active',
          value: 'active',
        },
        {
          label: 'Pending',
          value: 'pending',
        },
        {
          label: 'Rejected',
          value: 'rejected',
        },
      ],
    },
    {
      name: 'requestedAt',
      type: 'date',
      required: true,
      defaultValue: () => new Date().toISOString(),
      admin: {
        date: {
          pickerAppearance: 'dayAndTime',
        },
      },
    },
    {
      name: 'approvedAt',
      type: 'date',
      admin: {
        date: {
          pickerAppearance: 'dayAndTime',
        },
      },
    },
    {
      name: 'approvedBy',
      type: 'relationship',
      relationTo: 'users',
      hasMany: false,
      admin: {
        description: 'User who approved this membership request',
      },
    },
  ],
  indexes: [
    {
      fields: ['workspace', 'user'],
      unique: true,
    },
  ],
}
