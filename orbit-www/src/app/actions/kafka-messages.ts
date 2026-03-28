'use server'

import { kafkaClient } from '@/lib/grpc/kafka-client'
import { getPayloadUserFromSession } from '@/lib/auth/session'
import { getPayload } from 'payload'
import config from '@payload-config'
import { MessageSeekType } from '@/lib/proto/idp/kafka/v1/kafka_pb'

// ============================================================================
// Types
// ============================================================================

export type SeekMode = 'NEWEST' | 'OLDEST' | 'OFFSET'

export type BrowseMessagesInput = {
  topicId: string
  workspaceId: string
  seekType?: SeekMode
  startOffset?: number
  partition?: number | null
  cursor?: string | null
  limit?: number
}

export type MessageItem = {
  partition: number
  offset: string
  timestamp: number
  key: string | null
  value: string | null
  headers: Record<string, string>
  keySize: number
  valueSize: number
  truncated: boolean
}

export type BrowseMessagesResult = {
  success: boolean
  messages?: MessageItem[]
  nextCursor?: string
  hasMore?: boolean
  canProduce?: boolean
  error?: string
}

export type ProduceMessageInput = {
  topicId: string
  workspaceId: string
  partition?: number | null
  key?: string
  value: string
  headers?: Record<string, string>
}

export type ProduceMessageResult = {
  success: boolean
  partition?: number
  offset?: string
  timestamp?: number
  error?: string
}

export type MessagePermissions = {
  canBrowse: boolean
  canProduce: boolean
}

export type MessagePermissionsResult = {
  success: boolean
  permissions?: MessagePermissions
  error?: string
}

// ============================================================================
// Helpers
// ============================================================================

const SEEK_TYPE_MAP: Record<SeekMode, MessageSeekType> = {
  NEWEST: MessageSeekType.NEWEST,
  OLDEST: MessageSeekType.OLDEST,
  OFFSET: MessageSeekType.OFFSET,
}

function decodeBytes(bytes: Uint8Array): string | null {
  if (!bytes || bytes.length === 0) return null
  try {
    return new TextDecoder().decode(bytes)
  } catch {
    return `<binary: ${bytes.length} bytes>`
  }
}

function encodeString(str: string | undefined): Uint8Array {
  if (!str) return new Uint8Array(0)
  return new TextEncoder().encode(str)
}

/**
 * Check if a user has access to a topic, and what level.
 * Returns { canBrowse, canProduce } based on ownership or share permissions.
 *
 * Permission model:
 * - Topic owner (workspace member) → browse + produce
 * - Any share type (read, write, read-write) → browse
 * - write or read-write share → browse + produce
 * - No access → canBrowse: false, canProduce: false
 */
async function checkTopicAccess(
  userId: string,
  topicId: string,
  requestingWorkspaceId: string,
): Promise<{ canBrowse: boolean; canProduce: boolean; virtualClusterId?: string; topicName?: string; error?: string }> {
  const payload = await getPayload({ config })

  // Look up the topic to find its owner workspace + virtual cluster
  const topic = await payload.findByID({
    collection: 'kafka-topics',
    id: topicId,
    depth: 0,
    overrideAccess: true,
  })

  if (!topic) {
    return { canBrowse: false, canProduce: false, error: 'Topic not found' }
  }

  const ownerWorkspaceId = typeof topic.workspace === 'string'
    ? topic.workspace
    : topic.workspace?.id

  // Resolve virtual cluster ID for Bifrost routing
  const virtualClusterId = typeof topic.virtualCluster === 'string'
    ? topic.virtualCluster
    : (topic.virtualCluster as any)?.id
  const topicName = topic.name

  if (!ownerWorkspaceId) {
    return { canBrowse: false, canProduce: false, error: 'Topic has no workspace' }
  }

  // Check if user is a member of the topic's workspace (owner access)
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: ownerWorkspaceId } },
        { user: { equals: userId } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
    overrideAccess: true,
  })

  if (membership.docs.length > 0) {
    // Topic owner — full access
    return { canBrowse: true, canProduce: true, virtualClusterId, topicName }
  }

  // Check if user's workspace has an approved share for this topic
  const share = await payload.find({
    collection: 'kafka-topic-shares',
    where: {
      and: [
        { topic: { equals: topicId } },
        { targetWorkspace: { equals: requestingWorkspaceId } },
        { status: { equals: 'approved' } },
      ],
    },
    limit: 1,
    overrideAccess: true,
  })

  if (share.docs.length === 0) {
    return { canBrowse: false, canProduce: false, error: "You don't have access to this topic" }
  }

  const accessLevel = share.docs[0].accessLevel
  const canProduce = accessLevel === 'write' || accessLevel === 'read-write'

  // Any share type grants browse access
  return { canBrowse: true, canProduce, virtualClusterId, topicName }
}

