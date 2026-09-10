import { describe, it, expect } from 'vitest'
import { mapV1TemplateToV2Definition } from '../v1-migration'
import { TemplateDefinitionSchema } from '../schema'
import type { TemplateManifest } from '@/lib/template-manifest'
import type { Template } from '@/payload-types'

function template(overrides: Partial<Template> = {}): Template {
  return {
    id: 'tmpl-1',
    name: 'Go Service',
    slug: 'go-service',
    description: 'A Go microservice starter',
    workspace: 'ws-1',
    visibility: 'workspace',
    gitProvider: 'github',
    repoUrl: 'https://github.com/my-org/go-service-template',
    defaultBranch: 'main',
    isGitHubTemplate: true,
    manifestPath: 'orbit-template.yaml',
    variables: null,
    usageCount: 0,
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Template
}

const baseManifest: TemplateManifest = {
  apiVersion: 'orbit/v1',
  kind: 'Template',
  metadata: {
    name: 'go-service',
    language: 'go',
    categories: ['backend-service'],
  },
  variables: [
    { key: 'serviceName', type: 'string', required: true, validation: { pattern: '^[a-z-]+$' } },
    {
      key: 'visibility',
      type: 'select',
      required: false,
      options: [
        { label: 'Public', value: 'public' },
        { label: 'Private', value: 'private' },
      ],
    },
    {
      key: 'features',
      type: 'multiselect',
      required: false,
      options: [
        { label: 'Kafka', value: 'kafka' },
        { label: 'Postgres', value: 'postgres' },
      ],
    },
    { key: 'replicas', type: 'number', required: false, validation: { min: 1, max: 10 } },
    { key: 'enableTelemetry', type: 'boolean', required: false },
  ],
}

describe('mapV1TemplateToV2Definition', () => {
  it('produces a v2 document with a single parameters page mirroring v1 variables', () => {
    const def = mapV1TemplateToV2Definition(template(), baseManifest)

    expect(def.apiVersion).toBe('orbit/v2')
    expect(def.kind).toBe('Template')
    expect(def.metadata.name).toBe('go-service')
    expect(def.spec.parameters).toHaveLength(1)

    const props = def.spec.parameters[0].properties
    expect(props.serviceName).toMatchObject({ type: 'string', pattern: '^[a-z-]+$' })
    expect(props.visibility).toMatchObject({ type: 'string', enum: ['public', 'private'] })
    expect(props.features).toMatchObject({ type: 'array', items: { enum: ['kafka', 'postgres'] } })
    expect(props.replicas).toMatchObject({ type: 'number', minimum: 1, maximum: 10 })
    expect(props.enableTelemetry).toMatchObject({ type: 'boolean' })
    expect(def.spec.parameters[0].required).toEqual(['serviceName'])
  })

  it('uses the fast path (create-from-template) when isGitHubTemplate is true', () => {
    const def = mapV1TemplateToV2Definition(template({ isGitHubTemplate: true }), baseManifest)
    const actionIds = def.spec.steps.map((s) => s.action)
    expect(actionIds).toContain('github:repo:create-from-template')
    expect(actionIds).not.toContain('fetch:git')
  })

  it('uses the explicit fetch+render+push path when isGitHubTemplate is false', () => {
    const def = mapV1TemplateToV2Definition(template({ isGitHubTemplate: false }), baseManifest)
    const actionIds = def.spec.steps.map((s) => s.action)
    expect(actionIds).toEqual(
      expect.arrayContaining(['github:repo:create', 'fetch:git', 'fs:render', 'git:push']),
    )
  })

  it('always appends catalog:entity:register as the final step (the one intentional behaviour addition)', () => {
    const def = mapV1TemplateToV2Definition(template(), baseManifest)
    const last = def.spec.steps[def.spec.steps.length - 1]
    expect(last.action).toBe('catalog:entity:register')
  })

  it('produces a definition that satisfies TemplateDefinitionSchema for both source-mode branches', () => {
    expect(TemplateDefinitionSchema.safeParse(mapV1TemplateToV2Definition(template({ isGitHubTemplate: true }), baseManifest)).success).toBe(true)
    expect(TemplateDefinitionSchema.safeParse(mapV1TemplateToV2Definition(template({ isGitHubTemplate: false }), baseManifest)).success).toBe(true)
  })

  it('is a pure function (no side effects, deterministic output for the same input)', () => {
    const a = mapV1TemplateToV2Definition(template(), baseManifest)
    const b = mapV1TemplateToV2Definition(template(), baseManifest)
    expect(a).toEqual(b)
  })

  it('derives the repo-name parameter from a projectName variable when serviceName/name are absent', () => {
    const manifest: TemplateManifest = {
      ...baseManifest,
      variables: [
        { key: 'projectName', type: 'string', required: true },
        { key: 'description', type: 'string', required: false },
      ],
    }
    const def = mapV1TemplateToV2Definition(template({ isGitHubTemplate: true }), manifest)
    const repoStep = def.spec.steps.find((s) => s.action === 'github:repo:create-from-template')
    expect(repoStep?.input.name).toBe('${{ parameters.projectName }}')

    const catalogStep = def.spec.steps.find((s) => s.action === 'catalog:entity:register')
    expect(catalogStep?.input.name).toBe('${{ parameters.projectName }}')
  })

  it('falls back to the first required string variable when no preferred key matches', () => {
    const manifest: TemplateManifest = {
      ...baseManifest,
      variables: [
        { key: 'region', type: 'string', required: false },
        { key: 'clusterId', type: 'string', required: true },
        { key: 'replicas', type: 'number', required: true },
      ],
    }
    const def = mapV1TemplateToV2Definition(template({ isGitHubTemplate: true }), manifest)
    const repoStep = def.spec.steps.find((s) => s.action === 'github:repo:create-from-template')
    expect(repoStep?.input.name).toBe('${{ parameters.clusterId }}')
  })

  it('falls back to the first string variable when there is no required string variable', () => {
    const manifest: TemplateManifest = {
      ...baseManifest,
      variables: [
        { key: 'replicas', type: 'number', required: true },
        { key: 'region', type: 'string', required: false },
      ],
    }
    const def = mapV1TemplateToV2Definition(template({ isGitHubTemplate: true }), manifest)
    const repoStep = def.spec.steps.find((s) => s.action === 'github:repo:create-from-template')
    expect(repoStep?.input.name).toBe('${{ parameters.region }}')
  })

  it('throws loudly instead of emitting a dangling reference when there is no candidate variable at all', () => {
    const manifest: TemplateManifest = {
      ...baseManifest,
      variables: [{ key: 'replicas', type: 'number', required: true }],
    }
    expect(() => mapV1TemplateToV2Definition(template(), manifest)).toThrow(/repo.?name|candidate/i)
  })

  it('throws loudly when the manifest declares no variables at all', () => {
    const manifest: TemplateManifest = { ...baseManifest, variables: [] }
    expect(() => mapV1TemplateToV2Definition(template(), manifest)).toThrow()
  })
})
