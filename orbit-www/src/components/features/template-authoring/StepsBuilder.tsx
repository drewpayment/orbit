/**
 * Step builder panel — Template Authoring Phase 2, Task 11.
 *
 * Ordered step list; "Add step" opens a registry picker (Command palette
 * over the `registry` prop, grouped by family). Each step row expands to a
 * `SchemaForm` instance driven by the selected action's `inputSchema`
 * (architecture decision #5) — expression-capable fields (string/number/
 * integer, per `schema-ui-split.ts#isExpressionCapable`) are routed through a
 * per-step field registry so they render `ExpressionInput` with that step's
 * autocomplete candidates (decision #6, implemented via the existing
 * `fieldRegistry` extension point rather than a new field-type system).
 */
'use client'

import * as React from 'react'
import type { TemplateDefinition, Step } from '@/lib/scaffolder/schema'
import type { ActionDescriptor } from '@/lib/scaffolder/validate'
import type { BuilderAction } from './builder-state'
import { getExpressionCandidates, type ExpressionCandidate } from './expression-autocomplete'
import {
  defaultStepInput,
  findStepReferences,
  generateStepId,
  groupRegistryByFamily,
  type StepReference,
} from './step-builder-logic'
import { stepInputSchemaToSchemaFormPage } from './schema-ui-split'
import { ExpressionInput } from './ExpressionInput'
import { SchemaForm } from '@/components/forms/schema-form/SchemaForm'
import { createFieldRegistry, type FieldComponent, type FieldRegistry } from '@/components/forms/schema-form/field-registry'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { cn } from '@/lib/utils'
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'

export interface StepsBuilderProps {
  definition: TemplateDefinition
  dispatch: React.Dispatch<BuilderAction>
  registry: ActionDescriptor[]
}

/**
 * A number/integer input is edited as free text so it can hold an expression,
 * but a plain numeric literal must be stored as a number — the action's
 * InputSchema (and the Go engine) reject `"10"` where `10` is expected.
 * Expressions and non-numeric text pass through untouched for the validator
 * to report; an empty field clears the value.
 */
export function coerceExpressionInput(raw: string, schemaType: unknown): unknown {
  if (schemaType !== 'number' && schemaType !== 'integer') return raw
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  const numeric = schemaType === 'integer' ? /^-?\d+$/ : /^-?\d+(\.\d+)?$/
  return numeric.test(trimmed) ? Number(trimmed) : raw
}

const STEP_ID_RE = /^[a-z][a-z0-9-]*$/

/**
 * Re-type top-level number/integer inputs that an earlier build stored as
 * strings (e.g. `"10"`). Returns the same reference when nothing changes so
 * callers can skip a dispatch.
 */
export function coerceStepInput(input: Step['input'], inputSchema: unknown): Step['input'] {
  const props = ((inputSchema as { properties?: Record<string, { type?: unknown }> } | undefined)?.properties ?? {})
  let changed = false
  const next: Step['input'] = { ...input }
  for (const [key, value] of Object.entries(input)) {
    const type = props[key]?.type
    if ((type === 'number' || type === 'integer') && typeof value === 'string') {
      const coerced = coerceExpressionInput(value, type)
      if (coerced !== value) {
        next[key] = coerced
        changed = true
      }
    }
  }
  return changed ? next : input
}

function buildExpressionAwareRegistry(candidates: ExpressionCandidate[]): FieldRegistry {
  const base = createFieldRegistry()
  const ExpressionField: FieldComponent = ({ id, value, onChange, disabled, schema, ...rest }) => (
    <ExpressionInput
      id={id}
      value={typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value)}
      onChange={(raw) => onChange(coerceExpressionInput(raw, schema.type))}
      candidates={candidates}
      disabled={disabled}
      aria-invalid={rest['aria-invalid']}
    />
  )
  return {
    register: (name, component) => base.register(name, component),
    resolve(schema, uiSchema) {
      const isPlainScalar = !uiSchema?.['ui:field'] && !uiSchema?.['ui:widget'] && !schema.enum
      const isExpressionType = schema.type === 'string' || schema.type === 'number' || schema.type === 'integer'
      if (isPlainScalar && isExpressionType) return ExpressionField
      return base.resolve(schema, uiSchema)
    },
  }
}

