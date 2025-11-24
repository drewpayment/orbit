import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import userEvent from '@testing-library/user-event'
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

  it('should allow selecting a parent page', async () => {
    const user = userEvent.setup()

    render(
      <MovePageModal
        open={true}
        onOpenChange={vi.fn()}
        currentPage={mockPages[0] as any}
        pages={mockPages as any}
        onMove={vi.fn()}
      />
    )

    const page2Button = screen.getByText('Page 2')
    await user.click(page2Button)

    // Button should show selected state (has bg-accent class)
    expect(page2Button.className).toContain('bg-accent')
  })

  it('should call onMove with selected parent when Move button clicked', async () => {
    const user = userEvent.setup()
    const mockOnMove = vi.fn().mockResolvedValue(undefined)

    render(
      <MovePageModal
        open={true}
        onOpenChange={vi.fn()}
        currentPage={mockPages[0] as any}
        pages={mockPages as any}
        onMove={mockOnMove}
      />
    )

    // Select Page 2 as parent
    await user.click(screen.getByText('Page 2'))

    // Click Move Page button
    await user.click(screen.getByRole('button', { name: 'Move Page' }))

    // Should call onMove with current page ID and selected parent ID
    await waitFor(() => {
      expect(mockOnMove).toHaveBeenCalledWith('1', '2')
    })
  })

  it('should disable move button during operation', async () => {
    const user = userEvent.setup()
    const mockOnMove = vi.fn(() => new Promise(resolve => setTimeout(resolve, 100)))

    render(
      <MovePageModal
        open={true}
        onOpenChange={vi.fn()}
        currentPage={mockPages[0] as any}
        pages={mockPages as any}
        onMove={mockOnMove}
      />
    )

    // Select a parent
    await user.click(screen.getByText('Page 2'))

    // Click Move Page button
    const moveButton = screen.getByRole('button', { name: 'Move Page' })
    await user.click(moveButton)

    // Button should be disabled and show "Moving..." text
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Moving...' })).toBeDisabled()
    })
  })

  it('should close modal after successful move', async () => {
    const user = userEvent.setup()
    const mockOnMove = vi.fn().mockResolvedValue(undefined)
    const mockOnOpenChange = vi.fn()

    render(
      <MovePageModal
        open={true}
        onOpenChange={mockOnOpenChange}
        currentPage={mockPages[0] as any}
        pages={mockPages as any}
        onMove={mockOnMove}
      />
    )

    // Select a parent and move
    await user.click(screen.getByText('Page 2'))
    await user.click(screen.getByRole('button', { name: 'Move Page' }))

    // Should close modal after successful move
    await waitFor(() => {
      expect(mockOnOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('should call onOpenChange when Cancel clicked', async () => {
    const user = userEvent.setup()
    const mockOnOpenChange = vi.fn()

    render(
      <MovePageModal
        open={true}
        onOpenChange={mockOnOpenChange}
        currentPage={mockPages[0] as any}
        pages={mockPages as any}
        onMove={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(mockOnOpenChange).toHaveBeenCalledWith(false)
  })
})
