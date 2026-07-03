import type { CollectionConfig } from 'payload'
import { adminOnly } from '@/lib/access/collection-access'

export const KafkaProviders: CollectionConfig = {
  slug: 'kafka-providers',
  admin: {
    useAsTitle: 'displayName',
    group: 'Kafka',
    defaultColumns: ['displayName', 'name', 'adapterType'],
    description: 'System-managed Kafka provider definitions',
  },
  access: {
    // Any authenticated user can read provider definitions — non-sensitive,
    // enum-like reference data (adapter names/capabilities), not
    // workspace-scoped, so no membership check is needed. Not public: an
    // internal IDP has no legitimate anonymous consumer (UAC-4).
    read: ({ req: { user } }) => !!user,
    // Only platform admins can manage providers
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      unique: true,
      admin: {
        description: 'Unique identifier: apache-kafka, confluent-cloud, aws-msk, etc.',
      },
    },
    {
      name: 'displayName',
      type: 'text',
      required: true,
      admin: {
        description: 'Human-readable name',
      },
    },
    {
      name: 'adapterType',
      type: 'select',
      required: true,
      options: [
        { label: 'Apache Kafka', value: 'apache' },
        { label: 'Confluent Cloud', value: 'confluent' },
        { label: 'AWS MSK', value: 'msk' },
      ],
      admin: {
        description: 'Which adapter handles this provider',
      },
    },
    {
      name: 'requiredConfigFields',
      type: 'json',
      required: true,
      defaultValue: [],
      admin: {
        description: 'Connection/auth fields required for this provider',
      },
    },
    {
      name: 'capabilities',
      type: 'group',
      fields: [
        {
          name: 'schemaRegistry',
          type: 'checkbox',
          defaultValue: true,
          admin: {
            description: 'Supports Schema Registry integration',
          },
        },
        {
          name: 'transactions',
          type: 'checkbox',
          defaultValue: true,
          admin: {
            description: 'Supports transactions',
          },
        },
        {
          name: 'quotasApi',
          type: 'checkbox',
          defaultValue: false,
          admin: {
            description: 'Supports quotas API',
          },
        },
        {
          name: 'metricsApi',
          type: 'checkbox',
          defaultValue: false,
          admin: {
            description: 'Supports native metrics API',
          },
        },
      ],
    },
    {
      name: 'documentationUrl',
      type: 'text',
      admin: {
        description: 'Link to provider documentation',
      },
    },
    {
      name: 'icon',
      type: 'upload',
      relationTo: 'media',
      admin: {
        description: 'Provider logo',
      },
    },
  ],
  timestamps: true,
}
