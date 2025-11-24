import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { MovePageModal } from './MovePageModal'

describe('MovePageModal', () => {
  afterEach(() => {
    cleanup()
  })

  const mockPages = [
    { id: '1', title: 'Page 1', slug: 'page-1', parentPage: null },
    { id: '2', title: 'Page 2', slug: 'page-2', parentPage: null },
  ]

  it('should render modal when open', () => {
    render(
      <MovePageModal
        open={true}
        onOpenChange={vi.fn()}
        currentPage={mockPages[0] as any}
        pages={mockPages as any}
        onMove={vi.fn()}
      />
    )

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Move Page' })).toBeInTheDocument()
  })

  it('should exclude current page and descendants from selection', () => {
    render(
      <MovePageModal
        open={true}
        onOpenChange={vi.fn()}
        currentPage={mockPages[0] as any}
        pages={mockPages as any}
        onMove={vi.fn()}
      />
    )

    // Should not show current page as option
    expect(screen.queryByText('Page 1')).not.toBeInTheDocument()
    // Should show other pages
    expect(screen.getByText('Page 2')).toBeInTheDocument()
  })

  it('should show root option', () => {
    render(
      <MovePageModal
        open={true}
        onOpenChange={vi.fn()}
        currentPage={mockPages[0] as any}
        pages={mockPages as any}
        onMove={vi.fn()}
      />
    )

    expect(screen.getByText('Root (No parent)')).toBeInTheDocument()
  })

  it('should show move button', () => {
    render(
      <MovePageModal
        open={true}
        onOpenChange={vi.fn()}
        currentPage={mockPages[0] as any}
        pages={mockPages as any}
        onMove={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'Move Page' })).toBeInTheDocument()
  })

  it('should exclude descendants of current page', () => {
    const pagesWithChildren = [
      { id: '1', title: 'Parent', slug: 'parent', parentPage: null },
      { id: '2', title: 'Child', slug: 'child', parentPage: '1' },
      { id: '3', title: 'Grandchild', slug: 'grandchild', parentPage: '2' },
      { id: '4', title: 'Other', slug: 'other', parentPage: null },
    ]

    render(
      <MovePageModal
        open={true}
        onOpenChange={vi.fn()}
        currentPage={pagesWithChildren[0] as any}
        pages={pagesWithChildren as any}
        onMove={vi.fn()}
      />
    )

    // Should not show current page or descendants
    expect(screen.queryByText('Parent')).not.toBeInTheDocument()
    expect(screen.queryByText('Child')).not.toBeInTheDocument()
    expect(screen.queryByText('Grandchild')).not.toBeInTheDocument()
    // Should show other pages
    expect(screen.getByText('Other')).toBeInTheDocument()
  })
})
