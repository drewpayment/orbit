import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { KnowledgeTreeSidebar } from './KnowledgeTreeSidebar'
import type { KnowledgePage, KnowledgeSpace } from '@/payload-types'

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}))

describe('KnowledgeTreeSidebar', () => {
  const mockSpace: KnowledgeSpace = {
    id: 'space-1',
    name: 'Engineering Wiki',
    slug: 'engineering-wiki',
    description: 'Technical documentation for the engineering team',
    icon: '⚙️',
    workspace: 'workspace-1',
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
  }

  const mockPages: KnowledgePage[] = [
    {
      id: 'page-1',
      title: 'Getting Started',
      slug: 'getting-started',
      status: 'published',
      sortOrder: 0,
      parentPage: null,
      knowledgeSpace: 'space-1',
      content: null,
      createdBy: 'user-1',
      createdAt: '2025-01-01',
      updatedAt: '2025-01-01',
    },
    {
      id: 'page-2',
      title: 'Architecture',
      slug: 'architecture',
      status: 'published',
      sortOrder: 1,
      parentPage: null,
      knowledgeSpace: 'space-1',
      content: null,
      createdBy: 'user-1',
      createdAt: '2025-01-01',
      updatedAt: '2025-01-01',
    },
  ]

  it('renders space name with editorial font', () => {
    render(
      <KnowledgeTreeSidebar
        space={mockSpace}
        pages={mockPages}
        workspaceSlug="my-workspace"
      />
    )

    const heading = screen.getByRole('heading', { name: 'Engineering Wiki' })
    expect(heading).toBeInTheDocument()
    expect(heading).toHaveClass('font-serif-display')
  })

  it('renders space icon when provided', () => {
    render(
      <KnowledgeTreeSidebar
        space={mockSpace}
        pages={mockPages}
        workspaceSlug="my-workspace"
      />
    )

    expect(screen.getAllByText('⚙️')[0]).toBeInTheDocument()
  })

  it('renders space description when provided', () => {
    render(
      <KnowledgeTreeSidebar
        space={mockSpace}
        pages={mockPages}
        workspaceSlug="my-workspace"
      />
    )

    expect(screen.getAllByText('Technical documentation for the engineering team')[0]).toBeInTheDocument()
  })

  it('does not render description when not provided', () => {
    const spaceWithoutDescription = { ...mockSpace, description: undefined }

    const { container } = render(
      <KnowledgeTreeSidebar
        space={spaceWithoutDescription}
        pages={mockPages}
        workspaceSlug="my-workspace"
      />
    )

    expect(container.querySelector('p.text-xs.text-muted-foreground')).not.toBeInTheDocument()
  })

  it('renders tree navigation with pages', () => {
    render(
      <KnowledgeTreeSidebar
        space={mockSpace}
        pages={mockPages}
        workspaceSlug="my-workspace"
      />
    )

    const navs = screen.getAllByRole('tree')
    expect(navs[0]).toBeInTheDocument()
    expect(screen.getAllByText('Getting Started')[0]).toBeInTheDocument()
    expect(screen.getAllByText('Architecture')[0]).toBeInTheDocument()
  })

  it('renders New Page button', () => {
    render(
      <KnowledgeTreeSidebar
        space={mockSpace}
        pages={mockPages}
        workspaceSlug="my-workspace"
      />
    )

    const newPageButtons = screen.getAllByRole('button', { name: /new page/i })
    expect(newPageButtons.length).toBeGreaterThan(0)
  })

  it('has clean, borderless styling without Card wrapper', () => {
    const { container } = render(
      <KnowledgeTreeSidebar
        space={mockSpace}
        pages={mockPages}
        workspaceSlug="my-workspace"
      />
    )

    // Should use aside element
    const aside = container.querySelector('aside')
    expect(aside).toBeInTheDocument()

    // Should have border-r but not card styling
    expect(aside).toHaveClass('border-r', 'border-border')

    // Should NOT have card classes
    expect(container.querySelector('.card')).not.toBeInTheDocument()
  })

  it('applies correct width class', () => {
    const { container } = render(
      <KnowledgeTreeSidebar
        space={mockSpace}
        pages={mockPages}
        workspaceSlug="my-workspace"
      />
    )

    const aside = container.querySelector('aside')
    expect(aside).toHaveClass('w-64') // 256px as per design
  })

  it('shows empty state when no pages exist', () => {
    render(
      <KnowledgeTreeSidebar
        space={mockSpace}
        pages={[]}
        workspaceSlug="my-workspace"
      />
    )

    expect(screen.getByText(/no pages yet/i)).toBeInTheDocument()
  })

  it('does NOT show published/draft statistics', () => {
    render(
      <KnowledgeTreeSidebar
        space={mockSpace}
        pages={mockPages}
        workspaceSlug="my-workspace"
      />
    )

    // These should NOT exist (feature removed from new design)
    expect(screen.queryByText(/published/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/draft/i)).not.toBeInTheDocument()
  })

  it('highlights current page when currentPageId is provided', () => {
    render(
      <KnowledgeTreeSidebar
        space={mockSpace}
        pages={mockPages}
        currentPageId="page-1"
        workspaceSlug="my-workspace"
      />
    )

    const currentPageNode = screen.getByRole('treeitem', { current: 'page' })
    expect(currentPageNode).toBeInTheDocument()
    expect(currentPageNode).toHaveClass('bg-accent')
  })
})
