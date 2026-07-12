/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { canManageTarget, canAssignRole } from '../policy'

// --- Module mocks (declared before importing the actions under test) ---
// vi.mock factories are hoisted above imports, so the shared mock objects they
// close over must be created via vi.hoisted (also hoisted) — not plain consts.

const {
  mockGetActor,
  payloadMock,
  authApi,
  sessionCollection,
  baUserCollection,
} = vi.hoisted(() => ({
  mockGetActor: vi.fn(),
  payloadMock: {
    findByID: vi.fn(),
    find: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  authApi: {
    signUpEmail: vi.fn(),
    requestPasswordReset: vi.fn(),
    sendVerificationEmail: vi.fn(),
  },
  sessionCollection: { deleteMany: vi.fn() },
  baUserCollection: { updateOne: vi.fn(), findOne: vi.fn() },
}))

const dbMock = {
  collection: (name: string) => (name === 'session' ? sessionCollection : baUserCollection),
}

vi.mock('@/lib/auth/session', () => ({
  getPayloadUserFromSession: () => mockGetActor(),
}))
vi.mock('payload', () => ({ getPayload: async () => payloadMock }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('@/lib/auth', () => ({ auth: { api: authApi } }))
vi.mock('@/lib/mongodb', () => ({
  getMongoClient: async () => ({ db: () => dbMock }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import * as actions from '../actions'

// --- Fixtures ---
// Payload id and betterAuthId deliberately differ (session revocation keys on
// betterAuthId, never the Payload doc id).
const superAdmin = { id: 'p-super', betterAuthId: 'ba-super', role: 'super_admin', email: 'super@x.io', status: 'approved' }
const admin = { id: 'p-admin', betterAuthId: 'ba-admin', role: 'admin', email: 'admin@x.io', status: 'approved' }
const regular = { id: 'p-user', betterAuthId: 'ba-user', role: 'user', email: 'user@x.io', status: 'approved' }

function targetUser(over: Partial<typeof regular> = {}) {
  return { ...regular, ...over }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: no email collision, plenty of super_admins.
  payloadMock.find.mockResolvedValue({ docs: [] })
  baUserCollection.findOne.mockResolvedValue(null)
  payloadMock.count.mockResolvedValue({ totalDocs: 3 })
  payloadMock.create.mockResolvedValue({ id: 'p-new' })
  payloadMock.update.mockResolvedValue({ id: 'p-new' })
  authApi.signUpEmail.mockResolvedValue({ user: { id: 'ba-new' } })
})

// --- Pure policy matrix ---

describe('policy: canManageTarget', () => {
  it('admin can manage regular users only', () => {
    expect(canManageTarget('admin', 'user')).toBe(true)
    expect(canManageTarget('admin', 'admin')).toBe(false)
    expect(canManageTarget('admin', 'super_admin')).toBe(false)
  })
  it('super_admin can manage every role', () => {
    expect(canManageTarget('super_admin', 'user')).toBe(true)
    expect(canManageTarget('super_admin', 'admin')).toBe(true)
    expect(canManageTarget('super_admin', 'super_admin')).toBe(true)
  })
  it('regular user can manage nobody', () => {
    expect(canManageTarget('user', 'user')).toBe(false)
  })
})

describe('policy: canAssignRole', () => {
  it('admin may only assign role user', () => {
    expect(canAssignRole('admin', 'user')).toBe(true)
    expect(canAssignRole('admin', 'admin')).toBe(false)
    expect(canAssignRole('admin', 'super_admin')).toBe(false)
  })
  it('super_admin may assign any role', () => {
    expect(canAssignRole('super_admin', 'user')).toBe(true)
    expect(canAssignRole('super_admin', 'admin')).toBe(true)
    expect(canAssignRole('super_admin', 'super_admin')).toBe(true)
  })
})

// --- Auth gate (shared by every action) ---

describe('auth gate', () => {
  it('rejects unauthenticated callers', async () => {
    mockGetActor.mockResolvedValue(null)
    const res = await actions.deactivateUser('p-user')
    expect(res).toEqual({ ok: false, error: 'Forbidden' })
  })
  it('rejects non-platform-admin callers', async () => {
    mockGetActor.mockResolvedValue(regular)
    const res = await actions.deactivateUser('p-user')
    expect(res).toEqual({ ok: false, error: 'Forbidden' })
    expect(payloadMock.update).not.toHaveBeenCalled()
  })
})

// --- createUser ---

describe('createUser', () => {
  it('admin creates a regular user via invite (approved, unverified, reset link sent)', async () => {
    mockGetActor.mockResolvedValue(admin)
    const res = await actions.createUser({
      name: 'New Person',
      email: 'new@x.io',
      role: 'user',
      mode: 'invite',
    })
    expect(res.ok).toBe(true)
    expect(authApi.signUpEmail).toHaveBeenCalled()
    // BA user promoted to approved, NOT email-verified for invite mode.
    expect(baUserCollection.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'new@x.io' }),
      expect.objectContaining({ $set: expect.objectContaining({ status: 'approved', role: 'user' }) }),
    )
    // Payload mirror created approved with the BA id linked.
    expect(payloadMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'users',
        data: expect.objectContaining({ status: 'approved', role: 'user', betterAuthId: 'ba-new' }),
        overrideAccess: true,
      }),
    )
    // Invite link goes out via the reset-token path with invite copy.
    expect(authApi.requestPasswordReset).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ email: 'new@x.io', redirectTo: expect.stringContaining('invite=1') }) }),
    )
    if (res.ok) expect(res.data?.userId).toBe('p-new')
  })

  it('admin cannot create an admin (role escalation blocked)', async () => {
    mockGetActor.mockResolvedValue(admin)
    const res = await actions.createUser({ name: 'X', email: 'a@x.io', role: 'admin', mode: 'invite' })
    expect(res.ok).toBe(false)
    expect(authApi.signUpEmail).not.toHaveBeenCalled()
    expect(payloadMock.create).not.toHaveBeenCalled()
  })

  it('super_admin can create an admin', async () => {
    mockGetActor.mockResolvedValue(superAdmin)
    const res = await actions.createUser({ name: 'X', email: 'a@x.io', role: 'admin', mode: 'invite' })
    expect(res.ok).toBe(true)
  })

  it('manual-password mode creates a verified, immediately-usable account and sends no invite', async () => {
    mockGetActor.mockResolvedValue(admin)
    const res = await actions.createUser({
      name: 'PW User',
      email: 'pw@x.io',
      role: 'user',
      mode: 'password',
      password: 'longenough1',
    })
    expect(res.ok).toBe(true)
    expect(baUserCollection.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'pw@x.io' }),
      expect.objectContaining({ $set: expect.objectContaining({ emailVerified: true }) }),
    )
    expect(authApi.requestPasswordReset).not.toHaveBeenCalled()
  })

  it('rejects a manual password under 8 characters', async () => {
    mockGetActor.mockResolvedValue(admin)
    const res = await actions.createUser({ name: 'X', email: 'p@x.io', role: 'user', mode: 'password', password: 'short' })
    expect(res.ok).toBe(false)
    expect(authApi.signUpEmail).not.toHaveBeenCalled()
  })

  it('rejects a duplicate email in either store and creates nothing', async () => {
    mockGetActor.mockResolvedValue(admin)
    payloadMock.find.mockResolvedValue({ docs: [{ id: 'existing' }] })
    const res = await actions.createUser({ name: 'Dup', email: 'dup@x.io', role: 'user', mode: 'invite' })
    expect(res.ok).toBe(false)
    expect(authApi.signUpEmail).not.toHaveBeenCalled()
    expect(payloadMock.create).not.toHaveBeenCalled()
  })
})

