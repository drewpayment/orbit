#!/usr/bin/env tsx
// orbit-www/src/scripts/seed-example-templates.ts
//
// Idempotent seed for the checked-in `templates/examples/**` golden-path
// templates (docs/plans/2026-09-10-example-templates.md §4).
//
// Usage:
//   cd orbit-www
//   bun run seed:example-templates -- --workspace backend-engineers [--installation 118088915] [--publish] [--user drew@example.com]
//
// - Upserts `template-skeletons` by (workspace, slug) from
//   `templates/examples/skeletons/*/`; content is re-read from disk every
//   run, so a source edit updates the row (the collection's own
//   `skeleton-version-bump` hook bumps `.version`) — but an unchanged
//   directory is a no-op write-wise (see hasContentChanged in
//   seed-example-templates-lib.ts).
// - Upserts `template-definitions` (+ a new `template-definition-versions`
//   snapshot when the resolved body actually changed) by (workspace, slug)
//   from `templates/examples/definitions/*.yaml`, rewriting
//   `${skeleton:<slug>}` / `${template:<slug>}` / `${installation}`
//   placeholders to real ids first.
// - `--publish` attempts to publish each definition's latest version via
//   the SAME `publishVersion` helper the authoring UI's
//   `publishTemplateDefinition` server action delegates to (imported, not
//   duplicated) — not the server action itself, which requires an
//   authenticated request session this script does not have. The publish
//   gate (`validatedAt` + a recorded SUCCEEDED dry run of that exact
//   version) is enforced there regardless of caller, so `--publish` will
//   legitimately fail with "Publish gate failed: ..." until a human has
//   opened the template in the editor, run static validation, and done a
//   dry run — see templates/examples/README.md. That failure is reported
//   per-definition; it does not abort the run or the other definitions.
// - Refuses to write any definition whose resolved body fails
//   `TemplateDefinitionSchema.safeParse`.

import 'dotenv/config'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getPayload, type Payload } from 'payload'
import * as yaml from 'yaml'
import config from '@payload-config'
import { TemplateDefinitionSchema } from '@/lib/scaffolder/schema'
import { createDraftVersion, publishVersion } from '@/lib/scaffolder/versions'
import { isPlatformAdmin } from '@/lib/access/workspace-access'
import { dirToSkeletonFiles, hasContentChanged, rewritePlaceholders } from './seed-example-templates-lib'

// Repo root is three levels up from this file (orbit-www/src/scripts -> repo root).
const REPO_ROOT = join(__dirname, '..', '..', '..')
const EXAMPLES_DIR = join(REPO_ROOT, 'templates', 'examples')
const SKELETONS_DIR = join(EXAMPLES_DIR, 'skeletons')
const DEFINITIONS_DIR = join(EXAMPLES_DIR, 'definitions')

interface CliArgs {
  workspaceSlug: string
  installationId?: string
  publish: boolean
  userEmail?: string
}

function parseArgs(argv: string[]): CliArgs {
  let workspaceSlug: string | undefined
  let installationId: string | undefined
  let userEmail: string | undefined
  let publish = false

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--workspace':
        workspaceSlug = argv[++i]
        break
      case '--installation':
        installationId = argv[++i]
        break
      case '--user':
        userEmail = argv[++i]
        break
      case '--publish':
        publish = true
        break
      default:
        break
    }
  }

  if (!workspaceSlug) {
    throw new Error('Usage: seed-example-templates.ts --workspace <slug> [--installation <id>] [--publish] [--user <email>]')
  }

  return { workspaceSlug, installationId, publish, userEmail }
}

