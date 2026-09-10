'use client'

/**
 * Orbit-native `SchemaForm` field: pick a workspace "team" member.
 *
 * There is no `teams` collection in this repo yet (verified against
 * `src/collections/*` — only `Workspaces`/`WorkspaceMembers`/
 * `UserWorkspaceRoles`). Per the Phase 2 task instructions, this proxies with
 * the workspace's active members (server-scoped to the caller's own
 * membership — see `picker-data.ts#getTeamsForWorkspace`) rather than a real
 * team entity. Revisit once a `teams` collection exists.
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

export function OrbitTeamPicker({ id, uiSchema, value, onChange, disabled }: FieldComponentProps) {
  const options = pickerOptions(uiSchema?.['ui:options'])
  const [choices, setChoices] = React.useState<PickerOption[]>([])

  React.useEffect(() => {
    let cancelled = false
    if (!options.workspaceId) return
    async function load() {
      // Dynamically imported so this 'use client' module never eagerly pulls
      // in @payload-config (and its DATABASE_URI requirement) — including in
      // component tests, which always stub `fetcher` and so never reach here.
      const fetcher =
        options.fetcher ??
        (await import('@/app/(frontend)/self-service/templates/picker-data-actions')).listTeamsForPicker
      const result = await fetcher(options.workspaceId as string)
      if (!cancelled) setChoices(result)
    }
    void load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.workspaceId])

  return (
    <Select value={typeof value === 'string' ? value : ''} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id}>
        <SelectValue placeholder={options.placeholder ?? 'Select a team member…'} />
      </SelectTrigger>
      <SelectContent>
        {choices.map((opt) => (
          <SelectItem key={opt.id} value={opt.id}>
            {opt.label}
            {opt.description ? ` (${opt.description})` : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
