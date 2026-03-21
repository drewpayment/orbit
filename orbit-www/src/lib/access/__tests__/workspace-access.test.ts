/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFind = vi.fn()
const mockPayload = { find: mockFind } as any

const {
  getWorkspaceMembership,
  isWorkspaceMember,
  isWorkspaceAdminOrOwner,
  getAdminOrOwnerWorkspaceIds,
  getOwnerWorkspaceIds,
  getMemberWorkspaceIds,
  isSuperAdmin,
  isPlatformAdmin,
} = await import('../workspace-access')

describe('workspace-access helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getWorkspaceMembership', () => {
    it('returns membership doc when user is a member', async () => {
      const memberDoc = { id: 'm1', role: 'member', workspace: 'ws1', user: 'ba-user-1' }
      mockFind.mockResolvedValue({ docs: [memberDoc] })

      const result = await getWorkspaceMembership(mockPayload, 'ba-user-1', 'ws1')
      expect(result).toEqual(memberDoc)
      expect(mockFind).toHaveBeenCalledWith({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: 'ws1' } },
            { user: { equals: 'ba-user-1' } },
            { status: { equals: 'active' } },
          ],
        },
        limit: 1,
        overrideAccess: true,
      })
    })

    it('returns null when user is not a member', async () => {
      mockFind.mockResolvedValue({ docs: [] })
      const result = await getWorkspaceMembership(mockPayload, 'ba-user-2', 'ws1')
      expect(result).toBeNull()
    })
  })

  describe('isWorkspaceMember', () => {
    it('returns true when user is a member', async () => {
      mockFind.mockResolvedValue({ docs: [{ id: 'm1', role: 'member' }] })
      expect(await isWorkspaceMember(mockPayload, 'ba-user-1', 'ws1')).toBe(true)
    })

    it('returns false when user is not a member', async () => {
      mockFind.mockResolvedValue({ docs: [] })
      expect(await isWorkspaceMember(mockPayload, 'ba-user-2', 'ws1')).toBe(false)
    })
  })

  describe('isWorkspaceAdminOrOwner', () => {
    it('returns true for owner', async () => {
      mockFind.mockResolvedValue({ docs: [{ id: 'm1', role: 'owner' }] })
      expect(await isWorkspaceAdminOrOwner(mockPayload, 'ba-user-1', 'ws1')).toBe(true)
    })

    it('returns true for admin', async () => {
      mockFind.mockResolvedValue({ docs: [{ id: 'm1', role: 'admin' }] })
      expect(await isWorkspaceAdminOrOwner(mockPayload, 'ba-user-1', 'ws1')).toBe(true)
    })

    it('returns false for member', async () => {
      mockFind.mockResolvedValue({ docs: [{ id: 'm1', role: 'member' }] })
      expect(await isWorkspaceAdminOrOwner(mockPayload, 'ba-user-1', 'ws1')).toBe(false)
    })

    it('returns false for non-member', async () => {
      mockFind.mockResolvedValue({ docs: [] })
      expect(await isWorkspaceAdminOrOwner(mockPayload, 'ba-user-2', 'ws1')).toBe(false)
    })
  })

  describe('getAdminOrOwnerWorkspaceIds', () => {
    it('returns workspace IDs where user is owner or admin', async () => {
      mockFind.mockResolvedValue({
        docs: [
          { workspace: 'ws1', role: 'owner' },
          { workspace: 'ws2', role: 'admin' },
        ],
      })
      const ids = await getAdminOrOwnerWorkspaceIds(mockPayload, 'ba-user-1')
      expect(ids).toEqual(['ws1', 'ws2'])
    })

    it('returns empty array when user has no admin/owner roles', async () => {
      mockFind.mockResolvedValue({ docs: [] })
      const ids = await getAdminOrOwnerWorkspaceIds(mockPayload, 'ba-user-1')
      expect(ids).toEqual([])
    })

    it('handles workspace as object (populated relationship)', async () => {
      mockFind.mockResolvedValue({
        docs: [{ workspace: { id: 'ws1' }, role: 'owner' }],
      })
      const ids = await getAdminOrOwnerWorkspaceIds(mockPayload, 'ba-user-1')
      expect(ids).toEqual(['ws1'])
    })
  })

  describe('getOwnerWorkspaceIds', () => {
    it('returns workspace IDs where user is owner only', async () => {
      mockFind.mockResolvedValue({
        docs: [{ workspace: 'ws1', role: 'owner' }],
      })
      const ids = await getOwnerWorkspaceIds(mockPayload, 'ba-user-1')
      expect(ids).toEqual(['ws1'])
      expect(mockFind).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            and: expect.arrayContaining([
              { role: { equals: 'owner' } },
            ]),
          }),
        })
      )
    })
  })

  describe('getMemberWorkspaceIds', () => {
    it('returns all workspace IDs where user is active member', async () => {
      mockFind.mockResolvedValue({
        docs: [
          { workspace: 'ws1', role: 'owner' },
          { workspace: 'ws2', role: 'member' },
        ],
      })
      const ids = await getMemberWorkspaceIds(mockPayload, 'ba-user-1')
      expect(ids).toEqual(['ws1', 'ws2'])
    })
  })

  describe('isPlatformAdmin', () => {
    it('returns true for super_admin role', () => {
      expect(isPlatformAdmin({ role: 'super_admin' })).toBe(true)
    })

    it('returns true for admin role', () => {
      expect(isPlatformAdmin({ role: 'admin' })).toBe(true)
    })

    it('returns false for user role', () => {
      expect(isPlatformAdmin({ role: 'user' })).toBe(false)
    })

    it('returns false for null user', () => {
      expect(isPlatformAdmin(null)).toBe(false)
    })
  })

  describe('isSuperAdmin (deprecated alias)', () => {
    it('works as alias for isPlatformAdmin', () => {
      expect(isSuperAdmin({ role: 'super_admin' })).toBe(true)
      expect(isSuperAdmin({ role: 'admin' })).toBe(true)
      expect(isSuperAdmin({ role: 'user' })).toBe(false)
    })
  })
})
