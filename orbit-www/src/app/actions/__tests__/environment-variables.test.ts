import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('payload', () => ({ getPayload: vi.fn() }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('@/lib/authz', () => ({ getActor: vi.fn(), check: vi.fn() }))
vi.mock('@/lib/encryption', () => ({
  encrypt: vi.fn((v: string) => `enc:${v}`),
  decrypt: vi.fn((v: string) => v.replace(/^enc:/, '')),
}))

import { getPayload } from 'payload'
import { getActor, check } from '@/lib/authz'
import { resolveEnvironmentVariables } from '../environment-variables'

const actor = {
  payloadId: 'pl-1',
  betterAuthId: 'ba-1',
  email: 'a@test.com',
  role: 'user',
  isPlatformAdmin: false,
  user: { id: 'pl-1', collection: 'users' },
}

describe('resolveEnvironmentVariables (returns decrypted secrets)', () => {
  let payload: { findByID: ReturnType<typeof vi.fn>; find: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.clearAllMocks()
    payload = {
      findByID: vi.fn().mockResolvedValue({ id: 'app-1', workspace: 'ws-1' }),
      find: vi.fn().mockResolvedValue({ docs: [{ name: 'API_KEY', value: 'enc:s3cret' }] }),
    }
    ;(getPayload as any).mockResolvedValue(payload)
    ;(getActor as any).mockResolvedValue(actor)
    ;(check as any).mockResolvedValue({ allowed: true, reason: 'workspace member', actor })
  })

  it('rejects unauthenticated callers without reading or decrypting anything', async () => {
    ;(getActor as any).mockResolvedValue(null)
    const r = await resolveEnvironmentVariables('app-1', 'build')
    expect(r).toEqual({ success: false, error: 'Unauthorized' })
    expect(payload.findByID).not.toHaveBeenCalled()
    expect(payload.find).not.toHaveBeenCalled()
  })

  it('rejects non-members of the app workspace without returning secrets', async () => {
    ;(check as any).mockResolvedValue({ allowed: false, reason: 'not a member of this workspace', actor })
    const r = await resolveEnvironmentVariables('app-1', 'build')
    expect(r.success).toBe(false)
    expect(r.variables).toBeUndefined()
    expect(check).toHaveBeenCalledWith('create', { kind: 'workspace', id: 'ws-1' }, actor)
    expect(payload.find).not.toHaveBeenCalled()
  })

  it('returns decrypted variables to a member (the build path)', async () => {
    const r = await resolveEnvironmentVariables('app-1', 'build')
    expect(r.success).toBe(true)
    expect(r.variables).toEqual({ API_KEY: 's3cret' })
  })
})
