/**
 * Pure presentation helpers for the Initiatives UI (IDP refocus P2 — the Cortex
 * Initiatives model).
 *
 * Framework-light on purpose (mirrors ../scorecard-ui.ts): no 'use server', no
 * React, no Payload imports — so both server actions and client components can
 * import these. Keep every export side-effect free and unit-testable (see
 * initiative-ui.test.ts).
 */

import { passRatioTone } from '../scorecard-ui'

/** Initiative lifecycle states (mirrors Initiatives.status). */
export type InitiativeStatus = 'active' | 'completed' | 'cancelled'

/** Action-item states (mirrors InitiativeActionItems.status). */
export type ItemStatus = 'open' | 'in-progress' | 'done' | 'waived'

type DateInput = string | number | Date | null | undefined

/** Badge presentation: a shadcn <Badge> variant plus optional extra classes. */
export interface BadgePresentation {
  label: string
  variant: 'default' | 'secondary' | 'destructive' | 'outline'
  className?: string
}

const INITIATIVE_STATUS: Record<InitiativeStatus, BadgePresentation> = {
  active: { label: 'Active', variant: 'default' },
  completed: {
    label: 'Completed',
    variant: 'default',
    className: 'border-transparent bg-emerald-600 text-white hover:bg-emerald-600/90',
  },
  cancelled: { label: 'Cancelled', variant: 'outline', className: 'text-muted-foreground' },
}

/** Map an initiative status to a badge; unknown values render as a neutral chip. */
export function initiativeStatusPresentation(status: string): BadgePresentation {
  return INITIATIVE_STATUS[status as InitiativeStatus] ?? { label: status, variant: 'outline' }
}

const ITEM_STATUS: Record<ItemStatus, BadgePresentation> = {
  open: { label: 'Open', variant: 'outline', className: 'text-muted-foreground' },
  'in-progress': {
    label: 'In progress',
    variant: 'secondary',
    className: 'border-transparent bg-amber-100 text-amber-800',
  },
  done: {
    label: 'Done',
    variant: 'secondary',
    className: 'border-transparent bg-emerald-100 text-emerald-800',
  },
  waived: { label: 'Waived', variant: 'outline', className: 'text-muted-foreground line-through' },
}

/** Map an action-item status to a badge; unknown values render as a neutral chip. */
export function itemStatusPresentation(status: string): BadgePresentation {
  return ITEM_STATUS[status as ItemStatus] ?? { label: status, variant: 'outline' }
}

/** Human labels for the item-status <Select> (value → label), ladder order. */
export const ITEM_STATUS_OPTIONS: { value: ItemStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
  { value: 'waived', label: 'Waived' },
]

/**
 * True when `deadline` is strictly earlier than `now`. Pure past-check — callers
 * apply it only to *active* initiatives (a completed/cancelled campaign is never
 * flagged overdue). Returns false when no deadline is set.
 */
export function isOverdue(deadline: DateInput, now: Date): boolean {
  if (deadline == null) return false
  const t = new Date(deadline).getTime()
  if (Number.isNaN(t)) return false
  return t < now.getTime()
}

const DEADLINE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})

/** Short, TZ-stable deadline label ("Jul 2, 2026"), or "No deadline" when unset. */
export function formatDeadline(deadline: DateInput): string {
  if (deadline == null) return 'No deadline'
  const d = new Date(deadline)
  if (Number.isNaN(d.getTime())) return 'No deadline'
  return DEADLINE_FMT.format(d)
}

/**
 * Tailwind text tone for a completion percentage (0..100). Reuses the scorecard
 * pass-ratio thresholds so progress reads consistently across the two features.
 */
export function progressTone(pct: number): string {
  return passRatioTone(pct / 100)
}

/** Chip/label text for an initiative's target ladder level. */
export function targetLevelLabel(targetLevel?: string | null): string {
  const t = typeof targetLevel === 'string' ? targetLevel.trim() : ''
  return t ? `Target: ${t}` : 'No target level'
}

// ---------------------------------------------------------------------------
// View models
//
// The presentational contract the initiative components render against. Kept
// here (framework-light) so the components stay decoupled from the server
// actions; the pages import the real action return types (from
// lib/scorecards/initiatives.ts + the actions module) and pass them in. These
// mirror that contract structurally — any drift surfaces as a page tsc error.
// ---------------------------------------------------------------------------

/** Progress rollup for one initiative (mirrors computeInitiativeProgress). */
export interface InitiativeProgressView {
  total: number
  open: number
  inProgress: number
  done: number
  waived: number
  pctComplete: number
}

/** One initiative as rendered on the list page. */
export interface InitiativeSummaryView {
  id: string
  name: string
  scorecardName: string
  targetLevel?: string | null
  status: string
  deadline?: string | null
  ownerName?: string | null
  progress: InitiativeProgressView
}

/** One action item, enriched for the detail table. */
export interface ActionItemView {
  id: string
  entityId: string
  entityName: string
  entityKind?: string | null
  ruleId?: string | null
  ruleTitle?: string | null
  ruleLevel?: string | null
  status: string
  assigneeId?: string | null
  assigneeName?: string | null
  notes?: string | null
  updatedAt?: string | null
}

/** Full initiative detail: header fields, progress + enriched items. */
export interface InitiativeDetailView {
  id: string
  name: string
  description?: string | null
  scorecardId: string
  scorecardName: string
  targetLevel?: string | null
  status: string
  deadline?: string | null
  ownerName?: string | null
  progress: InitiativeProgressView
  items: ActionItemView[]
}

/** A scorecard option for the create form's picker (mirrors listScorecardOptions). */
export interface ScorecardOption {
  id: string
  name: string
  levels: { name: string; rank: number }[]
}
