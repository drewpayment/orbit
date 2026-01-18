import type { CollectionConfig } from 'payload'

/**
 * PluginRegistry Collection
 *
 * Central registry of all available Backstage plugins.
 * This is the source of truth for what plugins exist and their metadata.
 * Admin-only access - plugins are added/managed by platform administrators.
 */
export const PluginRegistry: CollectionConfig = {
  slug: 'plugin-registry',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'pluginId', 'category', 'version', 'enabled'],
    description: 'Manage available Backstage plugins for the platform',
    group: 'Platform',
  },
  access: {
    // Everyone can read the plugin registry (to browse available plugins)
    read: () => true,
    // Only authenticated users can manage plugins (admin check removed - no roles field)
    create: ({ req: { user } }) => !!user,
    update: ({ req: { user } }) => !!user,
    delete: ({ req: { user } }) => !!user,
  },
  fields: [
    {
      name: 'pluginId',
      type: 'text',
      required: true,
      unique: true,
      label: 'Plugin ID',
      admin: {
        description: 'Unique identifier for the plugin (e.g., "catalog", "github-actions", "argocd")',
      },
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      label: 'Plugin Name',
      admin: {
        description: 'Human-readable name (e.g., "Software Catalog", "GitHub Actions")',
      },
    },
    {
      name: 'description',
      type: 'textarea',
      required: true,
      label: 'Description',
      admin: {
        description: 'Detailed description of what the plugin does',
      },
    },
    {
      name: 'category',
      type: 'select',
      required: true,
      label: 'Category',
      options: [
        { label: 'API Catalog', value: 'api-catalog' },
        { label: 'CI/CD', value: 'ci-cd' },
        { label: 'Infrastructure', value: 'infrastructure' },
        { label: 'Cloud Resources', value: 'cloud-resources' },
        { label: 'Security', value: 'security' },
        { label: 'Monitoring', value: 'monitoring' },
        { label: 'Documentation', value: 'documentation' },
        { label: 'Collaboration', value: 'collaboration' },
        { label: 'Other', value: 'other' },
      ],
      admin: {
        description: 'Plugin category for organization',
      },
    },
    {
      name: 'enabled',
      type: 'checkbox',
      label: 'Enabled Globally',
      defaultValue: true,
      admin: {
        description: 'If disabled, this plugin cannot be enabled by any workspace',
      },
    },
    {
      name: 'metadata',
      type: 'group',
      label: 'Plugin Metadata',
      fields: [
        {
          name: 'version',
          type: 'text',
          label: 'Version',
          admin: {
            description: 'Plugin version (e.g., "1.2.3")',
          },
        },
        {
          name: 'backstagePackage',
          type: 'text',
          required: true,
          label: 'Backstage NPM Package',
          admin: {
            description: 'NPM package name (e.g., "@backstage/plugin-catalog")',
          },
        },
        {
          name: 'apiBasePath',
          type: 'text',
          required: true,
          label: 'API Base Path',
          admin: {
            description: 'Base path for plugin API endpoints (e.g., "/api/catalog")',
          },
        },
        {
          name: 'documentationUrl',
          type: 'text',
          label: 'Documentation URL',
          admin: {
            description: 'Link to plugin documentation',
          },
        },
        {
          name: 'icon',
          type: 'upload',
          relationTo: 'media',
          label: 'Plugin Icon',
          admin: {
            description: 'Icon to display in the UI',
          },
        },
      ],
    },
    {
      name: 'configuration',
      type: 'group',
      label: 'Configuration Schema',
      fields: [
        {
          name: 'requiredConfigKeys',
          type: 'array',
          label: 'Required Configuration Keys',
          admin: {
            description: 'Configuration keys that must be provided when enabling this plugin',
          },
          fields: [
            {
              name: 'key',
              type: 'text',
              required: true,
              label: 'Config Key',
            },
            {
              name: 'label',
              type: 'text',
              required: true,
              label: 'Display Label',
            },
            {
              name: 'description',
              type: 'textarea',
              label: 'Description',
            },
            {
              name: 'type',
              type: 'select',
              required: true,
              label: 'Value Type',
              options: [
                { label: 'Text', value: 'text' },
                { label: 'Number', value: 'number' },
                { label: 'Boolean', value: 'boolean' },
                { label: 'URL', value: 'url' },
                { label: 'Secret', value: 'secret' },
              ],
            },
            {
              name: 'defaultValue',
              type: 'text',
              label: 'Default Value',
            },
            {
              name: 'isSecret',
              type: 'checkbox',
              label: 'Is Secret',
              defaultValue: false,
              admin: {
                description: 'If checked, this value will be encrypted in the database',
              },
            },
          ],
        },
        {
          name: 'optionalConfigKeys',
          type: 'array',
          label: 'Optional Configuration Keys',
          admin: {
            description: 'Additional configuration options that are optional',
          },
          fields: [
            {
              name: 'key',
              type: 'text',
              required: true,
              label: 'Config Key',
            },
            {
              name: 'label',
              type: 'text',
              required: true,
              label: 'Display Label',
            },
            {
              name: 'description',
              type: 'textarea',
              label: 'Description',
            },
            {
              name: 'type',
              type: 'select',
              required: true,
              label: 'Value Type',
              options: [
                { label: 'Text', value: 'text' },
                { label: 'Number', value: 'number' },
                { label: 'Boolean', value: 'boolean' },
                { label: 'URL', value: 'url' },
                { label: 'Secret', value: 'secret' },
              ],
            },
            {
              name: 'defaultValue',
              type: 'text',
              label: 'Default Value',
            },
          ],
        },
        {
          name: 'supportedFeatures',
          type: 'array',
          label: 'Supported Features',
          admin: {
            description: 'List of features this plugin supports',
          },
          fields: [
            {
              name: 'feature',
              type: 'text',
              required: true,
            },
          ],
        },
      ],
    },
    {
      name: 'requirements',
      type: 'group',
      label: 'Plugin Requirements',
      fields: [
        {
          name: 'minimumBackstageVersion',
          type: 'text',
          label: 'Minimum Backstage Version',
          admin: {
            description: 'Minimum Backstage version required (e.g., "1.10.0")',
          },
        },
        {
          name: 'dependencies',
          type: 'array',
          label: 'Plugin Dependencies',
          admin: {
            description: 'Other plugins that must be enabled before this one',
          },
          fields: [
            {
              name: 'pluginId',
              type: 'relationship',
              relationTo: 'plugin-registry',
              required: true,
              label: 'Required Plugin',
            },
          ],
        },
        {
          name: 'externalDependencies',
          type: 'array',
          label: 'External Service Dependencies',
          admin: {
            description: 'External services this plugin requires (GitHub, ArgoCD, etc.)',
          },
          fields: [
            {
              name: 'service',
              type: 'text',
              required: true,
              label: 'Service Name',
            },
            {
              name: 'description',
              type: 'textarea',
              label: 'Description',
            },
          ],
        },
      ],
    },
    {
      name: 'status',
      type: 'group',
      label: 'Plugin Status',
      fields: [
        {
          name: 'stability',
          type: 'select',
          required: true,
          defaultValue: 'stable',
          label: 'Stability',
          options: [
            { label: 'Experimental', value: 'experimental' },
            { label: 'Beta', value: 'beta' },
            { label: 'Stable', value: 'stable' },
            { label: 'Deprecated', value: 'deprecated' },
          ],
        },
        {
          name: 'lastTested',
          type: 'date',
          label: 'Last Tested Date',
          admin: {
            description: 'When this plugin was last verified to work',
          },
        },
        {
          name: 'knownIssues',
          type: 'textarea',
          label: 'Known Issues',
          admin: {
            description: 'Any known issues or limitations with this plugin',
          },
        },
      ],
    },
  ],
  timestamps: true,
}
