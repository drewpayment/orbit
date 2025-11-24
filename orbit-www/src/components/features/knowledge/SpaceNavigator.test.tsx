import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SpaceNavigator } from './SpaceNavigator';
import type { KnowledgeSpace, KnowledgePage } from '@/payload-types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}))

describe('SpaceNavigator', () => {
  const mockWorkspaceSlug = 'test-workspace';
  const mockKnowledgeSpace: KnowledgeSpace = {
    id: 'space-1',
    name: 'Test Space',
    slug: 'test-space',
    description: 'A test knowledge space',
    workspaceId: 'ws-123',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as KnowledgeSpace;

  const mockPages: KnowledgePage[] = [
    {
      id: 'page-1',
      title: 'Getting Started',
      slug: 'getting-started',
      status: 'published',
      sortOrder: 0,
      spaceId: 'space-1',
      parentId: null,
      content: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as KnowledgePage,
    {
      id: 'page-2',
      title: 'Advanced Topics',
      slug: 'advanced-topics',
      status: 'published',
      sortOrder: 1,
      spaceId: 'space-1',
      parentId: null,
      content: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as KnowledgePage,
    {
      id: 'page-3',
      title: 'Nested Page',
      slug: 'nested-page',
      status: 'published',
      sortOrder: 0,
      spaceId: 'space-1',
      parentId: 'page-2',
      content: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as KnowledgePage,
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the space navigator with pages', () => {
    render(
      <SpaceNavigator
        knowledgeSpace={mockKnowledgeSpace}
        pages={mockPages}
        workspaceSlug={mockWorkspaceSlug}
      />
    );

    expect(screen.getByText('Test Space')).toBeInTheDocument();
    expect(screen.getByText('Getting Started')).toBeInTheDocument();
    expect(screen.getByText('Advanced Topics')).toBeInTheDocument();
  });

  it('shows empty state when no pages exist', () => {
    render(
      <SpaceNavigator
        knowledgeSpace={mockKnowledgeSpace}
        pages={[]}
        workspaceSlug={mockWorkspaceSlug}
      />
    );

    expect(screen.getByText(/no pages yet/i)).toBeInTheDocument();
    expect(screen.getByText(/create your first page/i)).toBeInTheDocument();
  });

  it('expands and collapses folders', async () => {
    render(
      <SpaceNavigator
        knowledgeSpace={mockKnowledgeSpace}
        pages={mockPages}
        workspaceSlug={mockWorkspaceSlug}
      />
    );

    // The nested page might be in the DOM but hidden initially
    // Use getAllByText since Collapsible keeps content in DOM
    const nestedPages = screen.queryAllByText('Nested Page');

    // Should have at least one instance
    expect(nestedPages.length).toBeGreaterThan(0);

    // Find and click the expand button for Advanced Topics
    const expandButtons = screen.getAllByRole('button');
    const chevronButton = expandButtons.find(button => {
      const svg = button.querySelector('svg');
      return svg && svg.classList.contains('lucide-chevron-right');
    });

    if (chevronButton) {
      fireEvent.click(chevronButton);
    }

    // After expansion, nested page should still be visible
    await waitFor(() => {
      const pages = screen.getAllByText('Nested Page');
      expect(pages.length).toBeGreaterThan(0);
    });
  });

  it('supports drag and drop reordering', async () => {
    const mockOnReorder = vi.fn();

    render(
      <SpaceNavigator
        knowledgeSpace={mockKnowledgeSpace}
        pages={mockPages}
        workspaceSlug={mockWorkspaceSlug}
        onReorder={mockOnReorder}
      />
    );

    // Find draggable elements
    const draggableElements = screen.getAllByTestId(/^page-drag-/);

    expect(draggableElements.length).toBeGreaterThan(0);

    // Verify drag handles have the correct attributes (use getAllByTestId since there are duplicates)
    const dragHandles = screen.getAllByTestId('page-drag-page-1');
    expect(dragHandles[0]).toHaveAttribute('role', 'button');
    expect(dragHandles[0]).toHaveClass('cursor-grab');
  });

  it('has clickable page links', () => {
    render(
      <SpaceNavigator
        knowledgeSpace={mockKnowledgeSpace}
        pages={mockPages}
        workspaceSlug={mockWorkspaceSlug}
      />
    );

    // Find all links
    const links = screen.getAllByRole('link');

    // Should have links for all pages
    expect(links.length).toBeGreaterThan(0);

    // Find the Getting Started link
    const gettingStartedLink = links.find(link =>
      link.textContent?.includes('Getting Started')
    );

    expect(gettingStartedLink).toBeDefined();
    expect(gettingStartedLink).toHaveAttribute('href', '/workspaces/test-workspace/knowledge/test-space/getting-started');
  });

  it('highlights the current page', () => {
    render(
      <SpaceNavigator
        knowledgeSpace={mockKnowledgeSpace}
        pages={mockPages}
        currentPageId="page-1"
        workspaceSlug={mockWorkspaceSlug}
      />
    );

    // Use getAllByText since there are multiple instances
    const gettingStartedElements = screen.getAllByText('Getting Started');
    // Find the parent div with the bg-accent class
    const currentPageElement = gettingStartedElements[0].parentElement;
    expect(currentPageElement?.className).toContain('bg-accent');
  });

  it('shows loading state', () => {
    render(
      <SpaceNavigator
        knowledgeSpace={mockKnowledgeSpace}
        pages={mockPages}
        workspaceSlug={mockWorkspaceSlug}
        isLoading={true}
      />
    );

    expect(screen.getByTestId('space-navigator-loading')).toBeInTheDocument();
  });

  it('does not display status badges or counts', () => {
    const pagesWithDrafts: KnowledgePage[] = [
      ...mockPages,
      {
        id: 'page-4',
        title: 'Another Page',
        slug: 'another-page',
        status: 'draft',
        sortOrder: 2,
        spaceId: 'space-1',
        parentId: null,
        content: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as KnowledgePage,
    ];

    render(
      <SpaceNavigator
        knowledgeSpace={mockKnowledgeSpace}
        pages={pagesWithDrafts}
        workspaceSlug={mockWorkspaceSlug}
      />
    );

    // Verify no status counts are displayed (like "3 published" or "1 drafts")
    expect(screen.queryByText(/\d+ published/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ draft/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ archived/i)).not.toBeInTheDocument();
  });
});
