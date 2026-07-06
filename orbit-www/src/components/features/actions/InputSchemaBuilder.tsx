'use client'

import { ChevronDown, ChevronUp, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  createBuilderField,
  moveField,
  FIELD_TYPE_OPTIONS,
  type BuilderField,
} from './input-schema-builder'

interface InputSchemaBuilderProps {
  value: BuilderField[]
  onChange: (next: BuilderField[]) => void
}

/**
 * Visual editor for an Action's run-form inputs (IDP refocus P3). Authors
 * add/remove/reorder typed fields — never raw JSON — and the parent assembles
 * the {@link BuilderField}[] into the shared inputSchema on submit. Each row
 * edits name, label, type, required, and (for `select`) an inline options list.
 */
export function InputSchemaBuilder({ value, onChange }: InputSchemaBuilderProps) {
  function patch(index: number, changes: Partial<BuilderField>) {
    onChange(value.map((f, i) => (i === index ? { ...f, ...changes } : f)))
  }

  function addField() {
    onChange([...value, createBuilderField()])
  }

  function removeField(index: number) {
    onChange(value.filter((_, i) => i !== index))
  }

  function move(index: number, delta: number) {
    onChange(moveField(value, index, delta))
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <Label>Inputs</Label>
          <p className="text-xs text-muted-foreground">
            The fields collected before this action runs.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addField}>
          <Plus className="h-4 w-4" />
          Add input
        </Button>
      </div>

      {value.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          No inputs — this action runs without collecting any values.
        </p>
      ) : (
        <div className="space-y-3">
          {value.map((f, i) => (
            <FieldRow
              key={f.id}
              field={f}
              isFirst={i === 0}
              isLast={i === value.length - 1}
              onChange={(changes) => patch(i, changes)}
              onRemove={() => removeField(i)}
              onMoveUp={() => move(i, -1)}
              onMoveDown={() => move(i, 1)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface FieldRowProps {
  field: BuilderField
  isFirst: boolean
  isLast: boolean
  onChange: (changes: Partial<BuilderField>) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}

function FieldRow({
  field,
  isFirst,
  isLast,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: FieldRowProps) {
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-start gap-2">
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Name (key)</Label>
            <Input
              value={field.name}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder="serviceName"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Label</Label>
            <Input
              value={field.label}
              onChange={(e) => onChange({ label: e.target.value })}
              placeholder="Service name"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Type</Label>
            <Select
              value={field.type}
              onValueChange={(type) => onChange({ type: type as BuilderField['type'] })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIELD_TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 pt-6">
            <Switch
              id={`req-${field.id}`}
              checked={field.required}
              onCheckedChange={(required) => onChange({ required })}
            />
            <Label htmlFor={`req-${field.id}`} className="text-xs">
              Required
            </Label>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={isFirst}
            onClick={onMoveUp}
            aria-label="Move input up"
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={isLast}
            onClick={onMoveDown}
            aria-label="Move input down"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive"
            onClick={onRemove}
            aria-label="Remove input"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {field.type === 'select' && (
        <OptionsEditor
          options={field.options}
          onChange={(options) => onChange({ options })}
        />
      )}

      <div className="space-y-1.5">
        <Label className="text-xs">Help text (optional)</Label>
        <Input
          value={field.help}
          onChange={(e) => onChange({ help: e.target.value })}
          placeholder="Shown under the field on the run form."
        />
      </div>
    </div>
  )
}

interface OptionsEditorProps {
  options: string[]
  onChange: (next: string[]) => void
}

/** Inline list editor for a select field's allowed values. */
function OptionsEditor({ options, onChange }: OptionsEditorProps) {
  function setOption(index: number, val: string) {
    onChange(options.map((o, i) => (i === index ? val : o)))
  }
  function addOption() {
    onChange([...options, ''])
  }
  function removeOption(index: number) {
    onChange(options.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-2 rounded-md bg-muted/40 p-2.5">
      <Label className="text-xs">Options</Label>
      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground">Add at least one option.</p>
      ) : (
        <div className="space-y-2">
          {options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={opt}
                onChange={(e) => setOption(i, e.target.value)}
                placeholder={`Option ${i + 1}`}
                className="h-8"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => removeOption(i)}
                aria-label="Remove option"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <Button type="button" variant="outline" size="sm" onClick={addOption}>
        <Plus className="h-4 w-4" />
        Add option
      </Button>
    </div>
  )
}
