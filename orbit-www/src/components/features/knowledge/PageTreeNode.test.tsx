import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PageTreeNode } from './PageTreeNode'
import type { PageTreeNodeProps } from './types'

// Mock Next.js router
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}))

// Mock server actions
vi.mock('@/app/actions/knowledge', () => ({
  renamePage: vi.fn(),
  movePage: vi.fn(),
  duplicatePage: vi.fn(),
  deletePage: vi.fn(),
}))

// Mock dnd-kit
vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}))

describe('PageTreeNode - Context Menu Actions', () => {
  const mockNode = {
    id: '1',
    title: 'Test Page',
    slug: 'test-page',
    children: [],
  }

  const defaultProps: PageTreeNodeProps = {
    node: mockNode,
    currentPageId: null,
    depth: 0,
    workspaceSlug: 'test-workspace',
    spaceSlug: 'test-space',
    isDragging: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should call onMoveClick when move handler is triggered', () => {
    const onMoveClick = vi.fn()

    render(
      <PageTreeNode
        {...defaultProps}
        onMoveClick={onMoveClick}
      />
    )

    const nodes = screen.getAllByText('Test Page')
    fireEvent.contextMenu(nodes[0])

    const moveOptions = screen.getAllByText('Move to...')
    fireEvent.click(moveOptions[0])

    expect(onMoveClick).toHaveBeenCalledWith('1')
  })

  it('should call onDeleteClick when delete handler is triggered', () => {
    const onDeleteClick = vi.fn()

    render(
      <PageTreeNode
        {...defaultProps}
        onDeleteClick={onDeleteClick}
      />
    )

    const nodes = screen.getAllByText('Test Page')
    fireEvent.contextMenu(nodes[0])

    const deleteOptions = screen.getAllByText('Delete')
    fireEvent.click(deleteOptions[0])

    expect(onDeleteClick).toHaveBeenCalledWith('1')
  })

  it('should call onDuplicateClick when duplicate handler is triggered', async () => {
    const onDuplicateClick = vi.fn()

    render(
      <PageTreeNode
        {...defaultProps}
        onDuplicateClick={onDuplicateClick}
      />
    )

    const nodes = screen.getAllByText('Test Page')
    fireEvent.contextMenu(nodes[0])

    const duplicateOptions = screen.getAllByText('Duplicate')
    fireEvent.click(duplicateOptions[0])

    expect(onDuplicateClick).toHaveBeenCalledWith('1')
  })

  it('should call onAddSubPageClick when add sub-page handler is triggered', () => {
    const onAddSubPageClick = vi.fn()

    render(
      <PageTreeNode
        {...defaultProps}
        onAddSubPageClick={onAddSubPageClick}
      />
    )

    const nodes = screen.getAllByText('Test Page')
    fireEvent.contextMenu(nodes[0])

    const addSubPageOptions = screen.getAllByText('Add sub-page')
    fireEvent.click(addSubPageOptions[0])

    expect(onAddSubPageClick).toHaveBeenCalledWith('1')
  })
})
