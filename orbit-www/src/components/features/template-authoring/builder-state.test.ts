import { describe, expect, it } from 'vitest'
import {
  createInitialBuilderState,
  moveArrayItem,
  parseDefinitionYaml,
  serializeDefinition,
  templateBuilderReducer,
  type BuilderAction,
} from './builder-state'
import type { TemplateDefinition } from '@/lib/scaffolder/schema'

function fixtureDefinition(): TemplateDefinition {
  return {
    apiVersion: 'orbit/v2',
    kind: 'Template',
    metadata: {
      name: 'backend-service',
      title: 'New Backend Service',
      description: 'Go service on the paved road',
      tags: ['go', 'service'],
      owner: 'team:platform',
      targetKind: 'service',
    },
    spec: {
      parameters: [
        {
          title: 'Service',
          required: ['name'],
          properties: {
            name: { type: 'string', pattern: '^[a-z]+$', 'ui:help': 'kebab-case' },
            owner: { type: 'string', 'ui:field': 'OrbitTeamPicker' },
          },
        },
      ],
      steps: [
        {
          id: 'repo',
          name: 'Create repository',
          action: 'github:repo:create-from-template',
          input: { name: '${{ parameters.name }}' },
        },
        {
          id: 'topic',
          name: 'Provision topic',
          action: 'kafka:topic:provision',
          input: { name: '${{ parameters.name }}' },
          if: '${{ parameters.needsTopic }}',
          continueOnError: true,
          timeout: '5m',
        },
      ],
      output: { links: [{ title: 'Repository', url: '${{ steps.repo.output.repoUrl }}' }] },
    },
  }
}

