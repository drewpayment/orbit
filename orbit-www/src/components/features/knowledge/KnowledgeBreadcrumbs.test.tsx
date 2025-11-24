import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { KnowledgeBreadcrumbs } from './KnowledgeBreadcrumbs'

describe('KnowledgeBreadcrumbs', () => {
  const mockWorkspace = {
    id: '1',
    slug: 'test-workspace',
    name: 'Test Workspace',
  }

  const mockSpace = {
    id: '2',
    slug: 'test-space',
    name: 'Test Space',
  }

  it('should render breadcrumb trail', () => {
    render(
      <KnowledgeBreadcrumbs
        workspace={mockWorkspace as any}
        space={mockSpace as any}
      />
    )

    expect(screen.getByText('Knowledge Base')).toBeInTheDocument()
    expect(screen.getByText('Test Space')).toBeInTheDocument()
  })

  it('should have 40px height', () => {
    const { container } = render(
      <KnowledgeBreadcrumbs
        workspace={mockWorkspace as any}
        space={mockSpace as any}
      />
    )

    const header = container.firstChild as HTMLElement
    expect(header).toHaveClass('h-10')
  })

  it('should display current page when provided', () => {
    const mockPage = {
      id: '3',
      title: 'Current Page',
      slug: 'current-page',
    }

    render(
      <KnowledgeBreadcrumbs
        workspace={mockWorkspace as any}
        space={mockSpace as any}
        currentPage={mockPage as any}
      />
    )

    expect(screen.getByText('Current Page')).toBeInTheDocument()
  })
})
