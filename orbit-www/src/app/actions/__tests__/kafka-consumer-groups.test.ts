import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('payload', () => ({ getPayload: vi.fn() }))
vi.mock('@payload-config', () => ({ default: {} }))

vi.mock('@/lib/authz', () => ({
  getActor: vi.fn(),
  check: vi.fn(),
}))

vi.mock('@/lib/grpc/bifrost-admin-client', () => ({
  bifrostAdminClient: {
    upsertVirtualCluster: vi.fn().mockResolvedValue({}),
    listConsumerGroups: vi.fn().mockResolvedValue({ groups: [] }),
    describeConsumerGroup: vi.fn().mockResolvedValue({ group: undefined }),
    resetConsumerGroupOffsets: vi.fn().mockResolvedValue({ success: true, newOffsets: [] }),
  },
}))

import { getPayload } from 'payload'
import { getActor, check } from '@/lib/authz'
import { bifrostAdminClient } from '@/lib/grpc/bifrost-admin-client'
import {
  listConsumerGroups,
  describeConsumerGroup,
  resetConsumerGroupOffsets,
} from '../kafka-consumer-groups'

const actor = {
  payloadId: 'pl-1',
  betterAuthId: 'ba-1',
  email: 'a@test.com',
  role: 'user',
  isPlatformAdmin: false,
  user: { id: 'pl-1', collection: 'users' },
}

const vcWithWorkspace = { id: 'vc-1', workspace: 'ws-1', application: 'app-1', status: 'active' }

describe('kafka consumer group actions: authentication and authorization', () => {
  let payload: { findByID: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.clearAllMocks()
    payload = { findByID: vi.fn().mockResolvedValue(vcWithWorkspace) }
    ;(getPayload as any).mockResolvedValue(payload)
    ;(getActor as any).mockResolvedValue(actor)
    ;(check as any).mockResolvedValue({ allowed: true, reason: 'workspace member', actor })
  })

  const noBifrostCalls = () => {
    expect(bifrostAdminClient.upsertVirtualCluster).not.toHaveBeenCalled()
    expect(bifrostAdminClient.listConsumerGroups).not.toHaveBeenCalled()
    expect(bifrostAdminClient.describeConsumerGroup).not.toHaveBeenCalled()
    expect(bifrostAdminClient.resetConsumerGroupOffsets).not.toHaveBeenCalled()
  }

  describe('unauthenticated', () => {
    beforeEach(() => (getActor as any).mockResolvedValue(null))

    it('listConsumerGroups is denied', async () => {
      const r = await listConsumerGroups('vc-1')
      expect(r).toEqual({ success: false, error: 'Not authenticated' })
      noBifrostCalls()
    })

    it('describeConsumerGroup is denied', async () => {
      const r = await describeConsumerGroup('vc-1', 'g')
      expect(r).toEqual({ success: false, error: 'Not authenticated' })
      noBifrostCalls()
    })

    it('resetConsumerGroupOffsets is denied', async () => {
      const r = await resetConsumerGroupOffsets('vc-1', 'g', 't', 'earliest')
      expect(r).toEqual({ success: false, error: 'Not authenticated' })
      noBifrostCalls()
    })
  })

  describe('non-member of the virtual cluster workspace', () => {
    beforeEach(() => (check as any).mockResolvedValue({ allowed: false, reason: 'not a member of this workspace', actor }))

    it('listConsumerGroups is denied', async () => {
      const r = await listConsumerGroups('vc-1')
      expect(r.success).toBe(false)
      expect(check).toHaveBeenCalledWith('read', { kind: 'workspace', id: 'ws-1' }, actor)
      noBifrostCalls()
    })

    it('describeConsumerGroup is denied', async () => {
      const r = await describeConsumerGroup('vc-1', 'g')
      expect(r.success).toBe(false)
      noBifrostCalls()
    })

    it('resetConsumerGroupOffsets is denied', async () => {
      const r = await resetConsumerGroupOffsets('vc-1', 'g', 't', 'earliest')
      expect(r.success).toBe(false)
      expect(check).toHaveBeenCalledWith('manage', { kind: 'workspace', id: 'ws-1' }, actor)
      noBifrostCalls()
    })
  })

  describe('unknown virtual cluster', () => {
    it('is denied without reaching bifrost', async () => {
      payload.findByID.mockRejectedValue(new Error('Not Found'))
      const r = await describeConsumerGroup('missing', 'g')
      expect(r.success).toBe(false)
      noBifrostCalls()
    })
  })

  describe('workspace resolution', () => {
    it('falls back to the owning application workspace for legacy clusters', async () => {
      payload.findByID.mockImplementation(async ({ collection }: any) =>
        collection === 'kafka-virtual-clusters'
          ? { id: 'vc-1', application: 'app-1' }
          : { id: 'app-1', workspace: { id: 'ws-legacy' } },
      )
      await describeConsumerGroup('vc-1', 'g')
      expect(check).toHaveBeenCalledWith('read', { kind: 'workspace', id: 'ws-legacy' }, actor)
    })

    it('denies when no workspace can be resolved', async () => {
      payload.findByID.mockResolvedValue({ id: 'vc-1' })
      const r = await describeConsumerGroup('vc-1', 'g')
      expect(r.success).toBe(false)
      noBifrostCalls()
    })
  })

  describe('authorized member', () => {
    it('listConsumerGroups reaches bifrost', async () => {
      const r = await listConsumerGroups('vc-1')
      expect(r.success).toBe(true)
      expect(bifrostAdminClient.listConsumerGroups).toHaveBeenCalledWith({ virtualClusterId: 'vc-1' })
    })

    it('resetConsumerGroupOffsets reaches bifrost', async () => {
      const r = await resetConsumerGroupOffsets('vc-1', 'g', 't', 'earliest')
      expect(r.success).toBe(true)
      expect(bifrostAdminClient.resetConsumerGroupOffsets).toHaveBeenCalled()
    })
  })
})
