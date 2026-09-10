/**
 * Fixtures panel — Template Authoring Phase 2, Task 14.
 *
 * "Golden inputs" (design §3.2): named sample parameter values saved on the
 * definition so a dry run is one click rather than a re-typed form. CRUD only
 * — the dry-run panel is what consumes them.
 *
 * The server actions arrive as props from the editor shell rather than being
 * imported here, so this renders under test without a Payload instance. Both
 * are RBAC-gated server-side, so nothing here is load-bearing for
 * authorization.
 */
'use client'

import * as React from 'react'
import { Loader2, Play, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

/** A fixture row as stored on `template-definitions.fixtures`. */
export interface FixtureRow {
  id?: string | null
  name: string
  values?: unknown
}

export interface FixturesPanelProps {
  definitionId: string
  fixtures: FixtureRow[]
  /** The parameter values currently in the dry-run form, saved as a new fixture. */
  currentValues?: Record<string, unknown>
  /** Load a fixture's values back into the dry-run form. Omit to hide the affordance. */
  onApply?: (values: Record<string, unknown>) => void
  /**
   * The `saveFixture` / `deleteFixture` server actions, injected by the
   * editor shell rather than imported here (see ValidationPanel for why).
   * Omitting them renders the list read-only.
   */
  saveFixture?: (
    definitionId: string,
    fixture: { id?: string; name: string; values?: unknown },
  ) => Promise<{ id: string }>
  deleteFixture?: (definitionId: string, fixtureId: string) => Promise<void>
  /** Called after a successful write so the parent can refresh server data. */
  onChanged?: () => void
}

function asRecord(values: unknown): Record<string, unknown> {
  return typeof values === 'object' && values !== null && !Array.isArray(values)
    ? (values as Record<string, unknown>)
    : {}
}

export function FixturesPanel({
  definitionId,
  fixtures,
  currentValues,
  onApply,
  saveFixture,
  deleteFixture,
  onChanged,
}: FixturesPanelProps) {
  const [name, setName] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)

  async function onSave() {
    const trimmed = name.trim()
    setError(null)
    if (!trimmed) {
      setError('A fixture name is required.')
      return
    }
    if (!saveFixture) return
    setBusy('save')
    try {
      await saveFixture(definitionId, { name: trimmed, values: currentValues ?? {} })
      setName('')
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the fixture.')
    } finally {
      setBusy(null)
    }
  }

  async function onDelete(fixtureId: string) {
    setError(null)
    if (!deleteFixture) return
    setBusy(fixtureId)
    try {
      await deleteFixture(definitionId, fixtureId)
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the fixture.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Fixtures</h3>
      <p className="text-xs text-muted-foreground">
        Named sample inputs for one-click dry runs.
      </p>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {fixtures.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
          No fixtures saved yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {fixtures.map((fixture, i) => (
            <li
              key={fixture.id ?? `${fixture.name}:${i}`}
              className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
            >
              <span className="truncate text-sm">{fixture.name}</span>
              <span className="flex shrink-0 items-center gap-1">
                {onApply ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Use fixture ${fixture.name}`}
                    onClick={() => onApply(asRecord(fixture.values))}
                  >
                    <Play className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
                {fixture.id && deleteFixture ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete fixture ${fixture.name}`}
                    disabled={busy === fixture.id}
                    onClick={() => void onDelete(fixture.id as string)}
                  >
                    {busy === fixture.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2 border-t pt-3">
        <Label htmlFor="fixture-name">Fixture name</Label>
        <div className="flex gap-2">
          <Input
            id="fixture-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Minimal"
          />
          <Button size="sm" variant="outline" disabled={busy === 'save'} onClick={() => void onSave()}>
            {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save fixture
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Saves the values currently entered in the dry-run form.
        </p>
      </div>
    </div>
  )
}
