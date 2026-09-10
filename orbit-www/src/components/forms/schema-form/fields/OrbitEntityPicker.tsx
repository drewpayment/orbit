'use client'

/**
 * Orbit-native `SchemaForm` field: pick a catalog entity of a given `kind`
 * (service, api, resource, …), scoped to `ui:options.workspaceId` and RBAC
 * checked server-side by `picker-data.ts#getEntitiesForWorkspace`.
 */
import * as React from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { FieldComponentProps } from '../field-registry'
import { pickerOptions, type PickerOption } from './orbit-picker-types'

export function OrbitEntityPicker({ id, uiSchema, value, onChange, disabled }: FieldComponentProps) {
  const options = pickerOptions(uiSchema?.['ui:options'])
  const [choices, setChoices] = React.useState<PickerOption[]>([])

  React.useEffect(() => {
    let cancelled = false
    if (!options.workspaceId || !options.kind) return
    async function load() {
      const fetcher =
        options.fetcher ??
        (await import('@/app/(frontend)/self-service/templates/picker-data-actions')).listEntitiesForPicker
      const result = await fetcher(options.workspaceId as string, options.kind as string)
      if (!cancelled) setChoices(result)
    }
    void load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.workspaceId, options.kind])

  return (
    <Select value={typeof value === 'string' ? value : ''} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id}>
        <SelectValue placeholder={options.placeholder ?? 'Select an entity…'} />
      </SelectTrigger>
      <SelectContent>
        {choices.map((opt) => (
          <SelectItem key={opt.id} value={opt.id}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
