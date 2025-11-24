import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renamePage, movePage, duplicatePage, deletePage } from './knowledge'

vi.mock('payload', () => ({
  getPayload: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@payload-config', () => ({
  default: {},
}))

describe('Knowledge Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
      })
    })

    it('should revalidate the path after move', async () => {
      const { getPayload } = await import('payload')
      const { revalidatePath } = await import('next/cache')
      const mockPayload = {
        update: vi.fn().mockResolvedValue({ id: '1' }),
      }
      ;(getPayload as any).mockResolvedValue(mockPayload)

      await movePage('1', '2', 'test', 'space')

      expect(revalidatePath).toHaveBeenCalledWith('/workspaces/test/knowledge/space')
    })
  })

  describe('duplicatePage', () => {
    it('should create copy with "(Copy)" suffix', async () => {
      const { getPayload } = await import('payload')
      const mockOriginalPage = {
        id: '1',
        title: 'Original Page',
        content: { type: 'doc', content: [] },
        knowledgeSpace: 'space1',
        parentPage: null,
        author: 'user1',
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
      })

      expect(mockPayload.create).toHaveBeenCalledWith({
        collection: 'knowledge-pages',
        data: {
          title: 'Original Page (Copy)',
          content: mockOriginalPage.content,
          knowledgeSpace: mockOriginalPage.knowledgeSpace,
          parentPage: mockOriginalPage.parentPage,
          author: mockOriginalPage.author,
          status: 'draft',
        },
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
