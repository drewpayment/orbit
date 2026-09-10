/**
 * Output builder panel — Template Authoring Phase 2, Task 12. A simple
 * repeatable list of `{ title, url }` / `{ title, entity }` link rows, with
 * expression-capable `url`/`entity` fields via `ExpressionInput`. Dispatches
 * a single `SET_OUTPUT` on every change — the whole `links[]` array is small
 * enough that per-row reducer actions would add complexity without benefit
 * (`builder-state.test.ts` covers `SET_OUTPUT` itself).
 */
'use client'

import * as React from 'react'
import type { TemplateDefinition } from '@/lib/scaffolder/schema'
import type { BuilderAction } from './builder-state'
import { getExpressionCandidates } from './expression-autocomplete'
import { ExpressionInput } from './ExpressionInput'
import type { ActionDescriptor } from '@/lib/scaffolder/validate'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Plus, Trash2 } from 'lucide-react'

export interface OutputBuilderProps {
  definition: TemplateDefinition
  dispatch: React.Dispatch<BuilderAction>
  registry: ActionDescriptor[]
}

export function OutputBuilder({ definition, dispatch, registry }: OutputBuilderProps) {
  const links = definition.spec.output?.links ?? []
  // Every step is "earlier" from the output block's perspective (it always
  // runs after the last step), matching `validate.ts`'s treatment of
  // `spec.output` expressions.
  const candidates = getExpressionCandidates(definition, definition.spec.steps.length, registry)

  function setLinks(next: typeof links) {
    dispatch({ type: 'SET_OUTPUT', output: { ...definition.spec.output, links: next } })
  }

  function updateLink(index: number, patch: Partial<(typeof links)[number]>) {
    setLinks(links.map((link, i) => (i === index ? { ...link, ...patch } : link)))
  }

  return (
    <div className="space-y-3">
      {links.map((link, index) => (
        <div key={index} className="grid grid-cols-1 gap-2 rounded-md border p-3 sm:grid-cols-3">
          <div>
            <Label htmlFor={`output-title-${index}`}>Title</Label>
            <Input
              id={`output-title-${index}`}
              value={link.title}
              onChange={(e) => updateLink(index, { title: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor={`output-url-${index}`}>URL</Label>
            <ExpressionInput
              id={`output-url-${index}`}
              value={link.url ?? ''}
              onChange={(v) => updateLink(index, { url: v || undefined })}
              candidates={candidates}
            />
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label htmlFor={`output-entity-${index}`}>Entity</Label>
              <ExpressionInput
                id={`output-entity-${index}`}
                value={link.entity ?? ''}
                onChange={(v) => updateLink(index, { entity: v || undefined })}
                candidates={candidates}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remove link"
              onClick={() => setLinks(links.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        onClick={() => setLinks([...links, { title: '' }])}
      >
        <Plus className="mr-1 h-4 w-4" /> Add link
      </Button>
    </div>
  )
}
