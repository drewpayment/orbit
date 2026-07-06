/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ensurePayloadUser, type BridgeSessionUser } from './ensure-payload-user'

function makePayloadMock() {
  return {
    find: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  }
}

const sessionUser: BridgeSessionUser = {
  id: 'ba-user-id-123',
  email: 'drew.payment@gmail.com',
  name: 'Drew Payment',
  role: 'super_admin',
  status: 'approved',
}

describe('ensurePayloadUser', () => {
  let payload: ReturnType<typeof makePayloadMock>

  beforeEach(() => {
    payload = makePayloadMock()
  })

  it('returns the existing Payload user without creating one', async () => {
    const existing = { id: 'p1', email: sessionUser.email, role: 'super_admin', betterAuthId: 'ba-user-id-123' }
    payload.find.mockResolvedValue({ docs: [existing] })

    const result = await ensurePayloadUser(payload as never, sessionUser)

    expect(result).toMatchObject({ id: 'p1' })
    expect(payload.create).not.toHaveBeenCalled()
    expect(payload.update).not.toHaveBeenCalled()
  })

  it('lazy-populates betterAuthId on an existing user that lacks it', async () => {
    const existing = { id: 'p1', email: sessionUser.email, role: 'super_admin' }
    payload.find.mockResolvedValue({ docs: [existing] })
    payload.update.mockResolvedValue({ ...existing, betterAuthId: 'ba-user-id-123' })

    const result = await ensurePayloadUser(payload as never, sessionUser)

    expect(payload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'users',
        id: 'p1',
        data: { betterAuthId: 'ba-user-id-123' },
        context: { skipApprovalHook: true },
      }),
    )
    expect(result?.betterAuthId).toBe('ba-user-id-123')
  })

  it('still returns the user when the betterAuthId backfill update fails', async () => {
    const existing = { id: 'p1', email: sessionUser.email, role: 'super_admin' }
    payload.find.mockResolvedValue({ docs: [existing] })
    payload.update.mockRejectedValue(new Error('update failed'))

    const result = await ensurePayloadUser(payload as never, sessionUser)

    expect(result).toMatchObject({ id: 'p1' })
  })

  it('self-heals a missing Payload user from the Better-Auth session', async () => {
    payload.find.mockResolvedValue({ docs: [] })
    const created = {
      id: 'p-new',
      email: sessionUser.email,
      role: 'super_admin',
      status: 'approved',
      betterAuthId: 'ba-user-id-123',
    }
    payload.create.mockResolvedValue(created)

    const result = await ensurePayloadUser(payload as never, sessionUser)

    expect(payload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'users',
        data: expect.objectContaining({
          email: 'drew.payment@gmail.com',
          name: 'Drew Payment',
          role: 'super_admin',
          status: 'approved',
          betterAuthId: 'ba-user-id-123',
        }),
        overrideAccess: true,
        // Must skip the approval hook: the doc is created already-approved and
        // the hook would otherwise fire approval side effects (emails, workflows).
        context: { skipApprovalHook: true },
      }),
    )
    expect(result).toMatchObject({ id: 'p-new' })
  })

  it('defaults role to user and status to approved when the session omits them', async () => {
    payload.find.mockResolvedValue({ docs: [] })
    payload.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'p-new', ...data }))

    // Legacy Better-Auth users predate the status/role additionalFields; a live
    // session proves the login gate passed, so approved is the safe default.
    await ensurePayloadUser(payload as never, { id: 'ba-2', email: 'legacy@example.com' })

    expect(payload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: 'user', status: 'approved' }),
      }),
    )
  })

  it('coerces unknown role/status values to safe defaults', async () => {
    payload.find.mockResolvedValue({ docs: [] })
    payload.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'p-new', ...data }))

    await ensurePayloadUser(payload as never, {
      id: 'ba-3',
      email: 'weird@example.com',
      role: 'owner-of-everything',
      status: 'super-approved',
    })

    expect(payload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: 'user', status: 'approved' }),
      }),
    )
  })

  it('recovers from a create race by re-finding the user', async () => {
    const racedDoc = { id: 'p-raced', email: sessionUser.email, betterAuthId: 'ba-user-id-123' }
    payload.find
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [racedDoc] })
    payload.create.mockRejectedValue(new Error('E11000 duplicate key'))

    const result = await ensurePayloadUser(payload as never, sessionUser)

    expect(result).toMatchObject({ id: 'p-raced' })
    expect(payload.find).toHaveBeenCalledTimes(2)
  })

  it('returns null when create fails and the re-find comes back empty', async () => {
    payload.find.mockResolvedValue({ docs: [] })
    payload.create.mockRejectedValue(new Error('validation failed'))

    const result = await ensurePayloadUser(payload as never, sessionUser)

    expect(result).toBeNull()
  })

  it('returns null when the session has no email', async () => {
    const result = await ensurePayloadUser(payload as never, { id: 'ba-4', email: '' })

    expect(result).toBeNull()
    expect(payload.find).not.toHaveBeenCalled()
  })
})
