import type { CollectionConfig, Where } from 'payload'

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
    create: ({ req: { user } }) => !!user,
    update: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false
      if (user.collection === 'users') return true

      const schema = await payload.findByID({
        collection: 'kafka-schemas',
        id,
        overrideAccess: true,
      })

      const workspaceId = typeof schema.workspace === 'string' ? schema.workspace : schema.workspace.id

      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: workspaceId } },
            { user: { equals: user.id } },
            { role: { in: ['owner', 'admin', 'member'] } },
            { status: { equals: 'active' } },
          ],
        },
        overrideAccess: true,
      })

      return members.docs.length > 0
    },
    delete: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false
      if (user.collection === 'users') return true

      const schema = await payload.findByID({
        collection: 'kafka-schemas',
        id,
        overrideAccess: true,
      })

      const workspaceId = typeof schema.workspace === 'string' ? schema.workspace : schema.workspace.id

      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: workspaceId } },
            { user: { equals: user.id } },
            { role: { in: ['owner', 'admin'] } },
            { status: { equals: 'active' } },
          ],
        },
        overrideAccess: true,
      })

      return members.docs.length > 0
    },
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
      ],
      admin: {
        position: 'sidebar',
      },
    },
  ],
  timestamps: true,
}
