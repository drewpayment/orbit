import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { DeletePageDialog } from './DeletePageDialog'

describe('DeletePageDialog', () => {
  afterEach(() => {
    cleanup()
  })

  const mockPage = {
    id: '1',
    title: 'Test Page',
    slug: 'test-page',
    childPages: [],
  }

  it('should render confirmation dialog', () => {
    render(
      <DeletePageDialog
        open={true}
        onOpenChange={vi.fn()}
        page={mockPage as any}
        onDelete={vi.fn()}
      />
    )

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Delete Page' })).toBeInTheDocument()
    expect(screen.getByText(/Are you sure you want to delete/)).toBeInTheDocument()
  })

  it('should display page title in confirmation message', () => {
    render(
      <DeletePageDialog
        open={true}
        onOpenChange={vi.fn()}
        page={mockPage as any}
        onDelete={vi.fn()}
      />
    )

    expect(screen.getByText(/Test Page/)).toBeInTheDocument()
  })

  it('should warn about permanent deletion', () => {
    render(
      <DeletePageDialog
        open={true}
        onOpenChange={vi.fn()}
        page={mockPage as any}
        onDelete={vi.fn()}
      />
    )

    expect(screen.getByText(/This action cannot be undone/)).toBeInTheDocument()
  })

  it('should warn when page has children', () => {
    const pageWithChildren = {
      ...mockPage,
      childPages: [{ id: '2', title: 'Child Page' }],
    }

    render(
      <DeletePageDialog
        open={true}
        onOpenChange={vi.fn()}
        page={pageWithChildren as any}
        onDelete={vi.fn()}
      />
    )

    expect(screen.getByText(/child page.*that will also be deleted/i)).toBeInTheDocument()
  })

  it('should not show child warning when page has no children', () => {
    render(
      <DeletePageDialog
        open={true}
        onOpenChange={vi.fn()}
        page={mockPage as any}
        onDelete={vi.fn()}
      />
    )

    expect(screen.queryByText(/child page.*that will also be deleted/i)).not.toBeInTheDocument()
  })

  it('should render cancel button', () => {
    render(
      <DeletePageDialog
        open={true}
        onOpenChange={vi.fn()}
        page={mockPage as any}
        onDelete={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('should render delete button with destructive styling', () => {
    render(
      <DeletePageDialog
        open={true}
        onOpenChange={vi.fn()}
        page={mockPage as any}
        onDelete={vi.fn()}
      />
    )

    const deleteButton = screen.getByRole('button', { name: 'Delete' })
    expect(deleteButton).toBeInTheDocument()
    // The button should have destructive variant classes
    expect(deleteButton.className).toMatch(/destructive/)
  })

  it('should call onDelete when Delete button clicked', async () => {
    const user = userEvent.setup()
    const mockOnDelete = vi.fn().mockResolvedValue(undefined)

    render(
      <DeletePageDialog
        open={true}
        onOpenChange={vi.fn()}
        page={mockPage as any}
        onDelete={mockOnDelete}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(mockOnDelete).toHaveBeenCalledWith('1')
    })
  })

  it('should disable delete button during operation', async () => {
    const user = userEvent.setup()
    const mockOnDelete = vi.fn((): Promise<void> => new Promise(resolve => setTimeout(resolve, 100)))

    render(
      <DeletePageDialog
        open={true}
        onOpenChange={vi.fn()}
        page={mockPage as any}
        onDelete={mockOnDelete}
      />
    )

    const deleteButton = screen.getByRole('button', { name: 'Delete' })
    await user.click(deleteButton)

    // Button should be disabled and show "Deleting..." text
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Deleting...' })).toBeDisabled()
    })
  })

  it('should close modal after successful delete', async () => {
    const user = userEvent.setup()
    const mockOnDelete = vi.fn().mockResolvedValue(undefined)
    const mockOnOpenChange = vi.fn()

    render(
      <DeletePageDialog
        open={true}
        onOpenChange={mockOnOpenChange}
        page={mockPage as any}
        onDelete={mockOnDelete}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    // Should close modal after successful delete
    await waitFor(() => {
      expect(mockOnOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('should call onOpenChange when Cancel clicked', async () => {
    const user = userEvent.setup()
    const mockOnOpenChange = vi.fn()

    render(
      <DeletePageDialog
        open={true}
        onOpenChange={mockOnOpenChange}
        page={mockPage as any}
        onDelete={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(mockOnOpenChange).toHaveBeenCalledWith(false)
  })

  it('should not render when open is false', () => {
    const { container } = render(
      <DeletePageDialog
        open={false}
        onOpenChange={vi.fn()}
        page={mockPage as any}
        onDelete={vi.fn()}
      />
    )

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('should use serif typography for title', () => {
    render(
      <DeletePageDialog
        open={true}
        onOpenChange={vi.fn()}
        page={mockPage as any}
        onDelete={vi.fn()}
      />
    )

    const title = screen.getByRole('heading', { name: 'Delete Page' })
    expect(title.className).toContain('font-serif-display')
  })
})
