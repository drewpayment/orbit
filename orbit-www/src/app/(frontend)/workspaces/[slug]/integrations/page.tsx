/**
 * Workspace Integrations Page
 *
 * Displays all enabled Backstage plugins for a workspace, rendering plugin-specific
 * components based on the plugin type. This page fetches enabled plugins from Payload CMS
 * and renders the appropriate React components.
 *
 * Features:
 * - Server-side data fetching for enabled plugins
 * - Dynamic component rendering based on plugin type
 * - Workspace-isolated plugin data
 * - Empty state when no plugins are enabled
 *
 * Route: /workspaces/[slug]/integrations
 */

import { getPayload } from 'payload'
import config from '@payload-config'
import { notFound } from 'next/navigation'
import { JiraIssuesList } from '@/components/plugins/JiraIssuesList'
import { GitHubPRsList } from '@/components/plugins/GitHubPRsList'
import type { Workspace, PluginConfig } from '@/payload-types'

interface WorkspaceIntegrationsPageProps {
  params: {
    slug: string
  }
}

export default async function WorkspaceIntegrationsPage({
  params,
}: WorkspaceIntegrationsPageProps) {
  const payload = await getPayload({ config })

  // Fetch workspace by slug
  const workspaceResult = await payload.find({
    collection: 'workspaces',
    where: {
      slug: {
        equals: params.slug,
      },
    },
    limit: 1,
  })

  if (workspaceResult.docs.length === 0) {
    notFound()
  }

  const workspace = workspaceResult.docs[0] as Workspace

  // Fetch enabled plugins for this workspace
  const pluginConfigsResult = await payload.find({
    collection: 'plugin-configs',
    where: {
      and: [
        {
          workspace: {
            equals: workspace.id,
          },
        },
        {
          enabled: {
            equals: true,
          },
        },
      ],
    },
    depth: 2, // Include plugin registry data
    limit: 100,
  })

  const pluginConfigs = pluginConfigsResult.docs as PluginConfig[]

  // If no plugins are enabled, show empty state
  if (pluginConfigs.length === 0) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Integrations</h1>
          <p className="mt-2 text-sm text-gray-600">
            Connect external tools to {workspace.name}
          </p>
        </div>

        <EmptyState workspaceSlug={params.slug} />
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Integrations</h1>
        <p className="mt-2 text-sm text-gray-600">
          External tools connected to {workspace.name}
        </p>
      </div>

      {/* Plugin Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {pluginConfigs.map((pluginConfig) => {
          const plugin =
            typeof pluginConfig.plugin === 'object' ? pluginConfig.plugin : null

          if (!plugin) {
            console.warn(`Plugin config ${pluginConfig.id} has no plugin reference`)
            return null
          }

          // Render appropriate component based on plugin type
          return (
            <PluginRenderer
              key={pluginConfig.id}
              workspaceId={workspace.id}
              pluginConfig={pluginConfig}
            />
          )
        })}
      </div>

      {/* Footer with link to admin */}
      <div className="mt-12 text-center">
        <a
          href={`/admin/collections/plugin-configs?where[workspace][equals]=${workspace.id}`}
          className="text-sm text-blue-600 hover:text-blue-500"
        >
          Manage integrations in admin panel →
        </a>
      </div>
    </div>
  )
}

/**
 * Plugin Renderer
 * Dynamically renders the correct component based on plugin type
 */
function PluginRenderer({
  workspaceId,
  pluginConfig,
}: {
  workspaceId: string
  pluginConfig: PluginConfig
}) {
  const plugin = typeof pluginConfig.plugin === 'object' ? pluginConfig.plugin : null

  if (!plugin) {
    return null
  }

  const config = pluginConfig.configuration as Record<string, any>

  // Render Jira plugin
  if (plugin.pluginId === 'jira' && config.projectKey) {
    return (
      <JiraIssuesList
        workspaceId={workspaceId}
        projectKey={config.projectKey}
        statusFilter={config.statusFilter}
        maxResults={config.maxResults || 50}
      />
    )
  }

  // Render GitHub Actions plugin
  if (plugin.pluginId === 'github-actions' && config.owner && config.repo) {
    return (
      <GitHubPRsList
        workspaceId={workspaceId}
        owner={config.owner}
        repo={config.repo}
        stateFilter={config.stateFilter || 'open'}
        maxResults={config.maxResults || 30}
      />
    )
  }

  // Render ArgoCD plugin
  if (plugin.pluginId === 'argocd' && config.appName) {
    return (
      <div className="border border-gray-200 rounded-lg bg-white shadow-sm p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">ArgoCD Application</h3>
        <p className="text-sm text-gray-500 mb-4">Application: {config.appName}</p>
        <p className="text-sm text-gray-600">
          ArgoCD integration component coming soon...
        </p>
        <a
          href={`${config.argocdUrl}/applications/${config.appName}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-500"
        >
          View in ArgoCD
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
            />
          </svg>
        </a>
      </div>
    )
  }

  // Fallback for unknown plugin types
  return (
    <div className="border border-gray-200 rounded-lg bg-white shadow-sm p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-2">{plugin.name}</h3>
      <p className="text-sm text-gray-500 mb-4">{plugin.description}</p>
      <p className="text-sm text-gray-600">
        Component for {plugin.pluginId} not yet implemented.
      </p>
    </div>
  )
}

/**
 * Empty State
 * Shown when no plugins are enabled
 */
function EmptyState({ workspaceSlug }: { workspaceSlug: string }) {
  return (
    <div className="text-center py-12">
      <svg
        className="mx-auto h-12 w-12 text-gray-400"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 10V3L4 14h7v7l9-11h-7z"
        />
      </svg>
      <h3 className="mt-2 text-sm font-semibold text-gray-900">No integrations</h3>
      <p className="mt-1 text-sm text-gray-500">
        Get started by enabling your first integration.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <a
          href="/admin/collections/plugin-registry"
          className="inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
        >
          Browse Plugins
        </a>
        <a
          href={`/admin/collections/plugin-configs/create`}
          className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          Enable Integration
        </a>
      </div>
    </div>
  )
}

/**
 * Metadata for SEO
 */
export async function generateMetadata({ params }: WorkspaceIntegrationsPageProps) {
  const payload = await getPayload({ config })

  const workspaceResult = await payload.find({
    collection: 'workspaces',
    where: {
      slug: {
        equals: params.slug,
      },
    },
    limit: 1,
  })

  if (workspaceResult.docs.length === 0) {
    return {
      title: 'Workspace Not Found',
    }
  }

  const workspace = workspaceResult.docs[0] as Workspace

  return {
    title: `Integrations - ${workspace.name}`,
    description: `External tool integrations for ${workspace.name}`,
  }
}
