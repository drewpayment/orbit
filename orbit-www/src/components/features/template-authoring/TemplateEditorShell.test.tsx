import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TemplateEditorShell, type TemplateEditorActions } from './TemplateEditorShell'
import type { TemplateDefinition } from '@/lib/scaffolder/schema'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const definition: TemplateDefinition = {
  apiVersion: 'orbit/v2',
  kind: 'Template',
  metadata: { name: 'backend-service', title: 'Backend service', owner: 'platform' },
  spec: { parameters: [{ title: 'Basics', properties: { repoName: { type: 'string' } } }], steps: [] },
}

function makeActions(overrides: Partial<TemplateEditorActions> = {}): TemplateEditorActions {
  return {
    saveTemplateDefinitionDraft: vi.fn().mockResolvedValue({ versionId: 'v2' }),
    validateTemplateDefinition: vi.fn().mockResolvedValue({ ok: true, errors: [] }),
    markVersionValidated: vi.fn().mockResolvedValue({ ok: true, errors: [] }),
    startDryRun: vi.fn().mockResolvedValue({ runId: 'run-1' }),
    getRun: vi.fn().mockResolvedValue(null),
    recordSuccessfulDryRun: vi.fn().mockResolvedValue({ recorded: true }),
    publishTemplateDefinition: vi.fn().mockResolvedValue({ id: 'def-1' }),
    deprecateTemplateDefinition: vi.fn().mockResolvedValue({ id: 'def-1' }),
    saveFixture: vi.fn().mockResolvedValue({ id: 'f1' }),
    deleteFixture: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function setup(props: Partial<React.ComponentProps<typeof TemplateEditorShell>> = {}) {
  const actions = props.actions ?? makeActions()
  render(
    <TemplateEditorShell
      definitionId="def-1"
      status="draft"
      workspaceId="ws-1"
      initialDefinition={definition}
      currentVersionId="v1"
      currentVersionValidated={false}
      currentVersionHasDryRun={false}
      registry={[]}
      fixtures={[]}
      versions={[]}
      {...props}
      actions={actions}
    />,
  )
  return { actions }
}

describe('TemplateEditorShell', () => {
  it('renders the metadata, the builder tabs, and the bottom bar', () => {
    setup()
    expect(screen.getByLabelText('Identifier')).toHaveValue('backend-service')
    expect(screen.getByLabelText('Title')).toHaveValue('Backend service')
    expect(screen.getByRole('tab', { name: 'Parameters' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Steps' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Output' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save draft/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /publish/i })).toBeInTheDocument()
  })

  it('starts clean, with Save draft disabled until something changes', async () => {
    setup()
    const save = screen.getByRole('button', { name: /save draft/i })
    expect(save).toBeDisabled()
    expect(screen.getByText('Saved')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Title'), '!')
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    expect(save).toBeEnabled()
  })

  it('saves the edited definition and returns to a clean state', async () => {
    const { actions } = setup()
    await userEvent.type(screen.getByLabelText('Owner'), 'x')
    await userEvent.click(screen.getByRole('button', { name: /save draft/i }))

    await waitFor(() => expect(actions.saveTemplateDefinitionDraft).toHaveBeenCalledTimes(1))
    const [id, saved] = vi.mocked(actions.saveTemplateDefinitionDraft).mock.calls[0]
    expect(id).toBe('def-1')
    expect((saved as TemplateDefinition).metadata.owner).toBe('platformx')
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument())
    expect(refresh).toHaveBeenCalled()
  })

  it('surfaces a save failure instead of claiming success', async () => {
    const actions = makeActions({
      saveTemplateDefinitionDraft: vi.fn().mockRejectedValue(new Error('permission denied')),
    })
    setup({ actions })
    await userEvent.type(screen.getByLabelText('Owner'), 'x')
    await userEvent.click(screen.getByRole('button', { name: /save draft/i }))
    expect(await screen.findByText(/permission denied/i)).toBeInTheDocument()
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  })

  it('stamps the saved version when validating a clean buffer', async () => {
    const { actions } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Validate' }))
    await waitFor(() => expect(actions.markVersionValidated).toHaveBeenCalledWith('v1'))
    expect(actions.validateTemplateDefinition).not.toHaveBeenCalled()
  })

  it('validates in memory only while there are unsaved changes', async () => {
    const { actions } = setup()
    await userEvent.type(screen.getByLabelText('Title'), '!')
    await userEvent.click(screen.getByRole('button', { name: 'Validate' }))
    await waitFor(() => expect(actions.validateTemplateDefinition).toHaveBeenCalledTimes(1))
    expect(actions.markVersionValidated).not.toHaveBeenCalled()
  })

  it('keeps Publish disabled until both gate facts hold', () => {
    setup({ currentVersionValidated: true, currentVersionHasDryRun: false })
    expect(screen.getByRole('button', { name: /publish/i })).toBeDisabled()
  })

  it('enables Publish once the saved version is validated and dry-run', () => {
    setup({ currentVersionValidated: true, currentVersionHasDryRun: true })
    expect(screen.getByRole('button', { name: /publish/i })).toBeEnabled()
  })

  it('re-disables Publish as soon as the definition is edited', async () => {
    setup({ currentVersionValidated: true, currentVersionHasDryRun: true })
    await userEvent.type(screen.getByLabelText('Title'), '!')
    expect(screen.getByRole('button', { name: /publish/i })).toBeDisabled()
  })

  it('surfaces the server rejection when publish is refused', async () => {
    const actions = makeActions({
      publishTemplateDefinition: vi.fn().mockRejectedValue(new Error('Publish gate failed: no dry run')),
    })
    setup({ actions, currentVersionValidated: true, currentVersionHasDryRun: true })
    await userEvent.click(screen.getByRole('button', { name: /publish/i }))
    expect(await screen.findByText(/publish gate failed/i)).toBeInTheDocument()
  })

  it('toggles the YAML side panel', async () => {
    setup()
    expect(screen.queryByRole('heading', { name: 'YAML' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /yaml/i }))
    expect(await screen.findByRole('heading', { name: 'YAML' })).toBeInTheDocument()
  })

  it('explains an empty action registry on the Steps tab', async () => {
    setup({ registry: [] })
    await userEvent.click(screen.getByRole('tab', { name: 'Steps' }))
    expect(await screen.findByText(/action registry is empty/i)).toBeInTheDocument()
  })

  it('warns that a dry run uses the saved version while edits are pending', async () => {
    setup()
    await userEvent.type(screen.getByLabelText('Title'), '!')
    expect(screen.getByText(/executes the last saved version/i)).toBeInTheDocument()
  })

  it('lists version history with its publish-gate badges', () => {
    setup({
      versions: [
        {
          id: 'v1',
          versionNumber: 1,
          changeNote: 'Initial draft',
          validatedAt: '2026-09-09T00:00:00.000Z',
          dryRunRunId: null,
          createdAt: '2026-09-09T00:00:00.000Z',
          isCurrent: true,
          definitionJson: definition,
        },
      ],
    })
    const versionItem = screen.getByText('v1').closest('li')
    expect(versionItem).not.toBeNull()
    expect(within(versionItem as HTMLElement).getByText('Current')).toBeInTheDocument()
    expect(within(versionItem as HTMLElement).getByText('Validated')).toBeInTheDocument()
  })
})
