'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ENTITY_KINDS, RELATION_TYPES } from '@/collections/catalog/constants'
import {
  buildSaveEntityTypeInput,
  validateEntityTypeForm,
  type EntityTypeFormState,
  type RequiredMetadataRow,
  type RequiredRelationRow,
} from './EntityTypeFormLogic'
import { saveEntityType } from '@/app/(frontend)/catalog/types/actions'
import type { EntityTypeDefinition } from '@/lib/catalog/entity-types'

const ANY_KIND = '__any__'

/** Build the editable form state from a resolved {@link EntityTypeDefinition}. */
function formStateFromDefinition(def: EntityTypeDefinition): EntityTypeFormState {
  return {
    displayName: def.displayName,
    description: def.description ?? '',
    baseValue: String(def.baseValue),
    scoringWeight: String(def.scoringWeight),
    goldenPath: {
      summary: def.goldenPath.summary ?? '',
      docsUrl: def.goldenPath.docsUrl ?? '',
      requiredRelations: def.goldenPath.requiredRelations.map((r) => ({
        relationType: r.relationType,
        direction: r.direction,
        targetKind: r.targetKind ?? '',
        min: String(r.min),
      })),
      requiredMetadata: def.goldenPath.requiredMetadata.map((m) => ({
        path: m.path,
        label: m.label ?? '',
      })),
    },
  }
}

/**
 * Edit form for one catalog kind's `entity-types` definition (Entity Scores &
 * Golden Paths, docs/plans/2026-07-01-entity-scores-and-golden-paths.md).
 * Owner/admin only — the page only renders this for users its server-computed
 * `canManage` flag already permits; the RBAC gate itself lives in
 * `catalog/types/actions.ts → saveEntityType`. Pre-filled from the resolved
 * definition, whether that's a stored row or the pure built-in default (saving
 * always creates-or-updates the (workspace, kind) row).
 */
