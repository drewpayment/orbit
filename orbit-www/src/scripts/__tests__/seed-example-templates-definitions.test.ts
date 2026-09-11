import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as yaml from 'yaml'
import { TemplateDefinitionSchema } from '@/lib/scaffolder/schema'
import { rewritePlaceholders } from '../seed-example-templates-lib'

// Repo-root-relative: orbit-www/src/scripts/__tests__ -> ../../../../templates/examples/definitions
const DEFINITIONS_DIR = join(__dirname, '..', '..', '..', '..', 'templates', 'examples', 'definitions')

function definitionFiles(): string[] {
  return readdirSync(DEFINITIONS_DIR)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .sort()
}

describe('templates/examples/definitions/*.yaml', () => {
  const files = definitionFiles()

  it('finds at least the five example templates', () => {
    expect(files.length).toBeGreaterThanOrEqual(5)
  })

  it.each(files)('%s parses as YAML and passes TemplateDefinitionSchema after placeholder substitution', (file) => {
    const raw = readFileSync(join(DEFINITIONS_DIR, file), 'utf8')

    // Substitute dummy ids for every ${skeleton:*} / ${template:*} /
    // ${installation} placeholder the way the seed script would, so the
    // shape check below exercises the document a real seed run produces.
    const { text: rewritten, unresolved } = rewritePlaceholders({
      text: raw,
      skeletonIds: {
        'go-http-service': 'dummy-skeleton-go-http-service',
        'go-kafka-consumer': 'dummy-skeleton-go-kafka-consumer',
        'go-openapi-server': 'dummy-skeleton-go-openapi-server',
      },
      templateIds: {
        'go-http-service': 'dummy-template-go-http-service',
        'nextjs-web-app': 'dummy-template-nextjs-web-app',
        'kafka-event-consumer': 'dummy-template-kafka-event-consumer',
        'openapi-rest-api': 'dummy-template-openapi-rest-api',
        'production-service-onboarding': 'dummy-template-production-service-onboarding',
      },
      installationId: 'dummy-installation-id',
    })

    expect(unresolved, `unresolved placeholders in ${file}: ${unresolved.join(', ')}`).toEqual([])

    const parsed = yaml.parse(rewritten)
    const result = TemplateDefinitionSchema.safeParse(parsed)

    if (!result.success) {
      throw new Error(`${file} failed TemplateDefinitionSchema: ${JSON.stringify(result.error.format(), null, 2)}`)
    }
  })

  it('every step id is unique within its definition', () => {
    for (const file of files) {
      const raw = readFileSync(join(DEFINITIONS_DIR, file), 'utf8')
      const parsed = yaml.parse(raw) as { spec?: { steps?: Array<{ id: string }> } }
      const ids = parsed.spec?.steps?.map((s) => s.id) ?? []
      const unique = new Set(ids)
      expect(unique.size, `${file} has duplicate step ids: ${ids.join(', ')}`).toBe(ids.length)
    }
  })
})
