import type { CollectionConfig, Where } from 'payload'

export const KafkaTopics: CollectionConfig = {
  slug: 'kafka-topics',
  admin: {
    useAsTitle: 'name',
    group: 'Kafka',
    defaultColumns: ['name', 'workspace', 'environment', 'status', 'partitions'],
    description: 'Kafka topics owned by workspaces',
  },
  access: {
    // Read: Users can see topics in their workspaces
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

      const topic = await payload.findByID({
        collection: 'kafka-topics',
        id,
        overrideAccess: true,
      })

      const workspaceId = typeof topic.workspace === 'string' ? topic.workspace : topic.workspace.id

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

      const topic = await payload.findByID({
        collection: 'kafka-topics',
        id,
        overrideAccess: true,
      })

      const workspaceId = typeof topic.workspace === 'string' ? topic.workspace : topic.workspace.id

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
      admin: {
        description: 'Owning workspace',
      },
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      index: true,
      admin: {
        description: 'Topic name (validated against naming conventions)',
      },
    },
    {
      name: 'description',
      type: 'textarea',
      admin: {
        description: 'Topic description',
      },
    },
    {
      name: 'environment',
      type: 'text',
      required: true,
      index: true,
      admin: {
        description: 'Target environment: dev, staging, prod',
      },
    },
    {
      name: 'cluster',
      type: 'relationship',
      relationTo: 'kafka-clusters',
      admin: {
        readOnly: true,
        description: 'Resolved cluster (stored for reference)',
      },
    },
    {
      name: 'partitions',
      type: 'number',
      required: true,
      defaultValue: 3,
      min: 1,
      admin: {
        description: 'Number of partitions',
      },
    },
    {
      name: 'replicationFactor',
      type: 'number',
      required: true,
      defaultValue: 3,
      min: 1,
      admin: {
        description: 'Replication factor',
      },
    },
    {
      name: 'retentionMs',
      type: 'number',
      defaultValue: 604800000, // 7 days
      admin: {
        description: 'Retention period in milliseconds',
      },
    },
    {
      name: 'cleanupPolicy',
      type: 'select',
      defaultValue: 'delete',
      options: [
        { label: 'Delete', value: 'delete' },
        { label: 'Compact', value: 'compact' },
        { label: 'Compact + Delete', value: 'compact,delete' },
      ],
    },
    {
      name: 'compression',
      type: 'select',
      defaultValue: 'none',
      options: [
        { label: 'None', value: 'none' },
        { label: 'Gzip', value: 'gzip' },
        { label: 'Snappy', value: 'snappy' },
        { label: 'LZ4', value: 'lz4' },
        { label: 'Zstd', value: 'zstd' },
      ],
    },
    {
      name: 'config',
      type: 'json',
      admin: {
        description: 'Additional topic configuration',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending-approval',
      options: [
        { label: 'Pending Approval', value: 'pending-approval' },
        { label: 'Provisioning', value: 'provisioning' },
        { label: 'Active', value: 'active' },
        { label: 'Failed', value: 'failed' },
        { label: 'Deleting', value: 'deleting' },
      ],
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'workflowId',
      type: 'text',
      admin: {
        readOnly: true,
        description: 'Temporal workflow ID for async tracking',
        position: 'sidebar',
      },
    },
    {
      name: 'approvalRequired',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        description: 'Based on policy evaluation',
        position: 'sidebar',
      },
    },
    {
      name: 'approvedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        readOnly: true,
        description: 'Who approved (if required)',
      },
    },
    {
      name: 'approvedAt',
      type: 'date',
      admin: {
        readOnly: true,
        description: 'Approval timestamp',
      },
    },
  ],
  timestamps: true,
}
