import type { CollectionConfig } from 'payload'

export const KafkaClusters: CollectionConfig = {
  slug: 'kafka-clusters',
  admin: {
    useAsTitle: 'name',
    group: 'Kafka',
    defaultColumns: ['name', 'provider', 'validationStatus', 'lastValidatedAt'],
    description: 'Registered Kafka clusters managed by platform team',
  },
  access: {
    // Only admins can see cluster details (contains sensitive config)
    read: ({ req: { user } }) => user?.collection === 'users',
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
      index: true,
      admin: {
        description: 'Cluster identifier',
      },
    },
    {
      name: 'provider',
      type: 'relationship',
      relationTo: 'kafka-providers',
      required: true,
      admin: {
        description: 'Provider type for this cluster',
      },
    },
    {
      name: 'connectionConfig',
      type: 'json',
      required: true,
      admin: {
        description: 'Provider-specific connection config (bootstrap servers, region, etc.)',
      },
    },
    {
      name: 'credentials',
      type: 'json',
      admin: {
        description: 'Encrypted auth credentials (SASL, mTLS certs, API keys)',
        // Note: In production, this should use encrypted storage
      },
    },
    {
      name: 'validationStatus',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Valid', value: 'valid' },
        { label: 'Invalid', value: 'invalid' },
      ],
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'lastValidatedAt',
      type: 'date',
      admin: {
        readOnly: true,
        position: 'sidebar',
        description: 'Last successful connection test',
      },
    },
    {
      name: 'description',
      type: 'textarea',
      admin: {
        description: 'Optional cluster description',
      },
    },
  ],
  timestamps: true,
}
