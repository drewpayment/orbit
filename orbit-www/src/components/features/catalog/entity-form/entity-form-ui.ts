import type { CatalogEntity } from '@/payload-types'
import type { EntityKind } from '@/collections/catalog/constants'
import { RUNTIME_PLATFORM_OPTIONS } from '@/collections/catalog/constants'

/**
 * Pure, React-free helpers for the catalog EntityForm (WP2). Kept out of the
 * client component so the link-row validation, source-lock predicate and
 * workspace-option shaping can be unit-tested directly (mirrors the
 * `catalog-query.ts` / `initiative-ui.ts` convention).
 *
 * The server contract (createCatalogEntity/updateCatalogEntity and the
 * CreateEntityInput/UpdateEntityPatch/EntityFormOptions types) lives in the
 * WP1 libs; nothing here imports it, so these helpers stay dependency-light and
 * safe on both server and client.
 */

export type Lifecycle = NonNullable<CatalogEntity['lifecycle']>
export type Tier = NonNullable<CatalogEntity['tier']>
type PersistedLink = NonNullable<CatalogEntity['links']>[number]
export type EntityLinkType = NonNullable<PersistedLink['type']>

export const LIFECYCLE_OPTIONS: { value: Lifecycle; label: string }[] = [
  { value: 'experimental', label: 'Experimental' },
  { value: 'production', label: 'Production' },
  { value: 'deprecated', label: 'Deprecated' },
]

export const TIER_OPTIONS: { value: Tier; label: string }[] = [
  { value: 'tier-1', label: 'Tier 1 — critical' },
  { value: 'tier-2', label: 'Tier 2 — important' },
  { value: 'tier-3', label: 'Tier 3 — supporting' },
]

export const LINK_TYPE_OPTIONS: { value: EntityLinkType; label: string }[] = [
  { value: 'docs', label: 'Docs' },
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'runbook', label: 'Runbook' },
  { value: 'repository', label: 'Repository' },
  { value: 'other', label: 'Other' },
]

// Re-export the runtime-platform vocabulary from the framework-light constants
// so the form imports one thing from here (mirrors LIFECYCLE/TIER co-location).
export { RUNTIME_PLATFORM_OPTIONS }

/** Per-kind subtype placeholder hints; falls back to a generic suggestion. */
const SUBTYPE_PLACEHOLDERS: Partial<Record<EntityKind, string>> = {
  datastore: 'postgresql, redis, s3…',
  resource: 'iot-device, bucket, queue…',
  service: 'website, worker, cron…',
}

/** Example subtype text for a kind (drives the form input placeholder). */
export function subtypePlaceholder(kind: EntityKind): string {
  return SUBTYPE_PLACEHOLDERS[kind] ?? 'A short refinement of the kind'
}

/**
 * Sentinel `<Select>` value for the "Global (no workspace)" option. A select
 * value must be a non-empty string, so a null workspace (global entity) is
 * represented by this constant in the UI and mapped back to `null` on submit.
 */
export const GLOBAL_WORKSPACE_VALUE = '__global__'

// ---------------------------------------------------------------------------
// Links editor
// ---------------------------------------------------------------------------

/** One editable link row. `key` is a stable React key, never persisted. */
export interface LinkRow {
  key: string
  label: string
  url: string
  type: EntityLinkType
}

let linkKeySeq = 0

/** A fresh link row (optionally pre-filled) with a process-unique React key. */
export function newLinkRow(partial?: Partial<Omit<LinkRow, 'key'>>): LinkRow {
  linkKeySeq += 1
  return {
    key: `link-${linkKeySeq}`,
    label: partial?.label ?? '',
    url: partial?.url ?? '',
    type: partial?.type ?? 'docs',
  }
}

/** Prefill editable rows from an entity's persisted links (edit mode). */
export function linksToRows(links: CatalogEntity['links'] | null | undefined): LinkRow[] {
  if (!links) return []
  return links.map((l) =>
    newLinkRow({ label: l.label ?? '', url: l.url ?? '', type: l.type ?? 'other' }),
  )
}

