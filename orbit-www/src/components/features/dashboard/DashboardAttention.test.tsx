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
        runs={[{ ...baseRun, kind: 'running', phases: (baseRun.phases ?? []).map((p) => p.key === 'execute' ? { ...p, status: 'active' } : p) }]}
      />,
    )
    expect(screen.getByRole('link', { name: /Open run/i })).toBeInTheDocument()
  })

  it('should render the latest thought block', () => {
    render(<DashboardAttention runs={[baseRun]} />)
    expect(screen.getByText('Latest thought')).toBeInTheDocument()
    expect(screen.getByText(/Ready to create the static_site service/)).toBeInTheDocument()
  })

  it('should not render a model line when model is omitted', () => {
    render(<DashboardAttention runs={[baseRun]} />)
    expect(screen.queryByText('claude-opus-4-7')).not.toBeInTheDocument()
  })

  it('should render the model line when model is explicitly passed', () => {
    render(<DashboardAttention runs={[{ ...baseRun, model: 'claude-sonnet-5' }]} />)
    expect(screen.getByText('claude-sonnet-5')).toBeInTheDocument()
  })

  describe('approval variant', () => {
    const approvalRun: AttentionRun = {
      id: 'pa-1234',
      kind: 'approval',
      title: 'Register kafka-orders-v2 topic pattern',
      workspace: 'Dogfood Test',
      startedRel: '5m ago',
      href: '/platform/approvals',
    }

    it('should show the "Needs approval" pill', () => {
      render(<DashboardAttention runs={[approvalRun]} />)
      expect(screen.getByText('Needs approval')).toBeInTheDocument()
    })

    it('should show the Review & approve CTA', () => {
      render(<DashboardAttention runs={[approvalRun]} />)
      expect(screen.getByRole('link', { name: /Review & approve/i })).toBeInTheDocument()
    })

    it('should render title and workspace', () => {
      render(<DashboardAttention runs={[approvalRun]} />)
      expect(screen.getByText(/Register kafka-orders-v2 topic pattern/)).toBeInTheDocument()
      expect(screen.getByText('Dogfood Test')).toBeInTheDocument()
    })
  })

  describe('optional props omitted', () => {
    const minimalRun: AttentionRun = {
      id: 'run-min',
      kind: 'running',
      title: 'Sync repository metadata',
      workspace: 'Dogfood Test',
      startedRel: '1m ago',
      href: '/agent',
    }

    it('should render without crashing when phases, lastThought, elapsed, app, and model are omitted', () => {
      render(<DashboardAttention runs={[minimalRun]} />)
      expect(screen.getByText(/Sync repository metadata/)).toBeInTheDocument()
    })

    it('should not render the "Latest thought" section when lastThought is omitted', () => {
      render(<DashboardAttention runs={[minimalRun]} />)
      expect(screen.queryByText('Latest thought')).not.toBeInTheDocument()
    })

    it('should not render an app row when app is omitted', () => {
      render(<DashboardAttention runs={[minimalRun]} />)
      expect(screen.queryByText('verofront')).not.toBeInTheDocument()
    })

    it('should not render elapsed time when elapsed is omitted', () => {
      render(<DashboardAttention runs={[minimalRun]} />)
      expect(screen.queryByText(/elapsed/)).not.toBeInTheDocument()
    })

    it('should still render the started-ago label without elapsed', () => {
      render(<DashboardAttention runs={[minimalRun]} />)
      expect(screen.getByText(/Started 1m ago/)).toBeInTheDocument()
    })
  })
})
