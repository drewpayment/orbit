import type { Payload } from 'payload'

/**
 * Resolves the workspace that owns a kafka-virtual-clusters doc, and the
 * cluster's topic prefix.
 *
 * Mirrors `KafkaVirtualClusters.ts`'s `readOwnedOrLegacyApplicationClusters`
 * access rule: ownership is direct (the `workspace` relationship) when set,
 * otherwise (legacy clusters that only set `application`) the workspace of
 * the owning `kafka-applications` doc. Internal routes call
 * `payload.findByID` with `overrideAccess: true`, which bypasses that access
 * rule entirely — so any internal route that trusts a caller-supplied
 * `virtualClusterId` against a caller-supplied `workspaceId` must run this
 * check itself, or a caller could provision against another workspace's
 * cluster just by guessing its id.
 */
export interface VirtualClusterOwnership {
  /** The owning workspace id, or null if neither ownership path resolves. */
  workspaceId: string | null
  /** Prefix for physical topic names on this cluster, e.g. "acme-dev-". */
  topicPrefix: string
}

function relationId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'string' && id.trim() !== '') return id
  }
  return null
}

export async function resolveVirtualClusterOwnership(
  payload: Payload,
  virtualCluster: Record<string, unknown>,
): Promise<VirtualClusterOwnership> {
  const topicPrefix = typeof virtualCluster.topicPrefix === 'string' ? virtualCluster.topicPrefix : ''

  const directWorkspaceId = relationId(virtualCluster.workspace)
  if (directWorkspaceId) {
    return { workspaceId: directWorkspaceId, topicPrefix }
  }

  const applicationRef = virtualCluster.application
  if (!applicationRef) {
    return { workspaceId: null, topicPrefix }
  }

  let applicationDoc: Record<string, unknown> | null = null
  if (typeof applicationRef === 'string') {
    try {
      applicationDoc = (await payload.findByID({
        collection: 'kafka-applications',
        id: applicationRef,
        depth: 0,
        overrideAccess: true,
      })) as unknown as Record<string, unknown>
    } catch {
      applicationDoc = null
    }
  } else {
    applicationDoc = applicationRef as Record<string, unknown>
  }

  if (!applicationDoc) {
    return { workspaceId: null, topicPrefix }
  }

  return { workspaceId: relationId(applicationDoc.workspace), topicPrefix }
}
