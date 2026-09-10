'use client'

/**
 * Orbit-native `SchemaForm` field: pick a repository through a git
 * connection. Scoped to `ui:options.workspaceId` + `ui:options.connection`
 * (a `git-connections` id), RBAC checked server-side by
 * `picker-data.ts#getReposForConnection` — see that module's KNOWN LIMITATION
 * doc comment: this is a v1 proxy over already-imported/discovered
 * `catalog-entities`, not a live GitHub/ADO repo browse.
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

export function OrbitRepoPicker({ id, uiSchema, value, onChange, disabled }: FieldComponentProps) {
  const options = pickerOptions(uiSchema?.['ui:options'])
  const [choices, setChoices] = React.useState<PickerOption[]>([])

  React.useEffect(() => {
    let cancelled = false
    if (!options.workspaceId || !options.connection) return
    async function load() {
      const fetcher =
        options.fetcher ??
        (await import('@/app/(frontend)/self-service/templates/picker-data-actions')).listReposForPicker
      const result = await fetcher(options.workspaceId as string, options.connection as string)
      if (!cancelled) setChoices(result)
    }
    void load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.workspaceId, options.connection])

  return (
    <Select value={typeof value === 'string' ? value : ''} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id}>
        <SelectValue placeholder={options.placeholder ?? 'Select a repository…'} />
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
