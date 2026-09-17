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
 * The shim delegates to the shared policy, which loads the membership row and
 * checks its `role` in code, so the mock just returns the row (or nothing).
 */
function mockRole(role: string | null) {
  mockFind.mockImplementation(async () => (role ? { docs: [{ id: 'm-1', role, status: 'active' }] } : { docs: [] }))
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
