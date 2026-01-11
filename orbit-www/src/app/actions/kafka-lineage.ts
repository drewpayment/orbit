'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import {
  getTopicLineageGraph,
  getApplicationLineageGraph,
  getTopicLineageSummary,
  getApplicationLineageSummary,
  getCrossWorkspaceLineage,
  type LineageGraph,
  type TopicLineageSummary,
  type ApplicationLineageSummary,
} from '@/lib/kafka/lineage'
import type { KafkaLineageEdge } from '@/payload-types'

// =============================================================================
// Types
// =============================================================================

export type LineageQueryOptions = {
  includeInactive?: boolean
  limit?: number
}

export type GetTopicLineageResult = {
  success: boolean
  graph?: LineageGraph
  error?: string
}

export type GetApplicationLineageResult = {
  success: boolean
  graph?: LineageGraph
  error?: string
}

export type GetTopicLineageSummaryResult = {
  success: boolean
  summary?: TopicLineageSummary
  error?: string
}

export type GetApplicationLineageSummaryResult = {
  success: boolean
  summary?: ApplicationLineageSummary
  error?: string
}

export type GetCrossWorkspaceLineageResult = {
  success: boolean
  edges?: KafkaLineageEdge[]
  error?: string
}

// =============================================================================
// Server Actions
// =============================================================================

/**
 * Get lineage graph for a topic.
 * Shows all producers and consumers of the topic.
 */
export async function getTopicLineage(
  topicId: string,
  options: LineageQueryOptions = {}
): Promise<GetTopicLineageResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })

  try {
    // Verify user has access to the topic
    const topic = await payload.findByID({
      collection: 'kafka-topics',
      id: topicId,
      depth: 1,
    })

    if (!topic) {
      return { success: false, error: 'Topic not found' }
    }

    // Get the lineage graph
    const graph = await getTopicLineageGraph(payload, topicId, options)

    return { success: true, graph }
  } catch (error) {
    console.error('Failed to get topic lineage:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get topic lineage',
    }
  }
}

/**
 * Get lineage graph for an application.
 * Shows all topics the application produces to or consumes from.
 */
export async function getApplicationLineage(
  applicationId: string,
  options: LineageQueryOptions = {}
): Promise<GetApplicationLineageResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })

  try {
    // Verify user has access to the application
    const application = await payload.findByID({
      collection: 'kafka-applications',
      id: applicationId,
      depth: 1,
    })

    if (!application) {
      return { success: false, error: 'Application not found' }
    }

    // Get the lineage graph
    const graph = await getApplicationLineageGraph(payload, applicationId, options)

    return { success: true, graph }
  } catch (error) {
    console.error('Failed to get application lineage:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get application lineage',
    }
  }
}

/**
 * Get lineage summary for a topic.
 * Returns counts and details of producers and consumers.
 */
export async function getTopicLineageSummaryAction(
  topicId: string
): Promise<GetTopicLineageSummaryResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })

  try {
    // Verify user has access to the topic
    const topic = await payload.findByID({
      collection: 'kafka-topics',
      id: topicId,
      depth: 0,
    })

    if (!topic) {
      return { success: false, error: 'Topic not found' }
    }

    const summary = await getTopicLineageSummary(payload, topicId)

    return { success: true, summary }
  } catch (error) {
    console.error('Failed to get topic lineage summary:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get topic lineage summary',
    }
  }
}

/**
 * Get lineage summary for an application.
 * Returns counts and details of topics produced to and consumed from.
 */
export async function getApplicationLineageSummaryAction(
  applicationId: string
): Promise<GetApplicationLineageSummaryResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })

  try {
    // Verify user has access to the application
    const application = await payload.findByID({
      collection: 'kafka-applications',
      id: applicationId,
      depth: 0,
    })

    if (!application) {
      return { success: false, error: 'Application not found' }
    }

    const summary = await getApplicationLineageSummary(payload, applicationId)

    return { success: true, summary }
  } catch (error) {
    console.error('Failed to get application lineage summary:', error)
    return {
      success: false,
      error:
        error instanceof Error ? error.message : 'Failed to get application lineage summary',
    }
  }
}

/**
 * Get cross-workspace lineage for a workspace.
 * Useful for security auditing and data governance.
 */
export async function getCrossWorkspaceLineageAction(
  workspaceId: string,
  direction: 'inbound' | 'outbound' | 'both' = 'both'
): Promise<GetCrossWorkspaceLineageResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })

  try {
    // Verify user has access to the workspace
    const workspace = await payload.findByID({
      collection: 'workspaces',
      id: workspaceId,
      depth: 0,
    })

    if (!workspace) {
      return { success: false, error: 'Workspace not found' }
    }

    const edges = await getCrossWorkspaceLineage(payload, workspaceId, direction)

    return { success: true, edges }
  } catch (error) {
    console.error('Failed to get cross-workspace lineage:', error)
    return {
      success: false,
      error:
        error instanceof Error ? error.message : 'Failed to get cross-workspace lineage',
    }
  }
}

/**
 * Get lineage edges for a topic (raw data).
 * Returns the actual edge documents with full details.
 */
export async function getTopicLineageEdges(
  topicId: string,
  options: { includeInactive?: boolean; limit?: number } = {}
): Promise<{ success: boolean; edges?: KafkaLineageEdge[]; error?: string }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })

  try {
    const { includeInactive = false, limit = 100 } = options

    const result = await payload.find({
      collection: 'kafka-lineage-edges',
      where: {
        and: [
          { topic: { equals: topicId } },
          ...(includeInactive ? [] : [{ isActive: { equals: true } }]),
        ],
      },
      limit,
      depth: 2,
    })

    return { success: true, edges: result.docs }
  } catch (error) {
    console.error('Failed to get topic lineage edges:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get topic lineage edges',
    }
  }
}

/**
 * Get lineage edges for an application (raw data).
 * Returns the actual edge documents with full details.
 */
export async function getApplicationLineageEdges(
  applicationId: string,
  options: { includeInactive?: boolean; limit?: number } = {}
): Promise<{ success: boolean; edges?: KafkaLineageEdge[]; error?: string }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })

  try {
    const { includeInactive = false, limit = 100 } = options

    const result = await payload.find({
      collection: 'kafka-lineage-edges',
      where: {
        and: [
          { sourceApplication: { equals: applicationId } },
          ...(includeInactive ? [] : [{ isActive: { equals: true } }]),
        ],
      },
      limit,
      depth: 2,
    })

    return { success: true, edges: result.docs }
  } catch (error) {
    console.error('Failed to get application lineage edges:', error)
    return {
      success: false,
      error:
        error instanceof Error ? error.message : 'Failed to get application lineage edges',
    }
  }
}
