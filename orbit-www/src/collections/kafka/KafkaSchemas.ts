import type { CollectionConfig } from 'payload'
import { docWorkspaceMutate, memberCreate, workspaceScopedRead } from '@/lib/access/collection-access'

export const KafkaSchemas: CollectionConfig = {
  slug: 'kafka-schemas',
  admin: {
    useAsTitle: 'subject',
    group: 'Kafka',
    defaultColumns: ['subject', 'topic', 'type', 'format', 'version', 'status'],
    description: 'Schemas registered for Kafka topics',
  },
  access: {
    // Read: Users can see schemas in their workspaces
    read: workspaceScopedRead(),
    // Any active member of the target workspace may register a schema
    create: memberCreate(),
    update: docWorkspaceMutate('kafka-schemas', ['owner', 'admin', 'member']),
    delete: docWorkspaceMutate('kafka-schemas', ['owner', 'admin']),
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
      admin: {
        description: 'Associated topic',
      },
    },
    {
      name: 'type',
      type: 'select',
      required: true,
      options: [
        { label: 'Key', value: 'key' },
        { label: 'Value', value: 'value' },
      ],
      admin: {
        description: 'Key or value schema',
      },
    },
    {
      name: 'subject',
      type: 'text',
      index: true,
      admin: {
        readOnly: true,
        description: 'Auto-generated: {env}.{workspace}.{topic}-{type}',
      },
    },
    {
      name: 'format',
      type: 'select',
      required: true,
      options: [
        { label: 'Avro', value: 'avro' },
        { label: 'Protobuf', value: 'protobuf' },
        { label: 'JSON', value: 'json' },
      ],
    },
    {
      name: 'content',
      type: 'code',
      required: true,
      admin: {
        language: 'json',
        description: 'Schema definition',
      },
    },
    {
      name: 'version',
      type: 'number',
      admin: {
        readOnly: true,
        description: 'Schema Registry version (mirrored)',
      },
    },
    {
      name: 'schemaId',
      type: 'number',
      admin: {
        readOnly: true,
        description: 'Schema Registry ID',
      },
    },
    {
      name: 'compatibility',
      type: 'select',
      defaultValue: 'backward',
      options: [
        { label: 'Backward', value: 'backward' },
        { label: 'Forward', value: 'forward' },
        { label: 'Full', value: 'full' },
        { label: 'None', value: 'none' },
      ],
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Registered', value: 'registered' },
        { label: 'Failed', value: 'failed' },
        { label: 'Stale', value: 'stale' },
      ],
      admin: {
        position: 'sidebar',
      },
    },
    // Version tracking fields (Phase 7)
    {
      name: 'latestVersion',
      type: 'number',
      admin: {
        description: 'Latest version number (cached)',
        readOnly: true,
      },
    },
    {
      name: 'versionCount',
      type: 'number',
      admin: {
        description: 'Total versions registered',
        readOnly: true,
      },
    },
    {
      name: 'firstRegisteredAt',
      type: 'date',
      admin: {
        description: 'When first version was registered',
        readOnly: true,
      },
    },
    {
      name: 'lastRegisteredAt',
      type: 'date',
      admin: {
        description: 'When latest version was registered',
        readOnly: true,
      },
    },
  ],
  timestamps: true,
}
