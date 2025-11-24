import { render } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Next.js modules
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

const mockGetPayload = vi.fn()
vi.mock('payload', () => ({
  getPayload: mockGetPayload,
}))

vi.mock('@payload-config', () => ({
  default: {},
}))

// Mock UI components
vi.mock('@/components/ui/sidebar', () => ({
  SidebarProvider: ({ children }: any) => <div data-testid="sidebar-provider">{children}</div>,
  SidebarInset: ({ children }: any) => <div data-testid="sidebar-inset">{children}</div>,
}))

vi.mock('@/components/app-sidebar', () => ({
  AppSidebar: () => <div data-testid="app-sidebar">App Sidebar</div>,
}))

vi.mock('@/components/site-header', () => ({
  SiteHeader: () => <div data-testid="site-header">Site Header</div>,
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: any) => <span data-testid="badge">{children}</span>,
}))

vi.mock('@/components/features/knowledge/PageContent', () => ({
  PageContent: ({ page }: any) => (
    <div data-testid="page-content" data-page-title={page.title}>
      Page Content
    </div>
  ),
}))

vi.mock('@/components/features/knowledge/KnowledgeBreadcrumbs', () => ({
  KnowledgeBreadcrumbs: ({ workspace, space, currentPage }: any) => (
    <div
      data-testid="knowledge-breadcrumbs"
      data-workspace={workspace.slug}
      data-space={space.slug}
      data-current-page={currentPage?.title}
    >
      Knowledge Breadcrumbs
    </div>
  ),
}))

describe('KnowledgePageView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render breadcrumbs with current page', async () => {
    const mockPayload = {
      find: vi.fn()
        .mockResolvedValueOnce({
          // Workspace
          docs: [
            {
              id: 'workspace-1',
              slug: 'test-workspace',
              name: 'Test Workspace',
            },
          ],
        })
        .mockResolvedValueOnce({
          // Knowledge space
          docs: [
            {
              id: 'space-1',
              slug: 'test-space',
              name: 'Test Space',
            },
          ],
        })
        .mockResolvedValueOnce({
          // Page
          docs: [
            {
              id: 'page-1',
              slug: 'test-page',
              title: 'Test Page Title',
              content: null,
              author: { id: 'user-1', name: 'Test User' },
              lastEditedBy: { id: 'user-1', name: 'Test User' },
              tags: [],
              childPages: [],
            },
          ],
        }),
    }

    mockGetPayload.mockResolvedValue(mockPayload as any)

    const params = Promise.resolve({
      slug: 'test-workspace',
      spaceSlug: 'test-space',
      pageSlug: 'test-page',
    })

    const { default: KnowledgePageView } = await import('./page')

    const { getByTestId } = render(await KnowledgePageView({ params }))

    // Should render KnowledgeBreadcrumbs with current page
    const breadcrumbs = getByTestId('knowledge-breadcrumbs')
    expect(breadcrumbs).toBeTruthy()
    expect(breadcrumbs.getAttribute('data-workspace')).toBe('test-workspace')
    expect(breadcrumbs.getAttribute('data-space')).toBe('test-space')
    expect(breadcrumbs.getAttribute('data-current-page')).toBe('Test Page Title')
  })

  it('should render page content', async () => {
    const mockPayload = {
      find: vi.fn()
        .mockResolvedValueOnce({
          // Workspace
          docs: [
            {
              id: 'workspace-1',
              slug: 'test-workspace',
              name: 'Test Workspace',
            },
          ],
        })
        .mockResolvedValueOnce({
          // Knowledge space
          docs: [
            {
              id: 'space-1',
              slug: 'test-space',
              name: 'Test Space',
            },
          ],
        })
        .mockResolvedValueOnce({
          // Page
          docs: [
            {
              id: 'page-1',
              slug: 'test-page',
              title: 'Test Page Title',
              content: null,
              author: { id: 'user-1', name: 'Test User' },
              lastEditedBy: { id: 'user-1', name: 'Test User' },
              tags: [],
              childPages: [],
            },
          ],
        }),
    }

    mockGetPayload.mockResolvedValue(mockPayload as any)

    const params = Promise.resolve({
      slug: 'test-workspace',
      spaceSlug: 'test-space',
      pageSlug: 'test-page',
    })

    const { default: KnowledgePageView } = await import('./page')

    const { getByTestId } = render(await KnowledgePageView({ params }))

    // Should render page content
    const pageContent = getByTestId('page-content')
    expect(pageContent).toBeTruthy()
    expect(pageContent.getAttribute('data-page-title')).toBe('Test Page Title')
  })

  it('should return 404 when page not found', async () => {
    const mockNotFound = vi.fn(() => {
      throw new Error('NEXT_NOT_FOUND')
    })
    vi.mocked(await import('next/navigation')).notFound = mockNotFound

    const mockPayload = {
      find: vi.fn()
        .mockResolvedValueOnce({
          // Workspace
          docs: [
            {
              id: 'workspace-1',
              slug: 'test-workspace',
              name: 'Test Workspace',
            },
          ],
        })
        .mockResolvedValueOnce({
          // Knowledge space
          docs: [
            {
              id: 'space-1',
              slug: 'test-space',
              name: 'Test Space',
            },
          ],
        })
        .mockResolvedValueOnce({
          // Page not found
          docs: [],
        }),
    }

    mockGetPayload.mockResolvedValue(mockPayload as any)

    const params = Promise.resolve({
      slug: 'test-workspace',
      spaceSlug: 'test-space',
      pageSlug: 'nonexistent',
    })

    const { default: KnowledgePageView } = await import('./page')

    // Should throw not found error
    await expect(KnowledgePageView({ params })).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
