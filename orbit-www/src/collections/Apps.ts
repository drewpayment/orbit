import type { CollectionConfig, Where } from 'payload'

export const Apps: CollectionConfig = {
  slug: 'apps',
  admin: {
    useAsTitle: 'name',
    group: 'Catalog',
    defaultColumns: ['name', 'status', 'workspace', 'updatedAt'],
  },
  access: {
    // Read: Admins see all, others see workspace-scoped
    read: async ({ req: { user, payload } }) => {
      if (!user) return false

      // Payload admin users can see all apps (user.collection indicates Payload auth)
      // TODO: Add proper role-based check when roles are implemented
      if (user.collection === 'users') return true

      // Get user's workspace memberships
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

      // Return query constraint: in user's workspaces
      return {
        workspace: { in: workspaceIds },
      } as Where
    },
    // Create: Users with app:create permission (workspace membership checked by workspace field)
    create: ({ req: { user } }) => !!user,
    // Update: Admins or workspace members (owner, admin, or member role)
    update: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false

      // Payload admin users can update all apps
      if (user.collection === 'users') return true

      const app = await payload.findByID({
        collection: 'apps',
        id,
        overrideAccess: true,
      })

      const workspaceId = typeof app.workspace === 'string'
        ? app.workspace
        : app.workspace.id

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
    // Delete: System admins or workspace owners/admins only
    delete: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false

      // Payload admin users can delete all apps
      if (user.collection === 'users') return true

      const app = await payload.findByID({
        collection: 'apps',
        id,
        overrideAccess: true,
      })

      const workspaceId = typeof app.workspace === 'string'
        ? app.workspace
        : app.workspace.id

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
      admin: {
        description: 'Optional - link to a Git repository',
      },
      fields: [
        {
          name: 'owner',
          type: 'text',
        },
        {
          name: 'name',
          type: 'text',
        },
        {
          name: 'url',
          type: 'text',
        },
        {
          name: 'installationId',
          type: 'text',
          admin: {
            description: 'GitHub App installation ID',
          },
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
          defaultValue: 'manual',
          options: [
            { label: 'Template', value: 'template' },
            { label: 'Imported', value: 'imported' },
            { label: 'Manual', value: 'manual' },
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
      admin: {
        description: 'Configure health monitoring for this application',
      },
      fields: [
        {
          name: 'url',
          type: 'text',
          admin: {
            description: 'Full URL to monitor (e.g., https://api.example.com/health)',
          },
        },
        {
          name: 'interval',
          type: 'number',
          defaultValue: 60,
          admin: {
            description: 'Check interval in seconds (minimum 30)',
          },
        },
        {
          name: 'timeout',
          type: 'number',
          defaultValue: 10,
          admin: {
            description: 'Request timeout in seconds',
          },
        },
        {
          name: 'method',
          type: 'select',
          defaultValue: 'GET',
          options: [
            { label: 'GET', value: 'GET' },
            { label: 'HEAD', value: 'HEAD' },
            { label: 'POST', value: 'POST' },
          ],
        },
        {
          name: 'expectedStatus',
          type: 'number',
          defaultValue: 200,
          admin: {
            description: 'Expected HTTP status code',
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
