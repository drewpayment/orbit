import type { CollectionConfig, Where } from 'payload'

export const KafkaConsumerGroupLagHistory: CollectionConfig = {
  slug: 'kafka-consumer-group-lag-history',
  admin: {
    useAsTitle: 'timestamp',
    group: 'Kafka',
    defaultColumns: ['consumerGroup', 'totalLag', 'memberCount', 'timestamp'],
    description: 'Historical lag snapshots for consumer groups',
  },
  access: {
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
    create: ({ req: { user } }) => user?.collection === 'users',
    update: ({ req: { user } }) => user?.collection === 'users',
    delete: ({ req: { user } }) => user?.collection === 'users',
  },
  fields: [
    {
      name: 'consumerGroup',
      type: 'relationship',
      relationTo: 'kafka-consumer-groups',
      required: true,
      index: true,
    },
    {
      name: 'virtualCluster',
      type: 'relationship',
      relationTo: 'kafka-virtual-clusters',
      index: true,
    },
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
    },
    {
      name: 'timestamp',
      type: 'date',
      required: true,
      index: true,
    },
    {
      name: 'totalLag',
      type: 'number',
      required: true,
    },
    {
      name: 'partitionLag',
      type: 'json',
      admin: {
        description: '{ "topic-0": 150, "topic-1": 42, ... }',
      },
    },
    {
      name: 'memberCount',
      type: 'number',
    },
    {
      name: 'state',
      type: 'text',
    },
  ],
  timestamps: true,
}
