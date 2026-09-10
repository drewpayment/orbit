import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FixturesPanel, type FixtureRow } from './FixturesPanel'

afterEach(cleanup)

const fixtures: FixtureRow[] = [
  { id: 'f1', name: 'Minimal', values: { repoName: 'svc-a' } },
  { id: 'f2', name: 'Full', values: { repoName: 'svc-b', withCi: true } },
]

function setup(overrides: Partial<React.ComponentProps<typeof FixturesPanel>> = {}) {
  const saveFixture = vi.fn().mockResolvedValue({ id: 'new-id' })
  const deleteFixture = vi.fn().mockResolvedValue(undefined)
  const onChanged = vi.fn()
  const onApply = vi.fn()
  render(
    <FixturesPanel
      definitionId="def-1"
      fixtures={fixtures}
      currentValues={{ repoName: 'draft-value' }}
      saveFixture={saveFixture}
      deleteFixture={deleteFixture}
      onChanged={onChanged}
      onApply={onApply}
      {...overrides}
    />,
  )
  return { saveFixture, deleteFixture, onChanged, onApply }
}

describe('FixturesPanel', () => {
  it('lists the saved fixtures by name', () => {
    setup()
    expect(screen.getByText('Minimal')).toBeInTheDocument()
    expect(screen.getByText('Full')).toBeInTheDocument()
  })

  it('shows an empty state when there are none', () => {
    render(<FixturesPanel definitionId="def-1" fixtures={[]} />)
    expect(screen.getByText(/no fixtures/i)).toBeInTheDocument()
  })

  it('saves the current parameter values under a new name', async () => {
    const { saveFixture, onChanged } = setup()
    await userEvent.type(screen.getByLabelText(/fixture name/i), 'Smoke')
    await userEvent.click(screen.getByRole('button', { name: /save fixture/i }))
    await waitFor(() =>
      expect(saveFixture).toHaveBeenCalledWith('def-1', {
        name: 'Smoke',
        values: { repoName: 'draft-value' },
      }),
    )
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('refuses to save without a name and never calls the server action', async () => {
    const { saveFixture } = setup()
    await userEvent.click(screen.getByRole('button', { name: /save fixture/i }))
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument()
    expect(saveFixture).not.toHaveBeenCalled()
  })

  it('clears the name field after a successful save', async () => {
    setup()
    const input = screen.getByLabelText(/fixture name/i)
    await userEvent.type(input, 'Smoke')
    await userEvent.click(screen.getByRole('button', { name: /save fixture/i }))
    await waitFor(() => expect(input).toHaveValue(''))
  })

  it('deletes a fixture by id', async () => {
    const { deleteFixture, onChanged } = setup()
    await userEvent.click(screen.getByRole('button', { name: /delete fixture minimal/i }))
    await waitFor(() => expect(deleteFixture).toHaveBeenCalledWith('def-1', 'f1'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('applies a fixture’s values to the caller', async () => {
    const { onApply } = setup()
    await userEvent.click(screen.getByRole('button', { name: /use fixture full/i }))
    expect(onApply).toHaveBeenCalledWith({ repoName: 'svc-b', withCi: true })
  })

  it('surfaces a save failure', async () => {
    const saveFixture = vi.fn().mockRejectedValue(new Error('permission denied'))
    setup({ saveFixture })
    await userEvent.type(screen.getByLabelText(/fixture name/i), 'Smoke')
    await userEvent.click(screen.getByRole('button', { name: /save fixture/i }))
    expect(await screen.findByText(/permission denied/i)).toBeInTheDocument()
  })

  it('surfaces a delete failure', async () => {
    const deleteFixture = vi.fn().mockRejectedValue(new Error('nope'))
    setup({ deleteFixture })
    await userEvent.click(screen.getByRole('button', { name: /delete fixture minimal/i }))
    expect(await screen.findByText(/nope/i)).toBeInTheDocument()
  })

  it('hides the apply affordance when the caller cannot receive values', () => {
    render(<FixturesPanel definitionId="def-1" fixtures={fixtures} />)
    expect(screen.queryByRole('button', { name: /use fixture/i })).not.toBeInTheDocument()
  })
})
