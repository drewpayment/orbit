'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  createAutomation,
  updateAutomation,
  type AutomationFormValues,
} from '@/app/(frontend)/automations/actions'
import { parseCronExpression } from '@/lib/automations/next-run'
import { extractTemplatePaths } from '@/lib/automations/input-mapping'
import {
  presetToCron,
  cronToPreset,
  type PresetState,
  DEFAULT_TIME,
  DEFAULT_WEEKDAY,
  DEFAULT_DAY_OF_MONTH,
} from '@/lib/automations/schedule-preset'
import { TriggerCards, type EventValue } from './TriggerCards'
import {
  FilterRows,
  FILTER_FIELDS,
  type GuidedCondition,
  type RawRow,
} from './FilterRows'
import {
  SchedulePicker,
  scheduleSummary,
  formatNextRun,
  nextCronRunUtc,
} from './SchedulePicker'

interface WorkspaceOption {
  id: string
  name: string
}
interface ActionInput {
  name: string
  label: string
  type: 'text' | 'textarea' | 'number' | 'boolean' | 'select'
  required: boolean
  options?: string[]
  help?: string
  placeholder?: string
}
interface ActionOption {
  id: string
  name: string
  /** The action's declared inputs, in schema order. */
  inputs?: ActionInput[]
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

/** Insert-variable tokens per trigger (schedule has none — no triggering event). */
const VARIABLE_TOKENS: Record<Exclude<EventValue, 'schedule'>, string[]> = {
  'rule-result-changed': [
    '{{entity.name}}',
    '{{entity.slug}}',
    '{{entity.kind}}',
    '{{rule.title}}',
    '{{scorecard.name}}',
    '{{transition}}',
    '{{passed}}',
    '{{detail}}',
  ],
  'entity-changed': [
    '{{entity.name}}',
    '{{entity.slug}}',
    '{{entity.kind}}',
    '{{entity.lifecycle}}',
    '{{operation}}',
  ],
}

/** `{{entity.slug}}` → `entity.slug` (the bare path the dispatcher resolves). */
function stripBraces(token: string): string {
  return token.replace(/^\{\{\s*|\s*\}\}$/g, '').trim()
}

/**
 * Template paths a trigger can resolve, derived from {@link VARIABLE_TOKENS}.
 * Schedule has no triggering event, so it allows NONE — any `{{…}}` is invalid.
 */
const ALLOWED_TEMPLATE_PATHS: Record<EventValue, ReadonlySet<string>> = {
  'rule-result-changed': new Set(VARIABLE_TOKENS['rule-result-changed'].map(stripBraces)),
  'entity-changed': new Set(VARIABLE_TOKENS['entity-changed'].map(stripBraces)),
  schedule: new Set<string>(),
}

/** Template paths used in `value` that the current trigger can't resolve. */
function invalidTemplatePaths(value: string, event: EventValue): string[] {
  const allowed = ALLOWED_TEMPLATE_PATHS[event]
  return extractTemplatePaths(value).filter((p) => !allowed.has(p))
}

/** Inline error for a value carrying a variable invalid for the current trigger. */
function templateErrorFor(event: EventValue, invalid: string[]): string {
  if (event === 'schedule') {
    return "Schedules can't use {{variables}} — enter a literal value."
  }
  return `{{${invalid[0]}}} isn't available for this trigger.`
}

/** Stringify a stored filter value for display in a row (mirrors the legacy editor). */
function toDisplay(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v)
}

