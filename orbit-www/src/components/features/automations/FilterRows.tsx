'use client'

import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { EventValue } from './TriggerCards'

/** A guided filter field: a friendly label bound to a dotted event path. */
export interface FilterFieldDef {
  path: string
  label: string
  /** When present the value is chosen from a Select; otherwise free Input. */
  options?: { value: string; label: string }[]
}

/** A single guided condition (`path` is/equals `value`). */
export interface GuidedCondition {
  path: string
  value: string
}

/** A raw escape-hatch condition (advanced authors / unknown paths). */
export interface RawRow {
  key: string
  value: string
}

/**
 * Per-trigger field catalog. Schedule events carry no entity/rule fields, so
 * they have no guided filter (the section is hidden for `schedule`). Keep the
 * dotted paths in sync with the event shapes in `lib/automations/events.ts`.
 */
export const FILTER_FIELDS: Record<Exclude<EventValue, 'schedule'>, FilterFieldDef[]> = {
  'rule-result-changed': [
    {
      path: 'transition',
      label: 'Transition',
      options: [
        { value: 'drift', label: 'Drift (started failing)' },
        { value: 'recovery', label: 'Recovery (started passing)' },
        { value: 'initial', label: 'Initial result' },
        { value: 'unchanged', label: 'Unchanged' },
      ],
    },
    {
      path: 'passed',
      label: 'Passed',
      options: [
        { value: 'true', label: 'Passing' },
        { value: 'false', label: 'Failing' },
      ],
    },
    { path: 'entity.kind', label: 'Entity kind' },
    { path: 'entity.lifecycle', label: 'Lifecycle' },
    { path: 'rule.title', label: 'Rule title' },
    { path: 'scorecard.name', label: 'Scorecard' },
  ],
  'entity-changed': [
    {
      path: 'operation',
      label: 'Change type',
      options: [
        { value: 'create', label: 'Created' },
        { value: 'update', label: 'Updated' },
      ],
    },
    { path: 'entity.kind', label: 'Entity kind' },
    { path: 'entity.lifecycle', label: 'Lifecycle' },
  ],
}

/**
 * Guided, trigger-aware filter editor. Each row is `[ Field ▾ ] is [ value ]`,
 * AND-ed. Known fields come from `fields`; unknown paths (or power users) drop
 * to the raw key/value escape hatch below. Hidden entirely for the schedule
 * trigger by the parent.
 */
export function FilterRows({
  fields,
  conditions,
  setConditions,
  advancedRows,
  setAdvancedRows,
}: {
  fields: FilterFieldDef[]
  conditions: GuidedCondition[]
  setConditions: (next: GuidedCondition[]) => void
  advancedRows: RawRow[]
  setAdvancedRows: (next: RawRow[]) => void
}) {
  const updateCond = (i: number, patch: Partial<GuidedCondition>) =>
    setConditions(conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  const updateRow = (i: number, patch: Partial<RawRow>) =>
    setAdvancedRows(advancedRows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))

  const fieldFor = (path: string) => fields.find((f) => f.path === path)

  return (
    <div className="space-y-2">
      {conditions.map((cond, i) => {
        const def = fieldFor(cond.path)
        return (
          <div key={i} className="flex items-center gap-2">
            <Select value={cond.path} onValueChange={(v) => updateCond(i, { path: v, value: '' })}>
              <SelectTrigger className="w-[40%]" aria-label="Field">
                <SelectValue placeholder="Field" />
              </SelectTrigger>
              <SelectContent>
                {fields.map((f) => (
                  <SelectItem key={f.path} value={f.path}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">is</span>
            {def?.options ? (
              <Select value={cond.value} onValueChange={(v) => updateCond(i, { value: v })}>
                <SelectTrigger className="flex-1" aria-label="Value">
                  <SelectValue placeholder="value" />
                </SelectTrigger>
                <SelectContent>
                  {def.options.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={cond.value}
                onChange={(e) => updateCond(i, { value: e.target.value })}
                placeholder="value"
                className="flex-1"
                aria-label="Value"
              />
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setConditions(conditions.filter((_, idx) => idx !== i))}
              aria-label="Remove condition"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )
      })}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setConditions([...conditions, { path: fields[0]?.path ?? '', value: '' }])}
      >
        <Plus className="h-4 w-4" /> Add condition
      </Button>

      {/* Advanced escape hatch: raw dotted-path → value for unknown paths. */}
      {advancedRows.length > 0 && (
        <div className="space-y-2 border-l pl-3">
          <p className="text-xs text-muted-foreground">Advanced conditions (raw event path)</p>
          {advancedRows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={row.key}
                onChange={(e) => updateRow(i, { key: e.target.value })}
                placeholder="event path (e.g. entity.tier)"
                className="flex-1"
                aria-label="Advanced field"
              />
              <span className="text-sm text-muted-foreground">is</span>
              <Input
                value={row.value}
                onChange={(e) => updateRow(i, { value: e.target.value })}
                placeholder="value"
                className="flex-1"
                aria-label="Advanced value"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setAdvancedRows(advancedRows.filter((_, idx) => idx !== i))}
                aria-label="Remove advanced condition"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => setAdvancedRows([...advancedRows, { key: '', value: '' }])}
        >
          <Plus className="h-4 w-4" /> Add a custom condition (advanced)
        </Button>
        <p className="pl-2 text-xs text-muted-foreground">
          Match any event field by its raw path.
        </p>
      </div>
    </div>
  )
}
