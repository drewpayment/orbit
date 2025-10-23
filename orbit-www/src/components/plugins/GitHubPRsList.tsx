/**
 * GitHubPRsList Component
 *
 * Displays GitHub Pull Requests from a workspace's GitHub integration using the generic
 * ProxyPluginRequest API. This component fetches data from Backstage's GitHub Actions plugin
 * through the Orbit plugins gRPC service.
 *
 * Features:
 * - Fetches PRs via ProxyPluginRequest (no plugin-specific RPC needed)
 * - Workspace-isolated data
 * - Loading and error states via PluginDataCard
 * - PR status indicators (open, merged, closed)
 * - Link to external GitHub
 *
 * Usage:
 * ```tsx
 * <GitHubPRsList
 *   workspaceId="ws-123"
 *   owner="myorg"
 *   repo="myrepo"
 * />
 * ```
 */

'use client'

import { useEffect, useState } from 'react'
import { pluginsClient } from '@/lib/grpc/plugins-client'
import { PluginDataCard } from './PluginDataCard'
import type { PluginStatus } from '@/lib/grpc/plugins-client'

interface GitHubPullRequest {
  number: number
  title: string
  state: 'open' | 'closed'
  merged: boolean
  user: {
    login: string
    avatar_url: string
  }
  created_at: string
  updated_at: string
  html_url: string
  draft: boolean
  head: {
    ref: string // branch name
  }
  base: {
    ref: string // target branch
  }
  labels: Array<{
    name: string
    color: string
  }>
  assignees: Array<{
    login: string
    avatar_url: string
  }>
}

interface GitHubPRsListProps {
  /** Workspace ID for isolation */
  workspaceId: string

  /** GitHub repository owner (org or user) */
  owner: string

  /** GitHub repository name */
  repo: string

  /** Filter by PR state */
  stateFilter?: 'open' | 'closed' | 'all'

  /** Maximum number of PRs to display */
  maxResults?: number
}

export function GitHubPRsList({
  workspaceId,
  owner,
  repo,
  stateFilter = 'open',
  maxResults = 30,
}: GitHubPRsListProps) {
  const [prs, setPRs] = useState<GitHubPullRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pluginStatus, setPluginStatus] = useState<PluginStatus | null>(null)

  const fetchPRs = async () => {
    try {
      setLoading(true)
      setError(null)

      // Use ProxyPluginRequest to call GitHub Actions plugin's REST API
      // Backstage GitHub Actions plugin exposes GitHub REST API endpoints
      const response = await pluginsClient.proxyPluginRequest({
        workspaceId,
        pluginId: 'github-actions',
        endpointPath: `/repos/${owner}/${repo}/pulls`, // GitHub REST API endpoint
        httpMethod: 'GET',
        queryParams: {
          state: stateFilter,
          per_page: maxResults.toString(),
          sort: 'updated',
          direction: 'desc',
        },
        headers: {},
        body: new Uint8Array(),
      })

      // Handle non-200 responses
      if (response.statusCode !== 200) {
        throw new Error(
          response.errorMessage || `GitHub API returned status ${response.statusCode}`,
        )
      }

      // Parse JSON response from Backstage/GitHub
      const decoder = new TextDecoder()
      const jsonText = decoder.decode(response.data)
      const githubResponse = JSON.parse(jsonText)

      setPRs(githubResponse)

      // Simulate plugin status (in real implementation, this would come from ListPlugins)
      setPluginStatus({
        healthy: true,
        statusMessage: 'Connected to GitHub',
        lastCheckedAt: BigInt(Date.now()),
        requestCount: 0,
        errorCount: 0,
      })
    } catch (err) {
      console.error('Failed to fetch GitHub PRs:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch pull requests')
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
    fetchPRs()
  }, [workspaceId, owner, repo, stateFilter, maxResults])

  const repoUrl = `https://github.com/${owner}/${repo}`

  return (
    <PluginDataCard
      title="Pull Requests"
      pluginId="github-actions"
      loading={loading}
      error={error}
      isEmpty={prs.length === 0}
      status={pluginStatus}
      onRetry={fetchPRs}
      description={`${owner}/${repo}`}
      actions={
        <a
          href={`${repoUrl}/pulls`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-500"
        >
          View in GitHub
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
      }
    >
      <div className="divide-y divide-gray-200">
        {prs.map((pr) => (
          <GitHubPRRow key={pr.number} pr={pr} />
        ))}
      </div>
    </PluginDataCard>
  )
}

