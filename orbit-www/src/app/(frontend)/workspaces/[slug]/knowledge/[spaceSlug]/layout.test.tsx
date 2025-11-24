import { render } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all external dependencies
vi.mock('next/navigation', () => ({
  notFound: vi.fn(),
}))

vi.mock('payload', () => ({
  getPayload: vi.fn(),
}))

vi.mock('@payload-config', () => ({
  default: {},
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarProvider: ({ children, defaultOpen }: any) => (
    <div data-testid="sidebar-provider" data-default-open={defaultOpen}>
      {children}
    </div>
  ),
  SidebarInset: ({ children }: any) => <div data-testid="sidebar-inset">{children}</div>,
}))

vi.mock('@/components/app-sidebar', () => ({
  AppSidebar: () => <div data-testid="app-sidebar">App Sidebar</div>,
}))

vi.mock('@/components/site-header', () => ({
  SiteHeader: () => <div data-testid="site-header">Site Header</div>,
}))

describe('KnowledgeSpaceLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render with auto-minimized sidebar', async () => {
    const { getPayload } = await import('payload')
    const mockGetPayload = getPayload as any

    mockGetPayload.mockResolvedValue({
      find: vi.fn()
        .mockResolvedValueOnce({ docs: [{ id: '1', slug: 'test-workspace', name: 'Test' }] })
        .mockResolvedValueOnce({ docs: [{ id: '2', slug: 'test-space', name: 'Test Space' }] })
        .mockResolvedValueOnce({ docs: [] }),
    })

    const KnowledgeSpaceLayout = (await import('./layout')).default

    const { getByTestId } = render(
      await KnowledgeSpaceLayout({
        children: <div>Test Content</div>,
        params: Promise.resolve({ slug: 'test-workspace', spaceSlug: 'test-space' }),
      })
    )

    // Should render with SidebarProvider defaultOpen={false}
    const sidebarProvider = getByTestId('sidebar-provider')
    expect(sidebarProvider).toBeTruthy()
    expect(sidebarProvider.getAttribute('data-default-open')).toBe('false')
  })
})
