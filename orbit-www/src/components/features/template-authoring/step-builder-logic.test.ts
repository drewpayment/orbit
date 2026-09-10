import { describe, expect, it } from 'vitest'
import {
  defaultStepInput,
  findStepReferences,
  generateStepId,
  groupRegistryByFamily,
} from './step-builder-logic'
import type { ActionDescriptor } from '@/lib/scaffolder/validate'
import type { TemplateDefinition } from '@/lib/scaffolder/schema'

function descriptor(overrides: Partial<ActionDescriptor>): ActionDescriptor {
  return {
    id: 'noop',
    family: 'utility',
    name: 'Noop',
    inputSchema: {},
    outputSchema: {},
    supportsPlan: false,
    ...overrides,
  }
}

describe('groupRegistryByFamily', () => {
  it('groups descriptors by family preserving order', () => {
    const registry = [
      descriptor({ id: 'a', family: 'fetch' }),
      descriptor({ id: 'b', family: 'publish' }),
      descriptor({ id: 'c', family: 'fetch' }),
    ]
    const groups = groupRegistryByFamily(registry)
    expect([...groups.keys()]).toEqual(['fetch', 'publish'])
    expect(groups.get('fetch')?.map((d) => d.id)).toEqual(['a', 'c'])
  })
})

describe('generateStepId', () => {
  it('derives an id from the action id last segment', () => {
    expect(generateStepId([], 'github:repo:create-from-template')).toBe('create-from-template')
  })

  it('avoids collisions by suffixing -2, -3, …', () => {
    expect(generateStepId(['create-from-template'], 'github:repo:create-from-template')).toBe(
      'create-from-template-2',
    )
    expect(
      generateStepId(['create-from-template', 'create-from-template-2'], 'github:repo:create-from-template'),
    ).toBe('create-from-template-3')
  })

  it('produces a legal lowercase-kebab id even from unusual action ids', () => {
    const id = generateStepId([], 'Kafka:Topic:Provision!!')
    expect(id).toMatch(/^[a-z][a-z0-9-]*$/)
  })
})

function definition(overrides: Partial<TemplateDefinition['spec']>): TemplateDefinition {
  return {
    apiVersion: 'orbit/v2',
    kind: 'Template',
    metadata: { name: 'x', title: 'X', owner: 'o' },
    spec: { parameters: [], steps: [], ...overrides },
  }
}

describe('defaultStepInput', () => {
  it('defaults catalog:entity:register to reference the current template id/version', () => {
    expect(defaultStepInput('catalog:entity:register')).toEqual({
      templateDefinitionId: '${{ template.id }}',
      templateVersionId: '${{ template.versionId }}',
    })
  })

  it('every other action gets an empty input, unchanged from before', () => {
    expect(defaultStepInput('github:repo:create-from-template')).toEqual({})
    expect(defaultStepInput('fs:render')).toEqual({})
  })
})

describe('findStepReferences', () => {
  it('finds a later step whose input references the removed step\'s output', () => {
    const def = definition({
      steps: [
        { id: 'repo', name: 'Create repo', action: 'a', input: {} },
        { id: 'push', name: 'Push', action: 'b', input: { url: '${{ steps.repo.output.repoUrl }}' } },
      ],
    })
    const refs = findStepReferences(def, 'repo')
    expect(refs).toEqual([{ sourceId: 'push', sourceLabel: 'Push' }])
  })

  it('finds a reference in a step\'s "if" expression', () => {
    const def = definition({
      steps: [
        { id: 'repo', name: 'Create repo', action: 'a', input: {} },
        {
          id: 'topic',
          name: 'Provision topic',
          action: 'b',
          input: {},
          if: '${{ steps.repo.output.needsTopic }}',
        },
      ],
    })
    const refs = findStepReferences(def, 'repo')
    expect(refs.map((r) => r.sourceId)).toEqual(['topic'])
  })

  it('finds a reference in spec.output', () => {
    const def = definition({
      steps: [{ id: 'repo', name: 'Create repo', action: 'a', input: {} }],
      output: { links: [{ title: 'Repo', url: '${{ steps.repo.output.repoUrl }}' }] },
    })
    const refs = findStepReferences(def, 'repo')
    expect(refs).toEqual([{ sourceId: '__output__', sourceLabel: 'Output' }])
  })

  it('returns an empty list when nothing references the step', () => {
    const def = definition({
      steps: [
        { id: 'repo', name: 'Create repo', action: 'a', input: {} },
        { id: 'other', name: 'Other', action: 'b', input: { x: 'literal' } },
      ],
    })
    expect(findStepReferences(def, 'repo')).toEqual([])
  })

  it('does not flag a step referencing its own (removed) id as a dependent of itself', () => {
    const def = definition({
      steps: [{ id: 'repo', name: 'Create repo', action: 'a', input: { x: '${{ steps.repo.output.y }}' } }],
    })
    expect(findStepReferences(def, 'repo')).toEqual([])
  })
})
