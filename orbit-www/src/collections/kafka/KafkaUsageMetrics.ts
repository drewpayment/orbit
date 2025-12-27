import type { CollectionConfig, Where } from 'payload'

export const KafkaUsageMetrics: CollectionConfig = {
  slug: 'kafka-usage-metrics',
  admin: {
    useAsTitle: 'id',
    group: 'Kafka',
    defaultColumns: ['topic', 'timestamp', 'messagesIn', 'messagesOut', 'bytesIn', 'bytesOut'],
    description: 'Time-series metrics for Kafka topics',
  },
  access: {
    // Read: Users can see metrics for topics in their workspaces
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
    // Metrics are system-generated
    create: ({ req: { user } }) => user?.collection === 'users',
    update: () => false, // Metrics are immutable
    delete: ({ req: { user } }) => user?.collection === 'users',
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
      name: 'timestamp',
      type: 'date',
      required: true,
      index: true,
      admin: {
        description: 'Metric timestamp',
      },
    },
    {
      name: 'granularity',
      type: 'select',
      required: true,
      defaultValue: 'minute',
      options: [
        { label: 'Minute', value: 'minute' },
        { label: 'Hour', value: 'hour' },
        { label: 'Day', value: 'day' },
      ],
      index: true,
    },
    // Message metrics
    {
      name: 'messagesIn',
      type: 'number',
      admin: {
        description: 'Messages produced',
      },
    },
    {
      name: 'messagesOut',
      type: 'number',
      admin: {
        description: 'Messages consumed',
      },
    },
    // Byte metrics
    {
      name: 'bytesIn',
      type: 'number',
      admin: {
        description: 'Bytes produced',
      },
    },
    {
      name: 'bytesOut',
      type: 'number',
      admin: {
        description: 'Bytes consumed',
      },
    },
    // Partition metrics
    {
      name: 'partitionMetrics',
      type: 'json',
      admin: {
        description: 'Per-partition metrics',
      },
    },
    // Lag metrics (aggregated)
    {
      name: 'totalLag',
      type: 'number',
      admin: {
        description: 'Total consumer lag across all groups',
      },
    },
    {
      name: 'consumerGroupCount',
      type: 'number',
      admin: {
        description: 'Number of active consumer groups',
      },
    },
  ],
  timestamps: true,
}
