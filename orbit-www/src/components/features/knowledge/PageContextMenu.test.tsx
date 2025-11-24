import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { PageContextMenu } from './PageContextMenu'

describe('PageContextMenu', () => {
  const mockPage = {
    id: '1',
    title: 'Test Page',
    slug: 'test-page',
  }

  it('should render context menu trigger', () => {
    render(
      <PageContextMenu page={mockPage as any}>
        <div>Page Item</div>
      </PageContextMenu>
    )

    expect(screen.getByText('Page Item')).toBeInTheDocument()
  })

  it('should show menu items on right-click', () => {
    render(
      <PageContextMenu page={mockPage as any}>
        <div data-testid="trigger">Page Item</div>
      </PageContextMenu>
    )

    const trigger = screen.getByTestId('trigger')
    fireEvent.contextMenu(trigger)

    expect(screen.getByText('Rename')).toBeInTheDocument()
    expect(screen.getByText('Move to...')).toBeInTheDocument()
    expect(screen.getByText('Add sub-page')).toBeInTheDocument()
    expect(screen.getByText('Duplicate')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })
})
