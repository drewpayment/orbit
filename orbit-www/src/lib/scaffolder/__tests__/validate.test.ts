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

const debugLogItems: ActionDescriptor = {
  id: 'debug:log-items',
  family: 'utility',
  name: 'Log items',
  inputSchema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: { count: { type: 'number' } },
        },
      },
    },
  },
  outputSchema: { type: 'object', properties: {} },
  supportsPlan: true,
}

const registry = [debugLog, githubRepoCreate, debugLogItems]

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
  it('rejects a step timeout that is not a positive Go duration of at most 2h (mirrors the Go engine)', () => {
    const step = { id: 'a', name: 'A', action: 'debug:log', input: { message: 'x' } }
    for (const [timeout, expectedMessage] of [
      ['1', 'Timeout must be a Go duration such as "30s", "5m" or "1h30m"'],
      ['abc', 'Timeout must be a Go duration such as "30s", "5m" or "1h30m"'],
      ['0s', 'Timeout must be positive'],
      ['3h', 'Timeout must not exceed 2h'],
    ] as const) {
      const result = validateDefinition(def({ steps: [{ ...step, timeout }] }), registry)
      expect(result.ok, timeout).toBe(false)
      expect(result.errors, timeout).toContainEqual({ path: 'spec.steps[0].timeout', message: expectedMessage })
    }
    for (const timeout of ['30s', '5m', '1h30m', '1.5h', '2h', '500ms']) {
      const result = validateDefinition(def({ steps: [{ ...step, timeout }] }), registry)
      expect(result.errors.filter((e) => e.path.endsWith('.timeout')), timeout).toEqual([])
    }
  })

  it('rejects a definition with no steps (mirrors the Go engine)', () => {
    const result = validateDefinition(def({ steps: [] }), registry)
    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual({
      path: 'spec.steps',
      message: 'A template must declare at least one step',
    })
  })

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

  it('recognizes a dashed step id in expression references (steps.<id> allows hyphens, matching StepSchema)', () => {
    const d = def({
      steps: [
        { id: 'create-repo', name: 'Create repo', action: 'github:repo:create', input: { name: 'x' } },
        {
          id: 'log',
          name: 'Log',
          action: 'debug:log',
          input: { message: '${{ steps.create-repo.output.repoUrl }}' },
        },
      ],
    })
    const result = validateDefinition(d, registry)
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('actually parses (not silently drops) a dashed step reference — an unknown dashed step id still errors', () => {
    // Proves the expression grammar recognizes the whole "steps.create-repo.output.x"
    // path rather than failing to match at the hyphen and silently ignoring the
    // expression entirely (which would also produce `ok: true` for the wrong reason).
    const d = def({
      steps: [
        {
          id: 'log',
          name: 'Log',
          action: 'debug:log',
          input: { message: '${{ steps.no-such-step.output.x }}' },
        },
      ],
    })
    const result = validateDefinition(d, registry)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.message.includes('no-such-step'))).toBe(true)
  })

  it('accepts a step "if" that is exactly one whole expression', () => {
    const d = def({
      parameters: [{ title: 'Service', properties: { needsTopic: { type: 'boolean' } } }],
      steps: [
        { id: 'log', name: 'Log', action: 'debug:log', input: { message: 'x' }, if: '${{ parameters.needsTopic }}' },
      ],
    })
    const result = validateDefinition(d, registry)
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('rejects a step "if" with surrounding literal text (not a whole expression)', () => {
    const d = def({
      steps: [
        {
          id: 'log',
          name: 'Log',
          action: 'debug:log',
          input: { message: 'x' },
          if: 'yes ${{ parameters.name }}',
        },
      ],
    })
    const result = validateDefinition(d, registry)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => /whole expression/i.test(e.message))).toBe(true)
  })

  it('rejects a step "if" containing multiple expressions', () => {
    const d = def({
      steps: [
        {
          id: 'log',
          name: 'Log',
          action: 'debug:log',
          input: { message: 'x' },
          if: '${{ parameters.name }}${{ user.email }}',
        },
      ],
    })
    const result = validateDefinition(d, registry)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => /whole expression/i.test(e.message))).toBe(true)
  })

  it('treats expressions nested inside objects inside arrays as expression holes, not literals (check 4)', () => {
    const d = def({
      parameters: [{ title: 'Service', properties: { n: { type: 'number' } } }],
      steps: [
        {
          id: 'x',
          name: 'X',
          action: 'debug:log-items',
          input: { items: [{ count: '${{ parameters.n }}' }] },
        },
      ],
    })
    const result = validateDefinition(d, registry)
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('still validates literal (non-expression) values nested inside arrays/objects', () => {
    const d = def({
      steps: [
        {
          id: 'x',
          name: 'X',
          action: 'debug:log-items',
          input: { items: [{ count: 'not-a-number' }] },
        },
      ],
    })
    const result = validateDefinition(d, registry)
    expect(result.ok).toBe(false)
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
