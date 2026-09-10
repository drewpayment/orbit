/**
 * Parameters (form) builder panel — Template Authoring Phase 2, Task 10.
 *
 * Portal's "Append field" model: an ordered list of parameter pages, each
 * with a list of field rows (name/type/label/help/required/default/
 * validation/`ui:visibleIf`/`ui:field`). Editing dispatches directly into the
 * Task 9 reducer — this component holds no field state of its own beyond the
 * ephemeral row model used to render inputs, computed fresh from `pages` on
 * every render (so external edits, e.g. from `YamlView`'s `REPLACE_ALL`,
 * always win).
 */
'use client'

import * as React from 'react'
import type { ParameterPage } from '@/lib/scaffolder/schema'
import type { BuilderAction } from './builder-state'
import {
  PARAMETER_FIELD_TYPE_OPTIONS,
  UI_FIELD_OPTIONS,
  isDuplicateFieldName,
  propertyFromRow,
  rowFromNameAndProperty,
  validateParameterFieldRows,
  type ParameterFieldRow,
} from './parameter-field-row'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Trash2, ChevronUp, ChevronDown, Plus } from 'lucide-react'

export interface ParametersBuilderProps {
  pages: ParameterPage[]
  dispatch: React.Dispatch<BuilderAction>
}

function pageRows(page: ParameterPage): ParameterFieldRow[] {
  const required = new Set(page.required ?? [])
  return Object.entries(page.properties).map(([name, property]) =>
    rowFromNameAndProperty(name, property, required.has(name)),
  )
}

/** Smallest `field<N>` name not already used on the page (avoids silently overwriting a same-named field). */
function nextFieldName(page: ParameterPage): string {
  let n = Object.keys(page.properties).length + 1
  while (`field${n}` in page.properties) n += 1
  return `field${n}`
}

export function ParametersBuilder({ pages, dispatch }: ParametersBuilderProps) {
  return (
    <div className="space-y-6">
      {pages.map((page, pageIndex) => (
        <ParameterPageEditor
          key={page.title + pageIndex}
          page={page}
          pageIndex={pageIndex}
          pageCount={pages.length}
          dispatch={dispatch}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        onClick={() => dispatch({ type: 'ADD_PARAMETER_PAGE', title: `Page ${pages.length + 1}` })}
      >
        <Plus className="mr-1 h-4 w-4" /> Add page
      </Button>
    </div>
  )
}

function ParameterPageEditor({
  page,
  pageIndex,
  pageCount,
  dispatch,
}: {
  page: ParameterPage
  pageIndex: number
  pageCount: number
  dispatch: React.Dispatch<BuilderAction>
}) {
  const rows = pageRows(page)
  const error = validateParameterFieldRows(rows)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <Input
          aria-label="Page title"
          value={page.title}
          onChange={(e) =>
            dispatch({ type: 'UPDATE_PARAMETER_PAGE', index: pageIndex, title: e.target.value })
          }
          className="max-w-xs font-medium"
        />
        <div className="ml-auto flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Move page up"
            disabled={pageIndex === 0}
            onClick={() => dispatch({ type: 'REORDER_PARAMETER_PAGE', index: pageIndex, delta: -1 })}
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Move page down"
            disabled={pageIndex === pageCount - 1}
            onClick={() => dispatch({ type: 'REORDER_PARAMETER_PAGE', index: pageIndex, delta: 1 })}
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Remove page"
            onClick={() => dispatch({ type: 'REMOVE_PARAMETER_PAGE', index: pageIndex })}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.map((row, rowIndex) => (
          <FieldRowEditor
            // Keyed by position: `row.id` is regenerated on every render by
            // `pageRows`, and keying by `row.name` remounted the row on every
            // rename keystroke (dropping focus from the Name input). Each
            // row's local drafts resync from props when its row changes.
            key={rowIndex}
            row={row}
            rowIndex={rowIndex}
            rowCount={rows.length}
            pageIndex={pageIndex}
            siblingNames={rows.filter((r) => r.name !== row.name).map((r) => r.name)}
            dispatch={dispatch}
          />
        ))}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() =>
            dispatch({
              type: 'ADD_FIELD',
              pageIndex,
              name: nextFieldName(page),
              property: { type: 'string' },
            })
          }
        >
          <Plus className="mr-1 h-4 w-4" /> Append field
        </Button>
      </CardContent>
    </Card>
  )
}

