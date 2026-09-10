import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react'
import { YamlView } from './YamlView'
import { serializeDefinition } from './builder-state'
import type { TemplateDefinition } from '@/lib/scaffolder/schema'

const setModelMarkers = vi.fn()

function MockMonacoEditor({
  value,
  onChange,
  onMount,
}: {
  value: string
  onChange: (v: string | undefined) => void
  onMount?: (editor: unknown, monaco: unknown) => void
}) {
  React.useEffect(() => {
    onMount?.(
      { getModel: () => ({ getLineCount: () => 1 }) },
      { editor: { setModelMarkers }, MarkerSeverity: { Error: 8 } },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <textarea data-testid="yaml-editor" value={value} onChange={(e) => onChange(e.target.value)} />
}

vi.mock('@monaco-editor/react', () => ({
  default: MockMonacoEditor,
}))

afterEach(() => {
  cleanup()
  vi.clearAllTimers()
  vi.useRealTimers()
  setModelMarkers.mockClear()
})

function fixtureDefinition(): TemplateDefinition {
  return {
    apiVersion: 'orbit/v2',
    kind: 'Template',
    metadata: { name: 'svc', title: 'Service', owner: 'team:platform' },
    spec: {
      parameters: [{ title: 'Service', properties: { name: { type: 'string' } } }],
      steps: [{ id: 's1', name: 'Step 1', action: 'fs:render', input: {} }],
    },
  }
}

describe('YamlView', () => {
  it('displays the serialized definition on mount', () => {
    const definition = fixtureDefinition()
    render(<YamlView definition={definition} onReplaceAll={vi.fn()} />)
    const editor = screen.getByTestId('yaml-editor') as HTMLTextAreaElement
    expect(editor.value).toBe(serializeDefinition(definition))
  })

  it('dispatches REPLACE_ALL (via onReplaceAll) after a valid debounced edit', () => {
    vi.useFakeTimers()
    const definition = fixtureDefinition()
    const onReplaceAll = vi.fn()
    render(<YamlView definition={definition} onReplaceAll={onReplaceAll} debounceMs={400} />)

    const edited: TemplateDefinition = {
      ...definition,
      metadata: { ...definition.metadata, title: 'Renamed Service' },
    }
    const editor = screen.getByTestId('yaml-editor')
    fireEvent.change(editor, { target: { value: serializeDefinition(edited) } })

    expect(onReplaceAll).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(400) })

    expect(onReplaceAll).toHaveBeenCalledTimes(1)
    expect(onReplaceAll).toHaveBeenCalledWith(edited)
    expect(setModelMarkers).toHaveBeenCalledWith(expect.anything(), 'template-yaml', [])
  })

  it('never dispatches and shows an inline error on invalid YAML', () => {
    vi.useFakeTimers()
    const definition = fixtureDefinition()
    const onReplaceAll = vi.fn()
    render(<YamlView definition={definition} onReplaceAll={onReplaceAll} debounceMs={400} />)

    const editor = screen.getByTestId('yaml-editor')
    fireEvent.change(editor, { target: { value: 'not: [valid, yaml' } })
    act(() => { vi.advanceTimersByTime(400) })

    expect(onReplaceAll).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(setModelMarkers).toHaveBeenCalledWith(
      expect.anything(),
      'template-yaml',
      expect.arrayContaining([expect.objectContaining({ severity: 8 })]),
    )
  })

  it('never dispatches on YAML that parses but fails shape validation', () => {
    vi.useFakeTimers()
    const definition = fixtureDefinition()
    const onReplaceAll = vi.fn()
    render(<YamlView definition={definition} onReplaceAll={onReplaceAll} debounceMs={400} />)

    const editor = screen.getByTestId('yaml-editor')
    fireEvent.change(editor, { target: { value: 'apiVersion: orbit/v2\nkind: Template\n' } })
    act(() => { vi.advanceTimersByTime(400) })

    expect(onReplaceAll).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('resyncs displayed text when the definition changes externally', () => {
    const definition = fixtureDefinition()
    const { rerender } = render(<YamlView definition={definition} onReplaceAll={vi.fn()} />)
    const externallyChanged: TemplateDefinition = {
      ...definition,
      metadata: { ...definition.metadata, title: 'Changed elsewhere' },
    }
    rerender(<YamlView definition={externallyChanged} onReplaceAll={vi.fn()} />)
    const editor = screen.getByTestId('yaml-editor') as HTMLTextAreaElement
    expect(editor.value).toBe(serializeDefinition(externallyChanged))
  })
})
