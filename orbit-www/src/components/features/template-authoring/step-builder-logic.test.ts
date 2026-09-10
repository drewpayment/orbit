import { describe, expect, it } from 'vitest'
import { generateStepId, groupRegistryByFamily } from './step-builder-logic'
import type { ActionDescriptor } from '@/lib/scaffolder/validate'

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
