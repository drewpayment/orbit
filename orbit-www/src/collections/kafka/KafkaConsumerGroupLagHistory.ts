import type { CollectionConfig } from 'payload'
import { adminOnly, workspaceScopedRead } from '@/lib/access/collection-access'

export const KafkaConsumerGroupLagHistory: CollectionConfig = {
  slug: 'kafka-consumer-group-lag-history',
  admin: {
    useAsTitle: 'timestamp',
    group: 'Kafka',
    defaultColumns: ['consumerGroup', 'totalLag', 'memberCount', 'timestamp'],
    description: 'Historical lag snapshots for consumer groups',
  },
  access: {
    read: workspaceScopedRead(),
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