export function EntityTypeForm({
  kind,
  initial,
}: {
  kind: string
  initial: EntityTypeDefinition
}) {
  const router = useRouter()
  const [form, setForm] = useState<EntityTypeFormState>(() => formStateFromDefinition(initial))
  const [submitting, setSubmitting] = useState(false)

  function patch(fields: Partial<EntityTypeFormState>) {
    setForm((f) => ({ ...f, ...fields }))
  }

  function patchGoldenPath(fields: Partial<EntityTypeFormState['goldenPath']>) {
    setForm((f) => ({ ...f, goldenPath: { ...f.goldenPath, ...fields } }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const error = validateEntityTypeForm(form)
    if (error) {
      toast.error(error)
      return
    }

    setSubmitting(true)
    try {
      await saveEntityType(buildSaveEntityTypeInput(kind, form))
      toast.success('Entity type saved')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save entity type')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="et-display-name">Display name</Label>
        <Input
          id="et-display-name"
          value={form.displayName}
          onChange={(e) => patch({ displayName: e.target.value })}
          placeholder="Backend Service"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="et-description">Description</Label>
        <Textarea
          id="et-description"
          value={form.description}
          onChange={(e) => patch({ description: e.target.value })}
          placeholder="What this type means here."
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="et-base-value">Base value (0-100)</Label>
          <Input
            id="et-base-value"
            type="number"
            min={0}
            max={100}
            value={form.baseValue}
            onChange={(e) => patch({ baseValue: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            The score an entity of this kind carries when no scorecard applies to it.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="et-scoring-weight">Scoring weight</Label>
          <Input
            id="et-scoring-weight"
            type="number"
            min={0}
            value={form.scoringWeight}
            onChange={(e) => patch({ scoringWeight: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            How much this kind counts when scorecards aggregate related entities.
          </p>
        </div>
      </div>

      <div className="space-y-3 rounded-md border bg-muted/30 p-3">
        <Label className="text-sm font-semibold">Golden path</Label>
        <div className="space-y-1.5">
          <Label htmlFor="et-gp-summary">Summary</Label>
          <Textarea
            id="et-gp-summary"
            value={form.goldenPath.summary}
            onChange={(e) => patchGoldenPath({ summary: e.target.value })}
            placeholder="Narrative for leaders."
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="et-gp-docs">Docs URL</Label>
          <Input
            id="et-gp-docs"
            value={form.goldenPath.docsUrl}
            onChange={(e) => patchGoldenPath({ docsUrl: e.target.value })}
            placeholder="https://docs.example.com/paved-road/service"
          />
        </div>

        <RequiredRelationsEditor
          value={form.goldenPath.requiredRelations}
          onChange={(requiredRelations) => patchGoldenPath({ requiredRelations })}
        />
        <RequiredMetadataEditor
          value={form.goldenPath.requiredMetadata}
          onChange={(requiredMetadata) => patchGoldenPath({ requiredMetadata })}
        />
      </div>

      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Save definition
        </Button>
      </div>
    </form>
  )
}

/**
 * Controlled editor for the golden path's `requiredRelations` rows: structural
 * expectations checked against an entity's actual relations. Mirrors the
 * relation-check fields in `scorecards/RuleBuilder.tsx` but pulls its
 * vocabularies straight from `@/collections/catalog/constants` (this form
 * lives in the catalog feature, not scorecards).
 */
function RequiredRelationsEditor({
  value,
  onChange,
}: {
  value: RequiredRelationRow[]
  onChange: (rows: RequiredRelationRow[]) => void
}) {
  function update(index: number, patch: Partial<RequiredRelationRow>) {
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }
  function add() {
    onChange([...value, { relationType: RELATION_TYPES[0], direction: 'either', targetKind: '', min: '1' }])
  }
  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">Required relations</Label>
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus className="h-4 w-4" />
          Add relation
        </Button>
      </div>
      {value.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">
          No structural expectations yet.
        </p>
      ) : (
        <div className="space-y-2">
          {value.map((row, index) => (
            <div key={index} className="flex flex-wrap items-end gap-2 rounded-md border bg-background p-2">
              <div className="min-w-[140px] flex-1 space-y-1">
                {index === 0 && <Label className="text-xs text-muted-foreground">Relation type</Label>}
                <Select value={row.relationType} onValueChange={(v) => update(index, { relationType: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RELATION_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-[120px] flex-1 space-y-1">
                {index === 0 && <Label className="text-xs text-muted-foreground">Direction</Label>}
                <Select
                  value={row.direction}
                  onValueChange={(v) => update(index, { direction: v as RequiredRelationRow['direction'] })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="either">Either direction</SelectItem>
                    <SelectItem value="from">From this entity</SelectItem>
                    <SelectItem value="to">To this entity</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-[120px] flex-1 space-y-1">
                {index === 0 && <Label className="text-xs text-muted-foreground">Target kind</Label>}
                <Select
                  value={row.targetKind || ANY_KIND}
                  onValueChange={(v) => update(index, { targetKind: v === ANY_KIND ? '' : v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY_KIND}>Any kind</SelectItem>
                    {ENTITY_KINDS.map((k) => (
                      <SelectItem key={k} value={k} className="capitalize">
                        {k}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-20 space-y-1">
                {index === 0 && <Label className="text-xs text-muted-foreground">Min</Label>}
                <Input
                  type="number"
                  min={0}
                  value={row.min}
                  onChange={(e) => update(index, { min: e.target.value })}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-muted-foreground hover:text-destructive"
                onClick={() => remove(index)}
                aria-label="Remove required relation"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Controlled editor for the golden path's `requiredMetadata` rows: expected
 * `metadata.*`/field paths on the entity, each with an optional human label.
 */
function RequiredMetadataEditor({
  value,
  onChange,
}: {
  value: RequiredMetadataRow[]
  onChange: (rows: RequiredMetadataRow[]) => void
}) {
  function update(index: number, patch: Partial<RequiredMetadataRow>) {
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }
  function add() {
    onChange([...value, { path: '', label: '' }])
  }
  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">Required metadata</Label>
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus className="h-4 w-4" />
          Add field
        </Button>
      </div>
      {value.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">
          No expected metadata fields yet.
        </p>
      ) : (
        <div className="space-y-2">
          {value.map((row, index) => (
            <div key={index} className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                {index === 0 && <Label className="text-xs text-muted-foreground">Path</Label>}
                <Input
                  value={row.path}
                  placeholder="metadata.costCenter"
                  onChange={(e) => update(index, { path: e.target.value })}
                />
              </div>
              <div className="flex-1 space-y-1">
                {index === 0 && <Label className="text-xs text-muted-foreground">Label</Label>}
                <Input
                  value={row.label}
                  placeholder="Cost center"
                  onChange={(e) => update(index, { label: e.target.value })}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-muted-foreground hover:text-destructive"
                onClick={() => remove(index)}
                aria-label="Remove required metadata field"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
