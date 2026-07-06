import type { CollectionConfig, Where } from 'payload'
import { memberCreate } from '@/lib/access/collection-access'

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

      // workspace-members.user stores the Better Auth ID — fail closed if absent.
      const userKey = user.betterAuthId
      if (!userKey) return false
      // Get user's workspace memberships
      const memberships = await payload.find({
        collection: 'workspace-members',
        where: {
          user: { equals: userKey },
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
    // Create: active member of the workspace owning `data.app` (was `!!user`
    // — gap closed; the app→workspace relation is indirect, so resolve via
    // the apps record rather than a direct `workspace` field).
    create: memberCreate({
      field: 'app',
      resolveWorkspace: async ({ data, payload }) => {
        const appId =
          typeof (data as { app?: unknown } | undefined)?.app === 'string'
            ? (data as { app?: string }).app
            : (data as { app?: { id?: string } } | undefined)?.app?.id
        if (!appId) return null
        try {
          const app = await payload.findByID({
            collection: 'apps',
            id: appId,
            depth: 0,
            overrideAccess: true,
          })
          return typeof app.workspace === 'string' ? app.workspace : app.workspace?.id ?? null
        } catch {
          return null
        }
      },
    }),
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

      const updateUserKey = user.betterAuthId
      if (!updateUserKey) return false
      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: workspaceId } },
            { user: { equals: updateUserKey } },
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

      const deleteUserKey = user.betterAuthId
      if (!deleteUserKey) return false
      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: workspaceId } },
            { user: { equals: deleteUserKey } },
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
      options: [
        { label: 'Docker Compose', value: 'docker-compose' },
        { label: 'Helm', value: 'helm' },
        { label: 'Custom', value: 'custom' },
      ],
    },
    {
      name: 'generatorSlug',
      type: 'text',
      admin: {
        description: 'Specific generator slug used (e.g., docker-compose-basic, helm-basic)',
      },
    },
    {
      name: 'launch',
      type: 'relationship',
      relationTo: 'launches',
      admin: {
        description: 'Launch infrastructure this deployment targets',
      },
    },
    {
      name: 'deployStrategy',
      type: 'select',
      options: [
        { label: 'Docker Compose', value: 'docker-compose' },
        { label: 'Helm', value: 'helm' },
        { label: 'Custom', value: 'custom' },
        { label: 'GCS Static Site', value: 'gcs-static-site' },
        { label: 'Cloud Run', value: 'cloud-run' },
      ],
      admin: {
        description: 'Deployment strategy — auto-detected from Launch template when applicable',
      },
    },
    {
      name: 'launchOutputs',
      type: 'json',
      admin: {
        description: 'Snapshot of Launch infrastructure outputs at deploy time',
        readOnly: true,
      },
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
    {
      name: 'generatedFiles',
      type: 'json',
      admin: {
        readOnly: true,
        description: 'Generated deployment files awaiting commit',
      },
    },
  ],
  timestamps: true,
}
