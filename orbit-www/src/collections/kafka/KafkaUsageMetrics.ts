import type { CollectionConfig } from 'payload'
import { adminOnly, workspaceScopedRead } from '@/lib/access/collection-access'

export const KafkaUsageMetrics: CollectionConfig = {
  slug: 'kafka-usage-metrics',
  admin: {
    useAsTitle: 'id',
    group: 'Kafka',
    defaultColumns: ['application', 'virtualCluster', 'topic', 'hourBucket', 'messagesIn', 'messagesOut', 'bytesIn', 'bytesOut'],
    description: 'Time-series metrics for Kafka topics',
  },
  access: {
    // Read: Users can see metrics for topics in their workspaces
    read: workspaceScopedRead(),
    // Metrics are system-generated
    create: adminOnly,
    update: () => false, // Metrics are immutable
    delete: adminOnly,
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
      name: 'application',
      type: 'relationship',
      relationTo: 'kafka-applications',
      required: true,
      index: true,
      admin: {
        description: 'Kafka application these metrics belong to',
      },
    },
    {
      name: 'virtualCluster',
      type: 'relationship',
      relationTo: 'kafka-virtual-clusters',
      required: true,
      index: true,
      admin: {
        description: 'Virtual cluster these metrics belong to',
      },
    },
    {
      name: 'serviceAccount',
      type: 'relationship',
      relationTo: 'kafka-service-accounts',
      index: true,
      admin: {
        description: 'Service account that generated these metrics (optional)',
      },
    },
    {
      name: 'hourBucket',
      type: 'date',
      required: true,
      index: true,
      admin: {
        description: 'Start of the hour this record represents (UTC)',
      },
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
