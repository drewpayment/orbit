'use client'

/**
 * Orbit-native `SchemaForm` field: pick a workspace. No server lookup here —
 * the caller (a Server Component page) already resolves the workspaces the
 * current user can act in and passes them via `ui:options.workspaces`.
 */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { FieldComponentProps } from '../field-registry'
import { pickerOptions } from './orbit-picker-types'

export function OrbitWorkspacePicker({ id, uiSchema, value, onChange, disabled }: FieldComponentProps) {
  const options = pickerOptions(uiSchema?.['ui:options'])
  const workspaces = options.workspaces ?? []

  return (
    <Select value={typeof value === 'string' ? value : ''} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id}>
        <SelectValue placeholder={options.placeholder ?? 'Select a workspace…'} />
      </SelectTrigger>
      <SelectContent>
        {workspaces.map((opt) => (
          <SelectItem key={opt.id} value={opt.id}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
