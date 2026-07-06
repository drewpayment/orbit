import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
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

describe('DashboardAttention — hub (2+ items)', () => {
  const awaitingRun: AttentionRun = {
    id: 'run-await',
    kind: 'awaiting',
    title: 'Awaiting deploy',
    workspace: 'Dogfood Test',
    startedRel: '2m ago',
    href: '/agent',
  }
  const approvalRun: AttentionRun = {
    id: 'appr-1',
    kind: 'approval',
    title: 'Approve topic pattern',
    workspace: 'Dogfood Test',
    startedRel: '5m ago',
    href: '/platform/approvals',
  }
  const runningRun: AttentionRun = {
    id: 'run-going',
    kind: 'running',
    title: 'Running sync job',
    workspace: 'Dogfood Test',
    startedRel: '1m ago',
    href: '/agent',
  }

  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('should render a single rich card (no hub chrome) for exactly one item', () => {
    render(<DashboardAttention runs={[approvalRun]} />)
    expect(screen.queryByText('Needs your attention')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /attention panel/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /promote to spotlight/i })).not.toBeInTheDocument()
  })

  it('should consolidate 2+ items into one hub panel with a header', () => {
    render(<DashboardAttention runs={[approvalRun, runningRun]} />)
    expect(screen.getByText('Needs your attention')).toBeInTheDocument()
  })

  it('should pick the highest-priority item as the spotlight (awaiting > approval > running)', () => {
    render(<DashboardAttention runs={[runningRun, approvalRun, awaitingRun]} />)
    // Non-spotlight items are promote buttons; the awaiting spotlight is not.
    const promotes = screen.getAllByRole('button', { name: /promote to spotlight/i })
    expect(promotes).toHaveLength(2)
    expect(screen.getByRole('button', { name: /Approve topic pattern.*promote to spotlight/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Running sync job.*promote to spotlight/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Awaiting deploy.*promote to spotlight/i })).not.toBeInTheDocument()
  })

  it('should show a per-kind count summary joined by ·, omitting zero kinds', () => {
    render(<DashboardAttention runs={[runningRun, approvalRun, awaitingRun]} />)
    expect(screen.getByText('1 approval · 1 awaiting input · 1 running')).toBeInTheDocument()
  })

  it('should swap the spotlight when a queue row is clicked', async () => {
    const user = userEvent.setup()
    render(<DashboardAttention runs={[approvalRun, awaitingRun, runningRun]} />)
    // awaiting is spotlight; approval + running are queue rows.
    await user.click(screen.getByRole('button', { name: /Approve topic pattern.*promote to spotlight/i }))
    // approval is now spotlight (no longer a promote button); awaiting drops into the queue.
    expect(screen.queryByRole('button', { name: /Approve topic pattern.*promote to spotlight/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Awaiting deploy.*promote to spotlight/i })).toBeInTheDocument()
  })

  it('should toggle collapse, reflecting aria-expanded and hiding the queue', async () => {
    const user = userEvent.setup()
    render(<DashboardAttention runs={[approvalRun, runningRun]} />)
    const toggle = screen.getByRole('button', { name: /collapse attention panel/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await user.click(toggle)
    const expandToggle = screen.getByRole('button', { name: /expand attention panel/i })
    expect(expandToggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: /promote to spotlight/i })).not.toBeInTheDocument()
  })

  it('should restore the persisted collapsed state from localStorage', async () => {
    window.localStorage.setItem('orbit.attentionHub.collapsed', 'true')
    window.localStorage.setItem('orbit.attentionHub.seenIds', JSON.stringify(['appr-1', 'run-going']))
    render(<DashboardAttention runs={[approvalRun, runningRun]} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /expand attention panel/i })).toHaveAttribute('aria-expanded', 'false'),
    )
  })

  it('should auto-expand when a new (unseen) item id appears even if persisted collapsed', async () => {
    window.localStorage.setItem('orbit.attentionHub.collapsed', 'true')
    window.localStorage.setItem('orbit.attentionHub.seenIds', JSON.stringify(['some-old-id']))
    render(<DashboardAttention runs={[approvalRun, runningRun]} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /collapse attention panel/i })).toHaveAttribute('aria-expanded', 'true'),
    )
  })

  it('should persist the collapse state to localStorage when toggled', async () => {
    const user = userEvent.setup()
    render(<DashboardAttention runs={[approvalRun, runningRun]} />)
    await user.click(screen.getByRole('button', { name: /collapse attention panel/i }))
    await waitFor(() => expect(window.localStorage.getItem('orbit.attentionHub.collapsed')).toBe('true'))
  })

  it('should cap the queue at 4 rows and reveal the rest via "Show N more"', async () => {
    const user = userEvent.setup()
    const many: AttentionRun[] = [
      awaitingRun,
      approvalRun,
      runningRun,
      { ...runningRun, id: 'r2', title: 'Run two' },
      { ...runningRun, id: 'r3', title: 'Run three' },
      { ...runningRun, id: 'r4', title: 'Run four' },
    ]
    render(<DashboardAttention runs={many} />)
    // 6 items → 1 spotlight + 5 queue → 4 visible, 1 hidden.
    expect(screen.getAllByRole('button', { name: /promote to spotlight/i })).toHaveLength(4)
    await user.click(screen.getByRole('button', { name: /show 1 more/i }))
    expect(screen.getAllByRole('button', { name: /promote to spotlight/i })).toHaveLength(5)
  })

  it('should show overflow footer links only when totals exceed fetched counts', () => {
    render(<DashboardAttention runs={[approvalRun, runningRun]} approvalsTotal={5} runsTotal={5} />)
    expect(screen.getByRole('link', { name: /view all approvals/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /view all runs/i })).toBeInTheDocument()
  })

  it('should not show overflow footer links when totals equal fetched counts', () => {
    render(<DashboardAttention runs={[approvalRun, runningRun]} approvalsTotal={1} runsTotal={1} />)
    expect(screen.queryByRole('link', { name: /view all approvals/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /view all runs/i })).not.toBeInTheDocument()
  })

  it('should expose an accessible deep-link affordance per queue row', () => {
    render(<DashboardAttention runs={[awaitingRun, approvalRun, runningRun]} />)
    expect(screen.getByRole('link', { name: /open Approve topic pattern/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open Running sync job/i })).toBeInTheDocument()
  })

  it('should keep queue rows keyboard-operable for promotion', async () => {
    const user = userEvent.setup()
    render(<DashboardAttention runs={[awaitingRun, approvalRun, runningRun]} />)
    const approvalRow = screen.getByRole('button', { name: /Approve topic pattern.*promote to spotlight/i })
    approvalRow.focus()
    await user.keyboard('{Enter}')
    // approval is promoted to spotlight, so its promote button is gone.
    expect(screen.queryByRole('button', { name: /Approve topic pattern.*promote to spotlight/i })).not.toBeInTheDocument()
  })
})