/**
 * Local draft for a text input whose committed value is normalized by
 * `propertyFromRow` (trimmed, or split/joined for enum options). Without this
 * the controlled input re-renders with the normalized value and a trailing
 * space or comma vanishes the instant it is typed. The draft resyncs from the
 * committed value only when they genuinely diverge (e.g. YamlView REPLACE_ALL),
 * not when the difference is whitespace the normalizer will strip.
 */
function useDraft(committed: string, normalize: (draft: string) => string): [string, (v: string) => void] {
  const [draft, setDraft] = React.useState(committed)
  React.useEffect(() => {
    setDraft((current) => (normalize(current) === committed ? current : committed))
  }, [committed, normalize])
  return [draft, setDraft]
}

const trimNormalize = (v: string) => v.trim()
const enumNormalize = (v: string) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ')

const UI_FIELD_DEFAULT_SENTINEL = '__default'

function FieldRowEditor({
  row,
  rowIndex,
  rowCount,
  pageIndex,
  siblingNames,
  dispatch,
}: {
  row: ParameterFieldRow
  rowIndex: number
  rowCount: number
  pageIndex: number
  /** Other fields' current names on this page (excludes this row itself). */
  siblingNames: string[]
  dispatch: React.Dispatch<BuilderAction>
}) {
  // The Name field needs its own local draft: `UPDATE_FIELD` is a true no-op
  // (builder-state.ts) when a rename collides with a sibling, which means no
  // re-render happens and `row.name` never reflects what was typed. Track it
  // locally so a rejected keystroke doesn't vanish from the input, and resync
  // from `row.name` whenever a rename actually lands (or an external edit —
  // e.g. YamlView's REPLACE_ALL — changes it).
  const [nameDraft, setNameDraft] = React.useState(row.name)
  const [nameError, setNameError] = React.useState<string | null>(null)
  React.useEffect(() => {
    setNameDraft(row.name)
    setNameError(null)
  }, [row.name])

  function commit(patch: Partial<ParameterFieldRow>) {
    const next = { ...row, ...patch }
    dispatch({
      type: 'UPDATE_FIELD',
      pageIndex,
      name: row.name,
      renameTo: next.name,
      property: propertyFromRow(next),
      required: next.required,
    })
  }

  function handleNameChange(value: string) {
    setNameDraft(value)
    if (isDuplicateFieldName(siblingNames, row.name, value)) {
      setNameError(`A field named "${value}" already exists on this page.`)
      return // the reducer would reject this rename too — don't bother dispatching
    }
    setNameError(null)
    commit({ name: value })
  }

  const [labelDraft, setLabelDraft] = useDraft(row.label, trimNormalize)
  const [defaultDraft, setDefaultDraft] = useDraft(row.defaultValue, trimNormalize)
  const [helpDraft, setHelpDraft] = useDraft(row.help, trimNormalize)
  const [patternDraft, setPatternDraft] = useDraft(row.pattern, trimNormalize)
  const [enumDraft, setEnumDraft] = useDraft(row.enumOptions, enumNormalize)
  const [visibleIfDraft, setVisibleIfDraft] = useDraft(row.visibleIf, trimNormalize)

  const fid = (suffix: string) => `${row.id}-${suffix}`

  return (
    <div className="grid grid-cols-1 gap-2 rounded-md border p-3 sm:grid-cols-2">
      <div>
        <Label htmlFor={fid('name')}>Name</Label>
        <Input
          id={fid('name')}
          value={nameDraft}
          onChange={(e) => handleNameChange(e.target.value)}
          aria-invalid={!!nameError}
        />
        {nameError && (
          <p role="alert" className="text-sm text-destructive">
            {nameError}
          </p>
        )}
      </div>
      <div>
        <Label htmlFor={fid('type')}>Type</Label>
        <Select value={row.type} onValueChange={(v) => commit({ type: v as ParameterFieldRow['type'] })}>
          <SelectTrigger id={fid('type')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PARAMETER_FIELD_TYPE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor={fid('label')}>Label</Label>
        <Input
          id={fid('label')}
          value={labelDraft}
          onChange={(e) => {
            setLabelDraft(e.target.value)
            commit({ label: e.target.value })
          }}
        />
      </div>
      <div>
        <Label htmlFor={fid('default')}>Default</Label>
        <Input
          id={fid('default')}
          value={defaultDraft}
          onChange={(e) => {
            setDefaultDraft(e.target.value)
            commit({ defaultValue: e.target.value })
          }}
        />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor={fid('help')}>Help text</Label>
        <Textarea
          id={fid('help')}
          value={helpDraft}
          onChange={(e) => {
            setHelpDraft(e.target.value)
            commit({ help: e.target.value })
          }}
        />
      </div>
      {row.type === 'string' && (
        <>
          <div>
            <Label htmlFor={fid('pattern')}>Pattern</Label>
            <Input
              id={fid('pattern')}
              value={patternDraft}
              onChange={(e) => {
                setPatternDraft(e.target.value)
                commit({ pattern: e.target.value })
              }}
            />
          </div>
          <div>
            <Label htmlFor={fid('enum')}>Enum options (comma-separated)</Label>
            <Input
              id={fid('enum')}
              value={enumDraft}
              placeholder="dev, staging, prod"
              onChange={(e) => {
                setEnumDraft(e.target.value)
                commit({ enumOptions: e.target.value })
              }}
            />
          </div>
        </>
      )}
      {(row.type === 'number' || row.type === 'integer') && (
        <>
          <div>
            <Label htmlFor={fid('min')}>Minimum</Label>
            <Input id={fid('min')} value={row.minimum} onChange={(e) => commit({ minimum: e.target.value })} />
          </div>
          <div>
            <Label htmlFor={fid('max')}>Maximum</Label>
            <Input id={fid('max')} value={row.maximum} onChange={(e) => commit({ maximum: e.target.value })} />
          </div>
        </>
      )}
      <div>
        <Label htmlFor={fid('visibleIf')}>Show only when (optional)</Label>
        <Input
          id={fid('visibleIf')}
          value={visibleIfDraft}
          placeholder={'${{ parameters.deployTarget == "kubernetes" }}'}
          onChange={(e) => {
            setVisibleIfDraft(e.target.value)
            commit({ visibleIf: e.target.value })
          }}
        />
        <p className="text-xs text-muted-foreground">
          Hide this field until another parameter has a value. Supports{' '}
          <code>{'${{ parameters.x }}'}</code> (truthy), <code>{'${{ !parameters.x }}'}</code>, and{' '}
          <code>{'${{ parameters.x == "value" }}'}</code>. Leave blank to always show.
        </p>
      </div>
      <div>
        <Label htmlFor={fid('uiField')}>Field widget</Label>
        <Select
          value={row.uiField || UI_FIELD_DEFAULT_SENTINEL}
          onValueChange={(v) => commit({ uiField: v === UI_FIELD_DEFAULT_SENTINEL ? '' : v })}
        >
          <SelectTrigger id={fid('uiField')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {UI_FIELD_OPTIONS.map((opt) => (
              <SelectItem key={opt.value || UI_FIELD_DEFAULT_SENTINEL} value={opt.value || UI_FIELD_DEFAULT_SENTINEL}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id={`${row.id}-required`}
          checked={row.required}
          onCheckedChange={(checked) => commit({ required: checked === true })}
        />
        <Label htmlFor={`${row.id}-required`}>Required</Label>
      </div>
      <div className="flex items-center justify-end gap-1 sm:col-span-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Move field up"
          disabled={rowIndex === 0}
          onClick={() => dispatch({ type: 'REORDER_FIELD', pageIndex, index: rowIndex, delta: -1 })}
        >
          <ChevronUp className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Move field down"
          disabled={rowIndex === rowCount - 1}
          onClick={() => dispatch({ type: 'REORDER_FIELD', pageIndex, index: rowIndex, delta: 1 })}
        >
          <ChevronDown className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Remove field"
          onClick={() => dispatch({ type: 'REMOVE_FIELD', pageIndex, name: row.name })}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
