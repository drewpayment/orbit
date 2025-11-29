import type { CollectionConfig, Where } from 'payload'

export const HealthChecks: CollectionConfig = {
  slug: 'health-checks',
  admin: {
    group: 'Monitoring',
    defaultColumns: ['app', 'status', 'responseTime', 'checkedAt'],
  },
  access: {
    // Same workspace-scoped access as Apps
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

      // Get apps in user's workspaces
      const apps = await payload.find({
        collection: 'apps',
        where: { workspace: { in: workspaceIds } },
        limit: 10000,
        overrideAccess: true,
      })

      const appIds = apps.docs.map(a => a.id)

      return {
        app: { in: appIds },
      } as Where
    },
    create: () => false, // Only system can create
    update: () => false, // Immutable records
    delete: ({ req: { user } }) => user?.collection === 'users', // Admin only
  },
  fields: [
    {
      name: 'app',
      type: 'relationship',
      relationTo: 'apps',
      required: true,
      index: true,
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      options: [
        { label: 'Healthy', value: 'healthy' },
        { label: 'Degraded', value: 'degraded' },
        { label: 'Down', value: 'down' },
      ],
    },
    {
      name: 'statusCode',
      type: 'number',
      admin: {
        description: 'HTTP response status code',
      },
    },
    {
      name: 'responseTime',
      type: 'number',
      admin: {
        description: 'Response time in milliseconds',
      },
    },
    {
      name: 'error',
      type: 'text',
      admin: {
        description: 'Error message if check failed',
      },
    },
    {
      name: 'checkedAt',
      type: 'date',
      required: true,
      index: true,
    },
  ],
  timestamps: true,
}
