'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { getActor, check, type Actor } from '@/lib/authz'
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

// Lineage spans workspaces (producers/consumers in other workspaces appear as
// nodes), but READING a lineage view requires membership in the workspace that
// owns the topic/application it is anchored on. The Payload local API skips
// access control by default, so the owner is resolved with an explicit lookup
// and checked via the policy.

type PayloadClient = Awaited<ReturnType<typeof getPayload>>

const relId = (v: unknown): string | null =>
  typeof v === 'string' ? v : v && typeof v === 'object' && 'id' in v ? String((v as { id: unknown }).id) : null

/** Member of the workspace that owns `collection`/`id`? Never throws; unknown doc => false. */
async function canReadOwnedDoc(
  payload: PayloadClient,
  actor: Actor,
  collection: 'kafka-topics' | 'kafka-applications',
  id: string,
): Promise<boolean> {
  try {
    const doc = await payload.findByID({ collection, id, depth: 0, overrideAccess: true })
    const workspaceId = relId(doc?.workspace)
    if (!workspaceId) return false
    return (await check('read', { kind: 'workspace', id: workspaceId }, actor)).allowed
  } catch {
    return false
  }
}

const NOT_FOUND = (what: string) => ({ success: false as const, error: `${what} not found` })

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
  const actor = await getActor()

  if (!actor) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })

  try {
    if (!(await canReadOwnedDoc(payload, actor, 'kafka-topics', topicId))) {
      return NOT_FOUND('Topic')
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
  const actor = await getActor()

  if (!actor) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })

  try {
    if (!(await canReadOwnedDoc(payload, actor, 'kafka-applications', applicationId))) {
      return NOT_FOUND('Application')
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
  const actor = await getActor()

  if (!actor) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })

  try {
    if (!(await canReadOwnedDoc(payload, actor, 'kafka-topics', topicId))) {
      return NOT_FOUND('Topic')
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
  const actor = await getActor()

  if (!actor) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })

  try {
    if (!(await canReadOwnedDoc(payload, actor, 'kafka-applications', applicationId))) {
      return NOT_FOUND('Application')
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
  const actor = await getActor()

  if (!actor) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })

  try {
    const membership = await check('read', { kind: 'workspace', id: workspaceId }, actor)
    if (!membership.allowed) {
      return NOT_FOUND('Workspace')
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
  const actor = await getActor()

  if (!actor) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })

  try {
    if (!(await canReadOwnedDoc(payload, actor, 'kafka-topics', topicId))) {
      return NOT_FOUND('Topic')
    }

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
  const actor = await getActor()

  if (!actor) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })

  try {
    if (!(await canReadOwnedDoc(payload, actor, 'kafka-applications', applicationId))) {
      return NOT_FOUND('Application')
    }

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
