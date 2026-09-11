import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as yaml from 'yaml'
import { TemplateDefinitionSchema, type TemplateDefinition } from '@/lib/scaffolder/schema'
import { MAX_STEP_TIMEOUT_MS, parseGoDurationMs, validateDefinition, type ActionDescriptor } from '@/lib/scaffolder/validate'
import { rewritePlaceholders } from '../seed-example-templates-lib'

// Repo-root-relative: orbit-www/src/scripts/__tests__ -> ../../../../templates/examples/definitions
const DEFINITIONS_DIR = join(__dirname, '..', '..', '..', '..', 'templates', 'examples', 'definitions')

// Repo-root-relative: orbit-www/src/scripts/__tests__ -> ../../../../services/repository/internal/grpc/scaffolder_actions.json
const ACTIONS_REGISTRY_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'services',
  'repository',
  'internal',
  'grpc',
  'scaffolder_actions.json',
)

interface RawActionDescriptor {
  name: string
  family: string
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  supportsPlan: boolean
}

/**
 * Loads the checked-in action registry and maps it into `ActionDescriptor`
 * the same way `listActionRegistry` (authoring-actions.ts) maps the live
 * gRPC `ListActions` response: `id` and `name` both come from the raw
 * entry's `name` field (the action's dotted id, e.g. "github:repo:create"),
 * not a separate display name.
 */
function loadActionRegistry(): ActionDescriptor[] {
  const raw = JSON.parse(readFileSync(ACTIONS_REGISTRY_PATH, 'utf8')) as RawActionDescriptor[]
  return raw.map((a) => ({
    id: a.name,
    family: a.family,
    name: a.name,
    inputSchema: a.inputSchema,
    outputSchema: a.outputSchema,
    supportsPlan: a.supportsPlan,
  }))
}

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

  it('no step timeout exceeds the engine\'s MAX_STEP_TIMEOUT_MS (2h)', () => {
    // A gate action like approval:request waits on its own input
    // (timeoutHours), not the step-level `timeout` — the validator's step
    // `timeout` is capped at 2h regardless of action, so an approval step
    // must not set one at all (the fix for the bug this test guards
    // against: kafka-event-consumer and production-service-onboarding both
    // shipped `timeout: 48h` on their approval:request step and failed
    // live validation in the editor).
    for (const file of files) {
      const raw = readFileSync(join(DEFINITIONS_DIR, file), 'utf8')
      const parsed = yaml.parse(raw) as { spec?: { steps?: Array<{ id: string; timeout?: string }> } }
      for (const step of parsed.spec?.steps ?? []) {
        if (step.timeout === undefined || step.timeout === '') continue
        const ms = parseGoDurationMs(step.timeout)
        expect(ms, `${file} step "${step.id}" has an unparseable timeout "${step.timeout}"`).not.toBeNull()
        expect(
          ms as number,
          `${file} step "${step.id}" timeout "${step.timeout}" exceeds MAX_STEP_TIMEOUT_MS (2h)`,
        ).toBeLessThanOrEqual(MAX_STEP_TIMEOUT_MS)
      }
    }
  })

  it.each(files)('%s passes the registry-aware validateDefinition with zero problems', (file) => {
    const registry = loadActionRegistry()
    const raw = readFileSync(join(DEFINITIONS_DIR, file), 'utf8')

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
    expect(unresolved).toEqual([])

    const parsed = TemplateDefinitionSchema.parse(yaml.parse(rewritten)) as TemplateDefinition
    const result = validateDefinition(parsed, registry)

    expect(result.ok, `${file} failed validateDefinition:\n${JSON.stringify(result.errors, null, 2)}`).toBe(true)
    expect(result.errors).toEqual([])
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
