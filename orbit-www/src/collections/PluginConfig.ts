import type { CollectionConfig } from 'payload'

/**
 * PluginConfig Collection
 *
 * Per-workspace plugin configuration and enablement.
 * Each record represents a plugin enabled for a specific workspace,
 * along with its configuration values and status.
 */
export const PluginConfig: CollectionConfig = {
  slug: 'plugin-config',
  admin: {
    useAsTitle: 'displayName',
    defaultColumns: ['workspace', 'plugin', 'enabled', 'updatedAt'],
    description: 'Manage plugin configurations for workspaces',
    group: 'Platform',
  },
  access: {
    // Users can read plugin configs for workspaces they're members of
    read: async ({ req: { user, payload } }) => {
      if (!user) return false

      // Admin can read all
      if (user.roles?.includes('admin')) return true

      // Get user's workspaces
      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [{ user: { equals: user.id } }, { status: { equals: 'active' } }],
        },
        limit: 100,
      })

      const workspaceIds = members.docs.map((m) => {
        return typeof m.workspace === 'string' ? m.workspace : m.workspace.id
      })

      // Query by workspace ID (relationship field)
      return {
        workspace: {
          in: workspaceIds,
        },
      }
    },
    // Only workspace admins/owners can create plugin configs
    create: async ({ req: { user, payload }, data }) => {
      if (!user) return false
      if (user.roles?.includes('admin')) return true

      // If no workspace is specified yet (rendering the form), allow the user to see it
      // The actual permission check will happen when they submit with a workspace selected
      if (!data?.workspace) return true

      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: data.workspace } },
            { user: { equals: user.id } },
            { role: { in: ['owner', 'admin'] } },
            { status: { equals: 'active' } },
          ],
        },
      })

      return members.docs.length > 0
    },
    // Only workspace admins/owners can update plugin configs
    update: async ({ req: { user, payload }, id }) => {
      if (!user) return false
      if (user.roles?.includes('admin')) return true

      try {
        const config = await payload.findByID({
          collection: 'plugin-config',
          id,
        })

        const members = await payload.find({
          collection: 'workspace-members',
          where: {
            and: [
              { workspace: { equals: config.workspace } },
              { user: { equals: user.id } },
              { role: { in: ['owner', 'admin'] } },
              { status: { equals: 'active' } },
            ],
          },
        })

        return members.docs.length > 0
      } catch (error) {
        // If config not found, deny access
        return false
      }
    },
    // Only workspace owners can delete plugin configs
    delete: async ({ req: { user, payload }, id }) => {
      if (!user) return false
      if (user.roles?.includes('admin')) return true

      try {
        const config = await payload.findByID({
          collection: 'plugin-config',
          id,
        })

        const members = await payload.find({
          collection: 'workspace-members',
          where: {
            and: [
              { workspace: { equals: config.workspace } },
              { user: { equals: user.id } },
              { role: { equals: 'owner' } },
              { status: { equals: 'active' } },
            ],
          },
        })

        return members.docs.length > 0
      } catch (error) {
        // If config not found, deny access
        return false
      }
    },
  },
  fields: [
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      label: 'Workspace',
      admin: {
        description: 'The workspace this plugin configuration belongs to',
      },
    },
    {
      name: 'plugin',
      type: 'relationship',
      relationTo: 'plugin-registry',
      required: true,
      label: 'Plugin',
      admin: {
        description: 'The plugin being configured',
      },
    },
    {
      name: 'displayName',
      type: 'text',
      label: 'Display Name (Computed)',
      admin: {
        readOnly: true,
        description: 'Auto-computed from workspace and plugin names',
      },
      hooks: {
        beforeChange: [
          async ({ data, req, operation }) => {
            if (operation === 'create' || operation === 'update') {
              // Fetch workspace and plugin to build display name
              try {
                const workspace =
                  typeof data.workspace === 'string'
                    ? await req.payload.findByID({
                        collection: 'workspaces',
                        id: data.workspace,
                      })
                    : data.workspace

                const plugin =
                  typeof data.plugin === 'string'
                    ? await req.payload.findByID({
                        collection: 'plugin-registry',
                        id: data.plugin,
                      })
                    : data.plugin

                return `${workspace?.name} - ${plugin?.name}`
              } catch (error) {
                return 'Unknown'
              }
            }
            return data.displayName
          },
        ],
      },
    },
    {
      name: 'enabled',
      type: 'checkbox',
      required: true,
      defaultValue: true,
      label: 'Enabled',
      admin: {
        description: 'Whether this plugin is currently active for the workspace',
      },
    },
    {
      name: 'configuration',
      type: 'json',
      label: 'Configuration Values',
      admin: {
        description: 'Plugin-specific configuration (non-sensitive values)',
      },
    },
    {
      name: 'secrets',
      type: 'array',
      label: 'Secrets',
      admin: {
        description: 'Encrypted sensitive configuration (API keys, tokens, etc.)',
      },
      fields: [
        {
          name: 'key',
          type: 'text',
          required: true,
          label: 'Secret Key',
        },
        {
          name: 'value',
          type: 'text',
          required: true,
          label: 'Secret Value',
          admin: {
            description: 'This value will be encrypted',
            components: {
              Field: {
                path: '/components/admin/fields/EncryptedField',
                exportName: 'EncryptedField',
              },
            },
          },
        },
        {
          name: 'description',
          type: 'text',
          label: 'Description',
        },
      ],
    },
    {
      name: 'status',
      type: 'group',
      label: 'Plugin Status',
      fields: [
        {
          name: 'health',
          type: 'select',
          label: 'Health Status',
          options: [
            { label: 'Healthy', value: 'healthy' },
            { label: 'Degraded', value: 'degraded' },
            { label: 'Unhealthy', value: 'unhealthy' },
            { label: 'Unknown', value: 'unknown' },
          ],
          defaultValue: 'unknown',
          admin: {
            description: 'Current health status from the plugins service',
          },
        },
        {
          name: 'lastHealthCheck',
          type: 'date',
          label: 'Last Health Check',
          admin: {
            description: 'When the plugin health was last checked',
          },
        },
        {
          name: 'errorMessage',
          type: 'textarea',
          label: 'Error Message',
          admin: {
            description: 'Latest error message if plugin is unhealthy',
          },
        },
        {
          name: 'requestCount',
          type: 'number',
          label: 'Total Requests',
          defaultValue: 0,
          admin: {
            description: 'Total number of requests to this plugin',
          },
        },
        {
          name: 'errorCount',
          type: 'number',
          label: 'Total Errors',
          defaultValue: 0,
          admin: {
            description: 'Total number of errors from this plugin',
          },
        },
      ],
    },
    {
      name: 'enabledBy',
      type: 'relationship',
      relationTo: 'users',
      label: 'Enabled By',
      admin: {
        description: 'User who enabled this plugin',
        readOnly: true,
      },
    },
    {
      name: 'enabledAt',
      type: 'date',
      label: 'Enabled At',
      admin: {
        description: 'When this plugin was enabled',
        readOnly: true,
      },
    },
    {
      name: 'lastModifiedBy',
      type: 'relationship',
      relationTo: 'users',
      label: 'Last Modified By',
      admin: {
        description: 'User who last modified this configuration',
        readOnly: true,
      },
    },
  ],
  indexes: [
    {
      fields: ['workspace', 'plugin'],
      options: {
        unique: true,
      },
    },
  ],
  hooks: {
    beforeChange: [
      async ({ data, req, operation }) => {
        if (operation === 'create') {
          // Set enabledBy and enabledAt on creation
          data.enabledBy = req.user?.id
          data.enabledAt = new Date().toISOString()
        }

        // Always update lastModifiedBy
        data.lastModifiedBy = req.user?.id

        return data
      },
    ],
    afterChange: [
      async ({ doc, req, operation }) => {
        // If this is a new plugin config or enabled state changed,
        // we could trigger a sync with the plugins gRPC service here
        if (operation === 'create' || operation === 'update') {
          // TODO: Call plugins gRPC service to sync configuration
          console.log(`Plugin config ${operation}: ${doc.displayName}`)
        }
      },
    ],
  },
  timestamps: true,
}
