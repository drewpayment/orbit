// Derive the five-phase timeline (Inspect → Plan → Approval → Execute → Verify)
// from the current run state. Used by <PhaseTimeline>.

export type PhaseKey = 'inspect' | 'plan' | 'approve' | 'execute' | 'verify'

export interface Phase {
  key: PhaseKey
  label: string
  status: 'done' | 'active' | 'pending'
}

interface DerivePhasesInput {
  status: string
  toolTurnCount: number
  proposalSeen: boolean
  approvalOpen: boolean
  approvalResolved: boolean
  executingToolCount: number
}

const TERMINAL_STATUSES = new Set(['completed', 'aborted', 'failed', 'timeout'])

// The phase model is intentionally coarse so it always lights up
// somewhere — even runs that never reach a proposal still show
// progress through Inspect.
export function derivePhases(input: DerivePhasesInput): Phase[] {
  const { status, toolTurnCount, proposalSeen, approvalOpen, approvalResolved, executingToolCount } =
    input

  const terminal = TERMINAL_STATUSES.has(status)

  const phases: Phase[] = [
    { key: 'inspect', label: 'Inspect', status: 'pending' },
    { key: 'plan', label: 'Plan', status: 'pending' },
    { key: 'approve', label: 'Approval', status: 'pending' },
    { key: 'execute', label: 'Execute', status: 'pending' },
    { key: 'verify', label: 'Verify', status: 'pending' },
  ]

  // Inspect — any tool call counts.
  if (toolTurnCount > 0) phases[0].status = 'done'

  // Plan — proposal received.
  if (proposalSeen) phases[1].status = 'done'

  // Approval — open gate makes this active; resolved makes it done.
  if (approvalOpen) {
    phases[2].status = 'active'
  } else if (approvalResolved) {
    phases[2].status = 'done'
  }

  // Execute — any tool calls *after* an approval was resolved.
  if (approvalResolved && executingToolCount > 0) {
    phases[3].status = 'active'
  }

  // Verify / terminal handling.
  if (terminal) {
    for (const p of phases) if (p.status !== 'done') p.status = 'done'
    if (status === 'completed') {
      phases[4].status = 'done'
    }
  }

  // If nothing is active yet (e.g. just starting), make Inspect active.
  if (!phases.some((p) => p.status === 'active' || p.status === 'done')) {
    phases[0].status = 'active'
  } else if (!phases.some((p) => p.status === 'active') && !terminal) {
    // Otherwise, the next pending phase after the last `done` is active.
    const lastDoneIdx = phases.reduce((acc, p, i) => (p.status === 'done' ? i : acc), -1)
    if (lastDoneIdx + 1 < phases.length) {
      phases[lastDoneIdx + 1].status = 'active'
    }
  }

  return phases
}
