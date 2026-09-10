/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Payload } from 'payload'

const mockFind = vi.fn()
const mockPayload = { find: mockFind } as unknown as Payload

const { canManageTemplateDefinitions, canPublishTemplateDefinition, canRunTemplateDefinition } =
  await import('./authz')

/**
 * Simulates the membership row's role, respecting `hasWorkspaceRole`'s
 * `where.and[].role.in` filter (a bare `mockResolvedValue` would ignore the
 * query and always "match", which would silently pass a member as an
 * owner/admin).
 */
function mockRole(role: string | null) {
  mockFind.mockImplementation(async ({ where }: { where?: { and?: unknown[] } }) => {
    if (!role) return { docs: [] }
    const roleClause = where?.and?.find(
      (c): c is { role: { in: string[] } } =>
        typeof c === 'object' && c !== null && 'role' in c,
    )
    const allowedRoles = roleClause?.role.in ?? []
    if (!allowedRoles.includes(role)) return { docs: [] }
    return { docs: [{ id: 'm-1', role, status: 'active' }] }
  })
}

describe('lib/templates/authz', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('canManageTemplateDefinitions (owner/admin, mirrors canManageActions)', () => {
    it('true for owner', async () => {
      mockRole('owner')
      expect(await canManageTemplateDefinitions(mockPayload, 'u1', 'ws1')).toBe(true)
    })

    it('true for admin', async () => {
      mockRole('admin')
      expect(await canManageTemplateDefinitions(mockPayload, 'u1', 'ws1')).toBe(true)
    })

    it('false for member', async () => {
      mockRole('member')
      expect(await canManageTemplateDefinitions(mockPayload, 'u1', 'ws1')).toBe(false)
    })

    it('false for no membership', async () => {
      mockRole(null)
      expect(await canManageTemplateDefinitions(mockPayload, 'u1', 'ws1')).toBe(false)
    })

    it('true when isPayloadAdmin bypasses regardless of membership', async () => {
      mockRole(null)
      expect(await canManageTemplateDefinitions(mockPayload, 'u1', 'ws1', true)).toBe(true)
      expect(mockFind).not.toHaveBeenCalled()
    })

    it('false without userId/workspaceId', async () => {
      expect(await canManageTemplateDefinitions(mockPayload, null, 'ws1')).toBe(false)
      expect(await canManageTemplateDefinitions(mockPayload, 'u1', null)).toBe(false)
    })
  })

  describe('canRunTemplateDefinition (any active member, mirrors canRunActions)', () => {
    it.each(['owner', 'admin', 'member'])('true for %s', async (role) => {
      mockRole(role)
      expect(await canRunTemplateDefinition(mockPayload, 'u1', 'ws1')).toBe(true)
    })

    it('false for no membership', async () => {
      mockRole(null)
      expect(await canRunTemplateDefinition(mockPayload, 'u1', 'ws1')).toBe(false)
    })

    it('true when isPayloadAdmin bypasses', async () => {
      mockRole(null)
      expect(await canRunTemplateDefinition(mockPayload, 'u1', 'ws1', true)).toBe(true)
    })
  })

  describe('canPublishTemplateDefinition (owner/admin; platform admin required for shared|public — design §3.7)', () => {
    it.each(['workspace', undefined] as const)(
      'owner/admin CAN publish visibility=%s without platform admin',
      async (visibility) => {
        mockRole('owner')
        expect(
          await canPublishTemplateDefinition(mockPayload, 'u1', 'ws1', visibility, false),
        ).toBe(true)
      },
    )

    it.each(['shared', 'public'] as const)(
      'owner/admin CANNOT publish visibility=%s without platform admin',
      async (visibility) => {
        mockRole('owner')
        expect(
          await canPublishTemplateDefinition(mockPayload, 'u1', 'ws1', visibility, false),
        ).toBe(false)
      },
    )

    it.each(['shared', 'public'] as const)(
      'owner/admin CAN publish visibility=%s WITH platform admin',
      async (visibility) => {
        mockRole('owner')
        expect(
          await canPublishTemplateDefinition(mockPayload, 'u1', 'ws1', visibility, true),
        ).toBe(true)
      },
    )

    it('member cannot publish any visibility, even platform admin flag alone does not skip owner/admin check', async () => {
      mockRole('member')
      expect(await canPublishTemplateDefinition(mockPayload, 'u1', 'ws1', 'workspace', false)).toBe(
        false,
      )
    })

    it('platform admin (isPayloadAdmin) can always publish, any visibility, without a workspace role', async () => {
      mockRole(null)
      expect(await canPublishTemplateDefinition(mockPayload, 'u1', 'ws1', 'public', true)).toBe(
        true,
      )
      expect(mockFind).not.toHaveBeenCalled()
    })

    it('false without userId/workspaceId', async () => {
      expect(await canPublishTemplateDefinition(mockPayload, null, 'ws1', 'workspace')).toBe(false)
    })
  })
})
