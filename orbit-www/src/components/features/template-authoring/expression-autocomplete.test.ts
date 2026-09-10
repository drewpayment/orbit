import { describe, expect, it } from 'vitest'
import { getExpressionCandidates } from './expression-autocomplete'
import type { TemplateDefinition } from '@/lib/scaffolder/schema'
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

function definition(steps: TemplateDefinition['spec']['steps']): TemplateDefinition {
  return {
    apiVersion: 'orbit/v2',
    kind: 'Template',
    metadata: { name: 'x', title: 'X', owner: 'o' },
    spec: {
      parameters: [
        {
          title: 'Service',
          properties: {
            name: { type: 'string', title: 'Name' },
            owner: { type: 'string' },
          },
        },
      ],
      steps,
    },
  }
}

const registry: ActionDescriptor[] = [
  descriptor({
    id: 'github:repo:create-from-template',
    outputSchema: {
      type: 'object',
      properties: {
        repoUrl: { type: 'string' },
        checkout: { type: 'string' },
      },
    },
  }),
  descriptor({
    id: 'fs:render',
    outputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        stats: { type: 'object', properties: { fileCount: { type: 'number' } } },
      },
    },
  }),
]

describe('getExpressionCandidates', () => {
  it('always includes all parameters regardless of step index', () => {
    const def = definition([
      { id: 'repo', name: 'Create repo', action: 'github:repo:create-from-template', input: {} },
    ])
    const candidates = getExpressionCandidates(def, 0, registry)
    const paths = candidates.map((c) => c.path)
    expect(paths).toContain('parameters.name')
    expect(paths).toContain('parameters.owner')
  })

  it('excludes the current step and any later step (no forward/self refs)', () => {
    const def = definition([
      { id: 'repo', name: 'Create repo', action: 'github:repo:create-from-template', input: {} },
      { id: 'render', name: 'Render', action: 'fs:render', input: {} },
      { id: 'push', name: 'Push', action: 'github:repo:create-from-template', input: {} },
    ])
    // At stepIndex 1 ("render"), only "repo" (index 0) is earlier.
    const candidates = getExpressionCandidates(def, 1, registry)
    const paths = candidates.map((c) => c.path)
    expect(paths).toContain('steps.repo.output.repoUrl')
    expect(paths).toContain('steps.repo.output.checkout')
    expect(paths.some((p) => p.startsWith('steps.render.'))).toBe(false)
    expect(paths.some((p) => p.startsWith('steps.push.'))).toBe(false)
  })

  it('includes nested object output paths', () => {
    const def = definition([
      { id: 'render', name: 'Render', action: 'fs:render', input: {} },
      { id: 'next', name: 'Next', action: 'fs:render', input: {} },
    ])
    const candidates = getExpressionCandidates(def, 1, registry)
    const paths = candidates.map((c) => c.path)
    expect(paths).toContain('steps.render.output.path')
    expect(paths).toContain('steps.render.output.stats.fileCount')
  })

  it('skips steps whose action is not in the registry', () => {
    const def = definition([{ id: 'unknown', name: 'Unknown', action: 'nope:nope', input: {} }])
    const candidates = getExpressionCandidates(def, 1, registry)
    expect(candidates.some((c) => c.path.startsWith('steps.unknown'))).toBe(false)
  })

  it('returns no step candidates for the first step', () => {
    const def = definition([
      { id: 'repo', name: 'Create repo', action: 'github:repo:create-from-template', input: {} },
    ])
    const candidates = getExpressionCandidates(def, 0, registry)
    expect(candidates.some((c) => c.path.startsWith('steps.'))).toBe(false)
  })
})
