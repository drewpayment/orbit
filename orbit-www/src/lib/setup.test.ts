/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.stubEnv('DATABASE_URI', 'mongodb://localhost:27017/testdb')

// Mock MongoDB
const mockCountDocuments = vi.fn()
const mockCollection = vi.fn(() => ({ countDocuments: mockCountDocuments }))
const mockDb = vi.fn(() => ({ collection: mockCollection }))
const mockConnect = vi.fn()

vi.mock('mongodb', () => ({
  MongoClient: vi.fn(() => ({
    connect: mockConnect,
    db: mockDb,
  })),
}))

const { hasUsers, resetSetupCache } = await import('./setup')

describe('hasUsers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSetupCache()
  })

  it('returns false when no users exist', async () => {
    mockCountDocuments.mockResolvedValue(0)
    expect(await hasUsers()).toBe(false)
    expect(mockCollection).toHaveBeenCalledWith('user')
  })

  it('returns true when users exist', async () => {
    mockCountDocuments.mockResolvedValue(1)
    expect(await hasUsers()).toBe(true)
  })

  it('caches the result after first call that returns true', async () => {
    mockCountDocuments.mockResolvedValue(1)
    await hasUsers()
    await hasUsers()
    expect(mockCountDocuments).toHaveBeenCalledTimes(1)
  })

  it('does not cache false results', async () => {
    mockCountDocuments.mockResolvedValue(0)
    await hasUsers()
    mockCountDocuments.mockResolvedValue(1)
    await hasUsers()
    expect(mockCountDocuments).toHaveBeenCalledTimes(2)
  })

  it('invalidates cache after resetSetupCache()', async () => {
    mockCountDocuments.mockResolvedValue(1)
    await hasUsers()
    resetSetupCache()
    await hasUsers()
    expect(mockCountDocuments).toHaveBeenCalledTimes(2)
  })

  it('returns false when MongoDB throws', async () => {
    mockConnect.mockRejectedValue(new Error('connection refused'))
    expect(await hasUsers()).toBe(false)
  })
})
