/**
 * `ui:` vocabulary field registry — resolves a JSON Schema field to a React
 * component. Precedence (highest wins): `ui:field` (name lookup) >
 * `ui:widget` (name lookup) > a registered `format:<format>` entry >
 * the type-based default. Every level falls through to the next rather than
 * throwing when a name is unregistered — an unrecognized `ui:field`/`ui:widget`
 * degrades gracefully to the type default instead of breaking the form.
 *
 * An `object` schema with explicit `properties` is NOT resolved here —
 * `SchemaForm` recurses into a nested `SchemaForm` instance for those. An
 * `object` schema with no fixed `properties` (a free-form `{ key: value }`
 * map — see {@link isKeyValueObjectSchema}) IS resolved here, to
 * `KeyValueObjectField`, since it has no nested field set to recurse into.
 */
'use client'

import * as React from 'react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Plus, X } from 'lucide-react'
import type { JsonSchema, UiFieldSchema } from './types'

/**
 * Props every registered field component receives from `SchemaForm`.
 *
 * `id` is optional here because `SchemaForm` renders leaf fields inside a
 * `<FormControl>` (a Radix Slot), which injects its own useId()-scoped `id`
 * (plus `aria-describedby`/`aria-invalid`) directly onto this element at
 * render time — the field component never sets its own `id` prop. It's still
 * typed as an incoming prop (not just implicit) so field components can
 * apply it to the DOM node they render, and so a caller invoking a field
 * component directly (e.g. in a test) can still pass one explicitly.
 */
export interface FieldComponentProps {
  id?: string
  schema: JsonSchema
  uiSchema?: UiFieldSchema
  value: unknown
  onChange: (value: unknown) => void
  onBlur?: () => void
  disabled?: boolean
  'aria-invalid'?: boolean
}

export type FieldComponent = React.ComponentType<FieldComponentProps>

// ---------------------------------------------------------------------------
// Built-in field components
// ---------------------------------------------------------------------------

export function StringInputField({
  id,
  value,
  onChange,
  onBlur,
  disabled,
  uiSchema,
  ...rest
}: FieldComponentProps) {
  const secret = uiSchema?.['ui:secret'] === true
  return (
    <Input
      id={id}
      type={secret ? 'password' : 'text'}
      value={typeof value === 'string' ? value : (value as number | undefined) ?? ''}
      placeholder={uiSchema?.['ui:placeholder']}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      aria-invalid={rest['aria-invalid']}
    />
  )
}

export function TextareaField({ id, value, onChange, onBlur, disabled, uiSchema }: FieldComponentProps) {
  return (
    <Textarea
      id={id}
      value={typeof value === 'string' ? value : ''}
      placeholder={uiSchema?.['ui:placeholder']}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
    />
  )
}

export function NumberInputField({ id, value, onChange, onBlur, disabled }: FieldComponentProps) {
  return (
    <Input
      id={id}
      type="number"
      value={value === undefined || value === null ? '' : (value as number)}
      disabled={disabled}
      onChange={(e) => {
        const raw = e.target.value
        onChange(raw === '' ? undefined : Number(raw))
      }}
      onBlur={onBlur}
    />
  )
}

export function BooleanSwitchField({ id, value, onChange, disabled }: FieldComponentProps) {
  return <Switch id={id} checked={value === true} disabled={disabled} onCheckedChange={onChange} />
}

