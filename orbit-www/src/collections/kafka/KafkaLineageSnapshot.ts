import type { CollectionConfig, Where } from 'payload'

export const KafkaLineageSnapshot: CollectionConfig = {
  slug: 'kafka-lineage-snapshots',
  admin: {
    useAsTitle: 'snapshotDate',
    group: 'Kafka',
    defaultColumns: ['topic', 'snapshotDate', 'producerCount', 'consumerCount', 'totalBytesIn'],
    description: 'Daily lineage snapshots for trend analysis',
  },
  access: {
    // Read: Users can see snapshots for topics in their workspaces
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
    // Snapshots are system-generated only
    create: ({ req: { user } }) => user?.collection === 'users',
    update: ({ req: { user } }) => user?.collection === 'users',
    delete: ({ req: { user } }) => user?.collection === 'users',
  },
  fields: [
    {
      name: 'topic',
      type: 'relationship',
      relationTo: 'kafka-topics',
      required: true,
      index: true,
      admin: {
        description: 'Topic this snapshot is for',
      },
    },
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
      admin: {
        description: 'Workspace that owns the topic',
      },
    },
    {
      name: 'snapshotDate',
      type: 'date',
      required: true,
      index: true,
      admin: {
        description: 'Date of this snapshot (truncated to day)',
      },
    },

    // Producer details
    {
      name: 'producers',
      type: 'array',
      admin: {
        description: 'Applications producing to this topic on this day',
      },
      fields: [
        {
          name: 'applicationId',
          type: 'text',
          required: true,
          admin: {
            description: 'Application ID',
          },
        },
        {
          name: 'applicationName',
          type: 'text',
          admin: {
            description: 'Application name (denormalized for historical reference)',
          },
        },
        {
          name: 'serviceAccountId',
          type: 'text',
          admin: {
            description: 'Service account ID',
          },
        },
        {
          name: 'workspaceId',
          type: 'text',
          admin: {
            description: 'Workspace ID',
          },
        },
        {
          name: 'workspaceName',
          type: 'text',
          admin: {
            description: 'Workspace name (denormalized)',
          },
        },
        {
          name: 'bytes',
          type: 'number',
          defaultValue: 0,
          admin: {
            description: 'Bytes produced on this day',
          },
        },
        {
          name: 'messages',
          type: 'number',
          defaultValue: 0,
          admin: {
            description: 'Messages produced on this day',
          },
        },
      ],
    },

    // Consumer details
    {
      name: 'consumers',
      type: 'array',
      admin: {
        description: 'Applications consuming from this topic on this day',
      },
      fields: [
        {
          name: 'applicationId',
          type: 'text',
          required: true,
          admin: {
            description: 'Application ID',
          },
        },
        {
          name: 'applicationName',
          type: 'text',
          admin: {
            description: 'Application name (denormalized for historical reference)',
          },
        },
        {
          name: 'serviceAccountId',
          type: 'text',
          admin: {
            description: 'Service account ID',
          },
        },
        {
          name: 'workspaceId',
          type: 'text',
          admin: {
            description: 'Workspace ID',
          },
        },
        {
          name: 'workspaceName',
          type: 'text',
          admin: {
            description: 'Workspace name (denormalized)',
          },
        },
        {
          name: 'bytes',
          type: 'number',
          defaultValue: 0,
          admin: {
            description: 'Bytes consumed on this day',
          },
        },
        {
          name: 'messages',
          type: 'number',
          defaultValue: 0,
          admin: {
            description: 'Messages consumed on this day',
          },
        },
      ],
    },

    // Summary stats
    {
      name: 'totalBytesIn',
      type: 'number',
      defaultValue: 0,
      admin: {
        description: 'Total bytes produced to topic on this day',
      },
    },
    {
      name: 'totalBytesOut',
      type: 'number',
      defaultValue: 0,
      admin: {
        description: 'Total bytes consumed from topic on this day',
      },
    },
    {
      name: 'totalMessagesIn',
      type: 'number',
      defaultValue: 0,
      admin: {
        description: 'Total messages produced to topic on this day',
      },
    },
    {
      name: 'totalMessagesOut',
      type: 'number',
      defaultValue: 0,
      admin: {
        description: 'Total messages consumed from topic on this day',
      },
    },
    {
      name: 'producerCount',
      type: 'number',
      defaultValue: 0,
      admin: {
        description: 'Number of unique producers on this day',
      },
    },
    {
      name: 'consumerCount',
      type: 'number',
      defaultValue: 0,
      admin: {
        description: 'Number of unique consumers on this day',
      },
    },
  ],
  timestamps: true,
}