// --- updateUser ---

describe('updateUser', () => {
  it('admin can rename a regular user', async () => {
    mockGetActor.mockResolvedValue(admin)
    payloadMock.findByID.mockResolvedValue(targetUser())
    const res = await actions.updateUser({ userId: 'p-user', name: 'Renamed' })
    expect(res.ok).toBe(true)
    expect(payloadMock.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'Renamed' }) }),
    )
  })

  it('admin cannot edit another admin', async () => {
    mockGetActor.mockResolvedValue(admin)
    payloadMock.findByID.mockResolvedValue({ ...admin, id: 'p-other-admin' })
    const res = await actions.updateUser({ userId: 'p-other-admin', name: 'Nope' })
    expect(res.ok).toBe(false)
    expect(payloadMock.update).not.toHaveBeenCalled()
  })

  it('admin cannot promote a user to admin', async () => {
    mockGetActor.mockResolvedValue(admin)
    payloadMock.findByID.mockResolvedValue(targetUser())
    const res = await actions.updateUser({ userId: 'p-user', role: 'admin' })
    expect(res.ok).toBe(false)
    expect(payloadMock.update).not.toHaveBeenCalled()
  })

  it('super_admin can promote a user to admin and mirrors the role to Better-Auth', async () => {
    mockGetActor.mockResolvedValue(superAdmin)
    payloadMock.findByID.mockResolvedValue(targetUser())
    const res = await actions.updateUser({ userId: 'p-user', role: 'admin' })
    expect(res.ok).toBe(true)
    expect(baUserCollection.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'user@x.io' }),
      expect.objectContaining({ $set: expect.objectContaining({ role: 'admin' }) }),
    )
  })

  it('no actor may change their own role', async () => {
    mockGetActor.mockResolvedValue(superAdmin)
    payloadMock.findByID.mockResolvedValue(superAdmin)
    const res = await actions.updateUser({ userId: 'p-super', role: 'admin' })
    expect(res.ok).toBe(false)
    expect(payloadMock.update).not.toHaveBeenCalled()
  })

  it('refuses to demote the last active super_admin', async () => {
    mockGetActor.mockResolvedValue(superAdmin)
    payloadMock.findByID.mockResolvedValue({ ...superAdmin, id: 'p-other-super', email: 'other@x.io' })
    payloadMock.count.mockResolvedValue({ totalDocs: 1 })
    const res = await actions.updateUser({ userId: 'p-other-super', role: 'admin' })
    expect(res.ok).toBe(false)
    expect(payloadMock.update).not.toHaveBeenCalled()
  })

  it('allows demoting a super_admin when others remain', async () => {
    mockGetActor.mockResolvedValue(superAdmin)
    payloadMock.findByID.mockResolvedValue({ ...superAdmin, id: 'p-other-super', email: 'other@x.io' })
    payloadMock.count.mockResolvedValue({ totalDocs: 2 })
    const res = await actions.updateUser({ userId: 'p-other-super', role: 'admin' })
    expect(res.ok).toBe(true)
  })
})

