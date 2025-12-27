import type { CollectionConfig, Where } from 'payload'

export const KafkaClientActivity: CollectionConfig = {
  slug: 'kafka-client-activity',
  admin: {
    useAsTitle: 'id',
    group: 'Kafka',
    defaultColumns: ['clientId', 'topic', 'activityType', 'workspace', 'timestamp'],
    description: 'Client activity log for lineage and auditing',
  },
  access: {
    // Read: Users can see activity for topics in their workspaces
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
    // Activity is system-generated
    create: ({ req: { user } }) => user?.collection === 'users',
    update: () => false, // Activity logs are immutable
    delete: ({ req: { user } }) => user?.collection === 'users',
  },
  fields: [
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
      admin: {
        description: 'Topic owner workspace',
      },
    },
    {
      name: 'topic',
      type: 'relationship',
      relationTo: 'kafka-topics',
      required: true,
      index: true,
    },
    {
      name: 'cluster',
      type: 'relationship',
      relationTo: 'kafka-clusters',
      index: true,
    },
    {
      name: 'activityType',
      type: 'select',
      required: true,
      options: [
        { label: 'Produce', value: 'produce' },
        { label: 'Consume', value: 'consume' },
        { label: 'Admin', value: 'admin' },
      ],
      index: true,
    },
    {
      name: 'clientId',
      type: 'text',
      index: true,
      admin: {
        description: 'Kafka client ID',
      },
    },
    {
      name: 'consumerGroup',
      type: 'text',
      index: true,
      admin: {
        description: 'Consumer group ID (for consume activity)',
      },
    },
    {
      name: 'sourceWorkspace',
      type: 'relationship',
      relationTo: 'workspaces',
      admin: {
        description: 'Workspace the client belongs to (if identified)',
      },
    },
    {
      name: 'serviceAccount',
      type: 'relationship',
      relationTo: 'kafka-service-accounts',
      admin: {
        description: 'Associated service account (if identified)',
      },
    },
    {
      name: 'share',
      type: 'relationship',
      relationTo: 'kafka-topic-shares',
      admin: {
        description: 'Associated share grant (if cross-workspace access)',
      },
    },
    {
      name: 'timestamp',
      type: 'date',
      required: true,
      index: true,
      admin: {
        description: 'Activity timestamp',
      },
    },
    {
      name: 'metadata',
      type: 'json',
      admin: {
        description: 'Additional activity metadata',
      },
    },
    {
      name: 'ipAddress',
      type: 'text',
      admin: {
        description: 'Client IP address',
      },
    },
  ],
  timestamps: true,
}
