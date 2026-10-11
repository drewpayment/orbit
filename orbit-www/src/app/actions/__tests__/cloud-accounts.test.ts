/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.hoisted(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
})

const findByID = vi.fn()
const update = vi.fn()
const find = vi.fn()
vi.mock('payload', () => ({ getPayload: async () => ({ findByID, update, find }) }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('@/lib/authz', () => ({
  getActor: vi.fn(async () => ({ isPlatformAdmin: true, payloadId: 'u1', user: { id: 'u1' } })),
}))

import { encryptSecretJson } from '@/lib/encryption/secret-fields'
import { updateCloudAccount, getAllCloudAccounts } from '../cloud-accounts'

const stored = { tenantId: 't-1', clientId: 'c-1', clientSecret: 'super-secret' }

describe('cloud-accounts actions', () => {
  beforeEach(() => {
    findByID.mockReset()
    update.mockReset()
    find.mockReset()
    findByID.mockResolvedValue({ id: 'a1', provider: 'azure', credentials: encryptSecretJson(stored) })
    update.mockResolvedValue({})
  })

  it('editing non-secret fields with a blank secret keeps the stored secret', async () => {
    const r = await updateCloudAccount('a1', {
      credentials: { tenantId: 't-2', clientId: 'c-1', clientSecret: '' },
    })
    expect(r.success).toBe(true)
    expect(update.mock.calls[0][0].data.credentials).toEqual({
      tenantId: 't-2',
      clientId: 'c-1',
      clientSecret: 'super-secret',
    })
  })

  it('entering a new secret rotates it', async () => {
    await updateCloudAccount('a1', { credentials: { clientSecret: 'rotated' } })
    expect(update.mock.calls[0][0].data.credentials.clientSecret).toBe('rotated')
  })

  it('updates that do not touch credentials never read or write them', async () => {
    await updateCloudAccount('a1', { name: 'renamed' })
    expect(findByID).not.toHaveBeenCalled()
    expect('credentials' in update.mock.calls[0][0].data).toBe(false)
  })

  it('getAllCloudAccounts never sends secrets or ciphertext to the client', async () => {
    find.mockImplementation(async ({ collection }: { collection: string }) =>
      collection === 'cloud-accounts'
        ? { docs: [{ id: 'a1', name: 'prod', provider: 'azure', credentials: encryptSecretJson(stored), workspaces: [] }] }
        : { docs: [] },
    )
    const out = await getAllCloudAccounts()
    expect(out.accounts[0].credentials).toEqual({ tenantId: 't-1', clientId: 'c-1' })
    const json = JSON.stringify(out)
    expect(json).not.toContain('super-secret')
    expect(json).not.toContain('"enc"')
  })
})
