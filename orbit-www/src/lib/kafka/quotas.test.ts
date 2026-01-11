import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  SYSTEM_DEFAULT_QUOTA,
  getEffectiveQuota,
  getQuotaUsage,
  canCreateApplication,
  getWorkspaceQuotaInfo,
  hasQuotaOverride,
} from './quotas'

// Mock Payload instance factory
const createMockPayload = () => {
  const mockFind = vi.fn()
  const mockCount = vi.fn()

  return {
    find: mockFind,
    count: mockCount,
    _mockFind: mockFind,
    _mockCount: mockCount,
  }
}

describe('Kafka Quotas', () => {
  describe('SYSTEM_DEFAULT_QUOTA', () => {
    it('should be 5', () => {
      expect(SYSTEM_DEFAULT_QUOTA).toBe(5)
    })
  })

  describe('getEffectiveQuota', () => {
    it('should return system default when no override exists', async () => {
      const mockPayload = createMockPayload()
      mockPayload._mockFind.mockResolvedValue({ docs: [] })

      const quota = await getEffectiveQuota(mockPayload as never, 'workspace-1')

      expect(quota).toBe(SYSTEM_DEFAULT_QUOTA)
      expect(mockPayload._mockFind).toHaveBeenCalledWith({
        collection: 'kafka-application-quotas',
        where: { workspace: { equals: 'workspace-1' } },
        limit: 1,
        overrideAccess: true,
      })
    })

    it('should return override value when override exists', async () => {
      const mockPayload = createMockPayload()
      mockPayload._mockFind.mockResolvedValue({
        docs: [{ applicationQuota: 15 }],
      })

      const quota = await getEffectiveQuota(mockPayload as never, 'workspace-1')

      expect(quota).toBe(15)
    })
  })

  describe('getQuotaUsage', () => {
    it('should return count of active applications', async () => {
      const mockPayload = createMockPayload()
      mockPayload._mockCount.mockResolvedValue({ totalDocs: 3 })

      const usage = await getQuotaUsage(mockPayload as never, 'workspace-1')

      expect(usage).toBe(3)
      expect(mockPayload._mockCount).toHaveBeenCalledWith({
        collection: 'kafka-applications',
        where: {
          workspace: { equals: 'workspace-1' },
          status: { equals: 'active' },
        },
        overrideAccess: true,
      })
    })

    it('should return 0 when no applications exist', async () => {
      const mockPayload = createMockPayload()
      mockPayload._mockCount.mockResolvedValue({ totalDocs: 0 })

      const usage = await getQuotaUsage(mockPayload as never, 'workspace-1')

      expect(usage).toBe(0)
    })
  })

  describe('canCreateApplication', () => {
    it('should return true when under quota', async () => {
      const mockPayload = createMockPayload()
      mockPayload._mockCount.mockResolvedValue({ totalDocs: 3 })
      mockPayload._mockFind.mockResolvedValue({ docs: [] }) // No override, uses default 5

      const canCreate = await canCreateApplication(mockPayload as never, 'workspace-1')

      expect(canCreate).toBe(true)
    })

    it('should return false when at quota', async () => {
      const mockPayload = createMockPayload()
      mockPayload._mockCount.mockResolvedValue({ totalDocs: 5 })
      mockPayload._mockFind.mockResolvedValue({ docs: [] }) // No override, uses default 5

      const canCreate = await canCreateApplication(mockPayload as never, 'workspace-1')

      expect(canCreate).toBe(false)
    })

    it('should return false when over quota', async () => {
      const mockPayload = createMockPayload()
      mockPayload._mockCount.mockResolvedValue({ totalDocs: 7 })
      mockPayload._mockFind.mockResolvedValue({ docs: [] })

      const canCreate = await canCreateApplication(mockPayload as never, 'workspace-1')

      expect(canCreate).toBe(false)
    })

    it('should respect quota override', async () => {
      const mockPayload = createMockPayload()
      mockPayload._mockCount.mockResolvedValue({ totalDocs: 7 })
      mockPayload._mockFind.mockResolvedValue({
        docs: [{ applicationQuota: 10 }],
      })

      const canCreate = await canCreateApplication(mockPayload as never, 'workspace-1')

      expect(canCreate).toBe(true) // 7 < 10
    })
  })

  describe('getWorkspaceQuotaInfo', () => {
    it('should return complete quota info without override', async () => {
      const mockPayload = createMockPayload()
      mockPayload._mockCount.mockResolvedValue({ totalDocs: 3 })
      mockPayload._mockFind.mockResolvedValue({ docs: [] })

      const info = await getWorkspaceQuotaInfo(mockPayload as never, 'workspace-1')

      expect(info).toEqual({
        used: 3,
        quota: 5,
        remaining: 2,
        hasOverride: false,
      })
    })

    it('should return complete quota info with override', async () => {
      const mockPayload = createMockPayload()
      mockPayload._mockCount.mockResolvedValue({ totalDocs: 8 })
      mockPayload._mockFind.mockResolvedValue({
        docs: [{ applicationQuota: 15 }],
      })

      const info = await getWorkspaceQuotaInfo(mockPayload as never, 'workspace-1')

      expect(info).toEqual({
        used: 8,
        quota: 15,
        remaining: 7,
        hasOverride: true,
      })
    })

    it('should clamp remaining to 0 when over quota', async () => {
      const mockPayload = createMockPayload()
      mockPayload._mockCount.mockResolvedValue({ totalDocs: 7 })
      mockPayload._mockFind.mockResolvedValue({ docs: [] }) // Default 5

      const info = await getWorkspaceQuotaInfo(mockPayload as never, 'workspace-1')

      expect(info.remaining).toBe(0)
    })
  })

  describe('hasQuotaOverride', () => {
    it('should return true when override exists', async () => {
      const mockPayload = createMockPayload()
      mockPayload._mockCount.mockResolvedValue({ totalDocs: 1 })

      const result = await hasQuotaOverride(mockPayload as never, 'workspace-1')

      expect(result).toBe(true)
    })

    it('should return false when no override exists', async () => {
      const mockPayload = createMockPayload()
      mockPayload._mockCount.mockResolvedValue({ totalDocs: 0 })

      const result = await hasQuotaOverride(mockPayload as never, 'workspace-1')

      expect(result).toBe(false)
    })
  })
})
