import type { CollectionConfig } from 'payload'
import { memberCreate, workspaceScopedRead, docWorkspaceMutate, relationId } from '@/lib/authz/payload'

export const Deployments: CollectionConfig = {
  slug: 'deployments',
  admin: {
    useAsTitle: 'name',
    group: 'Catalog',
    defaultColumns: ['name', 'app', 'status', 'healthStatus', 'lastDeployedAt'],
  },
  access: {
    // Read: Based on workspace membership through app relationship
    read: workspaceScopedRead({ via: [{ collection: 'apps', on: 'app' }] }),
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
    update: docWorkspaceMutate('deployments', ['owner', 'admin', 'member'], {
      field: 'app',
      resolveWorkspace: async ({ doc, payload }) => {
        const appId = relationId((doc as { app?: unknown }).app)
        if (!appId) return null
        try {
          const app = await payload.findByID({
            collection: 'apps',
            id: appId,
            depth: 0,
            overrideAccess: true,
          })
          return relationId(app.workspace)
        } catch {
          return null
        }
      },
    }),
    // Delete: Workspace owners and admins only
    delete: docWorkspaceMutate('deployments', ['owner', 'admin'], {
      field: 'app',
      resolveWorkspace: async ({ doc, payload }) => {
        const appId = relationId((doc as { app?: unknown }).app)
        if (!appId) return null
        try {
          const app = await payload.findByID({
            collection: 'apps',
            id: appId,
            depth: 0,
            overrideAccess: true,
          })
          return relationId(app.workspace)
        } catch {
          return null
        }
      },
    }),
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
