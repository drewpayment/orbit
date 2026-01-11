import type { CollectionConfig, Where } from 'payload'

export const KafkaOffsetCheckpoints: CollectionConfig = {
  slug: 'kafka-offset-checkpoints',
  admin: {
    useAsTitle: 'checkpointedAt',
    group: 'Kafka',
    defaultColumns: ['consumerGroup', 'virtualCluster', 'checkpointedAt'],
    description: 'Consumer group offset snapshots for disaster recovery',
  },
  access: {
    // Read: Users can see checkpoints for consumer groups in their workspace's virtual clusters
    read: async ({ req: { user, payload } }) => {
      if (!user) return false

      // Admin users can see all
      if (user.collection === 'users') return true

      // Regular users see only checkpoints for consumer groups in their workspace's virtual clusters
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

      // Find virtual clusters for those applications
      const virtualClusters = await payload.find({
        collection: 'kafka-virtual-clusters',
        where: {
          application: { in: appIds },
        },
        limit: 1000,
        overrideAccess: true,
      })

      const virtualClusterIds = virtualClusters.docs.map((vc) => vc.id)

      return {
        virtualCluster: { in: virtualClusterIds },
      } as Where
    },
    // Offset checkpoints are system/workflow-driven only
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
      admin: {
        description: 'Consumer group whose offsets are checkpointed',
      },
    },
    {
      name: 'virtualCluster',
      type: 'relationship',
      relationTo: 'kafka-virtual-clusters',
      required: true,
      index: true,
      admin: {
        description: 'Virtual cluster containing the consumer group',
      },
    },
    {
      name: 'checkpointedAt',
      type: 'date',
      required: true,
      index: true,
      admin: {
        description: 'When this checkpoint was taken',
      },
    },
    {
      name: 'offsets',
      type: 'json',
      required: true,
      admin: {
        description: 'Partition to offset mapping (e.g., {"0": 12345, "1": 67890})',
      },
    },
  ],
  timestamps: true,
}
