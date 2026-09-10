/**
 * Two-way YAML view — Template Authoring Phase 2, Task 13.
 *
 * Shows `serializeDefinition(state)` (the `orbit-template.yaml` v2 text form)
 * in a Monaco editor. On change (debounced ~400ms), `parseDefinitionYaml`
 * parses + shape-validates the text; on success it dispatches `REPLACE_ALL`
 * back into the Task 9 reducer, on failure it sets an inline Monaco error
 * marker and NEVER dispatches — architecture decision #3 (invalid YAML never
 * clobbers builder state).
 *
 * The editor's displayed text is NOT simply re-derived from `definition` on
 * every render (that would fight the user's cursor while typing); it only
 * resyncs from `definition` when the definition changed for a reason other
 * than this view's own last successful parse (e.g. the builder panels
 * editing a field, or an external `REPLACE_ALL`).
 */
'use client'

import * as React from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { TemplateDefinition } from '@/lib/scaffolder/schema'
import { parseDefinitionYaml, serializeDefinition } from './builder-state'

export interface YamlViewProps {
  definition: TemplateDefinition
  onReplaceAll: (definition: TemplateDefinition) => void
  /** Debounce delay in ms before parsing on change. Exposed for tests. */
  debounceMs?: number
}

export function YamlView({ definition, onReplaceAll, debounceMs = 400 }: YamlViewProps) {
  const lastAppliedText = React.useRef<string | null>(null)
  const [text, setText] = React.useState(() => serializeDefinition(definition))
  const [error, setError] = React.useState<string | null>(null)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const editorRef = React.useRef<Parameters<OnMount>[0] | null>(null)
  const monacoRef = React.useRef<Parameters<OnMount>[1] | null>(null)

  // Resync displayed text when `definition` changed from outside this view's
  // own last successfully-applied edit (external edit / initial load).
  React.useEffect(() => {
    const serialized = serializeDefinition(definition)
    if (serialized !== lastAppliedText.current) {
      setText(serialized)
      lastAppliedText.current = null
      setError(null)
    }
  }, [definition])

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  function setMarkers(message: string | null) {
    const monaco = monacoRef.current
    const editor = editorRef.current
    if (!monaco || !editor) return
    const model = editor.getModel?.()
    if (!model) return
    monaco.editor.setModelMarkers(
      model,
      'template-yaml',
      message
        ? [
            {
              startLineNumber: 1,
              startColumn: 1,
              endLineNumber: model.getLineCount(),
              endColumn: 1,
              message,
              severity: monaco.MarkerSeverity.Error,
            },
          ]
        : [],
    )
  }

  function handleChange(value: string | undefined) {
    const next = value ?? ''
    setText(next)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      const result = parseDefinitionYaml(next)
      if (!result.ok || !result.definition) {
        setError(result.error ?? 'Invalid YAML')
        setMarkers(result.error ?? 'Invalid YAML')
        return
      }
      setError(null)
      setMarkers(null)
      lastAppliedText.current = next
      onReplaceAll(result.definition)
    }, debounceMs)
  }

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
  }

  return (
    <div className="flex h-full flex-col">
      {error && (
        <div role="alert" className="border-b bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      <div className="min-h-[300px] flex-1">
        <Editor
          language="yaml"
          value={text}
          onChange={handleChange}
          onMount={handleMount}
          options={{ minimap: { enabled: false }, fontSize: 13 }}
        />
      </div>
    </div>
  )
}
