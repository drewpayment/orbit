import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Payload } from 'payload'

/**
 * Minimal fake — this test only exercises `createAction`'s input validation
 * (`buildActionData`), which throws BEFORE any Payload call for the case
 * under test, so the fake never needs to serve real data.
 */
function makeFakePayload() {
  const find = vi.fn(async () => ({ docs: [{ id: 'm-1', role: 'owner', status: 'active' }] }))
  const create = vi.fn()
  const payload = { find, create } as unknown as Payload
  return { payload, find, create }
}

let mockPayload: ReturnType<typeof makeFakePayload>['payload']

vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('payload', () => ({ getPayload: vi.fn(async () => mockPayload) }))
// Mocked at the `@/lib/authz` module boundary (never the real `actor.ts`).
// This test always exercises an authorized owner, so `check` allows unconditionally.
vi.mock('@/lib/authz', () => ({
  requireActor: vi.fn(async () => ({
    payloadId: 'payload-user-1',
    betterAuthId: 'user-1',
    email: 'user@test.dev',
    role: 'user',
    isPlatformAdmin: false,
    user: { id: 'payload-user-1' },
  })),
  check: vi.fn(async (_verb: string, _resource: unknown, actor: unknown) => ({ allowed: true, reason: 'owner', actor })),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

describe('self-service/authoring-actions — createAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('BLOCKER 1: rejects backend.type "scaffolder" — never manually authorable', async () => {
    const env = makeFakePayload()
    mockPayload = env.payload
    const { createAction } = await import('./authoring-actions')

    await expect(
      createAction({
        workspace: 'ws-1',
        name: 'Sneaky',
        approvalPolicy: 'none',
        backend: { type: 'scaffolder', ref: 'def-1' },
        inputSchema: { fields: [] },
        enabled: true,
      }),
    ).rejects.toThrow(/cannot be manually authored/i)
    expect(env.create).not.toHaveBeenCalled()
  })
})
