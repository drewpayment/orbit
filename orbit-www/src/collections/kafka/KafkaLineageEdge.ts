import type { CollectionConfig, Where } from 'payload'

export const KafkaLineageEdge: CollectionConfig = {
  slug: 'kafka-lineage-edges',
  admin: {
    useAsTitle: 'id',
    group: 'Kafka',
    defaultColumns: ['sourceApplication', 'direction', 'topic', 'lastSeen', 'isActive'],
    description: 'Aggregated data flow relationships between applications and topics',
  },
  access: {
    // Read: Users can see edges for topics in their workspaces
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

      // User can see edges where they own the topic (targetWorkspace)
      // or where their application is the source (sourceWorkspace)
      return {
        or: [
          { targetWorkspace: { in: workspaceIds } },
          { sourceWorkspace: { in: workspaceIds } },
        ],
      } as Where
    },
    // Lineage edges are system-generated only
    create: ({ req: { user } }) => user?.collection === 'users',
    update: ({ req: { user } }) => user?.collection === 'users',
    delete: ({ req: { user } }) => user?.collection === 'users',
  },
  fields: [
    // Source fields (who is producing/consuming)
    {
      name: 'sourceApplication',
      type: 'relationship',
      relationTo: 'kafka-applications',
      index: true,
      admin: {
        description: 'Application that is producing/consuming',
      },
    },
    {
      name: 'sourceServiceAccount',
      type: 'relationship',
      relationTo: 'kafka-service-accounts',
      index: true,
      admin: {
        description: 'Service account used for this connection',
      },
    },
    {
      name: 'sourceWorkspace',
      type: 'relationship',
      relationTo: 'workspaces',
      index: true,
      admin: {
        description: 'Workspace of the source application',
      },
    },

    // Target fields (the topic)
    {
      name: 'topic',
      type: 'relationship',
      relationTo: 'kafka-topics',
      required: true,
      index: true,
      admin: {
        description: 'Topic being accessed',
      },
    },
    {
      name: 'targetApplication',
      type: 'relationship',
      relationTo: 'kafka-applications',
      index: true,
      admin: {
        description: 'Application that owns the topic',
      },
    },
    {
      name: 'targetWorkspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
      admin: {
        description: 'Workspace that owns the topic',
      },
    },

    // Edge properties
    {
      name: 'direction',
      type: 'select',
      required: true,
      options: [
        { label: 'Produce', value: 'produce' },
        { label: 'Consume', value: 'consume' },
      ],
      index: true,
      admin: {
        description: 'Data flow direction',
      },
    },

    // Aggregated metrics (rolling 24h)
    {
      name: 'bytesLast24h',
      type: 'number',
      defaultValue: 0,
      admin: {
        description: 'Bytes transferred in the last 24 hours',
      },
    },
    {
      name: 'messagesLast24h',
      type: 'number',
      defaultValue: 0,
      admin: {
        description: 'Messages transferred in the last 24 hours',
      },
    },

    // Aggregated metrics (all-time)
    {
      name: 'bytesAllTime',
      type: 'number',
      defaultValue: 0,
      admin: {
        description: 'Total bytes transferred since first seen',
      },
    },
    {
      name: 'messagesAllTime',
      type: 'number',
      defaultValue: 0,
      admin: {
        description: 'Total messages transferred since first seen',
      },
    },

    // Timestamps
    {
      name: 'firstSeen',
      type: 'date',
      required: true,
      admin: {
        description: 'When this connection was first observed',
      },
    },
    {
      name: 'lastSeen',
      type: 'date',
      required: true,
      index: true,
      admin: {
        description: 'When this connection was last observed',
      },
    },

    // Status flags
    {
      name: 'isActive',
      type: 'checkbox',
      defaultValue: true,
      index: true,
      admin: {
        description: 'Connection seen in last 24 hours',
        position: 'sidebar',
      },
    },
    {
      name: 'isCrossWorkspace',
      type: 'checkbox',
      defaultValue: false,
      index: true,
      admin: {
        description: 'Source workspace differs from topic workspace',
        position: 'sidebar',
      },
    },
  ],
  timestamps: true,
}
