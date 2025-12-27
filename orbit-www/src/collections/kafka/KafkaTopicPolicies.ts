import type { CollectionConfig } from 'payload'

export const KafkaTopicPolicies: CollectionConfig = {
  slug: 'kafka-topic-policies',
  admin: {
    useAsTitle: 'name',
    group: 'Kafka',
    defaultColumns: ['name', 'workspace', 'environment', 'requireApproval', 'requireSchema', 'enabled'],
    description: 'Guardrails and policies for topic creation',
  },
  access: {
    // Platform admins manage policies
    read: ({ req: { user } }) => {
      if (!user) return false
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
    delete: ({ req: { user } }) => {
      if (!user) return false
      return user.collection === 'users'
    },
  },
  fields: [
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      index: true,
      admin: {
        description: 'Workspace this policy applies to (null = platform-wide)',
      },
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: {
        description: 'Policy name for identification',
      },
    },
    {
      name: 'description',
      type: 'textarea',
      admin: {
        description: 'Policy description',
      },
    },
    {
      name: 'environment',
      type: 'select',
      hasMany: true,
      options: [
        { label: 'Development', value: 'dev' },
        { label: 'Staging', value: 'staging' },
        { label: 'Production', value: 'prod' },
      ],
      admin: {
        description: 'Environments this policy applies to (empty = all)',
      },
    },
    // Naming conventions
    {
      name: 'namingConventions',
      type: 'group',
      admin: {
        description: 'Topic naming rules',
      },
      fields: [
        {
          name: 'pattern',
          type: 'text',
          admin: {
            description: 'Regex pattern for valid topic names',
          },
        },
        {
          name: 'prefix',
          type: 'text',
          admin: {
            description: 'Required prefix for topic names',
          },
        },
        {
          name: 'suffix',
          type: 'text',
          admin: {
            description: 'Required suffix for topic names',
          },
        },
        {
          name: 'maxLength',
          type: 'number',
          defaultValue: 255,
          admin: {
            description: 'Maximum topic name length',
          },
        },
      ],
    },
    // Partition limits
    {
      name: 'partitionLimits',
      type: 'group',
      admin: {
        description: 'Partition count constraints',
      },
      fields: [
        {
          name: 'min',
          type: 'number',
          defaultValue: 1,
          admin: {
            description: 'Minimum partitions',
          },
        },
        {
          name: 'max',
          type: 'number',
          defaultValue: 100,
          admin: {
            description: 'Maximum partitions',
          },
        },
        {
          name: 'default',
          type: 'number',
          defaultValue: 3,
          admin: {
            description: 'Default partition count',
          },
        },
      ],
    },
    // Replication limits
    {
      name: 'replicationLimits',
      type: 'group',
      admin: {
        description: 'Replication factor constraints',
      },
      fields: [
        {
          name: 'min',
          type: 'number',
          defaultValue: 1,
          admin: {
            description: 'Minimum replication factor',
          },
        },
        {
          name: 'max',
          type: 'number',
          defaultValue: 5,
          admin: {
            description: 'Maximum replication factor',
          },
        },
        {
          name: 'default',
          type: 'number',
          defaultValue: 3,
          admin: {
            description: 'Default replication factor',
          },
        },
      ],
    },
    // Retention limits
    {
      name: 'retentionLimits',
      type: 'group',
      admin: {
        description: 'Retention period constraints',
      },
      fields: [
        {
          name: 'minMs',
          type: 'number',
          defaultValue: 3600000, // 1 hour
          admin: {
            description: 'Minimum retention in milliseconds',
          },
        },
        {
          name: 'maxMs',
          type: 'number',
          defaultValue: 2592000000, // 30 days
          admin: {
            description: 'Maximum retention in milliseconds',
          },
        },
        {
          name: 'defaultMs',
          type: 'number',
          defaultValue: 604800000, // 7 days
          admin: {
            description: 'Default retention in milliseconds',
          },
        },
      ],
    },
    // Requirements
    {
      name: 'requireApproval',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        description: 'Require admin approval for topic creation',
      },
    },
    {
      name: 'requireSchema',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description: 'Require schema registration before topic creation',
      },
    },
    {
      name: 'requireDescription',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        description: 'Require topic description',
      },
    },
    // Allowed configurations
    {
      name: 'allowedCompressionTypes',
      type: 'select',
      hasMany: true,
      options: [
        { label: 'None', value: 'none' },
        { label: 'Gzip', value: 'gzip' },
        { label: 'Snappy', value: 'snappy' },
        { label: 'LZ4', value: 'lz4' },
        { label: 'Zstd', value: 'zstd' },
      ],
      defaultValue: ['none', 'gzip', 'snappy', 'lz4', 'zstd'],
      admin: {
        description: 'Allowed compression types',
      },
    },
    {
      name: 'allowedCleanupPolicies',
      type: 'select',
      hasMany: true,
      options: [
        { label: 'Delete', value: 'delete' },
        { label: 'Compact', value: 'compact' },
        { label: 'Compact + Delete', value: 'compact,delete' },
      ],
      defaultValue: ['delete', 'compact'],
      admin: {
        description: 'Allowed cleanup policies',
      },
    },
    // Auto-approval rules
    {
      name: 'autoApprovalRules',
      type: 'array',
      admin: {
        description: 'Rules for automatic approval',
      },
      fields: [
        {
          name: 'environment',
          type: 'select',
          options: [
            { label: 'Development', value: 'dev' },
            { label: 'Staging', value: 'staging' },
            { label: 'Production', value: 'prod' },
          ],
        },
        {
          name: 'maxPartitions',
          type: 'number',
          admin: {
            description: 'Auto-approve if partitions <= this value',
          },
        },
        {
          name: 'topicPattern',
          type: 'text',
          admin: {
            description: 'Regex pattern for auto-approvable topics',
          },
        },
      ],
    },
    {
      name: 'enabled',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        position: 'sidebar',
        description: 'Policy is active',
      },
    },
    {
      name: 'priority',
      type: 'number',
      defaultValue: 0,
      admin: {
        position: 'sidebar',
        description: 'Higher priority policies are evaluated first',
      },
    },
  ],
  timestamps: true,
}