/** True when neither field is filled — such rows are ignored, not errors. */
export function isRowBlank(row: LinkRow): boolean {
  return row.label.trim() === '' && row.url.trim() === ''
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim())
}

/**
 * Validate a single link row, returning a human message or null. A fully blank
 * row is valid (it gets dropped on submit); a partially filled row is not.
 */
export function validateLinkRow(row: LinkRow): string | null {
  if (isRowBlank(row)) return null
  if (row.label.trim() === '') return 'Every link needs a label.'
  if (row.url.trim() === '') return `Add a URL for “${row.label.trim()}”.`
  if (!isHttpUrl(row.url)) return 'Link URLs must start with http:// or https://.'
  return null
}

/** First blocking link error across all rows, or null when all are valid. */
export function collectLinkErrors(rows: LinkRow[]): string | null {
  for (const row of rows) {
    const err = validateLinkRow(row)
    if (err) return err
  }
  return null
}

/** Normalize rows to the persisted link shape for submit (drops blanks, trims). */
export function rowsToLinks(rows: LinkRow[]): { label: string; url: string; type: EntityLinkType }[] {
  return rows
    .filter((r) => !isRowBlank(r))
    .map((r) => ({ label: r.label.trim(), url: r.url.trim(), type: r.type }))
}

// ---------------------------------------------------------------------------
// Source-lock (projection field-ownership policy)
// ---------------------------------------------------------------------------

/**
 * Whether the entity's identity fields (name, kind, workspace) are owned by a
 * projection and must render read-only. Manual/absent source ⇒ fully editable.
 */
export function isSourceLocked(sourceType: string | null | undefined): boolean {
  return !!sourceType && sourceType !== 'manual'
}

const SOURCE_LABELS: Record<string, string> = {
  apps: 'Apps',
  'api-schemas': 'API schemas',
  kafka: 'Kafka',
  sync: 'Sync',
}

/** Provenance note for a projected entity ("Synced from Apps"), or null. */
export function sourceProvenanceLabel(sourceType: string | null | undefined): string | null {
  if (!isSourceLocked(sourceType)) return null
  const label = SOURCE_LABELS[sourceType as string] ?? (sourceType as string)
  return `Synced from ${label}`
}

// ---------------------------------------------------------------------------
// Workspace select shaping
// ---------------------------------------------------------------------------

export interface WorkspaceChoice {
  id: string
  name: string
}

/**
 * Build the workspace `<Select>` options: the manageable workspaces, prefixed
 * with a "Global (no workspace)" option when the caller is a platform admin.
 */
export function buildWorkspaceOptions(
  workspaces: WorkspaceChoice[],
  canCreateGlobal: boolean,
): { value: string; label: string }[] {
  const options = workspaces.map((w) => ({ value: w.id, label: w.name }))
  if (canCreateGlobal) {
    return [{ value: GLOBAL_WORKSPACE_VALUE, label: 'Global (no workspace)' }, ...options]
  }
  return options
}

/** Map a workspace select value to the id the server expects (Global ⇒ null). */
export function workspaceSelectionToId(value: string): string | null {
  return value === GLOBAL_WORKSPACE_VALUE ? null : value
}

/** Map a persisted workspace id (null = global) to its select value. */
export function idToWorkspaceSelection(workspaceId: string | null): string {
  return workspaceId === null ? GLOBAL_WORKSPACE_VALUE : workspaceId
}

// ---------------------------------------------------------------------------
// Form-facing contracts (structural — kept decoupled from the WP1 libs)
// ---------------------------------------------------------------------------

/**
 * One org-wide entity result for the owner / relation pickers. Structurally
 * matches `searchEntitiesForPicker`'s return so the real action can be wired in
 * without an adapter.
 */
export interface PickerEntity {
  id: string
  name: string
  kind: EntityKind
  workspaceName?: string | null
}

/**
 * The subset of `getEntityFormOptions()` the EntityForm reads. Declared
 * structurally so the server action's richer return type is assignable without
 * importing the WP1 lib (create-anywhere workspaces + platform-admin global).
 */
export interface EntityFormOptions {
  workspaces: WorkspaceChoice[]
  canCreateGlobal: boolean
}