/** Filter rows → object with light type coercion (true/false/number/string). */
function rowsToFilter(rows: RawRow[]): Record<string, unknown> {
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

/** Split a stored filter into guided (known-path) rows and raw escape-hatch rows. */
function splitFilter(
  event: EventValue,
  filter: Record<string, unknown> | null | undefined,
): { guided: GuidedCondition[]; advanced: RawRow[] } {
  const guided: GuidedCondition[] = []
  const advanced: RawRow[] = []
  if (!filter) return { guided, advanced }
  const fields = event === 'schedule' ? [] : FILTER_FIELDS[event]
  const known = new Set(fields.map((f) => f.path))
  for (const [k, v] of Object.entries(filter)) {
    const value = toDisplay(v)
    if (known.has(k)) guided.push({ path: k, value })
    else advanced.push({ key: k, value })
  }
  return { guided, advanced }
}

/** Default (incomplete-safe) schedule preset for a fresh schedule trigger. */
function defaultSchedule(): PresetState {
  return {
    frequency: 'daily',
    time: DEFAULT_TIME,
    weekday: DEFAULT_WEEKDAY,
    dayOfMonth: DEFAULT_DAY_OF_MONTH,
  }
}

const ERROR_FIELD_IDS: Record<string, string> = {
  workspace: 'auto-workspace',
  name: 'auto-name',
  schedule: 'auto-schedule',
  action: 'auto-action',
}
const ERROR_ORDER = ['workspace', 'name', 'schedule', 'action']

function controlIdFor(key: string): string {
  if (key.startsWith('input.')) return `auto-input-${key.slice('input.'.length)}`
  return ERROR_FIELD_IDS[key] ?? key
}

/** A muted placeholder for an unfilled part of the live summary. */
function Placeholder({ children }: { children: React.ReactNode }) {
  return <span className="italic text-muted-foreground">{children}</span>
}

/**
 * Create/edit form for an Automation (IDP refocus P4, authoring UX redesign).
 * Layout: Basics → ① When (trigger cards) → ② Only if (trigger-aware filter,
 * hidden for schedule) → ③ Then (action + inputs + variable insert) → live
 * summary → enabled + submit. Everything maps onto the unchanged server contract
 * {@link AutomationFormValues}.
 *
 * The trigger-change reset (clearing/​re-seeding filter + defaults) lives in the
 * onChange handler, NOT a `useEffect` keyed on `event` — so edit-mode hydration
 * is never wiped on first render.
 */
export function AutomationForm(props: Props) {
  const router = useRouter()
  const isEdit = props.mode === 'edit'
  const initial = isEdit ? props.initial : undefined
  const initialEvent: EventValue = initial?.event ?? 'rule-result-changed'

  const [workspace, setWorkspace] = useState(
    props.mode === 'create' ? (props.workspaces[0]?.id ?? '') : '',
  )
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [event, setEvent] = useState<EventValue>(initialEvent)

  // Guided filter conditions + raw escape-hatch rows. Create-mode seeds the
  // common drift filter for the default trigger; edit hydrates from the saved
  // filter, routing unknown paths to the advanced rows.
  const [guidedConditions, setGuidedConditions] = useState<GuidedCondition[]>(() => {
    if (initial) return splitFilter(initial.event, initial.filter).guided
    return [{ path: 'transition', value: 'drift' }]
  })
  const [advancedRows, setAdvancedRows] = useState<RawRow[]>(() =>
    initial ? splitFilter(initial.event, initial.filter).advanced : [],
  )

  const [schedule, setSchedule] = useState<PresetState>(() => {
    if (initial?.event === 'schedule' && initial.schedule) return cronToPreset(initial.schedule)
    return defaultSchedule()
  })

  const [actionId, setActionId] = useState(initial?.actionId ?? '')
  const [inputValues, setInputValues] = useState<Record<string, string>>(() => {
    const m = initial?.inputMapping
    if (!m) return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(m)) out[k] = typeof v === 'string' ? v : JSON.stringify(v)
    return out
  })
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  const actionOptions: ActionOption[] = useMemo(() => {
    if (props.mode === 'edit') return props.initial.actions
    return props.actionsByWorkspace[workspace] ?? []
  }, [props, workspace])

  const actionInputs = useMemo(
    () => actionOptions.find((a) => a.id === actionId)?.inputs ?? [],
    [actionOptions, actionId],
  )
  const selectedAction = actionOptions.find((a) => a.id === actionId)

  const clearError = (key: string) =>
    setErrors((e) => {
      if (!e[key]) return e
      const next = { ...e }
      delete next[key]
      return next
    })

  /**
   * Trigger change carries the dependent-state RESET (here, in the handler — not
   * an effect): drop filter conditions whose path is invalid for the new trigger,
   * re-seed the create-mode default, and clear stale validation.
   */
  function handleTriggerChange(next: EventValue) {
    if (next === event) return
    setEvent(next)
    setErrors({})
    if (next === 'schedule') {
      setGuidedConditions([])
      // advanced/raw conditions are meaningless for schedule; they're hidden and
      // dropped on submit, so leave them untouched for a possible switch-back.
      return
    }
    const known = new Set(FILTER_FIELDS[next].map((f) => f.path))
    setGuidedConditions((prev) => {
      const kept = prev.filter((c) => known.has(c.path))
      if (props.mode === 'create' && next === 'rule-result-changed' && kept.length === 0) {
        return [{ path: 'transition', value: 'drift' }]
      }
      return kept
    })
  }

  function buildFilter(): Record<string, unknown> {
    if (event === 'schedule') return {}
    const rows: RawRow[] = [
      ...guidedConditions
        .filter((c) => c.path.trim() !== '' && c.value.trim() !== '')
        .map((c) => ({ key: c.path, value: c.value })),
      ...advancedRows,
    ]
    return rowsToFilter(rows)
  }

  function focusFirstError(errs: Record<string, string>) {
    const keys = Object.keys(errs)
    const ordered = [
      ...ERROR_ORDER.filter((k) => keys.includes(k)),
      ...keys.filter((k) => k.startsWith('input.')),
    ]
    const first = ordered[0]
    if (!first) return
    const el = document.getElementById(controlIdFor(first))
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.focus({ preventScroll: true })
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Collect EVERY error (no early returns) so all surface inline at once.
    const next: Record<string, string> = {}
    if (!name.trim()) next.name = 'Give this automation a name.'
    if (props.mode === 'create' && !workspace) next.workspace = 'Choose a workspace.'

    let cron: string | null = null
    if (event === 'schedule') {
      cron = presetToCron(schedule)
      if (!cron) next.schedule = 'Choose when this should run.'
      else if (!parseCronExpression(cron)) next.schedule = "That schedule isn't valid."
    }

    if (!actionId) next.action = 'Choose an action to run.'

    for (const f of actionInputs) {
      const raw = inputValues[f.name] ?? ''
      if (f.required && raw.trim() === '') next[`input.${f.name}`] = `${f.label} is required.`
      // Flag any {{variable}} the current trigger can't resolve: schedule allows
      // none (no triggering event); event triggers allow only their own paths.
      // Catches stale cross-trigger variables (e.g. {{rule.title}} left behind
      // after switching scorecard→entity) that would silently fail at dispatch.
      const invalid = invalidTemplatePaths(raw, event)
      if (invalid.length > 0) next[`input.${f.name}`] = templateErrorFor(event, invalid)
    }

    if (Object.keys(next).length > 0) {
      setErrors(next)
      focusFirstError(next)
      return
    }

    // Build the mapping from the declared inputs only; keep non-empty values.
    const inputMapping: Record<string, unknown> = {}
    for (const f of actionInputs) {
      const v = (inputValues[f.name] ?? '').trim()
      if (v !== '') inputMapping[f.name] = inputValues[f.name]
    }

    const values: AutomationFormValues = {
      name,
      description,
      event,
      filter: buildFilter(),
      schedule: event === 'schedule' ? cron : null,
      actionId,
      inputMapping,
      enabled,
    }

    setSubmitting(true)
    try {
      if (props.mode === 'create') {
        const created = await createAutomation({ ...values, workspace })
        toast.success('Automation created')
        // Land on the new automation's detail page (immediate confirmation +
        // run history), not back on the list.
        router.push(`/automations/${created.id}`)
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

  function insertVariable(inputName: string, token: string) {
    setInputValues((s) => ({ ...s, [inputName]: (s[inputName] ?? '') + token }))
    clearError(`input.${inputName}`)
  }

  // ---- Live summary -------------------------------------------------------
  const summaryTrigger = (): React.ReactNode => {
    if (event === 'schedule') return <strong>{scheduleSummary(schedule)}</strong>
    if (event === 'rule-result-changed') {
      const transition = guidedConditions.find((c) => c.path === 'transition')?.value
      const verb =
        transition === 'drift'
          ? 'drifts'
          : transition === 'recovery'
            ? 'recovers'
            : transition === 'initial'
              ? 'is first evaluated'
              : transition === 'unchanged'
                ? 'is re-evaluated'
                : 'changes'
      return (
        <>
          When a scorecard check <strong>{verb}</strong>
        </>
      )
    }
    const operation = guidedConditions.find((c) => c.path === 'operation')?.value
    const verb = operation === 'create' ? 'is created' : operation === 'update' ? 'is updated' : 'changes'
    return (
      <>
        When a catalog entity <strong>{verb}</strong>
      </>
    )
  }

  const summaryAction = (): React.ReactNode =>
    selectedAction ? <strong>{selectedAction.name}</strong> : <Placeholder>an action</Placeholder>

  const summaryNextRun = (): React.ReactNode => {
    if (event !== 'schedule') return null
    const cron = presetToCron(schedule)
    const at = cron ? nextCronRunUtc(cron, new Date()) : null
    if (!at) return null
    return (
      <>
        {' · '}
        <span className="font-medium">Next run:</span> {formatNextRun(at)} UTC
      </>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* ---- Basics ---------------------------------------------------- */}
      {props.mode === 'create' && (
        <div className="space-y-1.5">
          <Label htmlFor="auto-workspace">Workspace</Label>
          <Select
            value={workspace}
            onValueChange={(v) => {
              setWorkspace(v)
              setActionId('') // action list changes with workspace
              clearError('workspace')
            }}
          >
            <SelectTrigger
              id="auto-workspace"
              aria-invalid={!!errors.workspace}
              className={errors.workspace ? 'border-destructive' : ''}
            >
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
          {errors.workspace && (
            <p role="alert" className="text-xs text-destructive">
              {errors.workspace}
            </p>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="auto-name">Name</Label>
        <Input
          id="auto-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            clearError('name')
          }}
          placeholder="Open remediation when a service drifts"
          aria-invalid={!!errors.name}
          className={errors.name ? 'border-destructive' : ''}
        />
        {errors.name && (
          <p role="alert" className="text-xs text-destructive">
            {errors.name}
          </p>
        )}
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

      <Separator />

      {/* ---- ① When ---------------------------------------------------- */}
      <div className="space-y-2">
        <div className="space-y-0.5">
          <Label className="text-sm font-semibold">When this happens</Label>
        </div>
        <TriggerCards value={event} onChange={handleTriggerChange} />
      </div>

      {event === 'schedule' && (
        <SchedulePicker
          state={schedule}
          setState={(s) => {
            setSchedule(s)
            clearError('schedule')
          }}
          error={errors.schedule}
          invalid={!!errors.schedule}
        />
      )}

      {/* ---- ② Only if (hidden for schedule) --------------------------- */}
      {event !== 'schedule' && (
        <div className="space-y-2">
          <div className="space-y-0.5">
            <Label className="text-sm font-semibold">Only run if… (optional)</Label>
            <p className="text-xs text-muted-foreground">
              All conditions must match. Leave empty to run on every event.
            </p>
          </div>
          <FilterRows
            fields={FILTER_FIELDS[event]}
            conditions={guidedConditions}
            setConditions={setGuidedConditions}
            advancedRows={advancedRows}
            setAdvancedRows={setAdvancedRows}
          />
        </div>
      )}

      <Separator />

      {/* ---- ③ Then ---------------------------------------------------- */}
      <div className="space-y-2">
        <Label htmlFor="auto-action" className="text-sm font-semibold">
          Then run this action
        </Label>
        <Select
          value={actionId}
          onValueChange={(v) => {
            setActionId(v)
            clearError('action')
          }}
          disabled={actionOptions.length === 0}
        >
          <SelectTrigger
            id="auto-action"
            aria-invalid={!!errors.action}
            className={errors.action ? 'border-destructive' : ''}
          >
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
        {errors.action && (
          <p role="alert" className="text-xs text-destructive">
            {errors.action}
          </p>
        )}
        {actionOptions.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Create an enabled action in this workspace first (Self-Service → New action).
          </p>
        )}
      </div>

      {actionId && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {event === 'schedule'
              ? 'A schedule has no triggering event — enter literal values.'
              : 'Enter a literal value, or insert a variable to pull from the triggering event.'}
          </p>

          {actionInputs.length === 0 ? (
            <p className="text-xs text-muted-foreground">This action has no inputs to configure.</p>
          ) : (
            actionInputs.map((f) => {
              const errKey = `input.${f.name}`
              const err = errors[errKey]
              // Live, non-blocking hint when a value carries a variable the
              // current trigger can't resolve (e.g. right after switching
              // triggers) — so the author sees it immediately, not only on submit.
              const staleTpl = invalidTemplatePaths(inputValues[f.name] ?? '', event)
              const optionsHint =
                f.type === 'select' && f.options?.length ? `Options: ${f.options.join(', ')}` : ''
              const hint = [f.help, optionsHint].filter(Boolean).join(' · ')
              const placeholder = f.placeholder ?? (f.required ? 'Required' : 'Optional')
              const canInsert =
                event !== 'schedule' && (f.type === 'text' || f.type === 'textarea')
              const tokens = event === 'schedule' ? [] : VARIABLE_TOKENS[event]
              return (
                <div key={f.name} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor={`auto-input-${f.name}`}>
                      {f.label}
                      {f.required && <span className="ml-0.5 text-destructive">*</span>}
                    </Label>
                    {canInsert && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button type="button" variant="outline" size="sm" className="h-7">
                            Insert variable
                            <ChevronDown className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Insert from event</DropdownMenuLabel>
                          {tokens.map((t) => (
                            <DropdownMenuItem key={t} onSelect={() => insertVariable(f.name, t)}>
                              <code className="text-xs">{t}</code>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                  {f.type === 'textarea' ? (
                    <Textarea
                      id={`auto-input-${f.name}`}
                      value={inputValues[f.name] ?? ''}
                      onChange={(e) => {
                        setInputValues((s) => ({ ...s, [f.name]: e.target.value }))
                        clearError(errKey)
                      }}
                      placeholder={placeholder}
                      aria-invalid={!!err}
                      className={err ? 'border-destructive' : ''}
                    />
                  ) : (
                    <Input
                      id={`auto-input-${f.name}`}
                      value={inputValues[f.name] ?? ''}
                      onChange={(e) => {
                        setInputValues((s) => ({ ...s, [f.name]: e.target.value }))
                        clearError(errKey)
                      }}
                      placeholder={placeholder}
                      aria-invalid={!!err}
                      className={err ? 'border-destructive' : ''}
                    />
                  )}
                  {err && (
                    <p role="alert" className="text-xs text-destructive">
                      {err}
                    </p>
                  )}
                  {!err && staleTpl.length > 0 && (
                    <p className="text-xs text-amber-600 dark:text-amber-500">
                      {templateErrorFor(event, staleTpl)}
                    </p>
                  )}
                  {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
                </div>
              )
            })
          )}
        </div>
      )}

      {/* ---- Live summary (read-back, not an input) ------------------- */}
      <Alert className="border-primary/30 bg-primary/5">
        <Sparkles className="h-4 w-4" />
        <AlertTitle>This automation will…</AlertTitle>
        <AlertDescription>
          {summaryTrigger()}, run {summaryAction()}
          {summaryNextRun()}.
        </AlertDescription>
      </Alert>

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
