import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getPayload } from 'payload'

// Module-level mocks — must be before imports
vi.mock('@/lib/auth/session', () => ({
  getPayloadUserFromSession: vi.fn(),
}))

vi.mock('@/lib/grpc/kafka-client', () => ({
  kafkaClient: {
    browseTopicMessages: vi.fn(),
    produceTopicMessage: vi.fn(),
  },
}))

vi.mock('payload', () => ({ getPayload: vi.fn() }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

import {
  browseTopicMessages,
  produceTopicMessage,
  getMessagePermissions,
} from '../kafka-messages'
import { getPayloadUserFromSession } from '@/lib/auth/session'
import { kafkaClient } from '@/lib/grpc/kafka-client'

const mockUser = { id: 'user-1', email: 'test@example.com', betterAuthId: 'ba-user-1' }

// Payload mock that grants owner access by default
function setupPayloadWithAccess(opts: { isMember?: boolean; shareAccessLevel?: string } = {}) {
  const { isMember = true, shareAccessLevel } = opts
  const mockPayload = {
    findByID: vi.fn().mockResolvedValue({
      id: 'topic-1',
      workspace: 'ws-1',
    }),
    find: vi.fn().mockImplementation(({ collection }: any) => {
      if (collection === 'workspace-members') {
        return Promise.resolve({
          docs: isMember ? [{ id: 'mem-1', workspace: 'ws-1', user: 'ba-user-1', status: 'active' }] : [],
        })
      }
      if (collection === 'kafka-topic-shares') {
        return Promise.resolve({
          docs: shareAccessLevel ? [{ id: 'share-1', accessLevel: shareAccessLevel, status: 'approved' }] : [],
        })
      }
      return Promise.resolve({ docs: [] })
    }),
  }
  vi.mocked(getPayload).mockResolvedValue(mockPayload as any)
  return mockPayload
}

describe('kafka-messages server actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('browseTopicMessages', () => {
    it('returns error when not authenticated', async () => {
      vi.mocked(getPayloadUserFromSession).mockResolvedValue(null)

      const result = await browseTopicMessages({
        topicId: 'topic-1',
        workspaceId: 'ws-1',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authenticated')
      expect(kafkaClient.browseTopicMessages).not.toHaveBeenCalled()
    })

    it('calls gRPC with correct parameters and returns mapped messages', async () => {
      vi.mocked(getPayloadUserFromSession).mockResolvedValue(mockUser as any)
      setupPayloadWithAccess({ isMember: true })
      vi.mocked(kafkaClient.browseTopicMessages).mockResolvedValue({
        messages: [
          {
            partition: 0,
            offset: BigInt(42),
            timestamp: BigInt(1711584000000),
            key: new TextEncoder().encode('my-key'),
            value: new TextEncoder().encode('{"hello":"world"}'),
            headers: {},
            keySize: 6,
            valueSize: 17,
            truncated: false,
          },
        ],
        nextCursor: 'abc123',
        hasMore: true,
        canProduce: true,
      } as any)

      const result = await browseTopicMessages({
        topicId: 'topic-1',
        workspaceId: 'ws-1',
        seekType: 'NEWEST',
        partition: 0,
      })

      expect(result.success).toBe(true)
      expect(result.messages).toHaveLength(1)
      expect(result.messages![0]).toEqual(
        expect.objectContaining({
          partition: 0,
          offset: '42',
          key: 'my-key',
          value: '{"hello":"world"}',
          keySize: 6,
          valueSize: 17,
          truncated: false,
        }),
      )
      expect(result.nextCursor).toBe('abc123')
      expect(result.hasMore).toBe(true)
      expect(result.canProduce).toBe(true)
    })

    it('passes empty partitions array when no partition filter', async () => {
      vi.mocked(getPayloadUserFromSession).mockResolvedValue(mockUser as any)
      setupPayloadWithAccess({ isMember: true })
      vi.mocked(kafkaClient.browseTopicMessages).mockResolvedValue({
        messages: [],
        nextCursor: '',
        hasMore: false,
        canProduce: false,
      } as any)

      await browseTopicMessages({
        topicId: 'topic-1',
        workspaceId: 'ws-1',
        partition: null,
      })

      expect(kafkaClient.browseTopicMessages).toHaveBeenCalledWith(
        expect.objectContaining({ partitions: [] }),
      )
    })

    it('handles gRPC errors gracefully', async () => {
      vi.mocked(getPayloadUserFromSession).mockResolvedValue(mockUser as any)
      setupPayloadWithAccess({ isMember: true })
      vi.mocked(kafkaClient.browseTopicMessages).mockRejectedValue(
        new Error('Connection refused'),
      )

      const result = await browseTopicMessages({
        topicId: 'topic-1',
        workspaceId: 'ws-1',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Connection refused')
    })

    it('rejects browse when user has no access', async () => {
      vi.mocked(getPayloadUserFromSession).mockResolvedValue(mockUser as any)
      setupPayloadWithAccess({ isMember: false })

      const result = await browseTopicMessages({
        topicId: 'topic-1',
        workspaceId: 'ws-1',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain("don't have access")
      expect(kafkaClient.browseTopicMessages).not.toHaveBeenCalled()
    })

    it('allows browse with read share', async () => {
      vi.mocked(getPayloadUserFromSession).mockResolvedValue(mockUser as any)
      setupPayloadWithAccess({ isMember: false, shareAccessLevel: 'read' })
      vi.mocked(kafkaClient.browseTopicMessages).mockResolvedValue({
        messages: [],
        nextCursor: '',
        hasMore: false,
        canProduce: false,
      } as any)

      const result = await browseTopicMessages({
        topicId: 'topic-1',
        workspaceId: 'ws-1',
      })

      expect(result.success).toBe(true)
      expect(result.canProduce).toBe(false)
    })
  })

  describe('produceTopicMessage', () => {
    it('returns error when not authenticated', async () => {
      vi.mocked(getPayloadUserFromSession).mockResolvedValue(null)

      const result = await produceTopicMessage({
        topicId: 'topic-1',
        workspaceId: 'ws-1',
        value: '{"test":true}',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authenticated')
    })

    it('produces message and returns offset/partition', async () => {
      vi.mocked(getPayloadUserFromSession).mockResolvedValue(mockUser as any)
      setupPayloadWithAccess({ isMember: true })
      vi.mocked(kafkaClient.produceTopicMessage).mockResolvedValue({
        success: true,
        partition: 2,
        offset: BigInt(100),
        timestamp: BigInt(1711584000000),
        error: '',
      } as any)

      const result = await produceTopicMessage({
        topicId: 'topic-1',
        workspaceId: 'ws-1',
        key: 'my-key',
        value: '{"test":true}',
        headers: { 'content-type': 'application/json' },
      })

      expect(result.success).toBe(true)
      expect(result.partition).toBe(2)
      expect(result.offset).toBe('100')
    })

    it('rejects produce when user has read-only share', async () => {
      vi.mocked(getPayloadUserFromSession).mockResolvedValue(mockUser as any)
      setupPayloadWithAccess({ isMember: false, shareAccessLevel: 'read' })

      const result = await produceTopicMessage({
        topicId: 'topic-1',
        workspaceId: 'ws-1',
        value: 'test',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain("don't have permission to produce")
      expect(kafkaClient.produceTopicMessage).not.toHaveBeenCalled()
    })

    it('allows produce with write share', async () => {
      vi.mocked(getPayloadUserFromSession).mockResolvedValue(mockUser as any)
      setupPayloadWithAccess({ isMember: false, shareAccessLevel: 'write' })
      vi.mocked(kafkaClient.produceTopicMessage).mockResolvedValue({
        success: true,
        partition: 0,
        offset: BigInt(1),
        timestamp: BigInt(1711584000000),
        error: '',
      } as any)

      const result = await produceTopicMessage({
        topicId: 'topic-1',
        workspaceId: 'ws-1',
        value: 'test',
      })

      expect(result.success).toBe(true)
    })

    it('returns error when produce fails', async () => {
      vi.mocked(getPayloadUserFromSession).mockResolvedValue(mockUser as any)
      setupPayloadWithAccess({ isMember: true })
      vi.mocked(kafkaClient.produceTopicMessage).mockResolvedValue({
        success: false,
        partition: 0,
        offset: BigInt(0),
        timestamp: BigInt(0),
        error: 'Topic not found',
      } as any)

      const result = await produceTopicMessage({
        topicId: 'topic-1',
        workspaceId: 'ws-1',
        value: 'test',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Topic not found')
    })
  })

  describe('getMessagePermissions', () => {
    it('returns owner permissions for workspace member', async () => {
      vi.mocked(getPayloadUserFromSession).mockResolvedValue(mockUser as any)
      setupPayloadWithAccess({ isMember: true })

      const result = await getMessagePermissions('topic-1', 'ws-1')

      expect(result.success).toBe(true)
      expect(result.permissions).toEqual({
        canBrowse: true,
        canProduce: true,
      })
    })

    it('returns read-only permissions for read share', async () => {
      vi.mocked(getPayloadUserFromSession).mockResolvedValue(mockUser as any)
      setupPayloadWithAccess({ isMember: false, shareAccessLevel: 'read' })

      const result = await getMessagePermissions('topic-1', 'ws-1')

      expect(result.success).toBe(true)
      expect(result.permissions).toEqual({
        canBrowse: true,
        canProduce: false,
      })
    })

    it('returns no permissions when no access', async () => {
      vi.mocked(getPayloadUserFromSession).mockResolvedValue(mockUser as any)
      setupPayloadWithAccess({ isMember: false })

      const result = await getMessagePermissions('topic-1', 'ws-1')

      expect(result.success).toBe(true)
      expect(result.permissions).toEqual({
        canBrowse: false,
        canProduce: false,
      })
    })
  })
})
