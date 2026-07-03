import type { CollectionConfig } from 'payload'
import { adminOnly, workspaceScopedRead } from '@/lib/access/collection-access'

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
    read: workspaceScopedRead(),
    // Activity is system-generated
    create: adminOnly,
    update: () => false, // Activity logs are immutable
    delete: adminOnly,
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
    // Bifrost integration fields (Phase 8)
    {
      name: 'virtualCluster',
      type: 'relationship',
      relationTo: 'kafka-virtual-clusters',
      index: true,
      admin: {
        description: 'Virtual cluster this activity belongs to',
      },
    },
    {
      name: 'application',
      type: 'relationship',
      relationTo: 'kafka-applications',
      index: true,
      admin: {
        description: 'Application this activity belongs to',
      },
    },
    // Volume metrics (Phase 8)
    {
      name: 'bytesTransferred',
      type: 'number',
      defaultValue: 0,
      admin: {
        description: 'Bytes transferred in this activity window',
      },
    },
    {
      name: 'messageCount',
      type: 'number',
      defaultValue: 0,
      admin: {
        description: 'Messages transferred in this activity window',
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
