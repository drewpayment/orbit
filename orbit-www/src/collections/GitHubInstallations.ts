import type { CollectionConfig } from 'payload'
import { isAdmin } from '../access/isAdmin'

export const GitHubInstallations: CollectionConfig = {
  slug: 'github-installations',

  admin: {
    useAsTitle: 'accountLogin',
    defaultColumns: ['accountLogin', 'installationId', 'status', 'installedAt'],
    group: 'Integrations',
    description: 'GitHub App installations for repository operations',
  },

  access: {
    // Only admins can view/manage GitHub installations
    read: isAdmin,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },

  fields: [
    // ===== GitHub App Installation Details =====
    {
      name: 'installationId',
      type: 'number',
      required: true,
      unique: true,
      admin: {
        description: 'GitHub App installation ID from GitHub API',
        readOnly: true,
      },
    },
    {
      name: 'accountLogin',
      type: 'text',
      required: true,
      admin: {
        description: 'GitHub organization name (e.g., "mycompany")',
      },
    },
    {
      name: 'accountId',
      type: 'number',
      required: true,
      admin: {
        description: 'GitHub account ID',
        readOnly: true,
      },
    },
    {
      name: 'accountType',
      type: 'select',
      required: true,
      defaultValue: 'Organization',
      options: [
        { label: 'Organization', value: 'Organization' },
        { label: 'User', value: 'User' },
      ],
      admin: {
        description: 'Type of GitHub account (usually Organization)',
      },
    },
    {
      name: 'accountAvatarUrl',
      type: 'text',
      admin: {
        description: 'GitHub organization avatar URL',
      },
    },

    // ===== Installation Token (Encrypted) =====
    {
      name: 'installationToken',
      type: 'text',
      required: true,
      admin: {
        description: 'Encrypted GitHub App installation access token',
        hidden: true, // Never show in admin UI
        readOnly: true,
      },
    },
    {
      name: 'tokenExpiresAt',
      type: 'date',
      required: true,
      admin: {
        description: 'When the current token expires (auto-refreshed every 50 min)',
        readOnly: true,
      },
    },
    {
      name: 'tokenLastRefreshedAt',
      type: 'date',
      admin: {
        description: 'Last successful token refresh timestamp',
        readOnly: true,
      },
    },

    // ===== Repository Access Configuration =====
    {
      name: 'repositorySelection',
      type: 'select',
      required: true,
      defaultValue: 'all',
      options: [
        { label: 'All Repositories', value: 'all' },
        { label: 'Selected Repositories', value: 'selected' },
      ],
      admin: {
        description: 'Repository access scope configured during installation',
      },
    },
    {
      name: 'selectedRepositories',
      type: 'array',
      admin: {
        description: 'Specific repositories if repositorySelection is "selected"',
        condition: (data) => data.repositorySelection === 'selected',
      },
      fields: [
        {
          name: 'fullName',
          type: 'text',
          required: true,
          admin: {
            description: 'Full repo name (e.g., "mycompany/backend")',
          },
        },
        {
          name: 'id',
          type: 'number',
          required: true,
        },
        {
          name: 'private',
          type: 'checkbox',
          defaultValue: false,
        },
      ],
    },

    // ===== Workspace Access Mapping =====
    {
      name: 'allowedWorkspaces',
      type: 'relationship',
      relationTo: 'workspaces',
      hasMany: true,
      admin: {
        description: 'Which Orbit workspaces can use this GitHub installation',
        position: 'sidebar',
      },
    },

    // ===== Lifecycle Status =====
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Suspended', value: 'suspended' },
        { label: 'Token Refresh Failed', value: 'refresh_failed' },
      ],
      admin: {
        description: 'Installation health status',
        position: 'sidebar',
      },
    },
    {
      name: 'suspendedAt',
      type: 'date',
      admin: {
        description: 'When the installation was suspended',
        condition: (data) => data.status === 'suspended',
      },
    },
    {
      name: 'suspensionReason',
      type: 'textarea',
      admin: {
        description: 'Why the installation was suspended',
        condition: (data) => data.status === 'suspended',
      },
    },

    // ===== Temporal Workflow Integration =====
    {
      name: 'temporalWorkflowId',
      type: 'text',
      admin: {
        description: 'ID of the token refresh Temporal workflow',
        readOnly: true,
        position: 'sidebar',
      },
    },
    {
      name: 'temporalWorkflowStatus',
      type: 'select',
      options: [
        { label: 'Running', value: 'running' },
        { label: 'Stopped', value: 'stopped' },
        { label: 'Failed', value: 'failed' },
      ],
      admin: {
        description: 'Token refresh workflow status',
        position: 'sidebar',
      },
    },

    // ===== Installation Metadata =====
    {
      name: 'installedBy',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      admin: {
        description: 'Orbit admin who installed the GitHub App',
        position: 'sidebar',
      },
    },
    {
      name: 'installedAt',
      type: 'date',
      required: true,
      defaultValue: () => new Date().toISOString(),
      admin: {
        description: 'When the GitHub App was installed',
        readOnly: true,
        position: 'sidebar',
      },
    },

    // ===== Multi-Tenancy (Future) =====
    {
      name: 'tenant',
      type: 'relationship',
      relationTo: 'tenants',
      admin: {
        description: 'For multi-tenant SaaS (null = default tenant for self-hosted)',
        position: 'sidebar',
      },
    },
  ],

  hooks: {
    afterChange: [
      async ({ doc, operation, req }) => {
        // Future: Start Temporal workflow on create
        if (operation === 'create') {
          // TODO: Start GitHubTokenRefreshWorkflow
          console.log('[GitHub Installation] Created:', doc.id)
        }
      },
    ],
  },
}
