/**
 * Template authoring builder state (Template Authoring Phase 2, Task 9).
 *
 * A pure `useReducer` reducer over the exact wire shape produced by Phase 1's
 * `TemplateDefinition` (`@/lib/scaffolder/schema`) — architecture decision #4
 * ("definition JSON is the wire format; YAML is a view"). No adapter is
 * needed between this reducer's state and `saveTemplateDefinitionDraft`.
 *
 * Per the design doc (§3.1/§3.3), `ui:*` directives live INLINE as sibling
 * keys on each JSON-Schema property object (e.g.
 * `{ type: 'string', 'ui:field': 'OrbitTeamPicker' }`), not in a separate
 * RJSF-style `uiSchema` map. `schema-ui-split.ts` adapts between this wire
 * shape and `SchemaForm`'s `{ schema, uiSchema }` props.
 *
 * All actions return new arrays/objects — the reducer never mutates `state`
 * or any nested array/object in place. `UPDATE_FIELD` is the one action that
 * can be a true no-op: renaming a field to a name already used by a sibling
 * on the same page returns the exact same `state` reference (not a shallow
 * copy) so React's `useReducer` bails out of re-rendering — see
 * `isDuplicateFieldName` and `ParametersBuilder`'s inline collision warning,
 * which mirrors this same check so it can warn before even dispatching.
 */
import YAML from 'yaml'
import {
  TemplateDefinitionSchema,
  type TemplateDefinition,
  type ParameterPage,
  type Step,
  type Output,
  type MetadataSchema,
} from '@/lib/scaffolder/schema'
import type { z } from 'zod'
import { isDuplicateFieldName } from './parameter-field-row'

export type TemplateMetadata = z.infer<typeof MetadataSchema>

/** A parameter page property, with the wire-format inline `ui:*` keys allowed. */
export type ParameterProperty = Record<string, unknown> & { type?: string }

export type BuilderAction =
  | { type: 'SET_METADATA'; metadata: Partial<TemplateMetadata> }
  | { type: 'ADD_PARAMETER_PAGE'; title?: string; index?: number }
  | { type: 'REMOVE_PARAMETER_PAGE'; index: number }
  | { type: 'REORDER_PARAMETER_PAGE'; index: number; delta: number }
  | { type: 'UPDATE_PARAMETER_PAGE'; index: number; title: string }
  | {
      type: 'ADD_FIELD'
      pageIndex: number
      name: string
      property: ParameterProperty
      required?: boolean
    }
  | {
      type: 'UPDATE_FIELD'
      pageIndex: number
      /** Current field name. */
      name: string
      /** New name — renames the field, preserving position. Defaults to `name`. */
      renameTo?: string
      property: ParameterProperty
      required?: boolean
    }
  | { type: 'REMOVE_FIELD'; pageIndex: number; name: string }
  | { type: 'REORDER_FIELD'; pageIndex: number; index: number; delta: number }
  | { type: 'ADD_STEP'; step: Step; index?: number }
  | { type: 'UPDATE_STEP'; id: string; patch: Partial<Step> }
  | { type: 'REMOVE_STEP'; id: string }
  | { type: 'REORDER_STEP'; index: number; delta: number }
  | { type: 'SET_OUTPUT'; output: Output | undefined }
  | { type: 'REPLACE_ALL'; definition: TemplateDefinition }

/** Move the element at `index` by `delta` positions, clamped to the list bounds. Returns a new array. */
export function moveArrayItem<T>(items: T[], index: number, delta: number): T[] {
  const target = index + delta
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) {
    return items
  }
  const next = [...items]
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved)
  return next
}

function reorderProperties(
  properties: Record<string, ParameterProperty>,
  index: number,
  delta: number,
): Record<string, ParameterProperty> {
  const entries = Object.entries(properties)
  const reordered = moveArrayItem(entries, index, delta)
  return Object.fromEntries(reordered)
}

