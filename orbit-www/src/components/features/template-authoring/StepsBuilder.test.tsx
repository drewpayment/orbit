import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { StepsBuilder } from './StepsBuilder'
import type { TemplateDefinition } from '@/lib/scaffolder/schema'
import type { ActionDescriptor } from '@/lib/scaffolder/validate'

afterEach(() => {
  cleanup()
})

function descriptor(overrides: Partial<ActionDescriptor>): ActionDescriptor {
  return {
    id: 'noop',
    family: 'utility',
    name: 'Noop',
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: {} },
    supportsPlan: false,
    ...overrides,
  }
}

function definition(steps: TemplateDefinition['spec']['steps']): TemplateDefinition {
  return {
    apiVersion: 'orbit/v2',
    kind: 'Template',
    metadata: { name: 'x', title: 'X', owner: 'o' },
    spec: { parameters: [], steps },
  }
}

const registry: ActionDescriptor[] = [
  descriptor({
    id: 'github:repo:create-from-template',
    family: 'publish',
    name: 'Create repo from template',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { repoUrl: { type: 'string' } } },
  }),
  descriptor({ id: 'fs:render', family: 'render', name: 'Render files' }),
]

describe('StepsBuilder', () => {
  it('dispatches ADD_STEP with a generated id when an action is chosen', () => {
    const dispatch = vi.fn()
    render(<StepsBuilder definition={definition([])} dispatch={dispatch} registry={registry} />)
    fireEvent.click(screen.getByRole('button', { name: /add step/i }))
    fireEvent.click(screen.getByText('Create repo from template'))
    expect(dispatch).toHaveBeenCalledWith({
      type: 'ADD_STEP',
      step: {
        id: 'create-from-template',
        name: 'Create repo from template',
        action: 'github:repo:create-from-template',
        input: {},
      },
    })
  })

  it('dispatches REMOVE_STEP when a step is removed', () => {
    const dispatch = vi.fn()
    const def = definition([{ id: 's1', name: 'Step 1', action: 'fs:render', input: {} }])
    render(<StepsBuilder definition={def} dispatch={dispatch} registry={registry} />)
    fireEvent.click(screen.getByRole('button', { name: /remove step/i }))
    expect(dispatch).toHaveBeenCalledWith({ type: 'REMOVE_STEP', id: 's1' })
  })

  it('dispatches REORDER_STEP when moving a step', () => {
    const dispatch = vi.fn()
    const def = definition([
      { id: 's1', name: 'Step 1', action: 'fs:render', input: {} },
      { id: 's2', name: 'Step 2', action: 'fs:render', input: {} },
    ])
    render(<StepsBuilder definition={def} dispatch={dispatch} registry={registry} />)
    fireEvent.click(screen.getAllByRole('button', { name: /move step down/i })[0])
    expect(dispatch).toHaveBeenCalledWith({ type: 'REORDER_STEP', index: 0, delta: 1 })
  })

  it('round-trips the "if" expression field via UPDATE_STEP', () => {
    const dispatch = vi.fn()
    const def = definition([{ id: 's1', name: 'Step 1', action: 'fs:render', input: {} }])
    render(<StepsBuilder definition={def} dispatch={dispatch} registry={registry} />)
    const ifInput = screen.getByLabelText(/run if/i)
    fireEvent.change(ifInput, { target: { value: '${{ parameters.needsTopic }}' } })
    expect(dispatch).toHaveBeenCalledWith({
      type: 'UPDATE_STEP',
      id: 's1',
      patch: { if: '${{ parameters.needsTopic }}' },
    })
  })

  it('inserts a well-formed expression into the "if" field via the insert menu', () => {
    const dispatch = vi.fn()
    const def = definition([
      { id: 'repo', name: 'Repo', action: 'github:repo:create-from-template', input: {} },
      { id: 's2', name: 'Step 2', action: 'fs:render', input: {} },
    ])
    render(<StepsBuilder definition={def} dispatch={dispatch} registry={registry} />)
    const insertButtons = screen.getAllByRole('button', { name: /insert expression/i })
    // First step ("repo") has no earlier steps, second row's "if" is the 2nd insert button on the page.
    fireEvent.click(insertButtons[1])
    fireEvent.click(screen.getByText('steps.repo.output.repoUrl'))
    expect(dispatch).toHaveBeenCalledWith({
      type: 'UPDATE_STEP',
      id: 's2',
      patch: { if: '${{ steps.repo.output.repoUrl }}' },
    })
  })

  it('dispatches UPDATE_STEP for continueOnError and timeout', () => {
    const dispatch = vi.fn()
    const def = definition([{ id: 's1', name: 'Step 1', action: 'fs:render', input: {} }])
    render(<StepsBuilder definition={def} dispatch={dispatch} registry={registry} />)
    fireEvent.click(screen.getByLabelText(/continue on error/i))
    expect(dispatch).toHaveBeenCalledWith({
      type: 'UPDATE_STEP',
      id: 's1',
      patch: { continueOnError: true },
    })
    fireEvent.change(screen.getByLabelText(/timeout/i), { target: { value: '5m' } })
    expect(dispatch).toHaveBeenCalledWith({ type: 'UPDATE_STEP', id: 's1', patch: { timeout: '5m' } })
  })

  it('shows a fallback message for a step whose action is not in the registry', () => {
    const dispatch = vi.fn()
    const def = definition([{ id: 's1', name: 'Step 1', action: 'nope:nope', input: {} }])
    render(<StepsBuilder definition={def} dispatch={dispatch} registry={registry} />)
    fireEvent.click(screen.getByRole('button', { name: /configure inputs/i }))
    expect(screen.getByText(/isn't in the registry/i)).toBeInTheDocument()
  })
})