// --- approve / reject ---

describe('approveUser / rejectUser', () => {
  it('approves a pending user through the normal hook path (no skipApprovalHook)', async () => {
    mockGetActor.mockResolvedValue(admin)
    payloadMock.findByID.mockResolvedValue(targetUser({ status: 'pending' }))
    const res = await actions.approveUser('p-user')
    expect(res.ok).toBe(true)
    const call = payloadMock.update.mock.calls[0][0]
    expect(call.data).toMatchObject({ status: 'approved' })
    expect(call.context?.skipApprovalHook).not.toBe(true)
  })

  it('refuses to approve a non-pending user', async () => {
    mockGetActor.mockResolvedValue(admin)
    payloadMock.findByID.mockResolvedValue(targetUser({ status: 'approved' }))
    const res = await actions.approveUser('p-user')
    expect(res.ok).toBe(false)
  })

  it('rejects a pending user', async () => {
    mockGetActor.mockResolvedValue(admin)
    payloadMock.findByID.mockResolvedValue(targetUser({ status: 'pending' }))
    const res = await actions.rejectUser('p-user')
    expect(res.ok).toBe(true)
    expect(payloadMock.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'rejected' }) }),
    )
  })
})

// --- deactivate / reactivate ---

describe('deactivateUser', () => {
  it('deactivates a regular user, mirrors status, and revokes their sessions by betterAuthId', async () => {
    mockGetActor.mockResolvedValue(admin)
    payloadMock.findByID.mockResolvedValue(targetUser())
    const res = await actions.deactivateUser('p-user')
    expect(res.ok).toBe(true)
    expect(payloadMock.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'deactivated' }) }),
    )
    expect(baUserCollection.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'user@x.io' }),
      expect.objectContaining({ $set: expect.objectContaining({ status: 'deactivated' }) }),
    )
    expect(sessionCollection.deleteMany).toHaveBeenCalled()
  })

  it('refuses self-deactivation', async () => {
    mockGetActor.mockResolvedValue(admin)
    payloadMock.findByID.mockResolvedValue(admin)
    const res = await actions.deactivateUser('p-admin')
    expect(res.ok).toBe(false)
    expect(payloadMock.update).not.toHaveBeenCalled()
  })

  it('admin cannot deactivate another admin', async () => {
    mockGetActor.mockResolvedValue(admin)
    payloadMock.findByID.mockResolvedValue({ ...admin, id: 'p-other-admin', email: 'o@x.io' })
    const res = await actions.deactivateUser('p-other-admin')
    expect(res.ok).toBe(false)
  })

  it('refuses to deactivate the last active super_admin', async () => {
    mockGetActor.mockResolvedValue(superAdmin)
    payloadMock.findByID.mockResolvedValue({ ...superAdmin, id: 'p-other-super', email: 'o@x.io' })
    payloadMock.count.mockResolvedValue({ totalDocs: 1 })
    const res = await actions.deactivateUser('p-other-super')
    expect(res.ok).toBe(false)
    expect(sessionCollection.deleteMany).not.toHaveBeenCalled()
  })
})

