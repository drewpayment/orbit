import type { CollectionConfig, Where } from 'payload'
import { healthClient } from '@/lib/grpc/health-client'

export const Apps: CollectionConfig = {
  slug: 'apps',
  admin: {
    useAsTitle: 'name',
    group: 'Catalog',
    defaultColumns: ['name', 'status', 'workspace', 'updatedAt'],
  },
  hooks: {
    afterChange: [
      async ({ doc }) => {
        // Always call manageSchedule - it's idempotent (deletes and recreates)
        // This ensures schedule exists even after manual deletion or service restart
        const healthConfig = doc.healthConfig?.url ? {
          url: doc.healthConfig.url,
          method: doc.healthConfig.method || 'GET',
          expectedStatus: doc.healthConfig.expectedStatus || 200,
          interval: doc.healthConfig.interval || 60,
          timeout: doc.healthConfig.timeout || 10,
        } : undefined

        console.log('[Apps Hook] Calling manageSchedule:', {
          appId: doc.id,
          hasUrl: !!doc.healthConfig?.url,
        })

        // Fire and forget - don't block the save
        healthClient.manageSchedule({
          appId: doc.id,
          healthConfig,
        }).then(response => {
          console.log('[Apps Hook] manageSchedule success:', response)
        }).catch(err => console.error('[Apps Hook] Failed to manage health schedule:', err))

        return doc
      },
    ],
    afterDelete: [
      async ({ doc }) => {
        // Fire and forget - don't block the delete
        healthClient.deleteSchedule({ appId: doc.id })
          .catch(err => console.error('Failed to delete health schedule:', err))
      },
    ],
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
        {
          name: 'branch',
          type: 'text',
          defaultValue: 'main',
          admin: {
            description: 'Branch to build from (default: main)',
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
    // Build configuration (detected or user-specified)
    {
      name: 'buildConfig',
      type: 'group',
      admin: {
        description: 'Railpack build configuration',
      },
      fields: [
        {
          name: 'language',
          type: 'text',
          admin: {
            description: 'Detected language (e.g., nodejs, python, go)',
            readOnly: true,
          },
        },
        {
          name: 'languageVersion',
          type: 'text',
          admin: {
            description: 'Language version (e.g., 22, 3.12)',
          },
        },
        {
          name: 'framework',
          type: 'text',
          admin: {
            description: 'Detected framework (e.g., nextjs, fastapi)',
            readOnly: true,
          },
        },
        {
          name: 'buildCommand',
          type: 'text',
          admin: {
            description: 'Build command override',
          },
        },
        {
          name: 'startCommand',
          type: 'text',
          admin: {
            description: 'Start command override',
          },
        },
        {
          name: 'dockerfilePath',
          type: 'text',
          admin: {
            description: 'Path to Dockerfile (if Railpack detection fails)',
          },
        },
      ],
    },
    // Latest build information
    {
      name: 'latestBuild',
      type: 'group',
      admin: {
        description: 'Information about the most recent build',
      },
      fields: [
        {
          name: 'imageUrl',
          type: 'text',
          admin: {
            description: 'Full image URL (e.g., ghcr.io/org/app:tag)',
            readOnly: true,
          },
        },
        {
          name: 'imageDigest',
          type: 'text',
          admin: {
            description: 'Image digest (sha256:...)',
            readOnly: true,
          },
        },
        {
          name: 'imageTag',
          type: 'text',
          admin: {
            description: 'Image tag used',
            readOnly: true,
          },
        },
        {
          name: 'builtAt',
          type: 'date',
          admin: {
            readOnly: true,
          },
        },
        {
          name: 'builtBy',
          type: 'relationship',
          relationTo: 'users',
          admin: {
            readOnly: true,
          },
        },
        {
          name: 'buildWorkflowId',
          type: 'text',
          admin: {
            description: 'Temporal workflow ID for the build',
            readOnly: true,
          },
        },
        {
          name: 'status',
          type: 'select',
          options: [
            { label: 'Never Built', value: 'none' },
            { label: 'Analyzing', value: 'analyzing' },
            { label: 'Awaiting Input', value: 'awaiting_input' },
            { label: 'Building', value: 'building' },
            { label: 'Success', value: 'success' },
            { label: 'Failed', value: 'failed' },
          ],
          defaultValue: 'none',
          admin: {
            readOnly: true,
          },
        },
        {
          name: 'availableChoices',
          type: 'json',
          admin: {
            description: 'Available package manager choices when awaiting_input',
            readOnly: true,
            condition: (data) => data?.latestBuild?.status === 'awaiting_input',
          },
        },
        {
          name: 'error',
          type: 'textarea',
          admin: {
            description: 'Error message if build failed',
            readOnly: true,
            condition: (data) => data?.latestBuild?.status === 'failed',
          },
        },
      ],
    },
    // Registry configuration for this app
    {
      name: 'registryConfig',
      type: 'relationship',
      relationTo: 'registry-configs',
      admin: {
        description: 'Container registry for built images (uses workspace default if not set)',
        position: 'sidebar',
      },
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
