/**
 * `ui:` vocabulary field registry — resolves a JSON Schema field to a React
 * component. Precedence (highest wins): `ui:field` (name lookup) >
 * `ui:widget` (name lookup) > a registered `format:<format>` entry >
 * the type-based default. Every level falls through to the next rather than
 * throwing when a name is unregistered — an unrecognized `ui:field`/`ui:widget`
 * degrades gracefully to the type default instead of breaking the form.
 *
 * `object` schemas are NOT resolved here — `SchemaForm` recurses into a
 * nested `SchemaForm` instance for object fields, so the registry only needs
 * to cover leaf field types.
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
import { X } from 'lucide-react'
import type { JsonSchema, UiFieldSchema } from './types'

/** Props every registered field component receives from `SchemaForm`. */
export interface FieldComponentProps {
  id: string
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
  return (
    <Select
      value={value === undefined || value === null ? '' : String(value)}
      onValueChange={onChange}
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

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

function isArrayOfString(schema: JsonSchema): boolean {
  return schema.type === 'array' && (schema.items === undefined || schema.items.type === 'string')
}

function typeDefault(schema: JsonSchema): FieldComponent {
  if (schema.type === 'string' && schema.enum && schema.enum.length > 0) return SelectField
  if (schema.type === 'string') return StringInputField
  if (schema.type === 'number' || schema.type === 'integer') return NumberInputField
  if (schema.type === 'boolean') return BooleanSwitchField
  if (isArrayOfString(schema)) return TagInputField
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
