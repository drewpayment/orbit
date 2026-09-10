import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { OutputBuilder } from './OutputBuilder'
import type { TemplateDefinition } from '@/lib/scaffolder/schema'
import type { ActionDescriptor } from '@/lib/scaffolder/validate'

afterEach(() => {
  cleanup()
})

function definition(output?: TemplateDefinition['spec']['output']): TemplateDefinition {
  return {
    apiVersion: 'orbit/v2',
    kind: 'Template',
    metadata: { name: 'x', title: 'X', owner: 'o' },
    spec: { parameters: [], steps: [], output },
  }
}

const registry: ActionDescriptor[] = []

describe('OutputBuilder', () => {
  it('adds a blank link row via SET_OUTPUT', () => {
    const dispatch = vi.fn()
    render(<OutputBuilder definition={definition()} dispatch={dispatch} registry={registry} />)
    fireEvent.click(screen.getByRole('button', { name: /add link/i }))
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_OUTPUT',
      output: { links: [{ title: '' }] },
    })
  })

  it('updates a link title via SET_OUTPUT preserving other links', () => {
    const dispatch = vi.fn()
    const def = definition({ links: [{ title: 'Repo', url: 'x' }, { title: 'Catalog' }] })
    render(<OutputBuilder definition={def} dispatch={dispatch} registry={registry} />)
    const titleInputs = screen.getAllByLabelText('Title')
    fireEvent.change(titleInputs[0], { target: { value: 'Repository' } })
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_OUTPUT',
      output: { links: [{ title: 'Repository', url: 'x' }, { title: 'Catalog' }] },
    })
  })

  it('removes a link', () => {
    const dispatch = vi.fn()
    const def = definition({ links: [{ title: 'Repo' }, { title: 'Catalog' }] })
    render(<OutputBuilder definition={def} dispatch={dispatch} registry={registry} />)
    fireEvent.click(screen.getAllByRole('button', { name: /remove link/i })[0])
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_OUTPUT', output: { links: [{ title: 'Catalog' }] } })
  })
})
