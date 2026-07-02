'use client'

import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  LINK_TYPE_OPTIONS,
  newLinkRow,
  validateLinkRow,
  type LinkRow,
} from './entity-form-ui'

interface EntityLinksEditorProps {
  rows: LinkRow[]
  onChange: (rows: LinkRow[]) => void
  disabled?: boolean
}

/**
 * Repeatable add/remove editor for an entity's links (docs, dashboards,
 * runbooks…). Presentational: it owns no async state, just edits the `rows`
 * array via `onChange`. Per-row validation messages come from the shared pure
 * helper so the inline hints match the submit-time gate.
 */
export function EntityLinksEditor({ rows, onChange, disabled }: EntityLinksEditorProps) {
  function update(index: number, patch: Partial<Omit<LinkRow, 'key'>>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function remove(index: number) {
    onChange(rows.filter((_, i) => i !== index))
  }

  function add() {
    onChange([...rows, newLinkRow()])
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>Links</Label>
        <Button type="button" variant="outline" size="sm" onClick={add} disabled={disabled}>
          <Plus className="h-4 w-4" />
          Add link
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
          No links yet. Add docs, dashboards or runbooks so others can find them.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((row, index) => {
            const error = validateLinkRow(row)
            return (
              <div key={row.key} className="space-y-1.5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                  <Input
                    aria-label="Link label"
                    placeholder="Label (e.g. API docs)"
                    value={row.label}
                    onChange={(e) => update(index, { label: e.target.value })}
                    disabled={disabled}
                    className="sm:w-[28%]"
                  />
                  <Input
                    aria-label="Link URL"
                    placeholder="https://…"
                    value={row.url}
                    onChange={(e) => update(index, { url: e.target.value })}
                    disabled={disabled}
                    className="flex-1"
                  />
                  <Select
                    value={row.type}
                    onValueChange={(v) => update(index, { type: v as LinkRow['type'] })}
                    disabled={disabled}
                  >
                    <SelectTrigger aria-label="Link type" className="sm:w-[9rem]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LINK_TYPE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove link"
                    onClick={() => remove(index)}
                    disabled={disabled}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {error && <p className="text-xs text-destructive">{error}</p>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
