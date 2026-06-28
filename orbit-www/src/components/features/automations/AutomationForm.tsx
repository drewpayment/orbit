'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Automation } from '@/payload-types'
import {
  createAutomation,
  updateAutomation,
  type AutomationFormValues,
} from '@/app/(frontend)/automations/actions'

type EventValue = Automation['trigger']['event']

const EVENT_OPTIONS: ReadonlyArray<{ value: EventValue; label: string; hint: string }> = [
  {
    value: 'rule-result-changed',
    label: 'Scorecard rule result changed',
    hint: 'Fires when a rule flips pass/fail. Filter on transition=drift for drift detection.',
  },
  {
    value: 'entity-changed',
    label: 'Catalog entity changed',
    hint: 'Fires when a catalog entity is created or updated.',
  },
  {
    value: 'schedule',
    label: 'Schedule (cron)',
    hint: 'Runs on a cron schedule. Execution by the scheduled worker is deferred.',
  },
]

interface WorkspaceOption {
  id: string
  name: string
}
interface ActionOption {
  id: string
  name: string
  /** Required inputs on this action; each must be mapped before saving. */
  requiredInputs?: { name: string; label: string }[]
}

interface Row {
  key: string
  value: string
}

export interface AutomationFormCreate {
  mode: 'create'
  workspaces: WorkspaceOption[]
  /** Enabled actions keyed by workspace id. */
  actionsByWorkspace: Record<string, ActionOption[]>
}
export interface AutomationFormEdit {
  mode: 'edit'
  automationId: string
  initial: {
    name: string
    description?: string | null
    event: EventValue
    filter?: Record<string, unknown> | null
    schedule?: string | null
    actionId?: string | null
    inputMapping?: Record<string, unknown> | null
    enabled: boolean
    actions: ActionOption[]
  }
}
type Props = AutomationFormCreate | AutomationFormEdit

/** Object → editable rows; preserves insertion order. */
function toRows(obj: Record<string, unknown> | null | undefined): Row[] {
  if (!obj) return []
  return Object.entries(obj).map(([key, value]) => ({
    key,
    value: typeof value === 'string' ? value : JSON.stringify(value),
  }))
}

/** Filter rows → object with light type coercion (true/false/number/string). */
function rowsToFilter(rows: Row[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const { key, value } of rows) {
    const k = key.trim()
    if (!k) continue
    const v = value.trim()
    if (v === 'true') out[k] = true
    else if (v === 'false') out[k] = false
    else if (v !== '' && /^-?\d+(\.\d+)?$/.test(v)) out[k] = Number(v)
    else out[k] = value
  }
  return out
}

/** Mapping rows → object (values stay strings; they may be templates). */
function rowsToMapping(rows: Row[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const { key, value } of rows) {
    const k = key.trim()
    if (k) out[k] = value
  }
  return out
}

function RowEditor({
  rows,
  setRows,
  keyPlaceholder,
  valuePlaceholder,
  addLabel,
}: {
  rows: Row[]
  setRows: (r: Row[]) => void
  keyPlaceholder: string
  valuePlaceholder: string
  addLabel: string
}) {
  const update = (i: number, patch: Partial<Row>) =>
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={row.key}
            onChange={(e) => update(i, { key: e.target.value })}
            placeholder={keyPlaceholder}
            className="flex-1"
          />
          <Input
            value={row.value}
            onChange={(e) => update(i, { value: e.target.value })}
            placeholder={valuePlaceholder}
            className="flex-1"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setRows(rows.filter((_, idx) => idx !== i))}
            aria-label="Remove row"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setRows([...rows, { key: '', value: '' }])}
      >
        <Plus className="h-4 w-4" /> {addLabel}
      </Button>
    </div>
  )
}

/**
 * Create/edit form for an Automation (IDP refocus P4). Authoring is enforced
 * server-side by create/updateAutomation; this form is only rendered for users
 * the page already authorized. Filter and input-mapping are edited as key/value
 * rows (no raw JSON): filter values are lightly coerced, mapping values stay
 * strings so they can hold `{{event.path}}` templates.
 */
