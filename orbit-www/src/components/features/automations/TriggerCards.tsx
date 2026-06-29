'use client'

import { Activity, Boxes, Clock, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Automation } from '@/payload-types'

export type EventValue = Automation['trigger']['event']

interface TriggerOption {
  value: EventValue
  label: string
  description: string
  icon: LucideIcon
}

/**
 * Trigger catalog. The stored enum values are fixed (`rule-result-changed`,
 * `entity-changed`, `schedule`); only the display labels/copy are author-facing.
 */
const TRIGGERS: ReadonlyArray<TriggerOption> = [
  {
    value: 'rule-result-changed',
    label: 'A scorecard check changes',
    description:
      'Runs when a service starts passing or failing a scorecard rule — e.g. when it drifts out of compliance.',
    icon: Activity,
  },
  {
    value: 'entity-changed',
    label: 'A catalog entity changes',
    description: 'Runs when a service, API, or other catalog entity is created or updated.',
    icon: Boxes,
  },
  {
    value: 'schedule',
    label: 'On a schedule',
    description:
      'Runs on a repeating schedule. No triggering event, so inputs use literal values.',
    icon: Clock,
  },
]

/**
 * Trigger picker rendered as a small radiogroup of bordered cards. `onChange`
 * carries the dependent-state reset in the parent (clearing filter conditions,
 * re-seeding defaults) — it is invoked from the click handler, never an effect,
 * so edit-mode hydration is not wiped on first render.
 */
export function TriggerCards({
  value,
  onChange,
}: {
  value: EventValue
  onChange: (next: EventValue) => void
}) {
  return (
    <div role="radiogroup" aria-label="Trigger" className="grid gap-2 sm:grid-cols-3">
      {TRIGGERS.map((opt) => {
        const selected = opt.value === value
        const Icon = opt.icon
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={cn(
              'flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-colors',
              'hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected ? 'border-primary ring-1 ring-primary' : 'border-border',
            )}
          >
            <Icon className={cn('h-5 w-5', selected ? 'text-primary' : 'text-muted-foreground')} />
            <span className="text-sm font-medium leading-tight">{opt.label}</span>
            <span className="text-xs text-muted-foreground">{opt.description}</span>
          </button>
        )
      })}
    </div>
  )
}
