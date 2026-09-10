import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { TemplateRunDetail } from './TemplateRunDetail'
import type { ActionRun } from '@/payload-types'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))
vi.mock('@/app/(frontend)/self-service/actions', () => ({
  approveRun: vi.fn(),
  rejectRun: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function run(overrides?: Partial<ActionRun>): ActionRun {
  return {
    id: 'run-1',
    action: 'action-1',
    workspace: 'ws-1',
    status: 'running',
    steps: [
      { id: 'create-repo', name: 'Create repo', status: 'succeeded', logTail: 'created https://github.com/x/y' },
      { id: 'register', name: 'Register entity', status: 'running', logTail: 'registering…' },
    ],
    logs: [{ ts: new Date().toISOString(), level: 'info', message: 'Run started.' }],
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  } as ActionRun
}

describe('TemplateRunDetail', () => {
  it('renders an ordered step list with status badges and log tails', () => {
    const getRun = vi.fn().mockResolvedValue(null)
    render(<TemplateRunDetail initialRun={run()} getRun={getRun} />)

    expect(screen.getByText('Create repo')).toBeInTheDocument()
    expect(screen.getByText('Register entity')).toBeInTheDocument()
    expect(screen.getByText('Succeeded')).toBeInTheDocument()
    expect(screen.getAllByText('Running').length).toBeGreaterThan(0)
    expect(screen.getByText(/created https:\/\/github.com\/x\/y/)).toBeInTheDocument()
  })

  it('renders whole-run logs via RunLogs', () => {
    const getRun = vi.fn().mockResolvedValue(null)
    render(<TemplateRunDetail initialRun={run()} getRun={getRun} />)
    expect(screen.getByText('Run started.')).toBeInTheDocument()
  })

  it('renders output links as anchors, external links get rel=noopener noreferrer', () => {
    const getRun = vi.fn().mockResolvedValue(null)
    const withOutputs = run({
      status: 'succeeded',
      outputs: { links: [{ title: 'Repository', url: 'https://github.com/acme/my-svc' }] },
    })
    render(<TemplateRunDetail initialRun={withOutputs} getRun={getRun} />)

    const link = screen.getByRole('link', { name: 'Repository' })
    expect(link).toHaveAttribute('href', 'https://github.com/acme/my-svc')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'))
  })

  it('renders an entity output link pointing at /catalog/<id>', () => {
    const getRun = vi.fn().mockResolvedValue(null)
    const withOutputs = run({
      status: 'succeeded',
      outputs: { links: [{ title: 'Service entity', entity: 'entity-123' }] },
    })
    render(<TemplateRunDetail initialRun={withOutputs} getRun={getRun} />)

    const link = screen.getByRole('link', { name: 'Service entity' })
    expect(link).toHaveAttribute('href', '/catalog/entity-123')
  })

  it('refuses to render a javascript: url as a clickable link', () => {
    const getRun = vi.fn().mockResolvedValue(null)
    const withOutputs = run({
      status: 'succeeded',
      outputs: { links: [{ title: 'Malicious', url: 'javascript:alert(1)' }] },
    })
    render(<TemplateRunDetail initialRun={withOutputs} getRun={getRun} />)

    expect(screen.queryByRole('link', { name: 'Malicious' })).not.toBeInTheDocument()
    expect(screen.getByText('Malicious')).toBeInTheDocument()
  })

  it('shows ApprovalButtons when the run is awaiting-approval', () => {
    const getRun = vi.fn().mockResolvedValue(null)
    render(<TemplateRunDetail initialRun={run({ status: 'awaiting-approval' })} getRun={getRun} />)
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument()
  })

  it('does not show ApprovalButtons for a running run', () => {
    const getRun = vi.fn().mockResolvedValue(null)
    render(<TemplateRunDetail initialRun={run({ status: 'running' })} getRun={getRun} />)
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
  })

  it('reflects live updates from polling', async () => {
    const getRun = vi.fn().mockResolvedValue(run({ status: 'succeeded' }))
    render(<TemplateRunDetail initialRun={run({ status: 'running' })} getRun={getRun} />)

    await waitFor(() => expect(screen.getByText('Succeeded')).toBeInTheDocument())
  })
})