export function AutomationForm(props: Props) {
  const router = useRouter()
  const isEdit = props.mode === 'edit'
  const initial = isEdit ? props.initial : undefined

  const [workspace, setWorkspace] = useState(
    props.mode === 'create' ? (props.workspaces[0]?.id ?? '') : '',
  )
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [event, setEvent] = useState<EventValue>(initial?.event ?? 'rule-result-changed')
  const [filterRows, setFilterRows] = useState<Row[]>(
    initial ? toRows(initial.filter) : [{ key: 'transition', value: 'drift' }],
  )
  const [schedule, setSchedule] = useState(initial?.schedule ?? '')
  const [actionId, setActionId] = useState(initial?.actionId ?? '')
  const [mappingRows, setMappingRows] = useState<Row[]>(toRows(initial?.inputMapping))
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const [submitting, setSubmitting] = useState(false)

  // Actions available for the picker depend on the selected workspace (create)
  // or the automation's fixed workspace (edit).
  const actionOptions: ActionOption[] = useMemo(() => {
    if (props.mode === 'edit') return props.initial.actions
    return props.actionsByWorkspace[workspace] ?? []
  }, [props, workspace])

  const eventHint = EVENT_OPTIONS.find((o) => o.value === event)?.hint

  // Required inputs on the selected action — surfaced as a hint and enforced
  // client-side before submit (the server is the authoritative guard).
  const requiredInputs = useMemo(
    () => actionOptions.find((a) => a.id === actionId)?.requiredInputs ?? [],
    [actionOptions, actionId],
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return toast.error('An automation name is required.')
    if (props.mode === 'create' && !workspace) return toast.error('Select a workspace.')
    if (!actionId) return toast.error('Select an action to run.')

    const inputMapping = rowsToMapping(mappingRows)
    const unmappedRequired = requiredInputs
      .filter((f) => {
        const v = inputMapping[f.name]
        return v == null || (typeof v === 'string' && v.trim() === '')
      })
      .map((f) => f.label)
    if (unmappedRequired.length > 0) {
      return toast.error(`Map a value for every required input: ${unmappedRequired.join(', ')}.`)
    }

    const values: AutomationFormValues = {
      name,
      description,
      event,
      filter: rowsToFilter(filterRows),
      schedule: event === 'schedule' ? schedule : null,
      actionId,
      inputMapping,
      enabled,
    }

    setSubmitting(true)
    try {
      if (props.mode === 'create') {
        await createAutomation({ ...values, workspace })
        toast.success('Automation created')
        router.push('/automations')
      } else {
        await updateAutomation(props.automationId, values)
        toast.success('Automation updated')
        router.refresh()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save automation')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {props.mode === 'create' && (
        <div className="space-y-1.5">
          <Label htmlFor="auto-workspace">Workspace</Label>
          <Select
            value={workspace}
            onValueChange={(v) => {
              setWorkspace(v)
              setActionId('') // action list changes with workspace
            }}
          >
            <SelectTrigger id="auto-workspace">
              <SelectValue placeholder="Select a workspace" />
            </SelectTrigger>
            <SelectContent>
              {props.workspaces.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="auto-name">Name</Label>
        <Input
          id="auto-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Open remediation when a service drifts"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="auto-description">Description</Label>
        <Textarea
          id="auto-description"
          value={description ?? ''}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this automation does and why."
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="auto-event">Trigger</Label>
        <Select value={event} onValueChange={(v) => setEvent(v as EventValue)}>
          <SelectTrigger id="auto-event">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EVENT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {eventHint && <p className="text-xs text-muted-foreground">{eventHint}</p>}
      </div>

      {event === 'schedule' && (
        <div className="space-y-1.5">
          <Label htmlFor="auto-schedule">Cron expression</Label>
          <Input
            id="auto-schedule"
            value={schedule ?? ''}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder="0 9 * * 1   (Mondays 09:00)"
          />
          <p className="text-xs text-muted-foreground">
            Scheduled execution is handled by the deferred Temporal worker.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <Label>Filter (optional)</Label>
        <p className="text-xs text-muted-foreground">
          Narrow the event — all rows must match (e.g. <code>transition</code> = <code>drift</code>,
          or <code>entity.kind</code> = <code>service</code>).
        </p>
        <RowEditor
          rows={filterRows}
          setRows={setFilterRows}
          keyPlaceholder="event field (e.g. transition)"
          valuePlaceholder="expected value (e.g. drift)"
          addLabel="Add filter"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="auto-action">Run action</Label>
        <Select value={actionId} onValueChange={setActionId} disabled={actionOptions.length === 0}>
          <SelectTrigger id="auto-action">
            <SelectValue
              placeholder={
                actionOptions.length === 0 ? 'No actions in this workspace' : 'Select an action'
              }
            />
          </SelectTrigger>
          <SelectContent>
            {actionOptions.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {actionOptions.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Create an enabled action in this workspace first (Self-Service → New action).
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label>Input mapping{requiredInputs.length === 0 ? ' (optional)' : ''}</Label>
        <p className="text-xs text-muted-foreground">
          Map event fields into the action&rsquo;s inputs. Values may use{' '}
          <code>{'{{entity.slug}}'}</code>, <code>{'{{rule.title}}'}</code>, etc.
        </p>
        {requiredInputs.length > 0 && (
          <p className="text-xs font-medium text-muted-foreground">
            Required inputs (must be mapped):{' '}
            {requiredInputs.map((f) => f.label).join(', ')}
          </p>
        )}
        <RowEditor
          rows={mappingRows}
          setRows={setMappingRows}
          keyPlaceholder="action input (e.g. entity)"
          valuePlaceholder="value or {{template}}"
          addLabel="Add mapping"
        />
      </div>

      <div className="flex items-center gap-2">
        <Switch id="auto-enabled" checked={enabled} onCheckedChange={setEnabled} />
        <Label htmlFor="auto-enabled">Enabled</Label>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {isEdit ? 'Save changes' : 'Create automation'}
        </Button>
      </div>
    </form>
  )
}
