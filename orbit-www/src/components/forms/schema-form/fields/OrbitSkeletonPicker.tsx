'use client'

/**
 * Orbit-native `SchemaForm` field: pick a `template-skeletons` bundle for the
 * `fetch:orbit-skeleton` scaffolder action's `skeletonId` input (Template
 * Authoring Phase 3, Task 5 — docs/plans/2026-09-10-template-authoring-phase-3-greenfield-content.md
 * §3.4, §5 Task 5).
 *
 * Same shape as the other Orbit pickers (`OrbitTeamPicker`,
 * `OrbitRepoPicker`, `OrbitEntityPicker`): scoped to `ui:options.workspaceId`,
 * RBAC-checked server-side by `picker-data.ts#getSkeletonsForWorkspace`
 * (never leaks another workspace's skeletons). Differs from the others in
 * two ways the task calls for explicitly:
 *  - an explicit loading state (skeleton authoring is a heavier fetch than
 *    the other pickers' small lookups, so the gap before options appear is
 *    worth signposting), and
 *  - an empty state with a link into the skeleton authoring flow, since
 *    "no skeletons yet" is an expected first-run state for this picker
 *    specifically (an author configuring `fetch:orbit-skeleton` before any
 *    skeleton has been created).
 */
import * as React from 'react'
import Link from 'next/link'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatBytes } from '@/lib/utils/format'
import type { FieldComponentProps } from '../field-registry'
import { pickerOptions } from './orbit-picker-types'
import type { SkeletonPickerOption } from '@/app/(frontend)/self-service/templates/picker-data'

export function OrbitSkeletonPicker({ id, uiSchema, value, onChange, disabled }: FieldComponentProps) {
  const options = pickerOptions(uiSchema?.['ui:options'])
  const [choices, setChoices] = React.useState<SkeletonPickerOption[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    if (!options.workspaceId) {
      setLoading(false)
      return
    }
    setLoading(true)
    async function load() {
      // Dynamically imported so this 'use client' module never eagerly pulls
      // in @payload-config (and its DATABASE_URI requirement) — including in
      // component tests, which always stub `fetcher` and so never reach here.
      const fetcher =
        (options.fetcher as ((workspaceId: string) => Promise<SkeletonPickerOption[]>) | undefined) ??
        (await import('@/app/(frontend)/self-service/templates/picker-data-actions')).listSkeletonsForPicker
      const result = await fetcher(options.workspaceId as string)
      if (!cancelled) {
        setChoices(result)
        setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.workspaceId])

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading skeletons…</p>
  }

  if (choices.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No skeletons yet.{' '}
        <Link href="/self-service/templates/skeletons/new" className="underline underline-offset-2">
          Create a skeleton
        </Link>{' '}
        to fetch from this step.
      </p>
    )
  }

  return (
    <Select value={typeof value === 'string' ? value : ''} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id}>
        <SelectValue placeholder={options.placeholder ?? 'Select a skeleton…'} />
      </SelectTrigger>
      <SelectContent>
        {choices.map((opt) => (
          <SelectItem key={opt.id} value={opt.id}>
            {opt.name} ({opt.fileCount} {opt.fileCount === 1 ? 'file' : 'files'}, {formatBytes(opt.totalSize)})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
