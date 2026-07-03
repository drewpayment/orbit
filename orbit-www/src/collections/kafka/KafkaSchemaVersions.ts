import type { CollectionConfig } from 'payload'
import { adminOnly, workspaceScopedRead } from '@/lib/access/collection-access'

export const KafkaSchemaVersions: CollectionConfig = {
  slug: 'kafka-schema-versions',
  admin: {
    useAsTitle: 'version',
    group: 'Kafka',
    defaultColumns: ['schema', 'version', 'schemaId', 'registeredAt'],
    description: 'Historical versions of Kafka schemas',
  },
  access: {
    read: workspaceScopedRead(),
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  fields: [
    {
      name: 'schema',
      type: 'relationship',
      relationTo: 'kafka-schemas',
      required: true,
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
      name: 'version',
      type: 'number',
      required: true,
      index: true,
    },
    {
      name: 'schemaId',
      type: 'number',
      required: true,
      admin: {
        description: 'Global Schema Registry ID',
      },
    },
    {
      name: 'content',
      type: 'code',
      required: true,
      admin: {
        language: 'json',
        description: 'Full schema definition',
      },
    },
    {
      name: 'fingerprint',
      type: 'text',
      index: true,
      admin: {
        description: 'Schema hash for deduplication',
      },
    },
    {
      name: 'compatibilityMode',
      type: 'select',
      options: [
        { label: 'Backward', value: 'backward' },
        { label: 'Forward', value: 'forward' },
        { label: 'Full', value: 'full' },
        { label: 'None', value: 'none' },
      ],
    },
    {
      name: 'isCompatible',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        description: 'Was this version compatible when registered',
      },
    },
    {
      name: 'registeredAt',
      type: 'date',
      admin: {
        description: 'When registered in Schema Registry',
      },
    },
    {
      name: 'syncedAt',
      type: 'date',
      admin: {
        description: 'When synced to Orbit',
      },
    },
  ],
  timestamps: true,
}
