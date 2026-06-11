import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react'

// The server actions are async server functions; stub them so the client
// component imports cleanly under jsdom.
vi.mock('@/app/actions/infra-agent', () => ({
  abortAgentRun: vi.fn(),
  approveAgentAction: vi.fn(),
  approveAgentActionWithEdits: vi.fn(),
  rejectAgentAction: vi.fn(),
  sendAgentMessage: vi.fn(),
  sendReviewerMessage: vi.fn(),
}))

import { AgentChatThread } from './AgentChatThread'
import { abortAgentRun } from '@/app/actions/infra-agent'
import type { AgentEventDTO } from './lib/agent-event-dto'

const RUN_CONTEXT = {
  title: 'Test run',
  startedAtIso: '2024-01-01T00:00:00.000Z',
  workspaceName: 'Engineering',
}

// ── EventSource test double ───────────────────────────────────────────────
class FakeEventSource {
  static instances: FakeEventSource[] = []
  url: string
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  listeners: Record<string, Array<() => void>> = {}
  closed = false

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }
  addEventListener(type: string, cb: () => void) {
    ;(this.listeners[type] ??= []).push(cb)
  }
  emit(type: string) {
    for (const cb of this.listeners[type] ?? []) cb()
  }
  close() {
    this.closed = true
  }
}

function turn(sequence: string, turnId: string, role: string, content: string): AgentEventDTO {
  return { sequence, emittedAt: '2024-01-01T00:00:00.000Z', kind: 'conversation_turn', conversationTurn: { turnId, role, content } }
}

describe('AgentChatThread', () => {
  beforeEach(() => {
    FakeEventSource.instances = []
    ;(globalThis as any).EventSource = FakeEventSource as any
    // jsdom doesn't implement Element.scrollTo; the auto-scroll effect calls it.
    if (!('scrollTo' in Element.prototype)) {
      ;(Element.prototype as any).scrollTo = () => {}
    }
    // jsdom has no IntersectionObserver; the header-visibility effect (active
    // when a run `context` is rendered) constructs one.
    ;(globalThis as any).IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return []
      }
    }
  })
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders initial events and opens SSE resuming from the max sequence', () => {
    render(
      <AgentChatThread
        workspaceId="ws1"
        workflowId="wf-1"
        initialStatus="running"
        initialEvents={[turn('3', 't1', 'user', 'deploy please'), turn('5', 't2', 'assistant', 'on it')]}
      />,
    )

    expect(screen.getByText('deploy please')).toBeInTheDocument()
    expect(screen.getByText('on it')).toBeInTheDocument()

    // SSE opened once, resuming after the highest persisted sequence (5).
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.instances[0].url).toContain('/api/agent/wf-1/stream?since=5')
  })

  it('keeps a terminal SSR run terminal even when backfill ends in a non-terminal status_update (BUG-1)', () => {
    // Repro of agent-qa-synthetic-2: Mongo status=failed, but the persisted
    // transcript's last status_update says "running". The replayed status
    // must NOT downgrade the effective terminal state.
    render(
      <AgentChatThread
        workspaceId="ws1"
        workflowId="wf-1"
        initialStatus="failed"
        initialEvents={[
          turn('1', 't1', 'user', 'go'),
          {
            sequence: '2',
            emittedAt: '2024-01-01T00:00:00.000Z',
            kind: 'status_update',
            statusUpdate: { status: 'running', message: '' },
          },
        ]}
      />,
    )

    // No live connection for a terminal run.
    expect(FakeEventSource.instances).toHaveLength(0)
    // Composer reflects the ended state (not enabled/awaiting).
    expect(screen.getByPlaceholderText(/Run finished/i)).toBeInTheDocument()
    // No live/connecting/reconnecting badge.
    expect(screen.queryByText(/connecting…|reconnecting…/i)).not.toBeInTheDocument()
  })

  it('does not open SSE when the run is already terminal', () => {
    render(
      <AgentChatThread
        workspaceId="ws1"
        workflowId="wf-1"
        initialStatus="completed"
        initialEvents={[turn('1', 't1', 'user', 'all done?')]}
      />,
    )

    expect(screen.getByText('all done?')).toBeInTheDocument()
    expect(FakeEventSource.instances).toHaveLength(0)
    // Composer reflects the ended state.
    expect(screen.getByPlaceholderText(/Run finished/i)).toBeInTheDocument()
  })

  it('shows the saved-history banner and ends the run on a `gone` event', () => {
    render(
      <AgentChatThread
        workspaceId="ws1"
        workflowId="wf-1"
        initialStatus="running"
        initialEvents={[turn('1', 't1', 'user', 'hi')]}
      />,
    )

    expect(FakeEventSource.instances).toHaveLength(1)
    expect(screen.queryByText(/showing saved history/i)).not.toBeInTheDocument()

    act(() => {
      FakeEventSource.instances[0].emit('gone')
    })

    expect(screen.getByText(/showing saved history/i)).toBeInTheDocument()
    expect(FakeEventSource.instances[0].closed).toBe(true)
    // Run is now treated as ended → composer disabled.
    expect(screen.getByPlaceholderText(/Run finished/i)).toBeInTheDocument()
  })

  it('ingests duplicate sequences only once', () => {
    render(
      <AgentChatThread
        workspaceId="ws1"
        workflowId="wf-1"
        initialStatus="running"
        initialEvents={[turn('1', 't1', 'user', 'hello world')]}
      />,
    )

    const es = FakeEventSource.instances[0]
    // Replay the same persisted event over the stream — it must not duplicate.
    act(() => {
      es.onmessage?.({ data: JSON.stringify(turn('1', 't1', 'user', 'hello world')) })
    })

    expect(screen.getAllByText('hello world')).toHaveLength(1)
  })

  it('surfaces an inline error when Abort fails (BUG-3)', async () => {
    ;(abortAgentRun as any).mockResolvedValue({ success: false, error: 'workflow not found' })

    render(
      <AgentChatThread
        workspaceId="ws1"
        workflowId="wf-1"
        initialStatus="running"
        context={RUN_CONTEXT}
        initialEvents={[turn('1', 't1', 'user', 'go')]}
      />,
    )

    // Abort buttons live in the RunHeader and FloatingStatusBar; either click
    // routes to the same onAbort handler.
    const abortBtn = screen.getAllByRole('button', { name: /abort/i })[0]
    fireEvent.click(abortBtn)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/workflow not found/i)
    })
    expect(abortAgentRun).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      workflowId: 'wf-1',
      reason: 'user requested abort',
    })
  })

  it('treats a clean stream close (`done`) as ended — composer disabled', () => {
    render(
      <AgentChatThread
        workspaceId="ws1"
        workflowId="wf-1"
        initialStatus="running"
        initialEvents={[turn('1', 't1', 'user', 'go')]}
      />,
    )

    // Live initially: composer is enabled (not the ended placeholder).
    expect(screen.queryByPlaceholderText(/Run finished/i)).not.toBeInTheDocument()

    act(() => {
      FakeEventSource.instances[0].emit('done')
    })

    // Stream ended without an explicit terminal status_update → ended state.
    expect(screen.getByPlaceholderText(/Run finished/i)).toBeInTheDocument()
  })
})
