import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ValidationPanel } from './ValidationPanel'
import type { TemplateDefinition } from '@/lib/scaffolder/schema'
import type { ValidationResult } from '@/lib/scaffolder/validate'

afterEach(cleanup)

const definition: TemplateDefinition = {
  apiVersion: 'orbit/v2',
  kind: 'Template',
  metadata: { name: 'svc', title: 'Service', owner: 'platform' },
  spec: { parameters: [], steps: [] },
}

function ok(): ValidationResult {
  return { ok: true, errors: [] }
}

describe('ValidationPanel', () => {
  it('starts idle, having validated nothing', () => {
    const validate = vi.fn()
    render(<ValidationPanel definition={definition} validate={validate} />)
    expect(validate).not.toHaveBeenCalled()
    expect(screen.getByText(/not validated yet/i)).toBeInTheDocument()
  })

  it('validates the current definition on demand and reports success', async () => {
    const validate = vi.fn().mockResolvedValue(ok())
    render(<ValidationPanel definition={definition} validate={validate} />)
    await userEvent.click(screen.getByRole('button', { name: /validate/i }))
    await waitFor(() => expect(screen.getByText(/validation passed/i)).toBeInTheDocument())
    expect(validate).toHaveBeenCalledWith(definition)
  })

  it('lists each error with its message', async () => {
    const validate = vi.fn().mockResolvedValue({
      ok: false,
      errors: [
        { path: 'spec.steps.0.action', message: 'Unknown action "github:nope"' },
        { path: 'metadata.owner', message: 'Required' },
      ],
    } satisfies ValidationResult)
    render(<ValidationPanel definition={definition} validate={validate} />)
    await userEvent.click(screen.getByRole('button', { name: /validate/i }))
    await waitFor(() => expect(screen.getByText(/Unknown action "github:nope"/)).toBeInTheDocument())
    expect(screen.getByText('Required')).toBeInTheDocument()
    expect(screen.getByText(/2 problems/i)).toBeInTheDocument()
  })

  it('offers a jump link for a placeable error path', async () => {
    const onJumpTo = vi.fn()
    const validate = vi.fn().mockResolvedValue({
      ok: false,
      errors: [{ path: 'spec.steps.1.input.owner', message: 'Required' }],
    } satisfies ValidationResult)
    render(<ValidationPanel definition={definition} validate={validate} onJumpTo={onJumpTo} />)
    await userEvent.click(screen.getByRole('button', { name: /validate/i }))
    const jump = await screen.findByRole('button', { name: /steps, step 2/i })
    await userEvent.click(jump)
    expect(onJumpTo).toHaveBeenCalledWith(
      expect.objectContaining({ tab: 'steps', stepIndex: 1 }),
    )
  })

  it('renders an unplaceable path as plain text with no jump link', async () => {
    const validate = vi.fn().mockResolvedValue({
      ok: false,
      errors: [{ path: 'apiVersion', message: 'Invalid literal' }],
    } satisfies ValidationResult)
    render(<ValidationPanel definition={definition} validate={validate} />)
    await userEvent.click(screen.getByRole('button', { name: /validate/i }))
    await waitFor(() => expect(screen.getByText('Invalid literal')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /apiVersion/i })).not.toBeInTheDocument()
    expect(screen.getByText('apiVersion')).toBeInTheDocument()
  })

  it('surfaces a thrown server error instead of appearing to pass', async () => {
    const validate = vi.fn().mockRejectedValue(new Error('registry unavailable'))
    render(<ValidationPanel definition={definition} validate={validate} />)
    await userEvent.click(screen.getByRole('button', { name: /validate/i }))
    await waitFor(() => expect(screen.getByText(/registry unavailable/i)).toBeInTheDocument())
    expect(screen.queryByText(/validation passed/i)).not.toBeInTheDocument()
  })

  it('reports the result to the parent so the publish gate can react', async () => {
    const onResult = vi.fn()
    const validate = vi.fn().mockResolvedValue(ok())
    render(<ValidationPanel definition={definition} validate={validate} onResult={onResult} />)
    await userEvent.click(screen.getByRole('button', { name: /validate/i }))
    await waitFor(() => expect(onResult).toHaveBeenCalledWith({ ok: true, errors: [] }))
  })

  it('runs when the parent bumps runToken, but not on the initial render', async () => {
    const validate = vi.fn().mockResolvedValue(ok())
    const { rerender } = render(
      <ValidationPanel definition={definition} validate={validate} runToken={0} />,
    )
    expect(validate).not.toHaveBeenCalled()
    rerender(<ValidationPanel definition={definition} validate={validate} runToken={1} />)
    await waitFor(() => expect(validate).toHaveBeenCalledTimes(1))
  })

  it('clears a previous result when the definition changes, so stale passes cannot mislead', async () => {
    const validate = vi.fn().mockResolvedValue(ok())
    const { rerender } = render(<ValidationPanel definition={definition} validate={validate} />)
    await userEvent.click(screen.getByRole('button', { name: /validate/i }))
    await waitFor(() => expect(screen.getByText(/validation passed/i)).toBeInTheDocument())

    const edited: TemplateDefinition = {
      ...definition,
      metadata: { ...definition.metadata, title: 'Changed' },
    }
    rerender(<ValidationPanel definition={edited} validate={validate} />)
    await waitFor(() => expect(screen.queryByText(/validation passed/i)).not.toBeInTheDocument())
  })
})
