import type { CollectionConfig } from 'payload'

export const Apps: CollectionConfig = {
  slug: 'apps',
  admin: {
    useAsTitle: 'name',
    group: 'Catalog',
    defaultColumns: ['name', 'status', 'workspace', 'updatedAt'],
  },
  access: {
    read: ({ req: { user } }) => {
      if (!user) return false
      return {
        'workspace.id': {
          in: user.workspaces?.map((w: { workspace: { id: string } }) =>
            typeof w.workspace === 'object' ? w.workspace.id : w.workspace
          ) || [],
        },
      }
    },
    create: ({ req: { user } }) => !!user,
    update: ({ req: { user } }) => !!user,
    delete: ({ req: { user } }) => !!user,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      index: true,
    },
    {
      name: 'description',
      type: 'textarea',
    },
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
    },
    {
      name: 'repository',
      type: 'group',
      fields: [
        {
          name: 'owner',
          type: 'text',
          required: true,
        },
        {
          name: 'name',
          type: 'text',
          required: true,
        },
        {
          name: 'url',
          type: 'text',
          required: true,
        },
        {
          name: 'installationId',
          type: 'text',
          required: true,
        },
      ],
    },
    {
      name: 'origin',
      type: 'group',
      fields: [
        {
          name: 'type',
          type: 'select',
          required: true,
          options: [
            { label: 'Template', value: 'template' },
            { label: 'Imported', value: 'imported' },
          ],
        },
        {
          name: 'template',
          type: 'relationship',
          relationTo: 'templates',
          admin: {
            condition: (data, siblingData) => siblingData?.type === 'template',
          },
        },
        {
          name: 'instantiatedAt',
          type: 'date',
          admin: {
            condition: (data, siblingData) => siblingData?.type === 'template',
          },
        },
      ],
    },
    {
      name: 'syncMode',
      type: 'select',
      defaultValue: 'orbit-primary',
      options: [
        { label: 'Orbit Primary', value: 'orbit-primary' },
        { label: 'Manifest Primary', value: 'manifest-primary' },
      ],
    },
    {
      name: 'manifestSha',
      type: 'text',
      admin: {
        readOnly: true,
        description: 'SHA of last synced .orbit.yaml',
      },
    },
    {
      name: 'healthConfig',
      type: 'group',
      fields: [
        {
          name: 'endpoint',
          type: 'text',
          defaultValue: '/health',
        },
        {
          name: 'interval',
          type: 'number',
          defaultValue: 60,
          admin: {
            description: 'Check interval in seconds',
          },
        },
        {
          name: 'timeout',
          type: 'number',
          defaultValue: 5,
          admin: {
            description: 'Timeout in seconds',
          },
        },
      ],
    },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'unknown',
      options: [
        { label: 'Healthy', value: 'healthy' },
        { label: 'Degraded', value: 'degraded' },
        { label: 'Down', value: 'down' },
        { label: 'Unknown', value: 'unknown' },
      ],
      admin: {
        position: 'sidebar',
      },
    },
  ],
  timestamps: true,
}
