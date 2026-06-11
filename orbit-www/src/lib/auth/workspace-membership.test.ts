/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  requireWorkspaceMembership,
  checkWorkspaceMembership,
  WorkspaceMembershipError,
} from './workspace-membership'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePayload(memberDocs: unknown[]) {
  return {
    find: vi.fn().mockResolvedValue({ docs: memberDocs }),
  } as unknown as import('payload').Payload
}

/** Shape of the payload.find arguments the helper is expected to build. */
interface FindCallArgs {
  where?: { and?: Array<Record<string, { equals?: unknown } | undefined>> }
  limit?: number
  overrideAccess?: boolean
}

// ---------------------------------------------------------------------------
// requireWorkspaceMembership
// ---------------------------------------------------------------------------

describe('requireWorkspaceMembership', () => {
  it('resolves when the user is an active member', async () => {
    const payload = makePayload([{ id: 'mem-1', user: 'bauth-1', workspace: 'ws-1', status: 'active' }])
    await expect(requireWorkspaceMembership(payload, 'bauth-1', 'ws-1')).resolves.toBeUndefined()
  })

  it('throws WorkspaceMembershipError when no membership exists', async () => {
    const payload = makePayload([])
    await expect(requireWorkspaceMembership(payload, 'bauth-1', 'ws-1')).rejects.toBeInstanceOf(
      WorkspaceMembershipError,
    )
  })

  it('queries using the betterAuthId (not the Payload user id)', async () => {
    const payload = makePayload([])
    try {
      await requireWorkspaceMembership(payload, 'bauth-xyz', 'ws-abc')
    } catch {
      // expected
    }
    const [callArgs] = vi.mocked(payload.find).mock.calls
    // The where clause must include user: { equals: 'bauth-xyz' }
    const andClauses = (callArgs[0] as FindCallArgs).where?.and ?? []
    const userClause = andClauses.find((c: any) => c?.user?.equals !== undefined)
    expect(userClause?.user?.equals).toBe('bauth-xyz')
  })

  it('includes workspace, status=active, and limit:1 in the query', async () => {
    const payload = makePayload([])
    try {
      await requireWorkspaceMembership(payload, 'bauth-1', 'ws-99')
    } catch {
      // expected
    }
    const [callArgs] = vi.mocked(payload.find).mock.calls
    const findArgs = callArgs[0] as FindCallArgs
    expect(findArgs.limit).toBe(1)
    expect(findArgs.overrideAccess).toBe(true)
    const andClauses = findArgs.where?.and ?? []
    const wsClause = andClauses.find((c: any) => c?.workspace?.equals !== undefined)
    expect(wsClause?.workspace?.equals).toBe('ws-99')
    const statusClause = andClauses.find((c: any) => c?.status?.equals !== undefined)
    expect(statusClause?.status?.equals).toBe('active')
  })
})

// ---------------------------------------------------------------------------
// checkWorkspaceMembership
// ---------------------------------------------------------------------------

describe('checkWorkspaceMembership', () => {
  it('returns { ok: true } when the user is a member', async () => {
    const payload = makePayload([{ id: 'mem-1' }])
    const result = await checkWorkspaceMembership(payload, 'bauth-1', 'ws-1')
    expect(result).toEqual({ ok: true })
  })

  it('returns { ok: false, error } when the user is not a member', async () => {
    const payload = makePayload([])
    const result = await checkWorkspaceMembership(payload, 'bauth-1', 'ws-1')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeTruthy()
    }
  })
})
