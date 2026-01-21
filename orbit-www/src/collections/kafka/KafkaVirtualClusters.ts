import type { CollectionConfig, Where } from 'payload'

export const KafkaVirtualClusters: CollectionConfig = {
  slug: 'kafka-virtual-clusters',
  admin: {
    useAsTitle: 'advertisedHost',
    group: 'Kafka',
    defaultColumns: ['application', 'environment', 'status', 'createdAt'],
    description: 'Virtual clusters for Kafka applications (one per environment)',
  },
  access: {
    read: async ({ req: { user, payload } }) => {
      if (!user) return false

      // Admins can see all
      if (user.collection === 'users') return true

      // Regular users see only virtual clusters for their workspaces
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

      // Find applications in user's workspaces (for backward compat)
      const apps = await payload.find({
        collection: 'kafka-applications',
        where: {
          workspace: { in: workspaceIds },
        },
        limit: 1000,
        overrideAccess: true,
      })

      const appIds = apps.docs.map((a) => a.id)

      // Return clusters that either:
      // 1. Have direct workspace ownership, OR
      // 2. Belong to an application in user's workspaces (legacy)
      return {
        or: [
          { workspace: { in: workspaceIds } },
          { application: { in: appIds } },
        ],
      } as Where
    },
    create: ({ req: { user } }) => {
      // Only system/workflows can create virtual clusters
      return user?.collection === 'users'
    },
    update: ({ req: { user } }) => {
      return user?.collection === 'users'
    },
    delete: ({ req: { user } }) => {
      return user?.collection === 'users'
    },
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: false, // Optional for backward compatibility with existing records
      index: true,
      admin: {
        description: 'User-defined name for this virtual cluster',
      },
      validate: (value: string | undefined | null) => {
        if (!value) return true // Allow empty for backward compat
        if (!/^[a-z][a-z0-9-]*$/.test(value)) {
          return 'Name must start with a letter and contain only lowercase letters, numbers, and hyphens'
        }
        if (value.length > 63) {
          return 'Name must be 63 characters or less'
        }
        return true
      },
    },
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: false, // Optional for backward compatibility
      index: true,
      admin: {
        description: 'Workspace that owns this virtual cluster (for direct ownership)',
      },
    },
    {
      name: 'application',
      type: 'relationship',
      relationTo: 'kafka-applications',
      required: false, // Changed from true - now optional for backward compatibility
      index: true,
      admin: {
        description: 'Legacy: Parent Kafka application (deprecated for new clusters)',
      },
    },
    {
      name: 'environment',
      type: 'select',
      required: true,
      options: [
        { label: 'Development', value: 'dev' },
        { label: 'Staging', value: 'staging' },
        { label: 'QA', value: 'qa' },
        { label: 'Production', value: 'prod' },
      ],
      index: true,
      admin: {
        description: 'Target environment',
      },
    },
    {
      name: 'physicalCluster',
      type: 'relationship',
      relationTo: 'kafka-clusters',
      required: true,
      admin: {
        description: 'Backing physical Kafka cluster',
      },
    },
    {
      name: 'topicPrefix',
      type: 'text',
      required: true,
      admin: {
        readOnly: true,
        description: 'Prefix for physical topic names (e.g., "acme-payments-dev-")',
      },
    },
    {
      name: 'groupPrefix',
      type: 'text',
      required: true,
      admin: {
        readOnly: true,
        description: 'Prefix for consumer group IDs',
      },
    },
    {
      name: 'advertisedHost',
      type: 'text',
      required: true,
      admin: {
        readOnly: true,
        description: 'Gateway hostname for clients (e.g., "payments-service.dev.kafka.orbit.io")',
      },
    },
    {
      name: 'advertisedPort',
      type: 'number',
      required: true,
      defaultValue: 9092,
      admin: {
        readOnly: true,
        description: 'Gateway port for clients',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'provisioning',
      options: [
        { label: 'Provisioning', value: 'provisioning' },
        { label: 'Active', value: 'active' },
        { label: 'Read Only', value: 'read_only' },
        { label: 'Deleting', value: 'deleting' },
        { label: 'Deleted', value: 'deleted' },
      ],
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'provisioningError',
      type: 'textarea',
      admin: {
        readOnly: true,
        condition: (data) => data?.status === 'provisioning',
        description: 'Error message if provisioning failed',
      },
    },
  ],
  timestamps: true,
}
