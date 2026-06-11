import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'

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
import type { AgentEventDTO } from './lib/agent-event-dto'

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
})
