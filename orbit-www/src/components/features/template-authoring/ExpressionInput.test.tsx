import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { ExpressionInput } from './ExpressionInput'

afterEach(() => {
  cleanup()
})

const candidates = [
  { path: 'parameters.name', description: 'Name' },
  { path: 'steps.repo.output.repoUrl', description: 'Create repo' },
]

describe('ExpressionInput', () => {
  it('renders the current value and calls onChange on typing', () => {
    const onChange = vi.fn()
    render(<ExpressionInput value="hello" onChange={onChange} candidates={candidates} />)
    const input = screen.getByDisplayValue('hello')
    fireEvent.change(input, { target: { value: 'hello world' } })
    expect(onChange).toHaveBeenCalledWith('hello world')
  })

  it('inserts a well-formed ${{ }} expression when a candidate is chosen', () => {
    const onChange = vi.fn()
    render(<ExpressionInput value="" onChange={onChange} candidates={candidates} />)
    fireEvent.click(screen.getByRole('button', { name: /insert expression/i }))
    fireEvent.click(screen.getByText('parameters.name'))
    expect(onChange).toHaveBeenCalledWith('${{ parameters.name }}')
  })

  it('appends the expression at the end of existing text', () => {
    const onChange = vi.fn()
    render(<ExpressionInput value="prefix-" onChange={onChange} candidates={candidates} />)
    fireEvent.click(screen.getByRole('button', { name: /insert expression/i }))
    fireEvent.click(screen.getByText('steps.repo.output.repoUrl'))
    expect(onChange).toHaveBeenCalledWith('prefix-${{ steps.repo.output.repoUrl }}')
  })
})