function updatePage(
  pages: ParameterPage[],
  pageIndex: number,
  updater: (page: ParameterPage) => ParameterPage,
): ParameterPage[] {
  if (pageIndex < 0 || pageIndex >= pages.length) return pages
  return pages.map((page, i) => (i === pageIndex ? updater(page) : page))
}

export const EMPTY_TEMPLATE_DEFINITION: TemplateDefinition = {
  apiVersion: 'orbit/v2',
  kind: 'Template',
  metadata: { name: '', title: '', owner: '' },
  spec: { parameters: [], steps: [] },
}

export function createInitialBuilderState(
  seed?: Partial<TemplateDefinition>,
): TemplateDefinition {
  return {
    ...EMPTY_TEMPLATE_DEFINITION,
    ...seed,
    metadata: { ...EMPTY_TEMPLATE_DEFINITION.metadata, ...seed?.metadata },
    spec: {
      parameters: seed?.spec?.parameters ?? [],
      steps: seed?.spec?.steps ?? [],
      output: seed?.spec?.output,
    },
  }
}

/** Replace `steps.<oldId>.` with `steps.<newId>.` inside every string of a JSON-ish value. */
function rewriteStepRefs(value: unknown, oldId: string, newId: string): unknown {
  if (typeof value === 'string') {
    return value.split(`steps.${oldId}.`).join(`steps.${newId}.`)
  }
  if (Array.isArray(value)) return value.map((v) => rewriteStepRefs(v, oldId, newId))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = rewriteStepRefs(v, oldId, newId)
    return out
  }
  return value
}

