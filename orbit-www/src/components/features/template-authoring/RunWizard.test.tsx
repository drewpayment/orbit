import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RunWizard } from './RunWizard'
import type { SchemaFormPage } from '@/components/forms/schema-form/types'
import type { ActionRun } from '@/payload-types'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const onePage: SchemaFormPage[] = [
  {
    title: 'Basics',
    schema: { type: 'object', properties: { name: { type: 'string', title: 'Name' } }, required: ['name'] },
  },
]

const pageWithSecret: SchemaFormPage[] = [
  {
    title: 'Basics',
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', title: 'Name' },
        token: { type: 'string', title: 'API token' },
      },
      required: ['name', 'token'],
    },
    uiSchema: { token: { 'ui:secret': true } },
  },
]

function baseRun(overrides?: Partial<ActionRun>): ActionRun {
  return {
    id: 'run-preview',
    action: 'action-1',
    workspace: 'ws-1',
    status: 'succeeded',
    plan: [{ kind: 'repo', name: 'my-svc', description: 'Create repository my-svc' }],
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  } as ActionRun
}

describe('RunWizard', () => {
  it('renders the parameter form first when there are pages', () => {
    render(
      <RunWizard
        slug="go-service"
        templateVersionId="ver-1"
        pages={onePage}
        planRun={vi.fn()}
        startRun={vi.fn()}
        getRun={vi.fn()}
      />,
    )
    expect(screen.getByLabelText(/^Name/i)).toBeInTheDocument()
  })

  it('advances to the review step on form submit and calls planRun', async () => {
    const planRun = vi.fn().mockResolvedValue({ runId: 'run-preview' })
    const getRun = vi.fn().mockResolvedValue(baseRun())

    render(
      <RunWizard
        slug="go-service"
        templateVersionId="ver-1"
        pages={onePage}
        planRun={planRun}
        startRun={vi.fn()}
        getRun={getRun}
      />,
    )

    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'my-svc' } })
    fireEvent.click(screen.getByRole('button', { name: /review/i }))

    await waitFor(() => expect(planRun).toHaveBeenCalledWith({ templateVersionId: 'ver-1', parameters: { name: 'my-svc' } }))
    await waitFor(() => expect(screen.getByText(/Create repository my-svc/)).toBeInTheDocument())
  })

  it('shows "preview unavailable" and still allows Submit when planRun rejects', async () => {
    const planRun = vi.fn().mockRejectedValue(new Error('Go worker unavailable'))
    const startRun = vi.fn().mockResolvedValue({ runId: 'run-real', status: 'pending' })

    render(
      <RunWizard
        slug="go-service"
        templateVersionId="ver-1"
        pages={onePage}
        planRun={planRun}
        startRun={startRun}
        getRun={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'my-svc' } })
    fireEvent.click(screen.getByRole('button', { name: /review/i }))

    await waitFor(() => expect(screen.getByText(/preview unavailable/i)).toBeInTheDocument())
    expect(screen.getByText(/Go worker unavailable/)).toBeInTheDocument()

    const submitButton = screen.getByRole('button', { name: /^submit$/i })
    expect(submitButton).not.toBeDisabled()

    fireEvent.click(submitButton)
    await waitFor(() =>
      expect(startRun).toHaveBeenCalledWith({ templateVersionId: 'ver-1', parameters: { name: 'my-svc' } }),
    )
    await waitFor(() => expect(push).toHaveBeenCalledWith('/self-service/templates/go-service/run/run-real'))
  })

  it('skips straight to review when the template has no parameter pages', async () => {
    const planRun = vi.fn().mockResolvedValue({ runId: 'run-preview' })
    render(
      <RunWizard
        slug="go-service"
        templateVersionId="ver-1"
        pages={[]}
        planRun={planRun}
        startRun={vi.fn()}
        getRun={vi.fn().mockResolvedValue(baseRun())}
      />,
    )
    await waitFor(() => expect(planRun).toHaveBeenCalledWith({ templateVersionId: 'ver-1', parameters: {} }))
  })

  it('lets the user go Back from review to the form', async () => {
    const planRun = vi.fn().mockResolvedValue({ runId: 'run-preview' })
    render(
      <RunWizard
        slug="go-service"
        templateVersionId="ver-1"
        pages={onePage}
        planRun={planRun}
        startRun={vi.fn()}
        getRun={vi.fn().mockResolvedValue(baseRun())}
      />,
    )
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'my-svc' } })
    fireEvent.click(screen.getByRole('button', { name: /review/i }))
    await waitFor(() => screen.getByRole('button', { name: /back/i }))
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(screen.getByLabelText(/^Name/i)).toBeInTheDocument()
  })

  it('surfaces a startRun error via a visible message rather than navigating', async () => {
    const planRun = vi.fn().mockResolvedValue({ runId: 'run-preview' })
    const startRun = vi.fn().mockRejectedValue(new Error('not published'))
    render(
      <RunWizard
        slug="go-service"
        templateVersionId="ver-1"
        pages={onePage}
        planRun={planRun}
        startRun={startRun}
        getRun={vi.fn().mockResolvedValue(baseRun())}
      />,
    )
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'my-svc' } })
    fireEvent.click(screen.getByRole('button', { name: /review/i }))
    await waitFor(() => screen.getByRole('button', { name: /^submit$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }))
    await waitFor(() => expect(screen.getByText(/not published/i)).toBeInTheDocument())
    expect(push).not.toHaveBeenCalled()
  })

  it('surfaces the server-side parameter-validation error ("Invalid parameters: ...") on submit', async () => {
    const planRun = vi.fn().mockResolvedValue({ runId: 'run-preview' })
    const startRun = vi.fn().mockRejectedValue(new Error("Invalid parameters: name: must NOT have fewer than 1 characters"))
    render(
      <RunWizard
        slug="go-service"
        templateVersionId="ver-1"
        pages={onePage}
        planRun={planRun}
        startRun={startRun}
        getRun={vi.fn().mockResolvedValue(baseRun())}
      />,
    )
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'my-svc' } })
    fireEvent.click(screen.getByRole('button', { name: /review/i }))
    await waitFor(() => screen.getByRole('button', { name: /^submit$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }))
    await waitFor(() => expect(screen.getByText(/Invalid parameters:.*must NOT have fewer than 1 characters/i)).toBeInTheDocument())
    expect(push).not.toHaveBeenCalled()
  })

  it('passes SchemaForm\'s {value, secret:true} wrapper through to startRun unmodified (server unwraps/redacts, not the client)', async () => {
    const planRun = vi.fn().mockResolvedValue({ runId: 'run-preview' })
    const startRun = vi.fn().mockResolvedValue({ runId: 'run-real', status: 'pending' })

    render(
      <RunWizard
        slug="go-service"
        templateVersionId="ver-1"
        pages={pageWithSecret}
        planRun={planRun}
        startRun={startRun}
        getRun={vi.fn().mockResolvedValue(baseRun())}
      />,
    )

    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'my-svc' } })
    fireEvent.change(screen.getByLabelText(/API token/i), { target: { value: 'topsecret' } })
    fireEvent.click(screen.getByRole('button', { name: /review/i }))

    await waitFor(() => screen.getByRole('button', { name: /^submit$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }))

    await waitFor(() =>
      expect(startRun).toHaveBeenCalledWith({
        templateVersionId: 'ver-1',
        parameters: { name: 'my-svc', token: { value: 'topsecret', secret: true } },
      }),
    )
  })

  it('surfaces the same server-side parameter-validation error in the review preview banner', async () => {
    const planRun = vi.fn().mockRejectedValue(new Error('Invalid parameters: unexpected additional property'))
    render(
      <RunWizard
        slug="go-service"
        templateVersionId="ver-1"
        pages={onePage}
        planRun={planRun}
        startRun={vi.fn()}
        getRun={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'my-svc' } })
    fireEvent.click(screen.getByRole('button', { name: /review/i }))
    await waitFor(() => expect(screen.getByText(/Invalid parameters: unexpected additional property/i)).toBeInTheDocument())
  })
})
