import { describe, it, expect } from 'vitest'
import { planMigration, buildManifestFromTemplateRow } from './migrate-templates-to-v2'
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
    language: 'go',
    categories: ['backend-service'],
    tags: [{ tag: 'go' }],
    manifestPath: 'orbit-template.yaml',
    variables: [{ key: 'serviceName', type: 'string', required: true }],
    usageCount: 0,
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Template
}

describe('buildManifestFromTemplateRow', () => {
  it('synthesizes a v1 manifest from the Templates row fields', () => {
    const manifest = buildManifestFromTemplateRow(template())
    expect(manifest.apiVersion).toBe('orbit/v1')
    expect(manifest.metadata.name).toBe('go-service')
    expect(manifest.metadata.language).toBe('go')
    expect(manifest.metadata.categories).toEqual(['backend-service'])
    expect(manifest.variables).toEqual([{ key: 'serviceName', type: 'string', required: true }])
  })

  it('defaults categories to ["other"] when the row has none (required by TemplateManifest)', () => {
    const manifest = buildManifestFromTemplateRow(template({ categories: null }))
    expect(manifest.metadata.categories.length).toBeGreaterThan(0)
  })
})

describe('planMigration', () => {
  it('plans a v2 definition for every template not already migrated', () => {
    const templates = [template({ id: 't1', slug: 'a' }), template({ id: 't2', slug: 'b' })]
    const { items, failures } = planMigration(templates, new Set())
    expect(items).toHaveLength(2)
    expect(items.map((p) => p.templateId)).toEqual(['t1', 't2'])
    expect(items[0].definition.apiVersion).toBe('orbit/v2')
    expect(failures).toEqual([])
  })

  it('skips templates that already have a migratedFrom match (idempotent re-run)', () => {
    const templates = [template({ id: 't1', slug: 'a' }), template({ id: 't2', slug: 'b' })]
    const { items } = planMigration(templates, new Set(['t1']))
    expect(items).toHaveLength(1)
    expect(items[0].templateId).toBe('t2')
  })

  it('produces an empty plan when every template is already migrated', () => {
    const templates = [template({ id: 't1', slug: 'a' })]
    const { items, failures } = planMigration(templates, new Set(['t1']))
    expect(items).toEqual([])
    expect(failures).toEqual([])
  })

  it('collects an unmappable template as a failure without aborting the rest of the plan', () => {
    const good1 = template({ id: 't1', slug: 'a' })
    const good2 = template({ id: 't2', slug: 'c' })
    // No string variable at all -> mapV1TemplateToV2Definition throws (fix #4).
    const bad = template({ id: 't-bad', slug: 'b', variables: [{ key: 'replicas', type: 'number', required: true }] })

    const { items, failures } = planMigration([good1, bad, good2], new Set())

    expect(items).toHaveLength(2)
    expect(items.map((p) => p.templateId)).toEqual(['t1', 't2'])
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ templateId: 't-bad', slug: 'b' })
    expect(failures[0].error).toMatch(/candidate/i)
  })
})
