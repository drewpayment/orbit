import type { Access, CollectionConfig, Where } from 'payload'
import { adminOnly } from '@/lib/access/collection-access'
import { getMemberWorkspaceIds, isPlatformAdmin } from '@/lib/access/workspace-access'

// No direct `workspace` relation on this collection — the workspace is
// resolved indirectly via virtualCluster → application → workspace. The
// shared `workspaceScopedRead()` factory only supports direct/OR fields, so
// this two-hop resolution is hand-rolled here (flagged in the WP2 report).
const readCheckpointsForMemberWorkspaces: Access = async ({ req: { user, payload } }) => {
  if (!user) return false
  if (isPlatformAdmin(user)) return true

  const betterAuthId = typeof user.betterAuthId === 'string' ? user.betterAuthId : null
  const workspaceIds = betterAuthId ? await getMemberWorkspaceIds(payload, betterAuthId) : []

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
}

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
    read: readCheckpointsForMemberWorkspaces,
    // Offset checkpoints are system/workflow-driven only
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
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