describe('reactivateUser', () => {
  it('restores a deactivated user to approved', async () => {
    mockGetActor.mockResolvedValue(admin)
    payloadMock.findByID.mockResolvedValue(targetUser({ status: 'deactivated' }))
    const res = await actions.reactivateUser('p-user')
    expect(res.ok).toBe(true)
    expect(payloadMock.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'approved' }) }),
    )
  })

  it('refuses to reactivate a user who is not deactivated', async () => {
    mockGetActor.mockResolvedValue(admin)
    payloadMock.findByID.mockResolvedValue(targetUser({ status: 'approved' }))
    const res = await actions.reactivateUser('p-user')
    expect(res.ok).toBe(false)
  })
})

// --- email utilities ---

describe('email utilities', () => {
  it('resendVerification sends a verification email for an approved, unverified user', async () => {
    mockGetActor.mockResolvedValue(admin)
    payloadMock.findByID.mockResolvedValue(targetUser())
    baUserCollection.findOne.mockResolvedValue({ email: 'user@x.io', emailVerified: false, status: 'approved' })
    const res = await actions.resendVerification('p-user')
    expect(res.ok).toBe(true)
    expect(authApi.sendVerificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ email: 'user@x.io' }) }),
    )
  })

  it('sendPasswordReset uses the reset-token path', async () => {
    mockGetActor.mockResolvedValue(admin)
    payloadMock.findByID.mockResolvedValue(targetUser())
    const res = await actions.sendPasswordReset('p-user')
    expect(res.ok).toBe(true)
    expect(authApi.requestPasswordReset).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ email: 'user@x.io' }) }),
    )
  })

  it('resendInvite re-sends the invite reset link', async () => {
    mockGetActor.mockResolvedValue(admin)
    payloadMock.findByID.mockResolvedValue(targetUser())
    baUserCollection.findOne.mockResolvedValue({ email: 'user@x.io', emailVerified: false, status: 'approved' })
    const res = await actions.resendInvite('p-user')
    expect(res.ok).toBe(true)
    expect(authApi.requestPasswordReset).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ redirectTo: expect.stringContaining('invite=1') }) }),
    )
  })
})
