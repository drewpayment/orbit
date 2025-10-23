/**
 * JiraIssuesList Component
 *
 * Displays Jira issues from a workspace's Jira integration using the generic
 * ProxyPluginRequest API. This component fetches data from Backstage's Jira plugin
 * through the Orbit plugins gRPC service.
 *
 * Features:
 * - Fetches issues via ProxyPluginRequest (no plugin-specific RPC needed)
 * - Workspace-isolated data
 * - Loading and error states via PluginDataCard
 * - Issue status badges
 * - Link to external Jira
 *
 * Usage:
 * ```tsx
 * <JiraIssuesList
 *   workspaceId="ws-123"
 *   projectKey="PROJ"
 * />
 * ```
 */

'use client'

import { useEffect, useState } from 'react'
import { pluginsClient } from '@/lib/grpc/plugins-client'
import { PluginDataCard } from './PluginDataCard'
import type { PluginStatus } from '@/lib/grpc/plugins-client'

interface JiraIssue {
  key: string
  summary: string
  status: {
    name: string
    statusCategory: {
      key: string // 'new', 'indeterminate', 'done'
    }
  }
  assignee: {
    displayName: string
    avatarUrls?: {
      '24x24': string
    }
  } | null
  priority: {
    name: string
    iconUrl?: string
  }
  created: string
  updated: string
}

interface JiraIssuesListProps {
  /** Workspace ID for isolation */
  workspaceId: string

  /** Jira project key (e.g., "PROJ") */
  projectKey: string

  /** Optional status filter (e.g., "To Do", "In Progress", "Done") */
  statusFilter?: string

  /** Maximum number of issues to display */
  maxResults?: number
}

export function JiraIssuesList({
  workspaceId,
  projectKey,
  statusFilter,
  maxResults = 50,
}: JiraIssuesListProps) {
  const [issues, setIssues] = useState<JiraIssue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pluginStatus, setPluginStatus] = useState<PluginStatus | null>(null)
  const [jiraBaseUrl, setJiraBaseUrl] = useState<string>('')

  const fetchIssues = async () => {
    try {
      setLoading(true)
      setError(null)

      // Build JQL query
      const jql = `project = ${projectKey}${
        statusFilter ? ` AND status = "${statusFilter}"` : ''
      } ORDER BY updated DESC`

      // Use ProxyPluginRequest to call Jira plugin's REST API
      // Backstage Jira plugin exposes: /api/jira/issues (search endpoint)
      const response = await pluginsClient.proxyPluginRequest({
        workspaceId,
        pluginId: 'jira',
        endpointPath: '/api/search', // Jira REST API search endpoint
        httpMethod: 'GET',
        queryParams: {
          jql,
          maxResults: maxResults.toString(),
          fields: 'summary,status,assignee,priority,created,updated',
        },
        headers: {},
        body: new Uint8Array(),
      })

      // Handle non-200 responses
      if (response.statusCode !== 200) {
        throw new Error(
          response.errorMessage || `Jira API returned status ${response.statusCode}`,
        )
      }

      // Parse JSON response from Backstage
      const decoder = new TextDecoder()
      const jsonText = decoder.decode(response.data)
      const jiraResponse = JSON.parse(jsonText)

      // Extract issues from Jira response
      setIssues(jiraResponse.issues || [])

      // Extract Jira base URL from first issue (for external links)
      if (jiraResponse.issues && jiraResponse.issues.length > 0) {
        const firstIssueUrl = jiraResponse.issues[0].self // e.g., "https://company.atlassian.net/rest/api/3/issue/10001"
        const url = new URL(firstIssueUrl)
        setJiraBaseUrl(`${url.protocol}//${url.host}`)
      }

      // Simulate plugin status (in real implementation, this would come from ListPlugins)
      setPluginStatus({
        healthy: true,
        statusMessage: 'Connected to Jira',
        lastCheckedAt: BigInt(Date.now()),
        requestCount: 0,
        errorCount: 0,
      })
    } catch (err) {
      console.error('Failed to fetch Jira issues:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch issues')
      setPluginStatus({
        healthy: false,
        statusMessage: err instanceof Error ? err.message : 'Unknown error',
        lastCheckedAt: BigInt(Date.now()),
        requestCount: 0,
        errorCount: 1,
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchIssues()
  }, [workspaceId, projectKey, statusFilter, maxResults])

  return (
    <PluginDataCard
      title="Jira Issues"
      pluginId="jira"
      loading={loading}
      error={error}
      isEmpty={issues.length === 0}
      status={pluginStatus}
      onRetry={fetchIssues}
      description={`Issues from ${projectKey}`}
      actions={
        jiraBaseUrl && (
          <a
            href={`${jiraBaseUrl}/browse/${projectKey}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-500"
          >
            View in Jira
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
        )
      }
    >
      <div className="divide-y divide-gray-200">
        {issues.map((issue) => (
          <JiraIssueRow key={issue.key} issue={issue} jiraBaseUrl={jiraBaseUrl} />
        ))}
      </div>
    </PluginDataCard>
  )
}

/**
 * Individual Jira Issue Row
 */
function JiraIssueRow({ issue, jiraBaseUrl }: { issue: JiraIssue; jiraBaseUrl: string }) {
  const statusCategory = issue.status.statusCategory.key
  const statusColor = getStatusColor(statusCategory)

  return (
    <div className="py-4 hover:bg-gray-50 transition-colors">
      <div className="flex items-start justify-between gap-4">
        {/* Left: Issue details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <a
              href={`${jiraBaseUrl}/browse/${issue.key}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-sm font-medium text-blue-600 hover:text-blue-500"
            >
              {issue.key}
            </a>
            {issue.priority && (
              <span className="flex items-center gap-1 text-xs text-gray-500">
                {issue.priority.iconUrl && (
                  <img
                    src={issue.priority.iconUrl}
                    alt={issue.priority.name}
                    className="w-4 h-4"
                  />
                )}
                {issue.priority.name}
              </span>
            )}
          </div>

          <p className="text-sm text-gray-900 mb-2">{issue.summary}</p>

          <div className="flex items-center gap-3 text-xs text-gray-500">
            {issue.assignee && (
              <div className="flex items-center gap-1.5">
                {issue.assignee.avatarUrls && (
                  <img
                    src={issue.assignee.avatarUrls['24x24']}
                    alt={issue.assignee.displayName}
                    className="w-5 h-5 rounded-full"
                  />
                )}
                <span>{issue.assignee.displayName}</span>
              </div>
            )}
            <span>Updated {formatRelativeTime(issue.updated)}</span>
          </div>
        </div>

        {/* Right: Status badge */}
        <span
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColor}`}
        >
          {issue.status.name}
        </span>
      </div>
    </div>
  )
}

/**
 * Get Tailwind classes for status badge based on Jira status category
 */
function getStatusColor(statusCategory: string): string {
  switch (statusCategory) {
    case 'new':
      return 'bg-gray-100 text-gray-800'
    case 'indeterminate':
      return 'bg-blue-100 text-blue-800'
    case 'done':
      return 'bg-green-100 text-green-800'
    default:
      return 'bg-gray-100 text-gray-800'
  }
}

/**
 * Format timestamp as relative time (e.g., "2 hours ago")
 */
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins} min ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
  if (diffDays < 30) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`
  return date.toLocaleDateString()
}
