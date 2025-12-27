import type { CollectionConfig, Where } from 'payload'

export const KafkaServiceAccounts: CollectionConfig = {
  slug: 'kafka-service-accounts',
  admin: {
    useAsTitle: 'name',
    group: 'Kafka',
    defaultColumns: ['name', 'workspace', 'type', 'status', 'createdBy'],
    description: 'Service accounts for Kafka access',
  },
  access: {
    // Read: Users can see service accounts in their workspaces
    read: async ({ req: { user, payload } }) => {
      if (!user) return false
      if (user.collection === 'users') return true

      const memberships = await payload.find({
        collection: 'workspace-members',
        where: {
          user: { equals: user.id },
          status: { equals: 'active' },
        },
        limit: 1000,
        overrideAccess: true,
      })

      const workspaceIds = memberships.docs.map(m =>
        String(typeof m.workspace === 'string' ? m.workspace : m.workspace.id)
      )

      return {
        workspace: { in: workspaceIds },
      } as Where
    },
    // Only workspace admins can create service accounts
    create: async ({ req: { user, payload }, data }) => {
      if (!user) return false
      if (user.collection === 'users') return true

      if (!data?.workspace) return false

      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: data.workspace } },
            { user: { equals: user.id } },
            { role: { in: ['owner', 'admin'] } },
            { status: { equals: 'active' } },
          ],
        },
        overrideAccess: true,
      })

      return members.docs.length > 0
    },
    update: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false
      if (user.collection === 'users') return true

      const account = await payload.findByID({
        collection: 'kafka-service-accounts',
        id,
        overrideAccess: true,
      })

      const workspaceId = typeof account.workspace === 'string' ? account.workspace : account.workspace.id

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
        overrideAccess: true,
      })

      return members.docs.length > 0
    },
    delete: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false
      if (user.collection === 'users') return true

      const account = await payload.findByID({
        collection: 'kafka-service-accounts',
        id,
        overrideAccess: true,
      })

      const workspaceId = typeof account.workspace === 'string' ? account.workspace : account.workspace.id

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
        overrideAccess: true,
      })

      return members.docs.length > 0
    },
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
      name: 'name',
      type: 'text',
      required: true,
      index: true,
      admin: {
        description: 'Service account identifier',
      },
    },
    {
      name: 'type',
      type: 'select',
      required: true,
      options: [
        { label: 'Producer', value: 'producer' },
        { label: 'Consumer', value: 'consumer' },
        { label: 'Producer + Consumer', value: 'producer-consumer' },
        { label: 'Admin', value: 'admin' },
      ],
    },
    {
      name: 'credentials',
      type: 'json',
      admin: {
        description: 'Provider-specific credentials (encrypted)',
        // Note: Credentials should never be exposed in API responses
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Revoked', value: 'revoked' },
      ],
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'createdBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        readOnly: true,
      },
    },
  ],
  hooks: {
    beforeChange: [
      async ({ operation, data, req }) => {
        // Set createdBy on create
        if (operation === 'create' && req.user) {
          data.createdBy = req.user.id
        }
        return data
      },
    ],
  },
  timestamps: true,
}
