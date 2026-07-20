'use client'

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { LevelInput } from '@/app/(frontend)/scorecards/actions'

/**
 * Controlled editor for a scorecard's maturity ladder (IDP refocus P2). Each row
 * is a rung (name, rank, optional color). Rows can be added, removed and
 * reordered; the evaluator sorts by `rank`, so reordering is a convenience and
 * the rank field is authoritative. Pure controlled component — all state lives
 * in the parent form.
 */
export function LevelEditor({
  value,
  onChange,
}: {
  value: LevelInput[]
  onChange: (levels: LevelInput[]) => void
}) {
  function update(index: number, patch: Partial<LevelInput>) {
    onChange(value.map((lvl, i) => (i === index ? { ...lvl, ...patch } : lvl)))
  }

  function add() {
    const nextRank = value.reduce((max, l) => Math.max(max, l.rank), 0) + 1
    onChange([...value, { name: '', rank: nextRank, color: '' }])
  }

  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index))
  }

  function move(index: number, dir: -1 | 1) {
    const target = index + dir
    if (target < 0 || target >= value.length) return
    const next = [...value]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  return (
    <fieldset className="space-y-2">
      <legend className="sr-only">Maturity ladder</legend>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium" aria-hidden="true">
          Maturity ladder
        </span>
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus className="h-4 w-4" />
          Add level
        </Button>
      </div>

      {value.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
          No levels yet. Add rungs like Bronze, Silver, Gold to grade entities.
        </p>
      ) : (
        <div className="space-y-2">
          {value.map((level, index) => (
            <div key={index} className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <Label
                  htmlFor={`level-name-${index}`}
                  className={index === 0 ? 'text-xs text-muted-foreground' : 'sr-only'}
                >
                  {index === 0 ? (
                    <>
                      <span aria-hidden="true">Name</span>
                      <span className="sr-only">Level 1 name</span>
                    </>
                  ) : (
                    `Level ${index + 1} name`
                  )}
                </Label>
                <Input
                  id={`level-name-${index}`}
                  value={level.name}
                  placeholder="Silver"
                  onChange={(e) => update(index, { name: e.target.value })}
                />
              </div>
              <div className="w-20 space-y-1">
                <Label
                  htmlFor={`level-rank-${index}`}
                  className={index === 0 ? 'text-xs text-muted-foreground' : 'sr-only'}
                >
                  {index === 0 ? (
                    <>
                      <span aria-hidden="true">Rank</span>
                      <span className="sr-only">Level 1 rank</span>
                    </>
                  ) : (
                    `Level ${index + 1} rank`
                  )}
                </Label>
                <Input
                  id={`level-rank-${index}`}
                  type="number"
                  value={Number.isFinite(level.rank) ? level.rank : 0}
                  onChange={(e) => update(index, { rank: Number(e.target.value) })}
                />
              </div>
              <div className="w-28 space-y-1">
                <Label
                  htmlFor={`level-color-${index}`}
                  className={index === 0 ? 'text-xs text-muted-foreground' : 'sr-only'}
                >
                  {index === 0 ? (
                    <>
                      <span aria-hidden="true">Color</span>
                      <span className="sr-only">Level 1 color</span>
                    </>
                  ) : (
                    `Level ${index + 1} color`
                  )}
                </Label>
                <Input
                  id={`level-color-${index}`}
                  value={level.color ?? ''}
                  placeholder="#c0c0c0"
                  onChange={(e) => update(index, { color: e.target.value })}
                />
              </div>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label="Move level up"
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => move(index, 1)}
                  disabled={index === value.length - 1}
                  aria-label="Move level down"
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-muted-foreground hover:text-destructive"
                  onClick={() => remove(index)}
                  aria-label="Remove level"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </fieldset>
  )
}