export function StepsBuilder({ definition, dispatch, registry }: StepsBuilderProps) {
  const steps = definition.spec.steps
  const registryById = React.useMemo(() => new Map(registry.map((d) => [d.id, d])), [registry])
  // Tracks the id of the step just created via "Add step" so its body opens
  // expanded (every other step starts collapsed).
  const [justAddedId, setJustAddedId] = React.useState<string | null>(null)

  function addStep(descriptor: ActionDescriptor) {
    const id = generateStepId(
      steps.map((s) => s.id),
      descriptor.id,
    )
    const step: Step = {
      id,
      name: descriptor.name,
      action: descriptor.id,
      input: defaultStepInput(descriptor.id),
    }
    dispatch({ type: 'ADD_STEP', step })
    setJustAddedId(id)
  }

  return (
    <div className="space-y-4">
      {steps.map((step, index) => (
        <StepRow
          key={step.id}
          step={step}
          index={index}
          stepCount={steps.length}
          descriptor={registryById.get(step.action)}
          candidates={getExpressionCandidates(definition, index, registry)}
          dependents={findStepReferences(definition, step.id)}
          siblingIds={steps.filter((s) => s.id !== step.id).map((s) => s.id)}
          defaultOpen={step.id === justAddedId}
          dispatch={dispatch}
        />
      ))}
      <RegistryPicker registry={registry} onSelect={addStep} />
    </div>
  )
}

