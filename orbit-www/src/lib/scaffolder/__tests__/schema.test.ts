import { describe, it, expect } from 'vitest'
import { TemplateDefinitionSchema } from '../schema'

const baseDoc = {
  apiVersion: 'orbit/v2',
  kind: 'Template',
  metadata: {
    name: 'backend-service',
    title: 'New Backend Service',
    owner: 'team:platform',
  },
  spec: {
    parameters: [
      {
        title: 'Service',
        required: ['name'],
        properties: {
          name: { type: 'string', pattern: '^[a-z][a-z0-9-]{2,40}$' },
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
    ],
  },
}

describe('TemplateDefinitionSchema', () => {
  it('accepts a well-formed v2 definition', () => {
    const result = TemplateDefinitionSchema.safeParse(baseDoc)
    expect(result.success).toBe(true)
  })

  it('rejects a wrong apiVersion', () => {
    const result = TemplateDefinitionSchema.safeParse({ ...baseDoc, apiVersion: 'orbit/v1' })
    expect(result.success).toBe(false)
  })

  it('rejects a wrong kind', () => {
    const result = TemplateDefinitionSchema.safeParse({ ...baseDoc, kind: 'Pattern' })
    expect(result.success).toBe(false)
  })

  it('rejects metadata.name that is not kebab-case-ish', () => {
    const result = TemplateDefinitionSchema.safeParse({
      ...baseDoc,
      metadata: { ...baseDoc.metadata, name: 'Backend Service!' },
    })
    expect(result.success).toBe(false)
  })

  it('allows passthrough ui: keys on parameter properties', () => {
    const result = TemplateDefinitionSchema.safeParse({
      ...baseDoc,
      spec: {
        ...baseDoc.spec,
        parameters: [
          {
            title: 'Service',
            properties: {
              name: { type: 'string', 'ui:help': 'kebab-case', 'ui:field': 'OrbitTeamPicker' },
            },
          },
        ],
      },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      const prop = result.data.spec.parameters[0].properties.name as Record<string, unknown>
      expect(prop['ui:help']).toBe('kebab-case')
    }
  })

  it('rejects a step id with invalid characters', () => {
    const result = TemplateDefinitionSchema.safeParse({
      ...baseDoc,
      spec: {
        ...baseDoc.spec,
        steps: [{ ...baseDoc.spec.steps[0], id: 'Repo Step!' }],
      },
    })
    expect(result.success).toBe(false)
  })

  it('accepts optional step fields (if, continueOnError, timeout)', () => {
    const result = TemplateDefinitionSchema.safeParse({
      ...baseDoc,
      spec: {
        ...baseDoc.spec,
        steps: [
          {
            ...baseDoc.spec.steps[0],
            if: '${{ parameters.needsTopic }}',
            continueOnError: true,
            timeout: '5m',
          },
        ],
      },
    })
    expect(result.success).toBe(true)
  })

  it('accepts an optional output block', () => {
    const result = TemplateDefinitionSchema.safeParse({
      ...baseDoc,
      spec: {
        ...baseDoc.spec,
        output: {
          links: [{ title: 'Repository', url: '${{ steps.repo.output.repoUrl }}' }],
          text: 'Done',
        },
      },
    })
    expect(result.success).toBe(true)
  })

  it('rejects a definition missing required top-level keys', () => {
    const result = TemplateDefinitionSchema.safeParse({ apiVersion: 'orbit/v2', kind: 'Template' })
    expect(result.success).toBe(false)
  })
})
