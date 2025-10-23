/**
 * Plugin Registry Seed Data
 *
 * Initial set of Backstage plugins to populate the PluginRegistry collection.
 * These match the hardcoded plugins in the Go plugins service (Phase 2).
 */

export const pluginsSeedData = [
  {
    pluginId: 'catalog',
    name: 'Software Catalog',
    description:
      'Centralized software catalog for tracking components, APIs, and resources across your organization',
    category: 'api-catalog',
    enabled: true,
    metadata: {
      version: '1.24.0',
      backstagePackage: '@backstage/plugin-catalog',
      apiBasePath: '/api/catalog',
      documentationUrl: 'https://backstage.io/docs/features/software-catalog/',
    },
    configuration: {
      requiredConfigKeys: [],
      optionalConfigKeys: [
        {
          key: 'catalog.providers',
          label: 'Catalog Providers',
          description: 'Configure catalog providers (GitHub, GitLab, etc.)',
          type: 'text',
        },
        {
          key: 'catalog.locations',
          label: 'Static Locations',
          description: 'Static catalog locations to import',
          type: 'text',
        },
      ],
      supportedFeatures: [
        { feature: 'Entity Management' },
        { feature: 'Component Discovery' },
        { feature: 'API Documentation' },
        { feature: 'Dependency Tracking' },
        { feature: 'Ownership Management' },
      ],
    },
    requirements: {
      minimumBackstageVersion: '1.10.0',
      externalDependencies: [],
    },
    status: {
      stability: 'stable',
      lastTested: new Date('2025-10-19'),
      knownIssues: '',
    },
  },
  {
    pluginId: 'github-actions',
    name: 'GitHub Actions',
    description:
      'View and manage GitHub Actions workflows directly from Backstage. Monitor CI/CD pipeline status and execution history.',
    category: 'ci-cd',
    enabled: true,
    metadata: {
      version: '0.1.0',
      backstagePackage: '@backstage-community/plugin-github-actions',
      apiBasePath: '/api/github-actions',
      documentationUrl:
        'https://github.com/backstage/community-plugins/tree/main/workspaces/github-actions',
    },
    configuration: {
      requiredConfigKeys: [
        {
          key: 'github.token',
          label: 'GitHub Token',
          description: 'Personal access token with repo and workflow permissions',
          type: 'secret',
          isSecret: true,
        },
      ],
      optionalConfigKeys: [
        {
          key: 'github.baseUrl',
          label: 'GitHub Base URL',
          description: 'GitHub Enterprise base URL (leave empty for github.com)',
          type: 'url',
        },
        {
          key: 'workflows.refresh',
          label: 'Refresh Interval',
          description: 'How often to refresh workflow data (in seconds)',
          type: 'number',
          defaultValue: '60',
        },
      ],
      supportedFeatures: [
        { feature: 'Workflow Status' },
        { feature: 'Execution History' },
        { feature: 'Artifact Downloads' },
        { feature: 'Re-run Workflows' },
      ],
    },
    requirements: {
      minimumBackstageVersion: '1.10.0',
      externalDependencies: [
        {
          service: 'GitHub',
          description: 'GitHub.com or GitHub Enterprise instance',
        },
      ],
    },
    status: {
      stability: 'stable',
      lastTested: new Date('2025-10-19'),
      knownIssues: '',
    },
  },
  {
    pluginId: 'argocd',
    name: 'ArgoCD',
    description:
      'GitOps continuous delivery with ArgoCD. Monitor application deployments, sync status, and health across environments.',
    category: 'infrastructure',
    enabled: true,
    metadata: {
      version: '4.4.2',
      backstagePackage: '@roadiehq/backstage-plugin-argo-cd',
      apiBasePath: '/api/argocd',
      documentationUrl: 'https://roadie.io/backstage/plugins/argo-cd/',
    },
    configuration: {
      requiredConfigKeys: [
        {
          key: 'argocd.baseUrl',
          label: 'ArgoCD Base URL',
          description: 'ArgoCD instance URL',
          type: 'url',
        },
        {
          key: 'argocd.token',
          label: 'ArgoCD Token',
          description: 'ArgoCD authentication token',
          type: 'secret',
          isSecret: true,
        },
      ],
      optionalConfigKeys: [
        {
          key: 'argocd.waitCycles',
          label: 'Wait Cycles',
          description: 'Number of wait cycles for sync operations',
          type: 'number',
          defaultValue: '25',
        },
        {
          key: 'argocd.username',
          label: 'Username',
          description: 'Alternative to token authentication',
          type: 'text',
        },
      ],
      supportedFeatures: [
        { feature: 'Application Status' },
        { feature: 'Sync Management' },
        { feature: 'Health Checks' },
        { feature: 'Deployment History' },
        { feature: 'Resource Visualization' },
      ],
    },
    requirements: {
      minimumBackstageVersion: '1.10.0',
      externalDependencies: [
        {
          service: 'ArgoCD',
          description: 'ArgoCD instance with API access',
        },
      ],
    },
    status: {
      stability: 'stable',
      lastTested: new Date('2025-10-19'),
      knownIssues: '',
    },
  },
]

/**
 * Seed function to populate the PluginRegistry collection
 */
export async function seedPlugins(payload: any) {
  console.log('Seeding plugin registry...')

  for (const pluginData of pluginsSeedData) {
    try {
      // Check if plugin already exists
      const existing = await payload.find({
        collection: 'plugin-registry',
        where: {
          pluginId: {
            equals: pluginData.pluginId,
          },
        },
      })

      if (existing.docs.length > 0) {
        console.log(`Plugin "${pluginData.name}" already exists, updating...`)
        await payload.update({
          collection: 'plugin-registry',
          id: existing.docs[0].id,
          data: pluginData,
        })
      } else {
        console.log(`Creating plugin "${pluginData.name}"...`)
        await payload.create({
          collection: 'plugin-registry',
          data: pluginData,
        })
      }
    } catch (error) {
      console.error(`Error seeding plugin "${pluginData.name}":`, error)
    }
  }

  console.log('Plugin registry seeding complete!')
}
