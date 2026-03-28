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

  try {
    const response = await kafkaClient.browseTopicMessages({
      topicId: input.topicId,
      workspaceId: input.workspaceId,
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
      canProduce: response.canProduce,
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

  try {
    const headers: Record<string, Uint8Array> = {}
    if (input.headers) {
      for (const [k, v] of Object.entries(input.headers)) {
        headers[k] = encodeString(v)
      }
    }

    const response = await kafkaClient.produceTopicMessage({
      topicId: input.topicId,
      workspaceId: input.workspaceId,
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

  try {
    // Use a zero-limit browse to check permissions without fetching data
    const response = await kafkaClient.browseTopicMessages({
      topicId,
      workspaceId,
      seekType: MessageSeekType.NEWEST,
      startOffset: BigInt(0),
      partitions: [],
      limit: 0,
      cursor: '',
    })

    return {
      success: true,
      permissions: {
        canBrowse: true,
        canProduce: response.canProduce,
      },
    }
  } catch (error) {
    // Permission denied means no browse access
    const message = error instanceof Error ? error.message : ''
    if (message.includes('PermissionDenied') || message.includes('permission')) {
      return {
        success: true,
        permissions: { canBrowse: false, canProduce: false },
      }
    }
    console.error('[getMessagePermissions] Error:', error)
    return { success: false, error: 'Failed to check permissions' }
  }
}
