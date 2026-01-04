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

      // Regular users see only virtual clusters for their workspace applications
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

      // Find applications in user's workspaces
      const apps = await payload.find({
        collection: 'kafka-applications',
        where: {
          workspace: { in: workspaceIds },
        },
        limit: 1000,
        overrideAccess: true,
      })

      const appIds = apps.docs.map((a) => a.id)

      return {
        application: { in: appIds },
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
      name: 'application',
      type: 'relationship',
      relationTo: 'kafka-applications',
      required: true,
      index: true,
      admin: {
        description: 'Parent Kafka application',
      },
    },
    {
      name: 'environment',
      type: 'select',
      required: true,
      options: [
        { label: 'Development', value: 'dev' },
        { label: 'Staging', value: 'stage' },
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
