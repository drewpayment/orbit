import type { DiscoveredEntity } from '@/payload-types'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * Presentational helpers for the Catalog Discovery review queue
 * (docs/plans/2026-07-06-catalog-discovery.md). Pure — grouping, evidence
 * parsing, and label maps live here so the client component stays focused on
 * interaction/state.
 */

export interface EvidenceEntry {
  detector: string
  file?: string
  excerpt?: string
}

/** Narrow the loosely-typed `evidence` json into a clean entry list. */
export function parseEvidence(raw: DiscoveredEntity['evidence']): EvidenceEntry[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => ({
      detector: String(e.detector ?? 'unknown'),
      file: typeof e.file === 'string' ? e.file : undefined,
      excerpt: typeof e.excerpt === 'string' ? e.excerpt : undefined,
    }))
}

/**
 * CODEOWNERS-derived ownership suggestions (surfaced as hints only in Phase 1 —
 * never auto-written). The detector packs `owner1, owner2` into an evidence
 * excerpt keyed `codeowners`.
 */
export function ownershipHints(evidence: EvidenceEntry[]): string[] {
  const owners = new Set<string>()
  for (const e of evidence) {
    if (e.detector !== 'codeowners' || !e.excerpt) continue
    for (const owner of e.excerpt.split(',')) {
      const trimmed = owner.trim()
      if (trimmed) owners.add(trimmed)
    }
  }
  return [...owners]
}

/** Evidence rows shown in the expander (everything that isn't an ownership hint). */
export function detectionEvidence(evidence: EvidenceEntry[]): EvidenceEntry[] {
  return evidence.filter((e) => e.detector !== 'codeowners')
}

export interface RepoGroup {
  key: string
  owner: string
  name: string
  url?: string
  rows: DiscoveredEntity[]
}

/** Group proposals under their repository, preserving the incoming sort order. */
export function groupByRepo(rows: DiscoveredEntity[]): RepoGroup[] {
  const groups = new Map<string, RepoGroup>()
  for (const row of rows) {
    const owner = row.repo?.owner ?? ''
    const name = row.repo?.name ?? ''
    const key = `${owner}/${name}`
    let group = groups.get(key)
    if (!group) {
      group = { key, owner, name, url: row.repo?.url ?? undefined, rows: [] }
      groups.set(key, group)
    }
    group.rows.push(row)
  }
  return [...groups.values()]
}

/** One-line proposal summary shown next to the path (schema type / build info). */
export function proposalSummary(row: DiscoveredEntity): string | null {
  const proposal = (row.proposal && typeof row.proposal === 'object' && !Array.isArray(row.proposal)
    ? row.proposal
    : {}) as Record<string, unknown>
  if (row.detectedKind === 'api') {
    return typeof proposal.schemaType === 'string' ? proposal.schemaType.toUpperCase() : null
  }
  const build = (proposal.buildConfig && typeof proposal.buildConfig === 'object'
    ? proposal.buildConfig
    : {}) as Record<string, unknown>
  const parts = [build.language, build.framework].filter((p): p is string => typeof p === 'string')
  return parts.length > 0 ? parts.join(' · ') : null
}

/**
 * Human name for a proposal, for toasts and confirm copy: the prefilled entity
 * name, falling back to the repository name, then the in-repo path, then the
 * dedupe key. Never empty.
 */
export function proposalDisplayName(row: DiscoveredEntity): string {
  const proposal = (row.proposal && typeof row.proposal === 'object' && !Array.isArray(row.proposal)
    ? row.proposal
    : {}) as Record<string, unknown>
  if (typeof proposal.name === 'string' && proposal.name.trim()) return proposal.name
  if (row.repo?.name) return row.repo.name
  return row.path || row.dedupeKey
}

/**
 * Detail-page href for an imported row, keyed on the `importedRef.collectionSlug`
 * the importer records: `apps` → the App page, `catalog-entities` → the catalog
 * entity page, `api-schemas` → the API catalog page. Returns null when the ref is
 * incomplete (e.g. a legacy row that only persisted `collectionSlug`) or the
 * collection has no user-facing detail route — the UI then names the target
 * without linking.
 */
export function importedHref(
  collectionSlug?: string | null,
  docId?: string | null,
): string | null {
  if (!collectionSlug || !docId) return null
  switch (collectionSlug) {
    case 'apps':
      return `/apps/${docId}`
    case 'catalog-entities':
      return `/catalog/${docId}`
    case 'api-schemas':
      return `/catalog/apis/${docId}`
    default:
      return null
  }
}

const SKIPPED_REASON_LABELS: Record<string, string> = {
  forbidden: 'You are not a member of this proposal’s workspace.',
  'not-found': 'This proposal no longer exists.',
  'missing-actor': 'Could not resolve the importing user — try again.',
  'missing-workspace': 'The proposal is missing its workspace.',
  'missing-raw-content': 'No spec content was fetched, so there is nothing to import.',
}

/** Human-readable note for an approve skip (import lib `skippedReason`). */
export function humanizeSkippedReason(reason?: string): string {
  if (!reason) return 'Could not be imported.'
  if (reason.startsWith('unsupported-schema-type:')) {
    const type = reason.split(':')[1] || 'this type'
    return `${type.toUpperCase()} specs aren’t importable yet.`
  }
  if (reason.startsWith('unknown-kind:')) return 'Unrecognised proposal kind.'
  return SKIPPED_REASON_LABELS[reason] ?? `Could not be imported (${reason}).`
}

const RENAME_REASON_LABELS: Record<string, string> = {
  forbidden: 'You are not allowed to rename this proposal.',
  'not-found': 'This proposal no longer exists.',
  'invalid-status': 'Only proposed rows can be renamed.',
  'invalid-name': 'Enter a name (up to 120 characters).',
}

/** Human-readable note for a failed rename (`renameDiscoveryCore` reason). */
export function humanizeRenameReason(reason?: string): string {
  if (!reason) return 'Could not rename this proposal.'
  return RENAME_REASON_LABELS[reason] ?? `Could not rename this proposal (${reason}).`
}

export function KindBadge({ kind }: { kind: DiscoveredEntity['detectedKind'] }) {
  return (
    <Badge variant={kind === 'api' ? 'secondary' : 'default'} className="capitalize">
      {kind}
    </Badge>
  )
}

const CONFIDENCE_STYLES: Record<DiscoveredEntity['confidence'], string> = {
  high: 'border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  medium: 'border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-300',
  low: 'border-transparent bg-muted text-muted-foreground',
}

export function ConfidenceChip({ confidence }: { confidence: DiscoveredEntity['confidence'] }) {
  return (
    <Badge variant="outline" className={cn('capitalize', CONFIDENCE_STYLES[confidence])}>
      {confidence} confidence
    </Badge>
  )
}
