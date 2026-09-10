// orbit-www/src/scripts/migrate-templates-to-v2.ts
//
// Idempotent reconciler: migrates every `templates` row to a
// `template-definitions` row (sourceMode: 'git', migratedFrom: <template id>)
// with a v1 `template-definition-versions` snapshot (phase-1 plan §7.2).
//
// --dry-run (default): prints, per un-migrated `templates` row, the v2
//   definition JSON that WOULD be created. No writes.
// --apply: performs the writes with `overrideAccess: true`.
//
// Idempotent: keyed on `template-definitions.migratedFrom`. A second run
// (dry-run or apply) sees every already-migrated template excluded from the
// plan and is a no-op.
//
// No downtime: additive only. `Templates` rows are never modified or
// deleted by this script.
//
// Usage: cd orbit-www && npx tsx src/scripts/migrate-templates-to-v2.ts [--apply]

import 'dotenv/config'
import { getPayload, type Payload } from 'payload'
import config from '@payload-config'
import type { Template } from '@/payload-types'
import type { TemplateManifest } from '@/lib/template-manifest'
import { mapV1TemplateToV2Definition } from '@/lib/scaffolder/v1-migration'
import { createDraftVersion } from '@/lib/scaffolder/versions'
import type { TemplateDefinition } from '@/lib/scaffolder/schema'

const PAGE_SIZE = 100

/**
 * The `templates` collection already stores most of what a v1
 * `orbit-template.yaml` manifest would (name/language/categories/tags come
 * from the synced row, not a re-parsed file), so this synthesizes an
 * equivalent {@link TemplateManifest} directly from the row rather than
 * re-fetching and re-parsing the source YAML.
 */
export function buildManifestFromTemplateRow(template: Template): TemplateManifest {
  return {
    apiVersion: 'orbit/v1',
    kind: 'Template',
    metadata: {
      name: template.slug,
      description: template.description ?? undefined,
      language: template.language ?? 'unknown',
      framework: template.framework ?? undefined,
      categories: template.categories && template.categories.length > 0 ? template.categories : ['other'],
      tags: template.tags?.map((t) => t.tag).filter((t): t is string => Boolean(t)),
      complexity: template.complexity ?? undefined,
    },
    variables: (template.variables as TemplateManifest['variables']) ?? undefined,
  }
}

export interface MigrationPlanItem {
  templateId: string
  slug: string
  workspaceId: string
  definition: TemplateDefinition
}

export interface MigrationPlanFailure {
  templateId: string
  slug: string
  error: string
}

export interface MigrationPlan {
  items: MigrationPlanItem[]
  failures: MigrationPlanFailure[]
}

/**
 * Pure planning function: given every `templates` row and the set of
 * template ids that already have a `template-definitions.migratedFrom`
 * match, returns the definitions that still need to be created. This is
 * what both `--dry-run` and `--apply` execute — the operator command is
 * auditable because the plan is identical either way.
 *
 * `mapV1TemplateToV2Definition` can throw for a template whose v1 manifest
 * has no candidate repo-name variable (fix #4 — it refuses to emit a
 * dangling `${{ parameters.* }}` reference). One unmappable template must
 * not abort the whole run: its error is collected into `failures` and
 * planning continues for every other template.
 */
export function planMigration(templates: Template[], alreadyMigratedTemplateIds: Set<string>): MigrationPlan {
  const items: MigrationPlanItem[] = []
  const failures: MigrationPlanFailure[] = []

  for (const template of templates) {
    if (alreadyMigratedTemplateIds.has(template.id)) continue
    try {
      const manifest = buildManifestFromTemplateRow(template)
      const definition = mapV1TemplateToV2Definition(template, manifest)
      const workspaceId = typeof template.workspace === 'string' ? template.workspace : template.workspace.id
      items.push({ templateId: template.id, slug: template.slug, workspaceId, definition })
    } catch (err) {
      failures.push({
        templateId: template.id,
        slug: template.slug,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { items, failures }
}

async function fetchAllTemplates(payload: Payload): Promise<Template[]> {
  const all: Template[] = []
  for (let page = 1; ; page++) {
    const res = await payload.find({
      collection: 'templates',
      limit: PAGE_SIZE,
      page,
      depth: 0,
      overrideAccess: true,
    })
    all.push(...res.docs)
    if (!res.hasNextPage) break
  }
  return all
}

async function fetchAlreadyMigratedTemplateIds(payload: Payload): Promise<Set<string>> {
  const ids = new Set<string>()
  for (let page = 1; ; page++) {
    const res = await payload.find({
      collection: 'template-definitions',
      where: { migratedFrom: { exists: true } },
      limit: PAGE_SIZE,
      page,
      depth: 0,
      overrideAccess: true,
    })
    for (const doc of res.docs) {
      const migratedFrom = typeof doc.migratedFrom === 'string' ? doc.migratedFrom : doc.migratedFrom?.id
      if (migratedFrom) ids.add(migratedFrom)
    }
    if (!res.hasNextPage) break
  }
  return ids
}

/** Derives a definition slug from the source template's slug, avoiding a collision with itself. */
function definitionSlugFor(templateSlug: string): string {
  return templateSlug
}

async function applyPlanItem(payload: Payload, item: MigrationPlanItem): Promise<void> {
  const definition = await payload.create({
    collection: 'template-definitions',
    data: {
      name: item.definition.metadata.title,
      slug: definitionSlugFor(item.slug),
      title: item.definition.metadata.title,
      description: item.definition.metadata.description,
      workspace: item.workspaceId,
      targetKind: item.definition.metadata.targetKind,
      visibility: 'workspace',
      status: 'draft',
      sourceMode: 'git',
      migratedFrom: item.templateId,
    },
    overrideAccess: true,
  })

  await createDraftVersion(payload, {
    definitionId: String(definition.id),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    definitionJson: item.definition as any,
    userId: 'system:migrate-templates-to-v2',
    changeNote: `Migrated from templates/${item.templateId}`,
  })
}

export async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const payload = await getPayload({ config })

  const [templates, alreadyMigrated] = await Promise.all([
    fetchAllTemplates(payload),
    fetchAlreadyMigratedTemplateIds(payload),
  ])

  const { items, failures } = planMigration(templates, alreadyMigrated)

  console.log(
    JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      totalTemplates: templates.length,
      alreadyMigrated: alreadyMigrated.size,
      toMigrate: items.length,
      unmappable: failures.length,
    }),
  )

  if (failures.length > 0) {
    console.log('  the following templates could not be mapped and were skipped:')
    for (const failure of failures) {
      console.log(`    templates/${failure.templateId} (${failure.slug}): ${failure.error}`)
    }
  }

  for (const item of items) {
    if (apply) {
      await applyPlanItem(payload, item)
      console.log(`  migrated templates/${item.templateId} (${item.slug})`)
    } else {
      console.log(`  would migrate templates/${item.templateId} (${item.slug}):`)
      console.log(JSON.stringify(item.definition, null, 2))
    }
  }

  if (apply) {
    const verification = planMigration(templates, await fetchAlreadyMigratedTemplateIds(payload))
    // Only unmigrated PLANNABLE templates indicate a real idempotency bug —
    // the same unmappable templates will still fail on every re-run and must
    // not be treated as a not-idempotent regression.
    if (verification.items.length > 0) {
      throw new Error(`${verification.items.length} template(s) still unmigrated after apply — not idempotent`)
    }
  }

  if (failures.length > 0) {
    process.exitCode = 1
  }
}

if (process.argv[1]?.endsWith('migrate-templates-to-v2.ts')) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
