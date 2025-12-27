import type { CollectionConfig } from 'payload'

export const KafkaProviders: CollectionConfig = {
  slug: 'kafka-providers',
  admin: {
    useAsTitle: 'displayName',
    group: 'Kafka',
    defaultColumns: ['displayName', 'name', 'adapterType'],
    description: 'System-managed Kafka provider definitions',
  },
  access: {
    // Everyone can read provider definitions
    read: () => true,
    // Only admins can manage providers
    create: ({ req: { user } }) => user?.collection === 'users',
    update: ({ req: { user } }) => user?.collection === 'users',
    delete: ({ req: { user } }) => user?.collection === 'users',
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
