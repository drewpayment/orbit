/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockHasUsers = vi.fn()
const mockResetSetupCache = vi.fn()
vi.mock('@/lib/setup', () => ({
  hasUsers: () => mockHasUsers(),
  resetSetupCache: mockResetSetupCache,
}))

const mockSignUpEmail = vi.fn()
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      signUpEmail: (...args: unknown[]) => mockSignUpEmail(...args),
    },
  },
}))

const mockPayloadCreate = vi.fn()
const mockPayloadFind = vi.fn()
vi.mock('payload', () => ({
  getPayload: vi.fn(() =>
    Promise.resolve({
      create: (...args: unknown[]) => mockPayloadCreate(...args),
      find: (...args: unknown[]) => mockPayloadFind(...args),
    })
  ),
}))

vi.mock('@payload-config', () => ({ default: {} }))

const { POST } = await import('./route')

function createRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validBody = {
  name: 'Admin User',
  email: 'admin@example.com',
  password: 'securepassword123',
  workspaceName: 'My Workspace',
}

describe('POST /api/setup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasUsers.mockResolvedValue(false)
    mockSignUpEmail.mockResolvedValue({
      user: { id: 'ba-user-1', email: 'admin@example.com', name: 'Admin User' },
      headers: new Headers({ 'set-cookie': 'session=abc123' }),
    })
    mockPayloadCreate.mockResolvedValue({ id: 'payload-1' })
    mockPayloadFind.mockResolvedValue({ docs: [] })
  })

  it('returns 403 when users already exist', async () => {
    mockHasUsers.mockResolvedValue(true)
    const response = await POST(createRequest(validBody))
    expect(response.status).toBe(403)
  })

  it('returns 400 when required fields are missing', async () => {
    const response = await POST(createRequest({ name: 'Test' }))
    expect(response.status).toBe(400)
  })

  it('returns 400 when password is too short', async () => {
    const response = await POST(createRequest({ ...validBody, password: 'short' }))
    expect(response.status).toBe(400)
  })

  it('creates user in Better Auth', async () => {
    await POST(createRequest(validBody))
    expect(mockSignUpEmail).toHaveBeenCalledWith({
      body: { name: 'Admin User', email: 'admin@example.com', password: 'securepassword123' },
    })
  })

  it('creates user in Payload', async () => {
    await POST(createRequest(validBody))
    expect(mockPayloadCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'users',
        data: expect.objectContaining({ email: 'admin@example.com', name: 'Admin User' }),
      })
    )
  })

  it('creates default tenant', async () => {
    await POST(createRequest(validBody))
    expect(mockPayloadCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'tenants',
        data: expect.objectContaining({
          name: 'Default',
          slug: 'default',
          plan: 'self-hosted',
          status: 'active',
        }),
      })
    )
  })

  it('creates workspace with provided name', async () => {
    await POST(createRequest(validBody))
    expect(mockPayloadCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'workspaces',
        data: expect.objectContaining({ name: 'My Workspace' }),
      })
    )
  })

  it('creates workspace member as owner', async () => {
    mockPayloadCreate
      .mockResolvedValueOnce({ id: 'payload-user-1' }) // users
      .mockResolvedValueOnce({ id: 'tenant-1' }) // tenants
      .mockResolvedValueOnce({ id: 'workspace-1' }) // workspaces
      .mockResolvedValueOnce({ id: 'member-1' }) // workspace-members

    await POST(createRequest(validBody))
    expect(mockPayloadCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'workspace-members',
        data: expect.objectContaining({
          workspace: 'workspace-1',
          user: 'payload-user-1',
          role: 'owner',
          status: 'active',
        }),
      })
    )
  })

  it('invalidates setup cache on success', async () => {
    await POST(createRequest(validBody))
    expect(mockResetSetupCache).toHaveBeenCalled()
  })

  it('returns 200 with success on success', async () => {
    const response = await POST(createRequest(validBody))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
  })

  it('returns 500 when Better Auth signup fails', async () => {
    mockSignUpEmail.mockRejectedValue(new Error('signup failed'))
    const response = await POST(createRequest(validBody))
    expect(response.status).toBe(500)
  })

  it('returns 400 for invalid email format', async () => {
    const response = await POST(createRequest({ ...validBody, email: 'notanemail' }))
    expect(response.status).toBe(400)
  })

  it('returns 400 for workspace name with no alphanumeric chars', async () => {
    const response = await POST(createRequest({ ...validBody, workspaceName: '!!!' }))
    expect(response.status).toBe(400)
  })

  it('returns 500 and does not call resetSetupCache when Payload fails', async () => {
    mockPayloadCreate.mockRejectedValue(new Error('DB error'))
    const response = await POST(createRequest(validBody))
    expect(response.status).toBe(500)
    expect(mockResetSetupCache).not.toHaveBeenCalled()
  })
})