export function templateBuilderReducer(
  state: TemplateDefinition,
  action: BuilderAction,
): TemplateDefinition {
  switch (action.type) {
    case 'SET_METADATA':
      return { ...state, metadata: { ...state.metadata, ...action.metadata } }

    case 'ADD_PARAMETER_PAGE': {
      const newPage: ParameterPage = { title: action.title ?? 'Untitled page', properties: {} }
      const pages = [...state.spec.parameters]
      const insertAt = action.index ?? pages.length
      pages.splice(insertAt, 0, newPage)
      return { ...state, spec: { ...state.spec, parameters: pages } }
    }

    case 'REMOVE_PARAMETER_PAGE': {
      const pages = state.spec.parameters.filter((_, i) => i !== action.index)
      return { ...state, spec: { ...state.spec, parameters: pages } }
    }

    case 'REORDER_PARAMETER_PAGE': {
      const pages = moveArrayItem(state.spec.parameters, action.index, action.delta)
      return { ...state, spec: { ...state.spec, parameters: pages } }
    }

    case 'UPDATE_PARAMETER_PAGE': {
      const pages = updatePage(state.spec.parameters, action.index, (page) => ({
        ...page,
        title: action.title,
      }))
      return { ...state, spec: { ...state.spec, parameters: pages } }
    }

    case 'ADD_FIELD': {
      const pages = updatePage(state.spec.parameters, action.pageIndex, (page) => {
        const properties = { ...page.properties, [action.name]: action.property }
        const required = action.required
          ? [...(page.required ?? []).filter((n) => n !== action.name), action.name]
          : page.required
        return { ...page, properties, required }
      })
      return { ...state, spec: { ...state.spec, parameters: pages } }
    }

    case 'UPDATE_FIELD': {
      const page = state.spec.parameters[action.pageIndex]
      if (!page || !(action.name in page.properties)) return state

      const newName = action.renameTo ?? action.name
      if (isDuplicateFieldName(Object.keys(page.properties), action.name, newName)) {
        // Renaming to a name a sibling field already uses would silently
        // drop that sibling. Return the SAME state reference (not a shallow
        // copy) so `useReducer` bails out of re-rendering entirely — this is
        // a true no-op, not just an unchanged-looking new object.
        return state
      }

      const pages = updatePage(state.spec.parameters, action.pageIndex, (p) => {
        const properties: Record<string, ParameterProperty> = {}
        for (const [key, value] of Object.entries(p.properties)) {
          if (key === action.name) {
            properties[newName] = action.property
          } else {
            properties[key] = value
          }
        }
        let required = p.required
        if (required) {
          required = required.map((n) => (n === action.name ? newName : n))
          if (action.required === false) required = required.filter((n) => n !== newName)
        }
        if (action.required === true) {
          required = [...(required ?? []).filter((n) => n !== newName), newName]
        }
        return { ...p, properties, required }
      })
      return { ...state, spec: { ...state.spec, parameters: pages } }
    }

    case 'REMOVE_FIELD': {
      const pages = updatePage(state.spec.parameters, action.pageIndex, (page) => {
        const properties = { ...page.properties }
        delete properties[action.name]
        const required = page.required?.filter((n) => n !== action.name)
        return { ...page, properties, required }
      })
      return { ...state, spec: { ...state.spec, parameters: pages } }
    }

    case 'REORDER_FIELD': {
      const pages = updatePage(state.spec.parameters, action.pageIndex, (page) => ({
        ...page,
        properties: reorderProperties(page.properties, action.index, action.delta),
      }))
      return { ...state, spec: { ...state.spec, parameters: pages } }
    }

    case 'ADD_STEP': {
      const steps = [...state.spec.steps]
      const insertAt = action.index ?? steps.length
      steps.splice(insertAt, 0, action.step)
      return { ...state, spec: { ...state.spec, steps } }
    }

    case 'UPDATE_STEP': {
      const newId = action.patch.id
      if (newId !== undefined && newId !== action.id) {
        // Renaming: refuse a collision (same no-op contract as UPDATE_FIELD)
        // and rewrite every `steps.<old>.` reference elsewhere so the author
        // doesn't have to chase dangling expressions by hand.
        if (state.spec.steps.some((s) => s.id === newId)) return state
        const rewrite = (value: unknown): unknown => rewriteStepRefs(value, action.id, newId)
        const steps = state.spec.steps.map((step) => {
          if (step.id === action.id) return { ...step, ...action.patch }
          return {
            ...step,
            input: rewrite(step.input) as Step['input'],
            ...(step.if !== undefined ? { if: rewrite(step.if) as string } : {}),
          }
        })
        const output = state.spec.output ? (rewrite(state.spec.output) as Output) : state.spec.output
        return { ...state, spec: { ...state.spec, steps, output } }
      }
      const steps = state.spec.steps.map((step) =>
        step.id === action.id ? { ...step, ...action.patch } : step,
      )
      return { ...state, spec: { ...state.spec, steps } }
    }

    case 'REMOVE_STEP': {
      const steps = state.spec.steps.filter((step) => step.id !== action.id)
      return { ...state, spec: { ...state.spec, steps } }
    }

    case 'REORDER_STEP': {
      const steps = moveArrayItem(state.spec.steps, action.index, action.delta)
      return { ...state, spec: { ...state.spec, steps } }
    }

    case 'SET_OUTPUT':
      return { ...state, spec: { ...state.spec, output: action.output } }

    case 'REPLACE_ALL':
      return action.definition

    default:
      return state
  }
}

/** Serialize builder state to the `orbit-template.yaml` v2 text form. */
export function serializeDefinition(definition: TemplateDefinition): string {
  return YAML.stringify(definition)
}

export interface ParseDefinitionYamlResult {
  ok: boolean
  definition?: TemplateDefinition
  error?: string
}

/**
 * Parse + shape-validate `orbit-template.yaml` v2 text back into a
 * `TemplateDefinition`. Never throws — callers (e.g. `YamlView`) dispatch
 * `REPLACE_ALL` only when `ok` is true, per architecture decision #3 (invalid
 * YAML never clobbers builder state).
 */
export function parseDefinitionYaml(yamlText: string): ParseDefinitionYamlResult {
  let parsed: unknown
  try {
    parsed = YAML.parse(yamlText)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Invalid YAML' }
  }
  const result = TemplateDefinitionSchema.safeParse(parsed)
  if (!result.success) {
    const error = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    return { ok: false, error }
  }
  return { ok: true, definition: result.data }
}
