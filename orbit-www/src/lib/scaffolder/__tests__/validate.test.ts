import { describe, it, expect } from 'vitest'
import { validateDefinition, type ActionDescriptor } from '../validate'
import type { TemplateDefinition } from '../schema'

const debugLog: ActionDescriptor = {
  id: 'debug:log',
  family: 'utility',
  name: 'Debug log',
  inputSchema: {
    type: 'object',
    properties: { message: { type: 'string' } },
    required: ['message'],
  },
  outputSchema: { type: 'object', properties: {} },
  supportsPlan: true,
}

const githubRepoCreate: ActionDescriptor = {
  id: 'github:repo:create',
  family: 'publish',
  name: 'Create GitHub repo',
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
  },
  outputSchema: {
    type: 'object',
    properties: { repoUrl: { type: 'string' }, repoName: { type: 'string' } },
  },
  supportsPlan: true,
}

const registry = [debugLog, githubRepoCreate]

function def(overrides: Partial<TemplateDefinition['spec']>): TemplateDefinition {
  return {
    apiVersion: 'orbit/v2',
    kind: 'Template',
    metadata: { name: 'test-template', title: 'Test', owner: 'team:platform' },
    spec: {
      parameters: [{ title: 'Service', properties: { name: { type: 'string' } } }],
      steps: [],
      ...overrides,
    },
  }
}

describe('validateDefinition', () => {
  it('passes a well-formed definition referencing parameters, earlier steps, and well-known namespaces', () => {
    const d = def({
      steps: [
        { id: 'repo', name: 'Create repo', action: 'github:repo:create', input: { name: '${{ parameters.name }}' } },
        {
          id: 'log',
          name: 'Log it',
          action: 'debug:log',
          input: { message: 'Created ${{ steps.repo.output.repoUrl }} for ${{ user.email }} run ${{ run.id }}' },
        },
      ],
    })
    const result = validateDefinition(d, registry)
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('collects duplicate step ids', () => {
    const d = def({
      steps: [
        { id: 'a', name: 'A', action: 'debug:log', input: { message: 'x' } },
        { id: 'a', name: 'A again', action: 'debug:log', input: { message: 'y' } },
      ],
    })
    const result = validateDefinition(d, registry)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.message.includes('Duplicate step id'))).toBe(true)
  })

  it('rejects a forward reference to a later step', () => {
    const d = def({
      steps: [
        { id: 'log', name: 'Log', action: 'debug:log', input: { message: '${{ steps.repo.output.repoUrl }}' } },
        { id: 'repo', name: 'Repo', action: 'github:repo:create', input: { name: 'x' } },
      ],
    })
    const result = validateDefinition(d, registry)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => /not an earlier step|forward/i.test(e.message))).toBe(true)
  })

  it('rejects a self reference', () => {
    const d = def({
      steps: [{ id: 'repo', name: 'Repo', action: 'github:repo:create', input: { name: '${{ steps.repo.output.repoUrl }}' } }],
    })
    const result = validateDefinition(d, registry)
    expect(result.ok).toBe(false)
  })

  it('rejects a reference to an unknown step', () => {
    const d = def({
      steps: [{ id: 'log', name: 'Log', action: 'debug:log', input: { message: '${{ steps.ghost.output.x }}' } }],
    })
    const result = validateDefinition(d, registry)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.message.includes('unknown step'))).toBe(true)
  })

  it('rejects a reference to an output key the action does not declare', () => {
    const d = def({
      steps: [
        { id: 'repo', name: 'Repo', action: 'github:repo:create', input: { name: 'x' } },
        { id: 'log', name: 'Log', action: 'debug:log', input: { message: '${{ steps.repo.output.notARealKey }}' } },
      ],
    })
    const result = validateDefinition(d, registry)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.message.includes('notARealKey'))).toBe(true)
  })

  it('rejects a reference to an undeclared parameter', () => {
    const d = def({
      steps: [{ id: 'log', name: 'Log', action: 'debug:log', input: { message: '${{ parameters.ghost }}' } }],
    })
    const result = validateDefinition(d, registry)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.message.includes('parameters.ghost'))).toBe(true)
  })

  it('rejects an unknown expression namespace', () => {
    const d = def({
      steps: [{ id: 'log', name: 'Log', action: 'debug:log', input: { message: '${{ foo.bar }}' } }],
    })
    const result = validateDefinition(d, registry)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => /namespace/i.test(e.message))).toBe(true)
  })

  it('rejects a step referencing an action not in the registry', () => {
    const d = def({
      steps: [{ id: 'x', name: 'X', action: 'nonexistent:action', input: {} }],
    })
    const result = validateDefinition(d, registry)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.message.includes('Unknown action'))).toBe(true)
  })

  it('rejects a literal input value that fails the action InputSchema', () => {
    const d = def({
      steps: [{ id: 'log', name: 'Log', action: 'debug:log', input: { message: 42 } }],
    })
    const result = validateDefinition(d, registry)
    expect(result.ok).toBe(false)
  })

  it('does not run schema validation against an expression-only input value', () => {
    const d = def({
      parameters: [{ title: 'Service', properties: { count: { type: 'number' } } }],
      steps: [{ id: 'log', name: 'Log', action: 'debug:log', input: { message: '${{ parameters.count }}' } }],
    })
    const result = validateDefinition(d, registry)
    expect(result.ok).toBe(true)
  })

  it('collects all errors instead of failing fast', () => {
    const d = def({
      steps: [
        { id: 'a', name: 'A', action: 'nonexistent:action', input: {} },
        { id: 'a', name: 'A again', action: 'debug:log', input: { message: '${{ foo.bar }}' } },
      ],
    })
    const result = validateDefinition(d, registry)
    expect(result.errors.length).toBeGreaterThanOrEqual(3)
  })
})