export function SelectField({ id, schema, value, onChange, disabled, uiSchema }: FieldComponentProps) {
  const options = schema.enum ?? []
  // shadcn's <Select> always emits a string via onValueChange — coerce back
  // to the declared type for a number/integer enum so the emitted value
  // matches what the zod schema (and the caller) expect.
  const isNumeric = schema.type === 'number' || schema.type === 'integer'
  return (
    <Select
      value={value === undefined || value === null ? '' : String(value)}
      onValueChange={(v) => onChange(isNumeric ? Number(v) : v)}
      disabled={disabled}
    >
      <SelectTrigger id={id}>
        <SelectValue placeholder={uiSchema?.['ui:placeholder'] ?? 'Select…'} />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={String(opt)} value={String(opt)}>
            {String(opt)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * Tag input for `array` of `string` — built on `command.tsx` + `popover.tsx`
 * (no new dependency). Fixes the comma-separated-string `multiselect` hack in
 * the legacy `UseTemplateForm`.
 */
export function TagInputField({ id, schema, value, onChange, disabled }: FieldComponentProps) {
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const tags = Array.isArray(value) ? (value as string[]) : []
  const options = (schema.items?.enum ?? []) as string[]

  function addTag(tag: string) {
    const trimmed = tag.trim()
    if (!trimmed || tags.includes(trimmed)) return
    onChange([...tags, trimmed])
    setDraft('')
  }

  function removeTag(tag: string) {
    onChange(tags.filter((t) => t !== tag))
  }

  return (
    <div id={id} className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <Badge key={tag} variant="secondary" className="gap-1">
            {tag}
            {!disabled && (
              <button
                type="button"
                aria-label={`Remove ${tag}`}
                onClick={() => removeTag(tag)}
                className="ml-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </Badge>
        ))}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" disabled={disabled}>
            Add tag
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="start">
          <Command>
            <CommandInput
              value={draft}
              onValueChange={setDraft}
              placeholder="Type a value…"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addTag(draft)
                }
              }}
            />
            <CommandList>
              <CommandGroup>
                {options
                  .filter((opt) => !tags.includes(opt))
                  .map((opt) => (
                    <CommandItem key={opt} onSelect={() => addTag(opt)}>
                      {opt}
                    </CommandItem>
                  ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}

function isScalarSchema(schema: JsonSchema | undefined): boolean {
  return (
    !!schema &&
    (schema.type === 'string' ||
      schema.type === 'number' ||
      schema.type === 'integer' ||
      schema.type === 'boolean')
  )
}

/**
 * True for a free-form `{ key: value }` map: `type: object`, no explicit
 * `properties`, and an `additionalProperties` that is either absent (bare
 * `{ type: 'object' }` — JSON Schema's default is "any additional keys of
 * any type"), `true`, or a scalar leaf schema (string/number/integer/
 * boolean). `additionalProperties: false` is excluded — that schema
 * declares no keys are allowed at all, so there is nothing to author.
 *
 * An object WITH `properties` is out of scope here — `SchemaForm` already
 * handles that shape by recursing into a nested `SchemaForm` instance.
 */
export function isKeyValueObjectSchema(schema: JsonSchema): boolean {
  if (schema.type !== 'object') return false
  const hasProperties = !!schema.properties && Object.keys(schema.properties).length > 0
  if (hasProperties) return false
  const additionalProperties = schema.additionalProperties
  if (additionalProperties === undefined || additionalProperties === true) return true
  if (typeof additionalProperties === 'object') return isScalarSchema(additionalProperties)
  return false
}

function isScalarValue(value: unknown): boolean {
  return value === null || value === undefined || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function defaultScalarValueField(schema: JsonSchema): FieldComponent {
  if (schema.type === 'number' || schema.type === 'integer') return NumberInputField
  if (schema.type === 'boolean') return BooleanSwitchField
  return StringInputField
}

export interface KeyValueObjectFieldProps extends FieldComponentProps {
  /**
   * Row value editor override — passed by callers (e.g. `StepsBuilder`'s
   * expression-aware registry) that want each row's value to accept a
   * `${{ }}` expression via the same `ExpressionInput` control used for
   * other step inputs. Receives the `additionalProperties` leaf schema (not
   * the outer object schema) as its `schema` prop. Defaults to a plain
   * scalar input matching that leaf schema's type.
   */
  valueField?: FieldComponent
}

/**
 * Editor for a free-form `{ key: value }` object — see
 * {@link isKeyValueObjectSchema} for the schema shapes it applies to (e.g.
 * `fs:render`'s `values` input). Rows of key + value with add/remove
 * controls; keys are validated non-empty and unique inline (mirroring the
 * step-id collision pattern in `StepsBuilder`) rather than blocking typing —
 * an invalid/duplicate key is shown with an inline error and simply isn't
 * emitted until fixed, so a transient bad state along the way never
 * clobbers the last-known-good value. A row whose existing value isn't a
 * JSON scalar (e.g. legacy or `additionalProperties: true` data) renders
 * read-only as JSON rather than crashing on an unsupported editor.
 */
export function KeyValueObjectField({ id, schema, value, onChange, disabled, valueField }: KeyValueObjectFieldProps) {
  const obj = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  // `obj` is a fresh object/literal reference every render (derived from
  // `value`, not memoized itself) — depending on `value` alone, not `obj`,
  // is intentional so this doesn't recompute on every render regardless of
  // whether the underlying value actually changed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const entries = React.useMemo(() => Object.entries(obj), [value])
  const additionalProperties = schema.additionalProperties
  const apSchema: JsonSchema = typeof additionalProperties === 'object' ? additionalProperties : { type: 'string' }
  const ValueField = valueField ?? defaultScalarValueField(apSchema)

  // Local key drafts so an in-progress rename (which may transiently be
  // empty or collide with a sibling key) is visible without being emitted —
  // reset whenever the committed value changes underneath us.
  const [keyDrafts, setKeyDrafts] = React.useState<string[]>(() => entries.map(([k]) => k))
  React.useEffect(() => {
    setKeyDrafts(entries.map(([k]) => k))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  function emit(nextEntries: Array<[string, unknown]>) {
    const next: Record<string, unknown> = {}
    for (const [k, v] of nextEntries) {
      if (k === '') continue
      next[k] = v
    }
    onChange(next)
  }

  function updateKeyAt(index: number, newKey: string) {
    const drafts = [...keyDrafts]
    drafts[index] = newKey
    setKeyDrafts(drafts)
    const others = drafts.filter((_, i) => i !== index)
    if (newKey !== '' && !others.includes(newKey)) {
      emit(entries.map(([k, v], i) => [i === index ? newKey : k, v]))
    }
  }

  function updateValueAt(index: number, newValue: unknown) {
    emit(entries.map(([k, v], i) => [k, i === index ? newValue : v]))
  }

  function removeAt(index: number) {
    const nextEntries = entries.filter((_, i) => i !== index)
    setKeyDrafts(nextEntries.map(([k]) => k))
    emit(nextEntries)
  }

  function addRow() {
    const existing = new Set(entries.map(([k]) => k))
    let candidate = 'key'
    let n = 1
    while (existing.has(candidate)) candidate = `key${n++}`
    emit([...entries, [candidate, apSchema.type === 'boolean' ? false : '']])
  }

  const keyCounts = keyDrafts.reduce<Record<string, number>>((acc, k) => {
    if (k !== '') acc[k] = (acc[k] ?? 0) + 1
    return acc
  }, {})

  return (
    <div id={id} className="space-y-2">
      {entries.length === 0 && <p className="text-sm text-muted-foreground">No entries.</p>}
      {entries.map(([, rowValue], index) => {
        const key = keyDrafts[index] ?? ''
        const duplicate = key !== '' && (keyCounts[key] ?? 0) > 1
        const empty = key === ''
        const scalar = isScalarValue(rowValue)
        return (
          <div key={index} className="space-y-1">
            <div className="flex items-center gap-2">
              <Input
                aria-label="Key"
                value={key}
                placeholder="key"
                disabled={disabled}
                onChange={(e) => updateKeyAt(index, e.target.value)}
                className="max-w-[10rem] font-mono text-xs"
                aria-invalid={duplicate || empty}
              />
              <div className="flex-1">
                {scalar ? (
                  <ValueField
                    schema={apSchema}
                    value={rowValue}
                    onChange={(v) => updateValueAt(index, v)}
                    disabled={disabled}
                  />
                ) : (
                  <Input readOnly disabled value={JSON.stringify(rowValue)} className="font-mono text-xs" />
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remove entry"
                disabled={disabled}
                onClick={() => removeAt(index)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            {duplicate && (
              <p role="alert" className="text-xs text-destructive">
                Duplicate key &quot;{key}&quot;.
              </p>
            )}
            {empty && (
              <p role="alert" className="text-xs text-destructive">
                Key cannot be empty.
              </p>
            )}
          </div>
        )
      })}
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={addRow}>
        <Plus className="mr-1 h-3.5 w-3.5" /> Add entry
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

function isArrayOfString(schema: JsonSchema): boolean {
  return schema.type === 'array' && (schema.items === undefined || schema.items.type === 'string')
}

function typeDefault(schema: JsonSchema): FieldComponent {
  // A non-empty enum on ANY type (string, number, integer) renders as a
  // Select — not just string enums.
  if (schema.enum && schema.enum.length > 0) return SelectField
  if (schema.type === 'string') return StringInputField
  if (schema.type === 'number' || schema.type === 'integer') return NumberInputField
  if (schema.type === 'boolean') return BooleanSwitchField
  if (isArrayOfString(schema)) return TagInputField
  if (isKeyValueObjectSchema(schema)) return KeyValueObjectField
  return StringInputField
}

export interface FieldRegistry {
  register(name: string, component: FieldComponent): void
  resolve(schema: JsonSchema, uiSchema?: UiFieldSchema): FieldComponent
}

/** Built-in widget name → component. Also seeded into every new registry. */
const BUILTIN_WIDGETS: Record<string, FieldComponent> = {
  textarea: TextareaField,
  password: StringInputField,
}

/** Create an isolated field registry seeded with the built-in widgets. */
export function createFieldRegistry(): FieldRegistry {
  const entries = new Map<string, FieldComponent>(Object.entries(BUILTIN_WIDGETS))

  return {
    register(name, component) {
      entries.set(name, component)
    },
    resolve(schema, uiSchema) {
      const fieldName = uiSchema?.['ui:field']
      if (fieldName && entries.has(fieldName)) return entries.get(fieldName)!

      const widgetName = uiSchema?.['ui:widget']
      if (widgetName && entries.has(widgetName)) return entries.get(widgetName)!

      if (schema.format) {
        const formatKey = `format:${schema.format}`
        if (entries.has(formatKey)) return entries.get(formatKey)!
      }

      return typeDefault(schema)
    },
  }
}

/** The shared, app-wide field registry. `SchemaForm` defaults to this. */
export const defaultFieldRegistry = createFieldRegistry()

/** Register a field component on the shared registry (e.g. Orbit pickers). */
export function registerField(name: string, component: FieldComponent): void {
  defaultFieldRegistry.register(name, component)
}

// ---------------------------------------------------------------------------
// Orbit-native pickers (Task 5) — registered under the design-doc names so
// `ui:field: OrbitTeamPicker` etc. resolves automatically. Imported lazily
// here (rather than at field-registry module scope importing the picker
// files, which import server actions) is unnecessary in Next.js — server
// action imports are fine from a 'use client' module — but kept as a
// dedicated call so it's easy to see what's pre-registered vs. app-defined.
// ---------------------------------------------------------------------------
import { OrbitEntityPicker } from './fields/OrbitEntityPicker'
import { OrbitRepoPicker } from './fields/OrbitRepoPicker'
import { OrbitSkeletonPicker } from './fields/OrbitSkeletonPicker'
import { OrbitTeamPicker } from './fields/OrbitTeamPicker'
import { OrbitWorkspacePicker } from './fields/OrbitWorkspacePicker'

defaultFieldRegistry.register('OrbitTeamPicker', OrbitTeamPicker)
defaultFieldRegistry.register('OrbitWorkspacePicker', OrbitWorkspacePicker)
defaultFieldRegistry.register('OrbitEntityPicker', OrbitEntityPicker)
defaultFieldRegistry.register('OrbitRepoPicker', OrbitRepoPicker)
defaultFieldRegistry.register('OrbitSkeletonPicker', OrbitSkeletonPicker)
