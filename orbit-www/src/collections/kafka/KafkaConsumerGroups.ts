import type { CollectionConfig, Where } from 'payload'

export const KafkaConsumerGroups: CollectionConfig = {
  slug: 'kafka-consumer-groups',
  admin: {
    useAsTitle: 'groupId',
    group: 'Kafka',
    defaultColumns: ['groupId', 'topic', 'workspace', 'state', 'totalLag', 'lastSeen'],
    description: 'Consumer groups consuming from topics',
  },
  access: {
    // Read: Users can see consumer groups for topics in their workspaces
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
    // Consumer groups are discovered automatically
    create: ({ req: { user } }) => user?.collection === 'users',
    update: ({ req: { user } }) => user?.collection === 'users',
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
        description: 'Workspace owning the topic',
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
      name: 'groupId',
      type: 'text',
      required: true,
      index: true,
      admin: {
        description: 'Consumer group ID',
      },
    },
    {
      name: 'state',
      type: 'select',
      options: [
        { label: 'Unknown', value: 'unknown' },
        { label: 'Preparing Rebalance', value: 'preparing-rebalance' },
        { label: 'Completing Rebalance', value: 'completing-rebalance' },
        { label: 'Stable', value: 'stable' },
        { label: 'Dead', value: 'dead' },
        { label: 'Empty', value: 'empty' },
      ],
      admin: {
        description: 'Consumer group state',
      },
    },
    {
      name: 'members',
      type: 'number',
      admin: {
        description: 'Number of group members',
      },
    },
    {
      name: 'totalLag',
      type: 'number',
      admin: {
        description: 'Total lag across all partitions',
      },
    },
    {
      name: 'partitionLag',
      type: 'json',
      admin: {
        description: 'Per-partition lag information',
      },
    },
    {
      name: 'ownerWorkspace',
      type: 'relationship',
      relationTo: 'workspaces',
      admin: {
        description: 'Workspace that owns this consumer (if known)',
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
        description: 'Associated share grant (if cross-workspace)',
      },
    },
    {
      name: 'firstSeen',
      type: 'date',
      admin: {
        readOnly: true,
        description: 'When this group was first discovered',
      },
    },
    {
      name: 'lastSeen',
      type: 'date',
      index: true,
      admin: {
        description: 'When this group was last seen active',
      },
    },
  ],
  hooks: {
    beforeChange: [
      async ({ operation, data }) => {
        if (operation === 'create') {
          data.firstSeen = new Date().toISOString()
        }
        data.lastSeen = new Date().toISOString()
        return data
      },
    ],
  },
  timestamps: true,
}
