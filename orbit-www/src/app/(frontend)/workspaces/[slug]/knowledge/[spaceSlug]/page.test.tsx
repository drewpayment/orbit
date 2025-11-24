import { describe, it, expect, vi, beforeEach, Mock } from 'vitest'
import type { getPayload as GetPayloadType } from 'payload'

// Mock Next.js navigation
const mockNotFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
})
const mockRedirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT: ${url}`)
})

vi.mock('next/navigation', () => ({
  notFound: mockNotFound,
  redirect: mockRedirect,
}))

// Mock Payload
const mockGetPayload = vi.fn()

vi.mock('payload', () => ({
  getPayload: mockGetPayload,
}))

// Mock config
vi.mock('@payload-config', () => ({
  default: {},
}))

// Mock UI components
vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div data-testid="card">{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarInset: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/app-sidebar', () => ({
  AppSidebar: () => <div>App Sidebar</div>,
}))

vi.mock('@/components/site-header', () => ({
  SiteHeader: () => <div>Site Header</div>,
}))

vi.mock('@/components/features/knowledge/SpaceNavigator', () => ({
  SpaceNavigator: () => <div>Space Navigator</div>,
}))

describe('KnowledgeSpacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should redirect to first page when pages exist', async () => {
    const mockPayload = {
      find: vi.fn()
        .mockResolvedValueOnce({
          // Workspace
          docs: [{
            id: 'workspace-1',
            slug: 'test-workspace',
          }],
        })
        .mockResolvedValueOnce({
          // User (temp auth)
          docs: [{ id: 'user-1' }],
        })
        .mockResolvedValueOnce({
          // Knowledge space
          docs: [{
            id: 'space-1',
            slug: 'test-space',
            name: 'Test Space',
            workspace: 'workspace-1',
          }],
        })
        .mockResolvedValueOnce({
          // Pages - has pages
          docs: [
            {
              id: 'page-1',
              slug: 'first-page',
              title: 'First Page',
              status: 'published',
              sortOrder: 1,
            },
            {
              id: 'page-2',
              slug: 'second-page',
              title: 'Second Page',
              status: 'published',
              sortOrder: 2,
            },
          ],
        }),
    }

    mockGetPayload.mockResolvedValue(mockPayload as any)

    const params = Promise.resolve({
      slug: 'test-workspace',
      spaceSlug: 'test-space',
    })

    const { default: KnowledgeSpacePage } = await import('./page')

    // Should throw redirect error
    await expect(KnowledgeSpacePage({ params })).rejects.toThrow('NEXT_REDIRECT')

    // Verify redirect was called with correct URL
    expect(mockRedirect).toHaveBeenCalledWith('/workspaces/test-workspace/knowledge/test-space/first-page')
  })

  it('should show empty state when no pages exist', async () => {
    const mockPayload = {
      find: vi.fn()
        .mockResolvedValueOnce({
          // Workspace
          docs: [{
            id: 'workspace-1',
            slug: 'test-workspace',
          }],
        })
        .mockResolvedValueOnce({
          // User (temp auth)
          docs: [{ id: 'user-1' }],
        })
        .mockResolvedValueOnce({
          // Knowledge space
          docs: [{
            id: 'space-1',
            slug: 'test-space',
            name: 'Test Space',
            workspace: 'workspace-1',
          }],
        })
        .mockResolvedValueOnce({
          // Pages - empty
          docs: [],
        }),
    }

    mockGetPayload.mockResolvedValue(mockPayload as any)

    const params = Promise.resolve({
      slug: 'test-workspace',
      spaceSlug: 'test-space',
    })

    const { default: KnowledgeSpacePage } = await import('./page')

    // Should NOT throw (doesn't redirect)
    const result = await KnowledgeSpacePage({ params })

    // Should NOT redirect
    expect(mockRedirect).not.toHaveBeenCalled()

    // Should return JSX (the empty state page)
    expect(result).toBeDefined()
  })

  it('should return 404 when workspace not found', async () => {
    const mockPayload = {
      find: vi.fn()
        .mockResolvedValueOnce({
          // Workspace not found
          docs: [],
        })
        .mockResolvedValueOnce({
          // User (temp auth) - won't be called but needed for completeness
          docs: [{ id: 'user-1' }],
        }),
    }

    mockGetPayload.mockResolvedValue(mockPayload as any)

    const params = Promise.resolve({
      slug: 'nonexistent',
      spaceSlug: 'test-space',
    })

    const { default: KnowledgeSpacePage } = await import('./page')

    // Should throw not found error
    await expect(KnowledgeSpacePage({ params })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mockNotFound).toHaveBeenCalled()
  })

  it('should return 404 when space not found', async () => {
    const mockPayload = {
      find: vi.fn()
        .mockResolvedValueOnce({
          // Workspace found
          docs: [{
            id: 'workspace-1',
            slug: 'test-workspace',
          }],
        })
        .mockResolvedValueOnce({
          // User (temp auth)
          docs: [{ id: 'user-1' }],
        })
        .mockResolvedValueOnce({
          // Space not found
          docs: [],
        })
        .mockResolvedValueOnce({
          // Pages - won't be called but needed for completeness
          docs: [],
        }),
    }

    mockGetPayload.mockResolvedValue(mockPayload as any)

    const params = Promise.resolve({
      slug: 'test-workspace',
      spaceSlug: 'nonexistent',
    })

    const { default: KnowledgeSpacePage } = await import('./page')

    // Should throw not found error
    await expect(KnowledgeSpacePage({ params })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mockNotFound).toHaveBeenCalled()
  })
})
