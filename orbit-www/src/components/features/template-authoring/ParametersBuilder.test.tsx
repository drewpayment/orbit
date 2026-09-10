import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { ParametersBuilder } from './ParametersBuilder'
import type { ParameterPage } from '@/lib/scaffolder/schema'

afterEach(() => {
  cleanup()
})

function page(overrides?: Partial<ParameterPage>): ParameterPage {
  return {
    title: 'Service',
    required: ['name'],
    properties: {
      name: { type: 'string' },
      owner: { type: 'string' },
    },
    ...overrides,
  }
}

describe('ParametersBuilder', () => {
  it('dispatches ADD_PARAMETER_PAGE when "Add page" is clicked', () => {
    const dispatch = vi.fn()
    render(<ParametersBuilder pages={[]} dispatch={dispatch} />)
    fireEvent.click(screen.getByRole('button', { name: /add page/i }))
    expect(dispatch).toHaveBeenCalledWith({ type: 'ADD_PARAMETER_PAGE', title: 'Page 1' })
  })

  it('dispatches ADD_FIELD when "Append field" is clicked', () => {
    const dispatch = vi.fn()
    render(<ParametersBuilder pages={[page()]} dispatch={dispatch} />)
    fireEvent.click(screen.getByRole('button', { name: /append field/i }))
    expect(dispatch).toHaveBeenCalledWith({
      type: 'ADD_FIELD',
      pageIndex: 0,
      name: 'field3',
      property: { type: 'string' },
    })
  })

  it('dispatches REMOVE_FIELD when a field row is removed', () => {
    const dispatch = vi.fn()
    render(<ParametersBuilder pages={[page()]} dispatch={dispatch} />)
    fireEvent.click(screen.getAllByRole('button', { name: /remove field/i })[0])
    expect(dispatch).toHaveBeenCalledWith({ type: 'REMOVE_FIELD', pageIndex: 0, name: 'name' })
  })

  it('dispatches REORDER_FIELD when moving a field down', () => {
    const dispatch = vi.fn()
    render(<ParametersBuilder pages={[page()]} dispatch={dispatch} />)
    fireEvent.click(screen.getAllByRole('button', { name: /move field down/i })[0])
    expect(dispatch).toHaveBeenCalledWith({ type: 'REORDER_FIELD', pageIndex: 0, index: 0, delta: 1 })
  })

  it('dispatches REORDER_PARAMETER_PAGE when moving a page', () => {
    const dispatch = vi.fn()
    render(<ParametersBuilder pages={[page(), page({ title: 'Other', properties: {} })]} dispatch={dispatch} />)
    fireEvent.click(screen.getAllByRole('button', { name: /move page down/i })[0])
    expect(dispatch).toHaveBeenCalledWith({ type: 'REORDER_PARAMETER_PAGE', index: 0, delta: 1 })
  })

  it('dispatches REMOVE_PARAMETER_PAGE when a page is removed', () => {
    const dispatch = vi.fn()
    render(<ParametersBuilder pages={[page()]} dispatch={dispatch} />)
    fireEvent.click(screen.getByRole('button', { name: /remove page/i }))
    expect(dispatch).toHaveBeenCalledWith({ type: 'REMOVE_PARAMETER_PAGE', index: 0 })
  })

  it('dispatches UPDATE_FIELD with a renameTo when a field name changes', () => {
    const dispatch = vi.fn()
    render(<ParametersBuilder pages={[page()]} dispatch={dispatch} />)
    const nameInputs = screen.getAllByLabelText('Name')
    fireEvent.change(nameInputs[0], { target: { value: 'renamed' } })
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'UPDATE_FIELD',
        pageIndex: 0,
        name: 'name',
        renameTo: 'renamed',
        required: true,
      }),
    )
  })

  it('does not dispatch and shows an inline error when renaming a field to an existing sibling name', () => {
    const dispatch = vi.fn()
    render(<ParametersBuilder pages={[page()]} dispatch={dispatch} />)
    const nameInputs = screen.getAllByLabelText('Name') as HTMLInputElement[]
    // "name" -> "owner" collides with the sibling field already named "owner".
    fireEvent.change(nameInputs[0], { target: { value: 'owner' } })

    expect(dispatch).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/a field named "owner" already exists/i)
    // The typed value is kept in the input so the author can keep editing.
    expect(nameInputs[0].value).toBe('owner')
  })

  it('clears the collision error once the name no longer collides', () => {
    const dispatch = vi.fn()
    render(<ParametersBuilder pages={[page()]} dispatch={dispatch} />)
    const nameInputs = screen.getAllByLabelText('Name') as HTMLInputElement[]
    fireEvent.change(nameInputs[0], { target: { value: 'owner' } })
    expect(screen.getByRole('alert')).toBeInTheDocument()

    fireEvent.change(nameInputs[0], { target: { value: 'ownerName' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'UPDATE_FIELD', name: 'name', renameTo: 'ownerName' }),
    )
  })

  it('allows retyping a field name back to its own current value without an error', () => {
    const dispatch = vi.fn()
    render(<ParametersBuilder pages={[page()]} dispatch={dispatch} />)
    const nameInputs = screen.getAllByLabelText('Name') as HTMLInputElement[]
    // Detour through a different value first (typing "name" -> "name" as a no-op
    // change event isn't observable — jsdom's controlled-input value tracker
    // skips firing onChange when the value doesn't actually change).
    fireEvent.change(nameInputs[0], { target: { value: 'namex' } })
    fireEvent.change(nameInputs[0], { target: { value: 'name' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'UPDATE_FIELD', name: 'name', renameTo: 'name' }),
    )
  })
})