describe('moveArrayItem', () => {
  it('moves an item forward', () => {
    expect(moveArrayItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
  })
  it('moves an item backward', () => {
    expect(moveArrayItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b'])
  })
  it('clamps out-of-bounds moves to a no-op', () => {
    expect(moveArrayItem(['a', 'b'], 0, -1)).toEqual(['a', 'b'])
    expect(moveArrayItem(['a', 'b'], 1, 1)).toEqual(['a', 'b'])
  })
})

describe('templateBuilderReducer', () => {
  it('SET_METADATA merges into existing metadata', () => {
    const state = createInitialBuilderState({ metadata: { name: 'x', title: 'X', owner: 'o' } })
    const next = templateBuilderReducer(state, {
      type: 'SET_METADATA',
      metadata: { title: 'Y', description: 'd' },
    })
    expect(next.metadata).toEqual({ name: 'x', title: 'Y', owner: 'o', description: 'd' })
    // original state untouched
    expect(state.metadata.title).toBe('X')
  })

  it('ADD_PARAMETER_PAGE appends a page by default', () => {
    const state = createInitialBuilderState()
    const next = templateBuilderReducer(state, { type: 'ADD_PARAMETER_PAGE', title: 'Service' })
    expect(next.spec.parameters).toEqual([{ title: 'Service', properties: {} }])
    expect(state.spec.parameters).toEqual([])
  })

  it('REMOVE_PARAMETER_PAGE removes by index', () => {
    let state = createInitialBuilderState()
    state = templateBuilderReducer(state, { type: 'ADD_PARAMETER_PAGE', title: 'A' })
    state = templateBuilderReducer(state, { type: 'ADD_PARAMETER_PAGE', title: 'B' })
    const next = templateBuilderReducer(state, { type: 'REMOVE_PARAMETER_PAGE', index: 0 })
    expect(next.spec.parameters.map((p) => p.title)).toEqual(['B'])
  })

  it('REORDER_PARAMETER_PAGE reorders pages', () => {
    let state = createInitialBuilderState()
    state = templateBuilderReducer(state, { type: 'ADD_PARAMETER_PAGE', title: 'A' })
    state = templateBuilderReducer(state, { type: 'ADD_PARAMETER_PAGE', title: 'B' })
    const next = templateBuilderReducer(state, {
      type: 'REORDER_PARAMETER_PAGE',
      index: 1,
      delta: -1,
    })
    expect(next.spec.parameters.map((p) => p.title)).toEqual(['B', 'A'])
  })

  it('UPDATE_PARAMETER_PAGE renames a page title', () => {
    let state = createInitialBuilderState()
    state = templateBuilderReducer(state, { type: 'ADD_PARAMETER_PAGE', title: 'A' })
    const next = templateBuilderReducer(state, { type: 'UPDATE_PARAMETER_PAGE', index: 0, title: 'Renamed' })
    expect(next.spec.parameters[0].title).toBe('Renamed')
  })

  it('ADD_FIELD adds a property and marks it required', () => {
    let state = createInitialBuilderState()
    state = templateBuilderReducer(state, { type: 'ADD_PARAMETER_PAGE', title: 'A' })
    const next = templateBuilderReducer(state, {
      type: 'ADD_FIELD',
      pageIndex: 0,
      name: 'foo',
      property: { type: 'string' },
      required: true,
    })
    expect(next.spec.parameters[0].properties.foo).toEqual({ type: 'string' })
    expect(next.spec.parameters[0].required).toEqual(['foo'])
  })

  it('UPDATE_FIELD can rename a field while preserving key order', () => {
    let state = createInitialBuilderState()
    state = templateBuilderReducer(state, { type: 'ADD_PARAMETER_PAGE', title: 'A' })
    state = templateBuilderReducer(state, {
      type: 'ADD_FIELD',
      pageIndex: 0,
      name: 'a',
      property: { type: 'string' },
    })
    state = templateBuilderReducer(state, {
      type: 'ADD_FIELD',
      pageIndex: 0,
      name: 'b',
      property: { type: 'string' },
    })
    const next = templateBuilderReducer(state, {
      type: 'UPDATE_FIELD',
      pageIndex: 0,
      name: 'a',
      renameTo: 'renamed',
      property: { type: 'number' },
      required: true,
    })
    expect(Object.keys(next.spec.parameters[0].properties)).toEqual(['renamed', 'b'])
    expect(next.spec.parameters[0].properties.renamed).toEqual({ type: 'number' })
    expect(next.spec.parameters[0].required).toEqual(['renamed'])
  })

  it('UPDATE_FIELD is a true no-op (same state reference) when renaming to a sibling name', () => {
    let state = createInitialBuilderState()
    state = templateBuilderReducer(state, { type: 'ADD_PARAMETER_PAGE', title: 'A' })
    state = templateBuilderReducer(state, {
      type: 'ADD_FIELD',
      pageIndex: 0,
      name: 'a',
      property: { type: 'string', title: 'A field' },
    })
    state = templateBuilderReducer(state, {
      type: 'ADD_FIELD',
      pageIndex: 0,
      name: 'b',
      property: { type: 'string', title: 'B field' },
    })
    const before = state

    const next = templateBuilderReducer(state, {
      type: 'UPDATE_FIELD',
      pageIndex: 0,
      name: 'a',
      renameTo: 'b', // collides with the existing sibling field "b"
      property: { type: 'number' }, // this edit must also be discarded, not just the rename
    })

    // True no-op: same reference, so React's useReducer bails out of re-rendering.
    expect(next).toBe(before)
    // Neither field was touched — "b" was not silently overwritten, "a" keeps its old property.
    expect(next.spec.parameters[0].properties).toEqual({
      a: { type: 'string', title: 'A field' },
      b: { type: 'string', title: 'B field' },
    })
  })

  it('UPDATE_FIELD renaming a field to its own current name is not treated as a collision', () => {
    let state = createInitialBuilderState()
    state = templateBuilderReducer(state, { type: 'ADD_PARAMETER_PAGE', title: 'A' })
    state = templateBuilderReducer(state, {
      type: 'ADD_FIELD',
      pageIndex: 0,
      name: 'a',
      property: { type: 'string' },
    })
    const next = templateBuilderReducer(state, {
      type: 'UPDATE_FIELD',
      pageIndex: 0,
      name: 'a',
      renameTo: 'a',
      property: { type: 'number' },
    })
    expect(next.spec.parameters[0].properties.a).toEqual({ type: 'number' })
  })

  it('REMOVE_FIELD removes the property and clears it from required', () => {
    let state = createInitialBuilderState()
    state = templateBuilderReducer(state, { type: 'ADD_PARAMETER_PAGE', title: 'A' })
    state = templateBuilderReducer(state, {
      type: 'ADD_FIELD',
      pageIndex: 0,
      name: 'a',
      property: { type: 'string' },
      required: true,
    })
    const next = templateBuilderReducer(state, { type: 'REMOVE_FIELD', pageIndex: 0, name: 'a' })
    expect(next.spec.parameters[0].properties).toEqual({})
    expect(next.spec.parameters[0].required).toEqual([])
  })

  it('REORDER_FIELD reorders fields within a page', () => {
    let state = createInitialBuilderState()
    state = templateBuilderReducer(state, { type: 'ADD_PARAMETER_PAGE', title: 'A' })
    state = templateBuilderReducer(state, {
      type: 'ADD_FIELD',
      pageIndex: 0,
      name: 'a',
      property: { type: 'string' },
    })
    state = templateBuilderReducer(state, {
      type: 'ADD_FIELD',
      pageIndex: 0,
      name: 'b',
      property: { type: 'string' },
    })
    const next = templateBuilderReducer(state, {
      type: 'REORDER_FIELD',
      pageIndex: 0,
      index: 0,
      delta: 1,
    })
    expect(Object.keys(next.spec.parameters[0].properties)).toEqual(['b', 'a'])
  })

  it('ADD_STEP/UPDATE_STEP/REMOVE_STEP/REORDER_STEP round-trip', () => {
    let state = createInitialBuilderState()
    const step1: BuilderAction = {
      type: 'ADD_STEP',
      step: { id: 's1', name: 'Step 1', action: 'fs:render', input: {} },
    }
    const step2: BuilderAction = {
      type: 'ADD_STEP',
      step: { id: 's2', name: 'Step 2', action: 'fs:render', input: {} },
    }
    state = templateBuilderReducer(state, step1)
    state = templateBuilderReducer(state, step2)
    expect(state.spec.steps.map((s) => s.id)).toEqual(['s1', 's2'])

    state = templateBuilderReducer(state, {
      type: 'UPDATE_STEP',
      id: 's1',
      patch: { name: 'Renamed' },
    })
    expect(state.spec.steps[0].name).toBe('Renamed')

    state = templateBuilderReducer(state, { type: 'REORDER_STEP', index: 0, delta: 1 })
    expect(state.spec.steps.map((s) => s.id)).toEqual(['s2', 's1'])

    state = templateBuilderReducer(state, { type: 'REMOVE_STEP', id: 's2' })
    expect(state.spec.steps.map((s) => s.id)).toEqual(['s1'])
  })

  it('SET_OUTPUT replaces the output block', () => {
    let state = createInitialBuilderState()
    state = templateBuilderReducer(state, {
      type: 'SET_OUTPUT',
      output: { links: [{ title: 'Repo', url: 'x' }] },
    })
    expect(state.spec.output).toEqual({ links: [{ title: 'Repo', url: 'x' }] })
    state = templateBuilderReducer(state, { type: 'SET_OUTPUT', output: undefined })
    expect(state.spec.output).toBeUndefined()
  })

  it('REPLACE_ALL swaps in a whole new definition', () => {
    const state = createInitialBuilderState()
    const replacement = fixtureDefinition()
    const next = templateBuilderReducer(state, { type: 'REPLACE_ALL', definition: replacement })
    expect(next).toEqual(replacement)
  })

  it('does not mutate the previous state object for any action type', () => {
    const state = createInitialBuilderState({ metadata: { name: 'x', title: 'X', owner: 'o' } })
    const frozen = JSON.parse(JSON.stringify(state))
    templateBuilderReducer(state, { type: 'ADD_PARAMETER_PAGE', title: 'A' })
    expect(state).toEqual(frozen)
  })
})

describe('serialize -> REPLACE_ALL -> serialize idempotence', () => {
  it('round-trips a full definition through YAML without loss', () => {
    const original = fixtureDefinition()
    const yamlText = serializeDefinition(original)

    const parsed = parseDefinitionYaml(yamlText)
    expect(parsed.ok).toBe(true)
    expect(parsed.error).toBeUndefined()

    const state = createInitialBuilderState()
    const next = templateBuilderReducer(state, { type: 'REPLACE_ALL', definition: parsed.definition! })

    expect(next).toEqual(original)
    expect(serializeDefinition(next)).toBe(yamlText)
  })

  it('rejects invalid YAML without producing a definition', () => {
    const result = parseDefinitionYaml('not: [valid, yaml')
    expect(result.ok).toBe(false)
    expect(result.definition).toBeUndefined()
    expect(result.error).toBeTruthy()
  })

  it('rejects YAML that parses but fails shape validation', () => {
    const result = parseDefinitionYaml('apiVersion: orbit/v2\nkind: Template\n')
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

describe('UPDATE_STEP id rename', () => {
  it('rewrites steps.<old>.output references in later steps and output links', () => {
    const def = fixtureDefinition()
    def.spec.steps = [
      { id: 'ping', name: 'Ping', action: 'http:request', input: {} },
      { id: 'done', name: 'Done', action: 'debug:log', input: { message: 'got ${{ steps.ping.output.status }}' }, if: '${{ steps.ping.output.status }}' },
    ]
    def.spec.output = { links: [{ title: 'x', url: 'https://e/${{ steps.ping.output.status }}' }] }
    const next = templateBuilderReducer(def, { type: 'UPDATE_STEP', id: 'ping', patch: { id: 'probe' } })
    expect(next.spec.steps[0].id).toBe('probe')
    expect(next.spec.steps[1].input.message).toBe('got ${{ steps.probe.output.status }}')
    expect(next.spec.steps[1].if).toBe('${{ steps.probe.output.status }}')
    expect(next.spec.output?.links?.[0].url).toBe('https://e/${{ steps.probe.output.status }}')
  })

  it('is a no-op when renaming to an id another step already uses', () => {
    const def = fixtureDefinition()
    def.spec.steps = [
      { id: 'a', name: 'A', action: 'debug:log', input: {} },
      { id: 'b', name: 'B', action: 'debug:log', input: {} },
    ]
    expect(templateBuilderReducer(def, { type: 'UPDATE_STEP', id: 'a', patch: { id: 'b' } })).toBe(def)
  })
})
