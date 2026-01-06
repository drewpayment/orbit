import type { CollectionConfig, Where } from 'payload'

export const KafkaApplications: CollectionConfig = {
  slug: 'kafka-applications',
  admin: {
    useAsTitle: 'name',
    group: 'Kafka',
    defaultColumns: ['name', 'workspace', 'status', 'createdAt'],
    description: 'Kafka applications for self-service virtual clusters',
  },
  access: {
    read: async ({ req: { user, payload } }) => {
      if (!user) return false

      // Admins can see all
      if (user.collection === 'users') return true

      // Regular users see only their workspace applications
      const memberships = await payload.find({
        collection: 'workspace-members',
        where: {
          user: { equals: user.id },
          status: { equals: 'active' },
        },
        limit: 1000,
        overrideAccess: true,
      })

      const workspaceIds = memberships.docs.map((m) =>
        String(typeof m.workspace === 'string' ? m.workspace : m.workspace.id)
      )

      return {
        workspace: { in: workspaceIds },
      } as Where
    },
    create: ({ req: { user } }) => !!user,
    update: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false

      // Admins can update any
      if (user.collection === 'users') return true

      const app = await payload.findByID({
        collection: 'kafka-applications',
        id: id as string,
        overrideAccess: true,
      })

      if (!app) return false

      const workspaceId =
        typeof app.workspace === 'string' ? app.workspace : (app.workspace as { id: string }).id

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
        limit: 1,
        overrideAccess: true,
      })

      return members.docs.length > 0
    },
    delete: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false

      // Admins can delete any
      if (user.collection === 'users') return true

      const app = await payload.findByID({
        collection: 'kafka-applications',
        id: id as string,
        overrideAccess: true,
      })

      if (!app) return false

      const workspaceId =
        typeof app.workspace === 'string' ? app.workspace : (app.workspace as { id: string }).id

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
        limit: 1,
        overrideAccess: true,
      })

      return members.docs.length > 0
    },
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: {
        description: 'Display name for the application (e.g., "Payments Service")',
      },
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: false, // Unique within workspace, not globally
      index: true,
      admin: {
        description: 'URL-safe identifier (e.g., "payments-service")',
      },
      validate: (value: string | undefined | null) => {
        if (!value) return 'Slug is required'
        if (!/^[a-z][a-z0-9-]*$/.test(value)) {
          return 'Slug must start with a letter and contain only lowercase letters, numbers, and hyphens'
        }
        if (value.length > 63) {
          return 'Slug must be 63 characters or less'
        }
        return true
      },
    },
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
      admin: {
        description: 'Workspace that owns this application',
      },
    },
    {
      name: 'description',
      type: 'textarea',
      admin: {
        description: 'Optional description of what this application does',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Decommissioning', value: 'decommissioning' },
        { label: 'Deleted', value: 'deleted' },
      ],
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'decommissioningStartedAt',
      type: 'date',
      admin: {
        readOnly: true,
        position: 'sidebar',
        condition: (data) => data?.status === 'decommissioning',
      },
    },
    {
      name: 'deletedAt',
      type: 'date',
      admin: {
        readOnly: true,
        position: 'sidebar',
        condition: (data) => data?.status === 'deleted',
      },
    },
    {
      name: 'deletedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        readOnly: true,
        condition: (data) => data?.status === 'deleted',
      },
    },
    {
      name: 'forceDeleted',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        readOnly: true,
        condition: (data) => data?.status === 'deleted',
      },
    },
    {
      name: 'createdBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        readOnly: true,
        position: 'sidebar',
      },
    },
  ],
  hooks: {
    beforeChange: [
      async ({ operation, data, req }) => {
        if (operation === 'create' && req.user) {
          data.createdBy = req.user.id
        }
        return data
      },
    ],
  },
  timestamps: true,
}