function RegistryPicker({
  registry,
  onSelect,
}: {
  registry: ActionDescriptor[]
  onSelect: (descriptor: ActionDescriptor) => void
}) {
  const [open, setOpen] = React.useState(false)
  const groups = React.useMemo(() => groupRegistryByFamily(registry), [registry])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline">
          <Plus className="mr-1 h-4 w-4" /> Add step
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search actions…" />
          <CommandList>
            <CommandEmpty>No actions found.</CommandEmpty>
            {[...groups.entries()].map(([family, descriptors]) => (
              <CommandGroup key={family} heading={family}>
                {descriptors.map((descriptor) => (
                  <CommandItem
                    key={descriptor.id}
                    value={`${family} ${descriptor.id} ${descriptor.name}`}
                    onSelect={() => {
                      onSelect(descriptor)
                      setOpen(false)
                    }}
                  >
                    {descriptor.name}
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{descriptor.id}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function StepRow({
  step,
  index,
  stepCount,
  descriptor,
  candidates,
  dependents,
  siblingIds,
  defaultOpen,
  dispatch,
}: {
  step: Step
  index: number
  stepCount: number
  descriptor: ActionDescriptor | undefined
  candidates: ExpressionCandidate[]
  dependents: StepReference[]
  /** Ids of the other steps (excludes this one), for inline collision checks. */
  siblingIds: string[]
  /** Opens the step's body by default — true only for a step just added via "Add step". */
  defaultOpen?: boolean
  dispatch: React.Dispatch<BuilderAction>
}) {
  const [bodyOpen, setBodyOpen] = React.useState(defaultOpen ?? false)
  const [expanded, setExpanded] = React.useState(false)
  const [confirmingRemoval, setConfirmingRemoval] = React.useState(false)
  const fieldRegistry = React.useMemo(() => buildExpressionAwareRegistry(candidates), [candidates])
  const inputPage = React.useMemo(
    () => (descriptor ? stepInputSchemaToSchemaFormPage('Inputs', descriptor.inputSchema) : undefined),
    [descriptor],
  )

  // Local draft for the id, mirroring ParametersBuilder's Name field: an
  // invalid or colliding id must stay visible with an inline error rather
  // than being silently dropped by the reducer's no-op guard.
  const [idDraft, setIdDraft] = React.useState(step.id)
  const [idError, setIdError] = React.useState<string | null>(null)
  React.useEffect(() => {
    setIdDraft(step.id)
    setIdError(null)
  }, [step.id])

  function patch(fields: Partial<Step>) {
    dispatch({ type: 'UPDATE_STEP', id: step.id, patch: fields })
  }

  // Self-heal inputs saved as numeric strings by earlier builds.
  React.useEffect(() => {
    if (!descriptor) return
    const healed = coerceStepInput(step.input, descriptor.inputSchema)
    if (healed !== step.input) dispatch({ type: 'UPDATE_STEP', id: step.id, patch: { input: healed } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.id, descriptor])

  function handleIdChange(value: string) {
    setIdDraft(value)
    if (!STEP_ID_RE.test(value)) {
      setIdError('Step id must be lowercase kebab-case, e.g. "create-repo".')
      return
    }
    if (value !== step.id && siblingIds.includes(value)) {
      setIdError(`A step with id "${value}" already exists.`)
      return
    }
    setIdError(null)
    if (value !== step.id) patch({ id: value })
  }

  function removeStep() {
    dispatch({ type: 'REMOVE_STEP', id: step.id })
  }

  function handleRemoveClick() {
    if (dependents.length > 0) {
      setConfirmingRemoval(true)
    } else {
      removeStep()
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center gap-2">
        <div>
          <Input
            aria-label="Step id"
            value={idDraft}
            onChange={(e) => handleIdChange(e.target.value)}
            aria-invalid={!!idError}
            className="max-w-[12rem] font-mono text-xs"
            placeholder="step-id"
          />
          {idError && (
            <p role="alert" className="text-xs text-destructive">
              {idError}
            </p>
          )}
        </div>
        <Input
          aria-label="Step name"
          value={step.name}
          onChange={(e) => patch({ name: e.target.value })}
          className="max-w-xs"
        />
        <span className="font-mono text-xs text-muted-foreground">{step.action}</span>
        {!descriptor && (
          <span className="text-xs text-destructive">Unknown action — not in the registry</span>
        )}
        <div className="ml-auto flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Move step up"
            disabled={index === 0}
            onClick={() => dispatch({ type: 'REORDER_STEP', index, delta: -1 })}
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Move step down"
            disabled={index === stepCount - 1}
            onClick={() => dispatch({ type: 'REORDER_STEP', index, delta: 1 })}
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label="Remove step" onClick={handleRemoveClick}>
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={bodyOpen ? 'Collapse step' : 'Expand step'}
            onClick={() => setBodyOpen((v) => !v)}
          >
            <ChevronDown className={cn('h-4 w-4 transition-transform', bodyOpen && 'rotate-180')} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {confirmingRemoval && (
          <div role="alert" className="space-y-2 rounded-md border border-destructive/50 bg-destructive/10 p-3">
            <p className="text-sm text-destructive">
              Removing this step will break {dependents.length === 1 ? 'a reference' : 'references'} in:{' '}
              {dependents.map((d) => d.sourceLabel).join(', ')}.
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="destructive" size="sm" onClick={removeStep}>
                Remove anyway
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingRemoval(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        <Collapsible open={bodyOpen} onOpenChange={setBodyOpen}>
          <CollapsibleContent className="space-y-3">
            <div>
              <Label htmlFor={`${step.id}-if`}>Run if (optional expression)</Label>
              <ExpressionInput
                id={`${step.id}-if`}
                value={step.if ?? ''}
                onChange={(v) => patch({ if: v || undefined })}
                candidates={candidates}
                placeholder={'${{ parameters.needsTopic }}'}
              />
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`${step.id}-continueOnError`}
                  checked={step.continueOnError === true}
                  onCheckedChange={(checked) => patch({ continueOnError: checked === true || undefined })}
                />
                <Label htmlFor={`${step.id}-continueOnError`}>Continue on error</Label>
              </div>
              <div>
                <Label htmlFor={`${step.id}-timeout`}>Timeout</Label>
                <Input
                  id={`${step.id}-timeout`}
                  value={step.timeout ?? ''}
                  placeholder="e.g. 30s, 5m"
                  onChange={(e) => patch({ timeout: e.target.value || undefined })}
                  className="w-32"
                />
                <p className="text-xs text-muted-foreground">
                  Duration with a unit (s, m, h), max 2h. Blank uses the default.
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)}>
                {expanded ? 'Hide inputs' : 'Configure inputs'}
              </Button>
            </div>
            {expanded && inputPage && (
              <div className="rounded-md border p-3">
                <SchemaForm
                  pages={[inputPage]}
                  values={step.input}
                  onChange={(values) => patch({ input: values })}
                  fieldRegistry={fieldRegistry}
                  hideSubmit
                  mode="single"
                  as="div"
                />
              </div>
            )}
            {expanded && !inputPage && (
              <p className="text-sm text-muted-foreground">
                This action isn&apos;t in the registry — its inputs can&apos;t be edited visually. Use the YAML
                view.
              </p>
            )}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  )
}