async function resolveWorkspaceId(payload: Payload, slug: string): Promise<string> {
  const result = await payload.find({
    collection: 'workspaces',
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const doc = result.docs[0]
  if (!doc) throw new Error(`No workspace found with slug "${slug}"`)
  return String(doc.id)
}

async function resolveUser(payload: Payload, email?: string): Promise<{ id: string; isPlatformAdmin: boolean }> {
  if (email) {
    const result = await payload.find({
      collection: 'users',
      where: { email: { equals: email } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    const doc = result.docs[0]
    if (!doc) throw new Error(`No user found with email "${email}"`)
    return { id: String(doc.id), isPlatformAdmin: isPlatformAdmin(doc) }
  }

  const result = await payload.find({
    collection: 'users',
    where: { role: { in: ['super_admin', 'admin'] } },
    sort: 'createdAt',
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const doc = result.docs[0]
  if (!doc) {
    throw new Error(
      'No platform-admin user found to attribute as createdBy. Pass --user <email>, or seed a platform admin first.',
    )
  }
  return { id: String(doc.id), isPlatformAdmin: isPlatformAdmin(doc) }
}

interface SkeletonManifest {
  metadata?: { name?: string; description?: string }
}

function listSkeletonDirs(): string[] {
  if (!existsSync(SKELETONS_DIR)) return []
  return readdirSync(SKELETONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
}

/**
 * Upserts one `template-skeletons` row from a `templates/examples/skeletons/<slug>/`
 * directory. Returns the row's Payload id.
 */
async function upsertSkeleton(
  payload: Payload,
  workspaceId: string,
  slug: string,
  createdBy: string,
): Promise<{ id: string; changed: boolean }> {
  const dir = join(SKELETONS_DIR, slug)
  const files = dirToSkeletonFiles(dir)

  const manifestFile = files.find((f) => f.path === 'orbit-template.yaml')
  const manifest = manifestFile ? (yaml.parse(manifestFile.content) as SkeletonManifest) : {}
  const name = manifest.metadata?.name ?? slug
  const description = manifest.metadata?.description ?? ''

  const existing = await payload.find({
    collection: 'template-skeletons',
    where: { and: [{ workspace: { equals: workspaceId } }, { slug: { equals: slug } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  const nextFiles = files.map((f) => ({ path: f.path, content: f.content }))

  if (existing.docs[0]) {
    const current = existing.docs[0]
    const currentFiles = (current.files ?? []).map((f) => ({ path: f.path, content: f.content ?? '' }))
    const changed = hasContentChanged(currentFiles, nextFiles) || current.description !== description

    if (changed) {
      const updated = await payload.update({
        collection: 'template-skeletons',
        id: current.id,
        data: { name, description, files: nextFiles },
        overrideAccess: true,
      })
      return { id: String(updated.id), changed: true }
    }
    return { id: String(current.id), changed: false }
  }

  const created = await payload.create({
    collection: 'template-skeletons',
    data: { workspace: workspaceId, name, slug, description, files: nextFiles, createdBy },
    overrideAccess: true,
  })
  return { id: String(created.id), changed: true }
}

interface DefinitionMetadata {
  metadata?: { name?: string; title?: string; description?: string; owner?: string; targetKind?: string }
}

function listDefinitionFiles(): string[] {
  if (!existsSync(DEFINITIONS_DIR)) return []
  return readdirSync(DEFINITIONS_DIR)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .sort()
}

/**
 * Ensures a `template-definitions` row exists for the given slug and
 * returns its id. Does NOT touch the version content — that's pass 2, once
 * every definition's id is known (a definition may reference another
 * definition's id via `${template:<slug>}`).
 */
async function ensureDefinitionRow(
  payload: Payload,
  workspaceId: string,
  slug: string,
  meta: NonNullable<DefinitionMetadata['metadata']>,
  createdBy: string,
): Promise<{ id: string; isNew: boolean }> {
  const existing = await payload.find({
    collection: 'template-definitions',
    where: { and: [{ workspace: { equals: workspaceId } }, { slug: { equals: slug } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  if (existing.docs[0]) {
    return { id: String(existing.docs[0].id), isNew: false }
  }

  const created = await payload.create({
    collection: 'template-definitions',
    data: {
      name: meta.title ?? slug,
      slug,
      title: meta.title ?? slug,
      description: meta.description,
      workspace: workspaceId,
      owner: meta.owner,
      targetKind: meta.targetKind,
      visibility: 'workspace',
      sourceMode: 'orbit',
      status: 'draft',
      createdBy,
    },
    overrideAccess: true,
  })
  return { id: String(created.id), isNew: true }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const payload = await getPayload({ config })

  const workspaceId = await resolveWorkspaceId(payload, args.workspaceSlug)
  const user = await resolveUser(payload, args.userEmail)
  console.log(`Workspace: ${args.workspaceSlug} (${workspaceId})`)
  console.log(`Attributed to user: ${user.id}${user.isPlatformAdmin ? ' (platform admin)' : ''}`)

  // --- Pass 1: skeletons --------------------------------------------------
  const skeletonIds: Record<string, string> = {}
  for (const slug of listSkeletonDirs()) {
    const { id, changed } = await upsertSkeleton(payload, workspaceId, slug, user.id)
    skeletonIds[slug] = id
    console.log(`skeleton ${slug}: ${id} ${changed ? '(updated)' : '(unchanged)'}`)
  }

  // --- Pass 2: definition rows (need every id before resolving bodies) ---
  const definitionFiles = listDefinitionFiles()
  const templateIds: Record<string, string> = {}
  const rawBySlug: Record<string, { file: string; raw: string; meta: NonNullable<DefinitionMetadata['metadata']> }> = {}

  for (const file of definitionFiles) {
    const raw = readFileSync(join(DEFINITIONS_DIR, file), 'utf8')
    const parsed = yaml.parse(raw) as DefinitionMetadata
    const meta = parsed.metadata
    if (!meta?.name) throw new Error(`${file}: metadata.name is required`)
    const { id } = await ensureDefinitionRow(payload, workspaceId, meta.name, meta, user.id)
    templateIds[meta.name] = id
    rawBySlug[meta.name] = { file, raw, meta }
  }

  // --- Pass 3: resolve placeholders, validate, and create versions -------
  for (const [slug, { file, raw }] of Object.entries(rawBySlug)) {
    const definitionId = templateIds[slug]
    const { text: resolved, unresolved } = rewritePlaceholders({
      text: raw,
      skeletonIds,
      templateIds,
      installationId: args.installationId,
    })

    if (unresolved.length > 0) {
      console.error(`${file}: unresolved placeholders, skipping: ${unresolved.join(', ')}`)
      continue
    }

    const parsed = yaml.parse(resolved)
    const result = TemplateDefinitionSchema.safeParse(parsed)
    if (!result.success) {
      console.error(`${file}: failed TemplateDefinitionSchema, skipping:`)
      console.error(JSON.stringify(result.error.format(), null, 2))
      continue
    }

    const existingVersions = await payload.find({
      collection: 'template-definition-versions',
      where: { definition: { equals: definitionId } },
      sort: '-versionNumber',
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    const latest = existingVersions.docs[0]
    const isUnchanged = latest !== undefined && !hasContentChanged(latest.definitionJson, result.data)

    let currentVersion = latest
    if (isUnchanged) {
      console.log(`definition ${slug}: ${definitionId} (unchanged, version ${latest.versionNumber})`)
    } else {
      currentVersion = await createDraftVersion(payload, {
        definitionId,
        definitionJson: result.data,
        userId: user.id,
        changeNote: latest ? 'Updated by seed-example-templates' : 'Initial draft from seed-example-templates',
      })
      console.log(`definition ${slug}: ${definitionId} (version ${currentVersion.versionNumber} created)`)
    }

    if (args.publish) {
      const versionToPublish = currentVersion
      if (!versionToPublish) {
        console.error(`definition ${slug}: no version to publish`)
        continue
      }

      try {
        await publishVersion(payload, {
          definitionId,
          versionId: String(versionToPublish.id),
          actor: { userId: user.id, isPlatformAdmin: user.isPlatformAdmin },
        })
        console.log(`definition ${slug}: published version ${versionToPublish.versionNumber}`)
      } catch (err) {
        console.error(
          `definition ${slug}: publish failed (expected until a human validates + dry-runs this version in the UI): ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
      }
    }
  }

  console.log('\nSeed complete.')
  process.exit(0)
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
