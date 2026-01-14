import type { CollectionConfig, Where } from 'payload'

export const KafkaSchemaVersions: CollectionConfig = {
  slug: 'kafka-schema-versions',
  admin: {
    useAsTitle: 'version',
    group: 'Kafka',
    defaultColumns: ['schema', 'version', 'schemaId', 'registeredAt'],
    description: 'Historical versions of Kafka schemas',
  },
  access: {
    read: async ({ req: { user, payload } }) => {
      if (!user) return false
      if (user.collection === 'users') return true

      const memberships = await payload.find({
        collection: 'workspace-members',
        where: {
          user: { equals: user.id },
          status: { equals: 'active' },
        },
        limit: 1000,
        overrideAccess: true,
      })

      const workspaceIds = memberships.docs.map(m =>
        String(typeof m.workspace === 'string' ? m.workspace : m.workspace.id)
      )

      return {
        workspace: { in: workspaceIds },
      } as Where
    },
    create: ({ req: { user } }) => user?.collection === 'users',
    update: ({ req: { user } }) => user?.collection === 'users',
    delete: ({ req: { user } }) => user?.collection === 'users',
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
