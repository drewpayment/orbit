import type { CollectionConfig } from 'payload'

export const BifrostConfig: CollectionConfig = {
  slug: 'bifrost-config',
  admin: {
    useAsTitle: 'name',
    group: 'Platform',
    description: 'Bifrost gateway connection settings for Kafka clients',
  },
  access: {
    // Only admins can read/write this singleton
    read: ({ req: { user } }) => {
      if (!user) return false
      // System users (admins) have full access
      return user.collection === 'users'
    },
    create: ({ req: { user } }) => {
      if (!user) return false
      return user.collection === 'users'
    },
    update: ({ req: { user } }) => {
      if (!user) return false
      return user.collection === 'users'
    },
    delete: () => false, // Prevent deletion of singleton
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      defaultValue: 'Default',
      admin: {
        readOnly: true,
        description: 'Configuration name (singleton)',
      },
    },
    {
      name: 'advertisedHost',
      type: 'text',
      required: true,
      label: 'Bifrost Advertised Host',
      admin: {
        description: 'The hostname:port clients use to connect (e.g., kafka.bifrost.orbit.io:9092)',
      },
    },
    {
      name: 'defaultAuthMethod',
      type: 'select',
      required: true,
      defaultValue: 'SASL/SCRAM-SHA-256',
      options: [
        { label: 'SCRAM-SHA-256', value: 'SASL/SCRAM-SHA-256' },
        { label: 'SCRAM-SHA-512', value: 'SASL/SCRAM-SHA-512' },
        { label: 'PLAIN', value: 'SASL/PLAIN' },
      ],
      admin: {
        description: 'Default authentication method for Kafka clients',
      },
    },
    {
      name: 'connectionMode',
      type: 'select',
      required: true,
      defaultValue: 'bifrost',
      label: 'Connection Mode',
      options: [
        { label: 'Bifrost Proxy', value: 'bifrost' },
        { label: 'Direct to Cluster', value: 'direct' },
      ],
      admin: {
        description: 'Bifrost: clients connect through proxy. Direct: clients connect to physical cluster.',
      },
    },
    {
      name: 'routingMode',
      type: 'select',
      required: true,
      defaultValue: 'sasl',
      label: 'Routing Mode',
      options: [
        { label: 'SASL (Single Gateway)', value: 'sasl' },
        { label: 'SNI (Per-Cluster Hostname)', value: 'sni' },
        { label: 'Both (SNI with SASL fallback)', value: 'both' },
      ],
      admin: {
        description:
          'SASL: Single gateway endpoint, routing based on credentials (default for dev). ' +
          'SNI: Per-cluster hostnames, routing based on TLS SNI (requires TLS + DNS). ' +
          'Both: Uses SNI when TLS available, falls back to SASL.',
      },
    },
    {
      name: 'tlsEnabled',
      type: 'checkbox',
      defaultValue: true,
      label: 'TLS Enabled',
      admin: {
        description: 'Whether client connections require TLS',
      },
    },
  ],
  timestamps: true,
}
