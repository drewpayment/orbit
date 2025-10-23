/**
 * PluginDataCard Component
 *
 * Generic container for displaying plugin data with consistent loading states,
 * error handling, and empty states. This component provides a reusable wrapper
 * for all plugin-specific components (Jira, GitHub, ArgoCD, etc.).
 *
 * Features:
 * - Loading skeleton
 * - Error display with retry
 * - Empty state
 * - Plugin status indicator
 * - Consistent styling
 *
 * Usage:
 * ```tsx
 * <PluginDataCard
 *   title="Jira Issues"
 *   pluginId="jira"
 *   loading={loading}
 *   error={error}
 *   isEmpty={issues.length === 0}
 *   status={{ healthy: true, statusMessage: 'Connected' }}
 *   onRetry={() => refetch()}
 * >
 *   <JiraIssuesList issues={issues} />
 * </PluginDataCard>
 * ```
 */

'use client'

import { type ReactNode } from 'react'
import type { PluginStatus } from '@/lib/grpc/plugins-client'

interface PluginDataCardProps {
  /** Display title for the plugin card */
  title: string

  /** Plugin identifier (e.g., 'jira', 'github-actions', 'argocd') */
  pluginId: string

  /** Loading state - shows skeleton when true */
  loading?: boolean

  /** Error message to display */
  error?: string | null

  /** Empty state - shows "No data" message when true */
  isEmpty?: boolean

  /** Plugin health status */
  status?: PluginStatus | null

  /** Retry callback for error state */
  onRetry?: () => void

  /** Plugin-specific content (rendered when not loading/error/empty) */
  children: ReactNode

  /** Optional description text */
  description?: string

  /** Optional action buttons in header */
  actions?: ReactNode
}

export function PluginDataCard({
  title,
  pluginId,
  loading = false,
  error = null,
  isEmpty = false,
  status = null,
  onRetry,
  children,
  description,
  actions,
}: PluginDataCardProps) {
  return (
    <div className="border border-gray-200 rounded-lg bg-white shadow-sm">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
            {status && (
              <PluginStatusBadge healthy={status.healthy} message={status.statusMessage} />
            )}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
        {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
      </div>

      {/* Content */}
      <div className="px-6 py-4">
        {loading && <LoadingSkeleton />}
        {error && (
          <ErrorState error={error} onRetry={onRetry} pluginId={pluginId} />
        )}
        {!loading && !error && isEmpty && <EmptyState pluginId={pluginId} />}
        {!loading && !error && !isEmpty && children}
      </div>
    </div>
  )
}

/**
 * Plugin Status Badge
 * Shows health indicator with tooltip
 */
function PluginStatusBadge({ healthy, message }: { healthy: boolean; message: string }) {
  const bgColor = healthy ? 'bg-green-100' : 'bg-red-100'
  const textColor = healthy ? 'text-green-800' : 'text-red-800'
  const dotColor = healthy ? 'bg-green-500' : 'bg-red-500'

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${bgColor} ${textColor}`}
      title={message}
    >
      <span className={`w-2 h-2 rounded-full ${dotColor}`} />
      {healthy ? 'Connected' : 'Degraded'}
    </span>
  )
}

/**
 * Loading Skeleton
 * Animated placeholder for loading state
 */
function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-4 bg-gray-200 rounded w-3/4"></div>
      <div className="h-4 bg-gray-200 rounded w-1/2"></div>
      <div className="h-4 bg-gray-200 rounded w-5/6"></div>
      <div className="space-y-3 mt-6">
        <div className="h-16 bg-gray-200 rounded"></div>
        <div className="h-16 bg-gray-200 rounded"></div>
        <div className="h-16 bg-gray-200 rounded"></div>
      </div>
    </div>
  )
}

/**
 * Error State
 * Displays error message with retry button
 */
function ErrorState({
  error,
  onRetry,
  pluginId,
}: {
  error: string
  onRetry?: () => void
  pluginId: string
}) {
  return (
    <div className="py-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
        <svg
          className="h-6 w-6 text-red-600"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth="1.5"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
          />
        </svg>
      </div>
      <h3 className="mt-2 text-sm font-semibold text-gray-900">Plugin Error</h3>
      <p className="mt-1 text-sm text-gray-500">{error}</p>
      <div className="mt-6 flex justify-center gap-3">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            Try Again
          </button>
        )}
        <a
          href={`/admin/collections/plugin-configs?where[plugin][equals]=${pluginId}`}
          className="inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
        >
          View Configuration
        </a>
      </div>
    </div>
  )
}

/**
 * Empty State
 * Displays message when no data is available
 */
function EmptyState({ pluginId }: { pluginId: string }) {
  return (
    <div className="py-8 text-center">
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
          d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"
        />
      </svg>
      <h3 className="mt-2 text-sm font-semibold text-gray-900">No data</h3>
      <p className="mt-1 text-sm text-gray-500">
        This plugin is configured but has no data to display.
      </p>
      <div className="mt-6">
        <a
          href={`/admin/collections/plugin-configs?where[plugin][equals]=${pluginId}`}
          className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          Check Configuration
        </a>
      </div>
    </div>
  )
}