// ============================================================================
// Server Actions
// ============================================================================

export async function browseTopicMessages(
  input: BrowseMessagesInput,
): Promise<BrowseMessagesResult> {
  const payloadUser = await getPayloadUserFromSession()
  if (!payloadUser) {
    return { success: false, error: 'Not authenticated' }
  }

  const userId = payloadUser.betterAuthId || payloadUser.id

  // Access control: verify user can browse this topic
  const access = await checkTopicAccess(userId, input.topicId, input.workspaceId)
  if (!access.canBrowse) {
    return { success: false, error: access.error || "You don't have access to browse this topic" }
  }

  try {
    // Pass the resolved topic name and virtual cluster ID to the gRPC handler.
    // topicId carries the virtual topic name, workspaceId carries the virtual cluster ID.
    // The handler passes these directly to Bifrost without PostgreSQL lookup.
    const response = await kafkaClient.browseTopicMessages({
      topicId: access.topicName || input.topicId,
      workspaceId: access.virtualClusterId || input.workspaceId,
      seekType: SEEK_TYPE_MAP[input.seekType ?? 'NEWEST'],
      startOffset: BigInt(input.startOffset ?? 0),
      partitions: input.partition != null ? [input.partition] : [],
      limit: input.limit ?? 50,
      cursor: input.cursor ?? '',
    })

    const messages: MessageItem[] = response.messages.map((msg) => ({
      partition: msg.partition,
      offset: msg.offset.toString(),
      timestamp: Number(msg.timestamp),
      key: decodeBytes(msg.key),
      value: decodeBytes(msg.value),
      headers: Object.fromEntries(
        Object.entries(msg.headers).map(([k, v]) => [k, decodeBytes(v) ?? '']),
      ),
      keySize: msg.keySize,
      valueSize: msg.valueSize,
      truncated: msg.truncated,
    }))

    return {
      success: true,
      messages,
      nextCursor: response.nextCursor || undefined,
      hasMore: response.hasMore,
      canProduce: access.canProduce,
    }
  } catch (error) {
    console.error('[browseTopicMessages] Error:', error)
    const message =
      error instanceof Error ? error.message : 'Failed to browse messages'
    return { success: false, error: message }
  }
}

export async function produceTopicMessage(
  input: ProduceMessageInput,
): Promise<ProduceMessageResult> {
  const payloadUser = await getPayloadUserFromSession()
  if (!payloadUser) {
    return { success: false, error: 'Not authenticated' }
  }

  const userId = payloadUser.betterAuthId || payloadUser.id

  // Access control: verify user can produce to this topic
  const access = await checkTopicAccess(userId, input.topicId, input.workspaceId)
  if (!access.canProduce) {
    return { success: false, error: access.error || "You don't have permission to produce to this topic" }
  }

  try {
    const headers: Record<string, Uint8Array> = {}
    if (input.headers) {
      for (const [k, v] of Object.entries(input.headers)) {
        headers[k] = encodeString(v)
      }
    }

    const response = await kafkaClient.produceTopicMessage({
      topicId: access.topicName || input.topicId,
      workspaceId: access.virtualClusterId || input.workspaceId,
      partition: input.partition ?? undefined,
      key: encodeString(input.key),
      value: encodeString(input.value),
      headers,
    })

    if (!response.success) {
      return { success: false, error: response.error || 'Produce failed' }
    }

    return {
      success: true,
      partition: response.partition,
      offset: response.offset.toString(),
      timestamp: Number(response.timestamp),
    }
  } catch (error) {
    console.error('[produceTopicMessage] Error:', error)
    const message =
      error instanceof Error ? error.message : 'Failed to produce message'
    return { success: false, error: message }
  }
}

export async function getMessagePermissions(
  topicId: string,
  workspaceId: string,
): Promise<MessagePermissionsResult> {
  const payloadUser = await getPayloadUserFromSession()
  if (!payloadUser) {
    return { success: false, error: 'Not authenticated' }
  }

  const userId = payloadUser.betterAuthId || payloadUser.id

  const access = await checkTopicAccess(userId, topicId, workspaceId)

  return {
    success: true,
    permissions: {
      canBrowse: access.canBrowse,
      canProduce: access.canProduce,
    },
  }
}
