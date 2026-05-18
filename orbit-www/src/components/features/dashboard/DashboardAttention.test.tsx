import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { DashboardAttention } from './DashboardAttention'
import type { AttentionRun } from './DashboardAttention'

const baseRun: AttentionRun = {
  id: 'agent-bdecb2b4',
  kind: 'awaiting',
  title: 'deploy verofront app to render.com',
  workspace: 'Dogfood Test',
  app: 'verofront',
  startedRel: '2m ago',
  elapsed: '2m 14s',
  lastThought: 'Ready to create the static_site service — needs a build command and 1 secret.',
  phases: [
    { key: 'inspect', label: 'Inspect', status: 'done' },
    { key: 'plan', label: 'Plan', status: 'done' },
    { key: 'approve', label: 'Approval', status: 'active' },
    { key: 'execute', label: 'Execute', status: 'pending' },
    { key: 'verify', label: 'Verify', status: 'pending' },
  ],
  href: '/workspaces/dogfood-test/infra-agent/agent-bdecb2b4',
}

describe('DashboardAttention', () => {
  afterEach(() => { cleanup() })

  it('should render nothing when there are no runs', () => {
    const { container } = render(<DashboardAttention runs={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('should render run title, workspace, and app metadata', () => {
    render(<DashboardAttention runs={[baseRun]} />)
    expect(screen.getByText(/deploy verofront app to render\.com/)).toBeInTheDocument()
    expect(screen.getByText('Dogfood Test')).toBeInTheDocument()
    expect(screen.getByText('verofront')).toBeInTheDocument()
  })

  it('should render mini phase timeline labels', () => {
    render(<DashboardAttention runs={[baseRun]} />)
    expect(screen.getByText('Inspect')).toBeInTheDocument()
    expect(screen.getByText('Plan')).toBeInTheDocument()
    expect(screen.getByText('Approval')).toBeInTheDocument()
    expect(screen.getByText('Execute')).toBeInTheDocument()
    expect(screen.getByText('Verify')).toBeInTheDocument()
  })

  it('should show the awaiting CTA when awaiting input', () => {
    render(<DashboardAttention runs={[baseRun]} />)
    expect(screen.getByRole('link', { name: /Review & approve/i })).toBeInTheDocument()
  })

  it('should show the running CTA when not awaiting input', () => {
    render(
      <DashboardAttention
        runs={[{ ...baseRun, kind: 'running', phases: baseRun.phases.map((p) => p.key === 'execute' ? { ...p, status: 'active' } : p) }]}
      />,
    )
    expect(screen.getByRole('link', { name: /Open run/i })).toBeInTheDocument()
  })

  it('should render the latest thought block', () => {
    render(<DashboardAttention runs={[baseRun]} />)
    expect(screen.getByText('Latest thought')).toBeInTheDocument()
    expect(screen.getByText(/Ready to create the static_site service/)).toBeInTheDocument()
  })
})
