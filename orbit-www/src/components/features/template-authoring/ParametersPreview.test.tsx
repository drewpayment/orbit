import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ParametersPreview } from './ParametersPreview'
import type { ParameterPage } from '@/lib/scaffolder/schema'

afterEach(() => {
  cleanup()
})

describe('ParametersPreview', () => {
  it('shows a placeholder with no pages', () => {
    render(<ParametersPreview pages={[]} />)
    expect(screen.getByText(/add a page to see a live preview/i)).toBeInTheDocument()
  })

  it('renders a live SchemaForm for the current pages', () => {
    const pages: ParameterPage[] = [
      {
        title: 'Service',
        required: ['name'],
        properties: {
          name: { type: 'string', title: 'Name' },
          enabled: { type: 'boolean', title: 'Enabled' },
        },
      },
    ]
    render(<ParametersPreview pages={pages} />)
    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('Enabled')).toBeInTheDocument()
    // hideSubmit — no submit button rendered
    expect(screen.queryByRole('button', { name: /submit/i })).not.toBeInTheDocument()
  })

  it('renders a wizard tab bar for multiple pages', () => {
    const pages: ParameterPage[] = [
      { title: 'Page A', properties: { a: { type: 'string' } } },
      { title: 'Page B', properties: { b: { type: 'string' } } },
    ]
    render(<ParametersPreview pages={pages} />)
    expect(screen.getByText('Page A')).toBeInTheDocument()
    expect(screen.getByText('Page B')).toBeInTheDocument()
  })
})
