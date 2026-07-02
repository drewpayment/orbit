/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('payload', () => ({
  getPayload: vi.fn(),
}))

vi.mock('@payload-config', () => ({
  default: {},
}))

vi.stubEnv('ORBIT_INTERNAL_API_KEY', 'test-api-key')

// Import after mocking env
import { getPayload } from 'payload'
const { GET } = await import('./route')

function req(apiKey?: string | null) {
  const headers: Record<string, string> = {}
  if (apiKey) headers['X-API-Key'] = apiKey
  return new Request('http://localhost/api/internal/scorecards/due', {
    method: 'GET',
    headers,
  })
}

describe('GET /api/internal/scorecards/due', () => {
  const mockPayload = {
    find: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(getPayload as any).mockResolvedValue(mockPayload)
  })

  it('returns 401 without an API key', async () => {
    const response = await GET(req(null) as any)
    expect(response.status).toBe(401)
    expect(mockPayload.find).not.toHaveBeenCalled()
  })

  it('returns 401 with the wrong API key', async () => {
    const response = await GET(req('wrong-key') as any)
    expect(response.status).toBe(401)
    expect(mockPayload.find).not.toHaveBeenCalled()
  })

  it('returns only enabled scorecards with workspace normalized to a string id', async () => {
    mockPayload.find.mockResolvedValueOnce({
      docs: [
        { id: 'sc-1', workspace: 'ws-1' },
        { id: 'sc-2', workspace: { id: 'ws-2', slug: 'ws-two' } },
      ],
      hasNextPage: false,
    })

    const response = await GET(req('test-api-key') as any)
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data).toEqual({
      scorecards: [
        { id: 'sc-1', workspaceId: 'ws-1' },
        { id: 'sc-2', workspaceId: 'ws-2' },
      ],
    })

    expect(mockPayload.find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'scorecards',
        where: { enabled: { equals: true } },
      }),
    )
  })

  it('skips rows with a missing workspace', async () => {
    mockPayload.find.mockResolvedValueOnce({
      docs: [
        { id: 'sc-1', workspace: 'ws-1' },
        { id: 'sc-2', workspace: null },
        { id: 'sc-3' },
      ],
      hasNextPage: false,
    })

    const response = await GET(req('test-api-key') as any)
    const data = await response.json()
    expect(data.scorecards).toEqual([{ id: 'sc-1', workspaceId: 'ws-1' }])
  })

  it('paginates across multiple pages', async () => {
    mockPayload.find
      .mockResolvedValueOnce({
        docs: [{ id: 'sc-1', workspace: 'ws-1' }],
        hasNextPage: true,
      })
      .mockResolvedValueOnce({
        docs: [{ id: 'sc-2', workspace: 'ws-2' }],
        hasNextPage: false,
      })

    const response = await GET(req('test-api-key') as any)
    const data = await response.json()
    expect(data.scorecards).toEqual([
      { id: 'sc-1', workspaceId: 'ws-1' },
      { id: 'sc-2', workspaceId: 'ws-2' },
    ])
    expect(mockPayload.find).toHaveBeenCalledTimes(2)
    expect(mockPayload.find).toHaveBeenNthCalledWith(1, expect.objectContaining({ page: 1 }))
    expect(mockPayload.find).toHaveBeenNthCalledWith(2, expect.objectContaining({ page: 2 }))
  })

  it('returns 500 when payload throws', async () => {
    mockPayload.find.mockRejectedValueOnce(new Error('db exploded'))

    const response = await GET(req('test-api-key') as any)
    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.error).toBe('db exploded')
  })
})
