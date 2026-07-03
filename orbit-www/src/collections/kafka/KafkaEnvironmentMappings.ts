import type { CollectionConfig } from 'payload'
import { adminOnly } from '@/lib/access/collection-access'

export const KafkaEnvironmentMappings: CollectionConfig = {
  slug: 'kafka-environment-mappings',
  admin: {
    useAsTitle: 'environment',
    group: 'Kafka',
    defaultColumns: ['environment', 'cluster', 'isDefault', 'priority'],
    description: 'Maps environments to Kafka clusters',
  },
  access: {
    // Only platform admins can manage environment mappings
    read: adminOnly,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  fields: [
    {
      name: 'environment',
      type: 'text',
      required: true,
      index: true,
      admin: {
        description: 'Environment name: dev, staging, prod, etc.',
      },
    },
    {
      name: 'cluster',
      type: 'relationship',
      relationTo: 'kafka-clusters',
      required: true,
      admin: {
        description: 'Target Kafka cluster for this environment',
      },
    },
    {
      name: 'routingRule',
      type: 'json',
      admin: {
        description: 'Optional routing rules (region-based, workspace metadata, round-robin)',
      },
    },
    {
      name: 'priority',
      type: 'number',
      defaultValue: 0,
      admin: {
        description: 'Priority for multiple clusters in same environment (higher = preferred)',
      },
    },
    {
      name: 'isDefault',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description: 'Default cluster for this environment',
        position: 'sidebar',
      },
    },
  ],
  timestamps: true,
}
