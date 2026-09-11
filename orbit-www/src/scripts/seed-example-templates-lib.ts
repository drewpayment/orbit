// orbit-www/src/scripts/seed-example-templates-lib.ts
//
// Pure logic for `seed-example-templates.ts` (docs/plans/2026-09-10-example-templates.md
// §4), split out so it can be unit tested without a Payload instance:
//  - rewritePlaceholders: substitutes `${skeleton:<slug>}` / `${template:<slug>}`
//    / `${installation}` tokens in a definition/skeleton YAML string with
//    real Payload ids.
//  - dirToSkeletonFiles: converts a skeleton source directory on disk into
//    the `template-skeletons.files[]` shape, INCLUDING `orbit-template.yaml`
//    at the bundle root (fs:render reads it from the fetched bundle at
//    render time, so it must ship as a normal bundle file, not be treated
//    specially here).
//  - hasContentChanged: cheap equality check used to decide whether a new
//    version/upsert write is actually needed.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

// ---------------------------------------------------------------------------
// placeholder rewriting
// ---------------------------------------------------------------------------

const SKELETON_PLACEHOLDER = /\$\{skeleton:([a-z0-9-]+)\}/g
const TEMPLATE_PLACEHOLDER = /\$\{template:([a-z0-9-]+)\}/g
const INSTALLATION_PLACEHOLDER = /\$\{installation\}/g

export interface RewritePlaceholdersInput {
  /** Raw YAML/text containing `${skeleton:<slug>}` / `${template:<slug>}` / `${installation}` tokens. */
  text: string
  /** slug -> template-skeletons Payload id. */
  skeletonIds: Record<string, string>
  /** slug -> template-definitions Payload id. */
  templateIds: Record<string, string>
  /** GitHub App installation id to substitute for `${installation}`. Omitted: left untouched. */
  installationId?: string
}

export interface RewritePlaceholdersResult {
  text: string
  /** Placeholders found but unresolvable (unknown slug), e.g. "skeleton:go-missing". */
  unresolved: string[]
}

/**
 * Replaces every `${skeleton:<slug>}`, `${template:<slug>}`, and
 * `${installation}` token in `text`. A `skeleton:`/`template:` token whose
 * slug is not in the given maps is left untouched and reported in
 * `unresolved` — the caller decides whether that's fatal (it is, for the
 * seed script: an unresolved reference means a skeleton/definition that
 * hasn't been created yet, almost certainly a slug typo or missing seed
 * step). `${installation}` with no `installationId` given is left
 * untouched without being reported, since omitting `--installation` is a
 * supported invocation (the definition keeps its literal placeholder,
 * which is a visibly-wrong default an author must replace before running).
 */
export function rewritePlaceholders(input: RewritePlaceholdersInput): RewritePlaceholdersResult {
  const { text, skeletonIds, templateIds, installationId } = input
  const unresolved: string[] = []

  let out = text.replace(SKELETON_PLACEHOLDER, (match, slug: string) => {
    const id = skeletonIds[slug]
    if (!id) {
      unresolved.push(`skeleton:${slug}`)
      return match
    }
    return id
  })

  out = out.replace(TEMPLATE_PLACEHOLDER, (match, slug: string) => {
    const id = templateIds[slug]
    if (!id) {
      unresolved.push(`template:${slug}`)
      return match
    }
    return id
  })

  if (installationId) {
    out = out.replace(INSTALLATION_PLACEHOLDER, installationId)
  }

  return { text: out, unresolved }
}

// ---------------------------------------------------------------------------
// skeleton directory -> files[] conversion
// ---------------------------------------------------------------------------

export interface SkeletonFile {
  path: string
  content: string
}

/**
 * Recursively reads every file under `dir` (skeleton directories are small
 * and shallow — a plain recursive walk is enough, no need for a streaming
 * approach) and returns them as `{ path, content }` pairs with
 * forward-slash-relative paths, sorted for deterministic output.
 * `orbit-template.yaml` at the bundle root is included like any other file
 * — see module doc comment.
 */
export function dirToSkeletonFiles(dir: string): SkeletonFile[] {
  const files: SkeletonFile[] = []

  function walk(current: string) {
    for (const entry of readdirSync(current)) {
      const fullPath = join(current, entry)
      const st = statSync(fullPath)
      if (st.isDirectory()) {
        walk(fullPath)
      } else if (st.isFile()) {
        const relPath = relative(dir, fullPath).split(sep).join('/')
        files.push({ path: relPath, content: readFileSync(fullPath, 'utf8') })
      }
    }
  }

  walk(dir)
  files.sort((a, b) => a.path.localeCompare(b.path))
  return files
}

// ---------------------------------------------------------------------------
// change detection
// ---------------------------------------------------------------------------

/**
 * Deep-equality check (via a canonical JSON stringify) used to decide
 * whether an upsert actually needs to write — the seed script must be
 * idempotent: re-running it with unchanged source files/definitions must
 * not create a new skeleton version or a new template-definition-versions
 * row.
 */
export function hasContentChanged(previous: unknown, next: unknown): boolean {
  return canonicalJSON(previous) !== canonicalJSON(next)
}

function canonicalJSON(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value))
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep)
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key])
    }
    return sorted
  }
  return value
}
