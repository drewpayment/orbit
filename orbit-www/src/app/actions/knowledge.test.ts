import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getActor } from '@/lib/authz'
import {
  createKnowledgeSpace,
  createKnowledgePage,
  renamePage,
  movePage,
  duplicatePage,
  deletePage,
  updatePageSortOrder,
  updatePageContent,
} from './knowledge'

vi.mock('payload', () => ({
  getPayload: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@payload-config', () => ({
  default: {},
}))

// Fixed actor (Phase C, #135): pre-existing test never mocked identity at all
// and always crashed at module load (`@/lib/auth/session` → `@/lib/auth`
// constructs a MongoClient at import time with no DATABASE_URI); confirmed by
// reproducing the identical crash against the pre-migration `knowledge.ts`.
// Mock `@/lib/authz` at the module boundary per the Phase C brief — never the
// real `actor.ts`.
const mockActor = {
  payloadId: 'payload-1',
  betterAuthId: 'ba-1',
  email: 'user@example.com',
  role: 'user',
  isPlatformAdmin: false,
  user: { id: 'payload-1', collection: 'users', _strategy: 'better-auth' },
}
vi.mock('@/lib/authz', () => ({
  getActor: vi.fn(),
}))

describe('Knowledge Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getActor).mockResolvedValue(mockActor as any)
  })

  describe('authentication', () => {
    it.each([
      ['createKnowledgeSpace', () => createKnowledgeSpace({ name: 'n', visibility: 'private', workspaceSlug: 'w' })],
      ['createKnowledgePage', () => createKnowledgePage({ title: 't', slug: 's', knowledgeSpaceId: 'sp', workspaceSlug: 'w', spaceSlug: 's' })],
      ['renamePage', () => renamePage('1', 't', 'w', 's')],
      ['movePage', () => movePage('1', null, 'w', 's')],
      ['duplicatePage', () => duplicatePage('1', 'w', 's')],
      ['deletePage', () => deletePage('1', 'w', 's')],
      ['updatePageSortOrder', () => updatePageSortOrder('1', '2', 'w', 's')],
      ['updatePageContent', () => updatePageContent('1', 'w', 's', 'p', { type: 'doc', content: [] } as any)],
    ])('%s rejects unauthenticated callers before touching payload', async (_name, call) => {
      vi.mocked(getActor).mockResolvedValue(null)
      const { getPayload } = await import('payload')
      ;(getPayload as any).mockClear()
      await expect(call()).rejects.toThrow('Not authenticated')
      expect(getPayload).not.toHaveBeenCalled()
    })
  })

  describe('createKnowledgePage', () => {
    it('attributes the page to the session actor, ignoring any client-supplied userId', async () => {
      const { getPayload } = await import('payload')
      const mockPayload = {
        findByID: vi.fn().mockResolvedValue({ id: 'parent-1', knowledgeSpace: 'space-1' }),
        create: vi.fn().mockResolvedValue({ id: 'new', slug: 'x' }),
      }
      ;(getPayload as any).mockResolvedValue(mockPayload)

      await createKnowledgePage({
        title: 'T',
        slug: 'x',
        knowledgeSpaceId: 'space-1',
        parentPageId: 'parent-1',
        userId: 'attacker-chosen',
        workspaceSlug: 'w',
        spaceSlug: 's',
      } as any)

      const data = mockPayload.create.mock.calls[0][0].data
      expect(data.author).toBe(mockActor.payloadId)
      expect(data.lastEditedBy).toBe(mockActor.payloadId)
      expect(mockPayload.create.mock.calls[0][0]).toMatchObject({ user: mockActor.user, overrideAccess: false })
    })

    it('rejects a parent page that belongs to a different space', async () => {
      const { getPayload } = await import('payload')
      const mockPayload = {
        findByID: vi.fn().mockResolvedValue({ id: 'parent-1', knowledgeSpace: 'other-space' }),
        create: vi.fn(),
      }
      ;(getPayload as any).mockResolvedValue(mockPayload)

      await expect(
        createKnowledgePage({
          title: 'T',
          slug: 'x',
          knowledgeSpaceId: 'space-1',
          parentPageId: 'parent-1',
          workspaceSlug: 'w',
          spaceSlug: 's',
        }),
      ).rejects.toThrow('Parent page not found')
      expect(mockPayload.create).not.toHaveBeenCalled()
    })
  })

  describe('updatePageContent', () => {
    it('updates under the actor access rules (never override)', async () => {
      const { getPayload } = await import('payload')
      const mockPayload = { update: vi.fn().mockResolvedValue({ id: '1' }) }
      ;(getPayload as any).mockResolvedValue(mockPayload)

      await updatePageContent('1', 'w', 's', 'p', { type: 'doc', content: [] } as any)

      expect(mockPayload.update).toHaveBeenCalledWith({
        collection: 'knowledge-pages',
        id: '1',
        data: { content: { type: 'doc', content: [] }, contentFormat: 'blocks' },
        user: mockActor.user,
        overrideAccess: false,
      })
    })
  })

  describe('updatePageSortOrder', () => {
    it('refuses to reorder across knowledge spaces and reads under actor access', async () => {
      const { getPayload } = await import('payload')
      const mockPayload = {
        findByID: vi
          .fn()
          .mockResolvedValueOnce({ id: 'a', knowledgeSpace: 'space-1', parentPage: null })
          .mockResolvedValueOnce({ id: 'b', knowledgeSpace: 'space-2', parentPage: null }),
        find: vi.fn(),
        update: vi.fn(),
      }
      ;(getPayload as any).mockResolvedValue(mockPayload)

      await expect(updatePageSortOrder('a', 'b', 'w', 's')).rejects.toThrow('Pages must be in the same space')
      for (const call of mockPayload.findByID.mock.calls) {
        expect(call[0]).toMatchObject({ user: mockActor.user, overrideAccess: false })
      }
      expect(mockPayload.update).not.toHaveBeenCalled()
    })
  })

  describe('renamePage', () => {
    it('should update page title', async () => {
      const { getPayload } = await import('payload')
      const mockPayload = {
        update: vi.fn().mockResolvedValue({ id: '1', title: 'New Title' }),
      }
      ;(getPayload as any).mockResolvedValue(mockPayload)

      await renamePage('1', 'New Title', 'test', 'space')

      expect(mockPayload.update).toHaveBeenCalledWith({
        collection: 'knowledge-pages',
        id: '1',
        data: {
          title: 'New Title',
        },
        user: mockActor.user,
        overrideAccess: false,
      })
    })

    it('should revalidate the path after rename', async () => {
      const { getPayload } = await import('payload')
      const { revalidatePath } = await import('next/cache')
      const mockPayload = {
        update: vi.fn().mockResolvedValue({ id: '1' }),
      }
      ;(getPayload as any).mockResolvedValue(mockPayload)

      await renamePage('1', 'New Title', 'test', 'space')

      expect(revalidatePath).toHaveBeenCalledWith('/workspaces/test/knowledge/space')
    })
  })

  describe('movePage', () => {
    it('should update parent page relationship', async () => {
      const { getPayload } = await import('payload')
      const mockPayload = {
        findByID: vi
          .fn()
          .mockResolvedValueOnce({ id: '1', knowledgeSpace: 'space-1' })
          .mockResolvedValueOnce({ id: '2', knowledgeSpace: 'space-1' }),
        update: vi.fn().mockResolvedValue({ id: '1', parentPage: '2' }),
      }
      ;(getPayload as any).mockResolvedValue(mockPayload)

      await movePage('1', '2', 'test', 'space')

      expect(mockPayload.update).toHaveBeenCalledWith({
        collection: 'knowledge-pages',
        id: '1',
        data: {
          parentPage: '2',
        },
        user: mockActor.user,
        overrideAccess: false,
      })
    })

    it('should handle null parent (move to root)', async () => {
      const { getPayload } = await import('payload')
      const mockPayload = {
        update: vi.fn().mockResolvedValue({ id: '1', parentPage: null }),
      }
      ;(getPayload as any).mockResolvedValue(mockPayload)

      await movePage('1', null, 'test', 'space')

      expect(mockPayload.update).toHaveBeenCalledWith({
        collection: 'knowledge-pages',
        id: '1',
        data: {
          parentPage: null,
        },
        user: mockActor.user,
        overrideAccess: false,
      })
    })

    it('should revalidate the path after move', async () => {
      const { getPayload } = await import('payload')
      const { revalidatePath } = await import('next/cache')
      const mockPayload = {
        findByID: vi
          .fn()
          .mockResolvedValueOnce({ id: '1', knowledgeSpace: 'space-1' })
          .mockResolvedValueOnce({ id: '2', knowledgeSpace: 'space-1' }),
        update: vi.fn().mockResolvedValue({ id: '1' }),
      }
      ;(getPayload as any).mockResolvedValue(mockPayload)

      await movePage('1', '2', 'test', 'space')

      expect(revalidatePath).toHaveBeenCalledWith('/workspaces/test/knowledge/space')
    })
  })

  describe('movePage (cross-space guard)', () => {
    it('rejects a new parent in a different space', async () => {
      const { getPayload } = await import('payload')
      const mockPayload = {
        findByID: vi
          .fn()
          .mockResolvedValueOnce({ id: '1', knowledgeSpace: 'space-1' })
          .mockResolvedValueOnce({ id: '2', knowledgeSpace: 'space-2' }),
        update: vi.fn(),
      }
      ;(getPayload as any).mockResolvedValue(mockPayload)

      await expect(movePage('1', '2', 'test', 'space')).rejects.toThrow('Parent page not found')
      expect(mockPayload.update).not.toHaveBeenCalled()
    })

    it('rejects moving a page under itself', async () => {
      const { getPayload } = await import('payload')
      const mockPayload = { findByID: vi.fn(), update: vi.fn() }
      ;(getPayload as any).mockResolvedValue(mockPayload)

      await expect(movePage('1', '1', 'test', 'space')).rejects.toThrow('Parent page not found')
      expect(mockPayload.update).not.toHaveBeenCalled()
    })
  })

  describe('duplicatePage', () => {
    it('should create copy with "(Copy)" suffix', async () => {
      const { getPayload } = await import('payload')
      const mockOriginalPage = {
        id: '1',
        title: 'Original Page',
        slug: 'original-page',
        content: { type: 'doc', content: [] },
        knowledgeSpace: 'space1',
        parentPage: null,
        author: 'user1',
        sortOrder: 0,
      }
      const mockPayload = {
        findByID: vi.fn().mockResolvedValue(mockOriginalPage),
        create: vi.fn().mockResolvedValue({
          id: '2',
          title: 'Original Page (Copy)',
          slug: 'original-page-copy',
        }),
      }
      ;(getPayload as any).mockResolvedValue(mockPayload)

      const result = await duplicatePage('1', 'test', 'space')

      expect(mockPayload.findByID).toHaveBeenCalledWith({
        collection: 'knowledge-pages',
        id: '1',
        user: mockActor.user,
        overrideAccess: false,
      })

      expect(mockPayload.create).toHaveBeenCalledWith({
        collection: 'knowledge-pages',
        data: {
          title: 'Original Page (Copy)',
          slug: 'original-page-copy',
          content: mockOriginalPage.content,
          knowledgeSpace: mockOriginalPage.knowledgeSpace,
          parentPage: mockOriginalPage.parentPage,
          author: mockActor.payloadId,
          lastEditedBy: mockActor.payloadId,
          status: 'draft',
          sortOrder: 1,
          version: 1,
        },
        user: mockActor.user,
        overrideAccess: false,
      })

      expect(result.title).toBe('Original Page (Copy)')
    })

    it('should revalidate the path after duplicate', async () => {
      const { getPayload } = await import('payload')
      const { revalidatePath } = await import('next/cache')
      const mockPayload = {
        findByID: vi.fn().mockResolvedValue({
          id: '1',
          title: 'Page',
          content: {},
          knowledgeSpace: 'space1',
          parentPage: null,
          author: 'user1',
        }),
        create: vi.fn().mockResolvedValue({ id: '2' }),
      }
      ;(getPayload as any).mockResolvedValue(mockPayload)

      await duplicatePage('1', 'test', 'space')

      expect(revalidatePath).toHaveBeenCalledWith('/workspaces/test/knowledge/space')
    })
  })

  describe('deletePage', () => {
    it('should delete the page', async () => {
      const { getPayload } = await import('payload')
      const mockPayload = {
        delete: vi.fn().mockResolvedValue({ id: '1' }),
      }
      ;(getPayload as any).mockResolvedValue(mockPayload)

      await deletePage('1', 'test', 'space')

      expect(mockPayload.delete).toHaveBeenCalledWith({
        collection: 'knowledge-pages',
        id: '1',
        user: mockActor.user,
        overrideAccess: false,
      })
    })

    it('should revalidate the path after delete', async () => {
      const { getPayload } = await import('payload')
      const { revalidatePath } = await import('next/cache')
      const mockPayload = {
        delete: vi.fn().mockResolvedValue({ id: '1' }),
      }
      ;(getPayload as any).mockResolvedValue(mockPayload)

      await deletePage('1', 'test', 'space')

      expect(revalidatePath).toHaveBeenCalledWith('/workspaces/test/knowledge/space')
    })
  })
})
