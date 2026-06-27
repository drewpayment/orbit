/**
 * Pure presentation helpers for the Self-Service Actions UI (IDP refocus P3).
 *
 * Framework-light: no 'use server', no React state — just lucide icon *types*
 * and plain maps — so both the server catalog page and the client components
 * (cards, dialog, tables, badges) can import these. Keep everything here pure
 * and unit-testable (see action-ui.test.ts).
 */

import type { LucideIcon } from 'lucide-react'
import {
  Wrench,
  Webhook,
  LayoutTemplate,
  GitBranch,
  Rocket,
  Radio,
  Sparkles,
  Play,
} from 'lucide-react'
import type { Action, ActionRun } from '@/payload-types'

export type ActionBackendType = Action['backend']['type']
export type RunStatus = ActionRun['status']

/** Human label for an Action's backend executor. */
export const BACKEND_TYPE_LABEL: Record<ActionBackendType, string> = {
  builtin: 'Built-in',
  webhook: 'Webhook',
  'temporal-template': 'Template',
  'temporal-pattern': 'Pattern',
  'temporal-launch': 'Launch',
  'kafka-provision': 'Kafka topic',
  agent: 'Agent',
}

export function backendTypeLabel(type: string): string {
  return BACKEND_TYPE_LABEL[type as ActionBackendType] ?? type
}

/** Leading icon for an Action card / dialog, keyed off the backend type. */
export const BACKEND_TYPE_ICON: Record<ActionBackendType, LucideIcon> = {
  builtin: Wrench,
  webhook: Webhook,
  'temporal-template': LayoutTemplate,
  'temporal-pattern': GitBranch,
  'temporal-launch': Rocket,
  'kafka-provision': Radio,
  agent: Sparkles,
}

export function backendTypeIcon(type: string): LucideIcon {
  return BACKEND_TYPE_ICON[type as ActionBackendType] ?? Play
}

/** Human label for an Action's approval policy. `none` returns null (no badge). */
export const APPROVAL_POLICY_LABEL: Record<string, string> = {
  none: 'No approval',
  'workspace-admin': 'Workspace approval',
  'platform-admin': 'Platform approval',
}

export function approvalPolicyLabel(policy: string | null | undefined): string | null {
  if (!policy || policy === 'none') return null
  return APPROVAL_POLICY_LABEL[policy] ?? policy
}

export interface StatusPresentation {
  label: string
  /** Tailwind classes for an outline Badge. */
  className: string
}

/**
 * Status → badge presentation for an Action Run. Mirrors the run lifecycle
 * pending → awaiting-approval → running → succeeded|failed.
 */
export const RUN_STATUS_PRESENTATION: Record<RunStatus, StatusPresentation> = {
  pending: {
    label: 'Pending',
    className: 'border-border bg-transparent text-muted-foreground',
  },
  'awaiting-approval': {
    label: 'Awaiting approval',
    className: 'border-amber-500/25 bg-amber-500/15 text-amber-600 dark:text-amber-400',
  },
  running: {
    label: 'Running',
    className: 'border-blue-500/25 bg-blue-500/15 text-blue-600 dark:text-blue-400 animate-pulse',
  },
  succeeded: {
    label: 'Succeeded',
    className: 'border-green-500/25 bg-green-500/15 text-green-600 dark:text-green-400',
  },
  failed: {
    label: 'Failed',
    className: 'border-red-500/25 bg-red-500/15 text-red-600 dark:text-red-400',
  },
}

export function runStatusPresentation(status: string): StatusPresentation {
  return (
    RUN_STATUS_PRESENTATION[status as RunStatus] ?? {
      label: status,
      className: 'border-border bg-muted text-muted-foreground',
    }
  )
}

/** Human label for a run trigger. */
export function triggerLabel(trigger: string | null | undefined): string {
  return trigger === 'automation' ? 'Automation' : 'Manual'
}

/** Compact relative time (e.g. "5m ago"), falling back to a locale date. */
export function formatRelativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return '—'
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000)
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}
