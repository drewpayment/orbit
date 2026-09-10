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

  it('warns before removing a step that later steps depend on, instead of dispatching immediately', () => {
    const dispatch = vi.fn()
    const def = definition([
      { id: 'repo', name: 'Repo', action: 'github:repo:create-from-template', input: {} },
      { id: 'push', name: 'Push', action: 'fs:render', input: { url: '${{ steps.repo.output.repoUrl }}' } },
    ])
    render(<StepsBuilder definition={def} dispatch={dispatch} registry={registry} />)
    const removeButtons = screen.getAllByRole('button', { name: /remove step/i })
    fireEvent.click(removeButtons[0]) // remove "repo", which "push" depends on

    expect(dispatch).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/break a reference in: push/i)

    fireEvent.click(screen.getByRole('button', { name: /remove anyway/i }))
    expect(dispatch).toHaveBeenCalledWith({ type: 'REMOVE_STEP', id: 'repo' })
  })

  it('cancelling the removal warning does not dispatch', () => {
    const dispatch = vi.fn()
    const def = definition([
      { id: 'repo', name: 'Repo', action: 'github:repo:create-from-template', input: {} },
      { id: 'push', name: 'Push', action: 'fs:render', input: { url: '${{ steps.repo.output.repoUrl }}' } },
    ])
    render(<StepsBuilder definition={def} dispatch={dispatch} registry={registry} />)
    fireEvent.click(screen.getAllByRole('button', { name: /remove step/i })[0])
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(dispatch).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('removes a step with no dependents immediately, without a warning', () => {
    const dispatch = vi.fn()
    const def = definition([{ id: 's1', name: 'Step 1', action: 'fs:render', input: {} }])
    render(<StepsBuilder definition={def} dispatch={dispatch} registry={registry} />)
    fireEvent.click(screen.getByRole('button', { name: /remove step/i }))
    expect(dispatch).toHaveBeenCalledWith({ type: 'REMOVE_STEP', id: 's1' })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('StepsBuilder (typed inputs and step ids)', () => {
  const httpLike = descriptor({
    id: 'http:request',
    family: 'utility',
    name: 'HTTP request',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        timeoutSeconds: { type: 'integer', title: 'Timeout seconds' },
      },
    },
  })

  it('stores a numeric literal typed into an integer input as a number, not a string', () => {
    const dispatch = vi.fn()
    const def = definition([{ id: 's1', name: 'S', action: 'http:request', input: { url: 'https://x' } }])
    render(<StepsBuilder definition={def} dispatch={dispatch} registry={[...registry, httpLike]} />)
    fireEvent.click(screen.getByRole('button', { name: /configure inputs/i }))
    fireEvent.change(document.getElementById('timeoutSeconds') as HTMLInputElement, { target: { value: '10' } })
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'UPDATE_STEP',
        id: 's1',
        patch: { input: expect.objectContaining({ timeoutSeconds: 10 }) },
      }),
    )
  })

  it('keeps an expression typed into an integer input as a string', () => {
    const dispatch = vi.fn()
    const def = definition([{ id: 's1', name: 'S', action: 'http:request', input: {} }])
    render(<StepsBuilder definition={def} dispatch={dispatch} registry={[...registry, httpLike]} />)
    fireEvent.click(screen.getByRole('button', { name: /configure inputs/i }))
    fireEvent.change(document.getElementById('timeoutSeconds') as HTMLInputElement, {
      target: { value: '${{ parameters.t }}' },
    })
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: { input: expect.objectContaining({ timeoutSeconds: '${{ parameters.t }}' }) },
      }),
    )
  })

  it('lets the author rename a step id', () => {
    const dispatch = vi.fn()
    const def = definition([{ id: 'log', name: 'Log', action: 'fs:render', input: {} }])
    render(<StepsBuilder definition={def} dispatch={dispatch} registry={registry} />)
    fireEvent.change(screen.getByLabelText('Step id'), { target: { value: 'announce' } })
    expect(dispatch).toHaveBeenCalledWith({ type: 'UPDATE_STEP', id: 'log', patch: { id: 'announce' } })
  })

  it('rejects an invalid or colliding step id inline without dispatching', () => {
    const dispatch = vi.fn()
    const def = definition([
      { id: 'log', name: 'Log', action: 'fs:render', input: {} },
      { id: 'ping', name: 'Ping', action: 'fs:render', input: {} },
    ])
    render(<StepsBuilder definition={def} dispatch={dispatch} registry={registry} />)
    const idInput = screen.getAllByLabelText('Step id')[0]
    fireEvent.change(idInput, { target: { value: 'ping' } })
    fireEvent.change(idInput, { target: { value: 'Bad Id' } })
    expect(dispatch).not.toHaveBeenCalled()
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)
  })
})

describe('StepsBuilder (self-heals numeric strings saved by older builds)', () => {
  it('dispatches a coerced input patch on mount when a number field holds a numeric string', () => {
    const dispatch = vi.fn()
    const httpLike = descriptor({
      id: 'http:request',
      name: 'HTTP request',
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string' }, timeoutSeconds: { type: 'integer' } },
      },
    })
    const def = definition([
      { id: 's1', name: 'S', action: 'http:request', input: { url: 'https://x', timeoutSeconds: '10' } },
    ])
    render(<StepsBuilder definition={def} dispatch={dispatch} registry={[...registry, httpLike]} />)
    expect(dispatch).toHaveBeenCalledWith({
      type: 'UPDATE_STEP',
      id: 's1',
      patch: { input: { url: 'https://x', timeoutSeconds: 10 } },
    })
  })

  it('does not dispatch on mount when inputs are already well-typed', () => {
    const dispatch = vi.fn()
    const def = definition([{ id: 's1', name: 'S', action: 'fs:render', input: { path: 'x' } }])
    render(<StepsBuilder definition={def} dispatch={dispatch} registry={registry} />)
    expect(dispatch).not.toHaveBeenCalled()
  })
})
