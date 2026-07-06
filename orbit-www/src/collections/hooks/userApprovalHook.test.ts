import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- mongodb mock -----------------------------------------------------------
const mockFindOne = vi.fn()
const mockUpdateOne = vi.fn()
const mockInsertOne = vi.fn()
const mockCollection = vi.fn(() => ({
  findOne: mockFindOne,
  updateOne: mockUpdateOne,
  insertOne: mockInsertOne,
}))
vi.mock('@/lib/mongodb', () => ({
  getMongoClient: vi.fn(async () => ({
    db: () => ({ collection: mockCollection }),
  })),
}))

// --- Better Auth server API mock (imported dynamically by the hook) ---------
const mockSendVerificationEmail = vi.fn()
vi.mock('@/lib/auth', () => ({
  auth: { api: { sendVerificationEmail: mockSendVerificationEmail } },
}))

import { userApprovalAfterChangeHook } from './userApprovalHook'

const mockPayloadUpdate = vi.fn()

function runHook(args: {
  operation?: 'create' | 'update'
  doc: Record<string, unknown>
  previousDoc?: Record<string, unknown>
}) {
  return (userApprovalAfterChangeHook as any)({
    operation: args.operation ?? 'update',
    doc: args.doc,
    previousDoc: args.previousDoc ?? {},
    req: { payload: { update: mockPayloadUpdate }, user: { id: 'admin-1' } },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFindOne.mockResolvedValue({ _id: 'ba-1', email: 'u@test.com' })
  mockSendVerificationEmail.mockResolvedValue({})
  mockPayloadUpdate.mockResolvedValue({})
})

describe('userApprovalAfterChangeHook', () => {
  it('UAC-1: approving (skip unchecked) requests exactly one Better-Auth verification email and no hand-rolled token', async () => {
    await runHook({
      doc: { id: 'p1', email: 'u@test.com', status: 'approved', skipEmailVerification: false },
      previousDoc: { status: 'pending' },
    })

    expect(mockSendVerificationEmail).toHaveBeenCalledTimes(1)
    expect(mockSendVerificationEmail).toHaveBeenCalledWith({
      body: { email: 'u@test.com', callbackURL: '/login' },
    })
    // Better Auth user marked approved, NOT force-verified
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { _id: 'ba-1' },
      { $set: { status: 'approved' } },
    )
    // No hand-rolled insert into the verification collection remains
    expect(mockInsertOne).not.toHaveBeenCalled()
  })

  it('UAC-2a: approving with skip checked sets emailVerified and sends no email', async () => {
    await runHook({
      doc: { id: 'p1', email: 'u@test.com', status: 'approved', skipEmailVerification: true },
      previousDoc: { status: 'pending' },
    })

    expect(mockUpdateOne).toHaveBeenCalledWith(
      { _id: 'ba-1' },
      { $set: { status: 'approved', emailVerified: true } },
    )
    expect(mockSendVerificationEmail).not.toHaveBeenCalled()
  })

  it('UAC-2b: checking skip AFTER approval (status unchanged) retroactively sets emailVerified, no email', async () => {
    await runHook({
      doc: { id: 'p1', email: 'u@test.com', status: 'approved', skipEmailVerification: true },
      previousDoc: { status: 'approved', skipEmailVerification: false },
    })

    expect(mockUpdateOne).toHaveBeenCalledWith(
      { _id: 'ba-1' },
      { $set: { emailVerified: true } },
    )
    expect(mockSendVerificationEmail).not.toHaveBeenCalled()
    // retroactive path does not rewrite approval metadata
    expect(mockPayloadUpdate).not.toHaveBeenCalled()
  })

  it('does nothing when status is unchanged and skip did not flip', async () => {
    await runHook({
      doc: { id: 'p1', email: 'u@test.com', status: 'approved', skipEmailVerification: false },
      previousDoc: { status: 'approved', skipEmailVerification: false },
    })

    expect(mockFindOne).not.toHaveBeenCalled()
    expect(mockUpdateOne).not.toHaveBeenCalled()
    expect(mockSendVerificationEmail).not.toHaveBeenCalled()
  })

  it('does nothing on create', async () => {
    await runHook({
      operation: 'create',
      doc: { id: 'p1', email: 'u@test.com', status: 'approved' },
    })
    expect(mockFindOne).not.toHaveBeenCalled()
  })

  it('marks Better Auth user rejected when status flips to rejected', async () => {
    await runHook({
      doc: { id: 'p1', email: 'u@test.com', status: 'rejected' },
      previousDoc: { status: 'pending' },
    })
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { _id: 'ba-1' },
      { $set: { status: 'rejected' } },
    )
    expect(mockSendVerificationEmail).not.toHaveBeenCalled()
  })

  it('swallows send failures so approval is not rolled back', async () => {
    mockSendVerificationEmail.mockRejectedValue(new Error('resend down'))
    await expect(
      runHook({
        doc: { id: 'p1', email: 'u@test.com', status: 'approved', skipEmailVerification: false },
        previousDoc: { status: 'pending' },
      }),
    ).resolves.toBeDefined()
    // BA user still approved despite send failure
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { _id: 'ba-1' },
      { $set: { status: 'approved' } },
    )
  })

  it('returns early when no Better Auth user exists for the email', async () => {
    mockFindOne.mockResolvedValue(null)
    await runHook({
      doc: { id: 'p1', email: 'ghost@test.com', status: 'approved', skipEmailVerification: false },
      previousDoc: { status: 'pending' },
    })
    expect(mockUpdateOne).not.toHaveBeenCalled()
    expect(mockSendVerificationEmail).not.toHaveBeenCalled()
  })
})
