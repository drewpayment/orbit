import type { CollectionConfig, Where } from 'payload'

export const Deployments: CollectionConfig = {
  slug: 'deployments',
  admin: {
    useAsTitle: 'name',
    group: 'Catalog',
    defaultColumns: ['name', 'app', 'status', 'healthStatus', 'lastDeployedAt'],
  },
  access: {
    // Read: Based on workspace membership through app relationship
    read: async ({ req: { user, payload } }) => {
      if (!user) return false

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

      // Get apps in user's workspaces
      const apps = await payload.find({
        collection: 'apps',
        where: {
          workspace: { in: workspaceIds },
        },
        limit: 10000,
        overrideAccess: true,
      })

      const appIds = apps.docs.map(app => String(app.id))

      // Return query constraint: deployments where app is in user's workspaces
      return {
        app: { in: appIds },
      } as Where
    },
    // Create: Users with active workspace membership (validated through app access)
    create: ({ req: { user } }) => !!user,
    // Update: Workspace members (owner, admin, or member role)
    update: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false

      const deployment = await payload.findByID({
        collection: 'deployments',
        id,
        overrideAccess: true,
      })

      const appId = typeof deployment.app === 'string'
        ? deployment.app
        : deployment.app.id

      const app = await payload.findByID({
        collection: 'apps',
        id: appId,
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
    // Delete: Workspace owners and admins only
    delete: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false

      const deployment = await payload.findByID({
        collection: 'deployments',
        id,
        overrideAccess: true,
      })

      const appId = typeof deployment.app === 'string'
        ? deployment.app
        : deployment.app.id

      const app = await payload.findByID({
        collection: 'apps',
        id: appId,
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
      admin: {
        description: 'e.g., production, staging, development',
      },
    },
    {
      name: 'app',
      type: 'relationship',
      relationTo: 'apps',
      required: true,
      index: true,
    },
    {
      name: 'generator',
      type: 'select',
      required: true,
      options: [
        { label: 'Docker Compose', value: 'docker-compose' },
        { label: 'Terraform', value: 'terraform' },
        { label: 'Helm', value: 'helm' },
        { label: 'Custom', value: 'custom' },
      ],
    },
    {
      name: 'config',
      type: 'json',
      admin: {
        description: 'Generator-specific configuration',
      },
    },
    {
      name: 'target',
      type: 'group',
      fields: [
        {
          name: 'type',
          type: 'text',
          required: true,
          admin: {
            description: 'e.g., kubernetes, aws-ecs, docker-host',
          },
        },
        {
          name: 'region',
          type: 'text',
        },
        {
          name: 'cluster',
          type: 'text',
        },
        {
          name: 'url',
          type: 'text',
          admin: {
            description: 'Deployment URL after successful deploy',
          },
        },
      ],
    },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'pending',
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Deploying', value: 'deploying' },
        { label: 'Generated', value: 'generated' },
        { label: 'Deployed', value: 'deployed' },
        { label: 'Failed', value: 'failed' },
      ],
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'lastDeployedAt',
      type: 'date',
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'lastDeployedBy',
      type: 'relationship',
      relationTo: 'users',
    },
    {
      name: 'healthStatus',
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
    {
      name: 'healthLastChecked',
      type: 'date',
    },
    {
      name: 'workflowId',
      type: 'text',
      admin: {
        readOnly: true,
        description: 'Active Temporal workflow ID',
      },
    },
    {
      name: 'deploymentError',
      type: 'textarea',
      admin: {
        readOnly: true,
        condition: (data) => data?.status === 'failed',
      },
    },
  ],
  timestamps: true,
}