/**
 * Individual GitHub PR Row
 */
function GitHubPRRow({ pr }: { pr: GitHubPullRequest }) {
  const prStateColor = getPRStateColor(pr)

  return (
    <div className="py-4 hover:bg-gray-50 transition-colors">
      <div className="flex items-start justify-between gap-4">
        {/* Left: PR details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <a
              href={pr.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-sm text-blue-600 hover:text-blue-500"
            >
              #{pr.number}
            </a>
            {pr.draft && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                Draft
              </span>
            )}
          </div>

          <p className="text-sm text-gray-900 mb-2">{pr.title}</p>

          <div className="flex items-center gap-3 text-xs text-gray-500 mb-2">
            <div className="flex items-center gap-1.5">
              <img
                src={pr.user.avatar_url}
                alt={pr.user.login}
                className="w-5 h-5 rounded-full"
              />
              <span>{pr.user.login}</span>
            </div>
            <span>→</span>
            <span className="font-mono">
              {pr.head.ref} → {pr.base.ref}
            </span>
            <span>Updated {formatRelativeTime(pr.updated_at)}</span>
          </div>

          {/* Labels */}
          {pr.labels.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {pr.labels.slice(0, 3).map((label) => (
                <span
                  key={label.name}
                  className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                  style={{
                    backgroundColor: `#${label.color}20`,
                    color: `#${label.color}`,
                  }}
                >
                  {label.name}
                </span>
              ))}
              {pr.labels.length > 3 && (
                <span className="text-xs text-gray-500">+{pr.labels.length - 3} more</span>
              )}
            </div>
          )}

          {/* Assignees */}
          {pr.assignees.length > 0 && (
            <div className="flex items-center gap-1 mt-2">
              <span className="text-xs text-gray-500">Assigned to:</span>
              {pr.assignees.slice(0, 3).map((assignee) => (
                <img
                  key={assignee.login}
                  src={assignee.avatar_url}
                  alt={assignee.login}
                  className="w-5 h-5 rounded-full"
                  title={assignee.login}
                />
              ))}
              {pr.assignees.length > 3 && (
                <span className="text-xs text-gray-500">+{pr.assignees.length - 3}</span>
              )}
            </div>
          )}
        </div>

        {/* Right: State badge */}
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${prStateColor}`}>
          {pr.merged ? (
            <>
              <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 16 16">
                <path d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z"/>
              </svg>
              Merged
            </>
          ) : pr.state === 'open' ? (
            <>
              <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 16 16">
                <path d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z"/>
              </svg>
              Open
            </>
          ) : (
            <>
              <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 16 16">
                <path d="M11.28 6.78a.75.75 0 00-1.06-1.06L7.25 8.69 5.78 7.22a.75.75 0 00-1.06 1.06l2 2a.75.75 0 001.06 0l3.5-3.5z"/>
                <path fillRule="evenodd" d="M16 8A8 8 0 110 8a8 8 0 0116 0zm-1.5 0a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z"/>
              </svg>
              Closed
            </>
          )}
        </span>
      </div>
    </div>
  )
}

/**
 * Get Tailwind classes for PR state badge
 */
function getPRStateColor(pr: GitHubPullRequest): string {
  if (pr.merged) {
    return 'bg-purple-100 text-purple-800'
  }
  if (pr.state === 'open') {
    return 'bg-green-100 text-green-800'
  }
  return 'bg-red-100 text-red-800' // closed but not merged
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
