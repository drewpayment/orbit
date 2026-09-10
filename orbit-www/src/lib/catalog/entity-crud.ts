import type { EntityKind, RelationType, RuntimePlatform } from '@/collections/catalog/constants'
import { ENTITY_KINDS, RELATION_TYPES, RUNTIME_PLATFORMS } from '@/collections/catalog/constants'

/**
 * Catalog entity CRUD — pure, framework-light input types + validators
 * (Catalog Entity CRUD, docs/plans/2026-07-02-catalog-entity-crud.md, WP1).
 *
 * This module holds NO Payload / React / server-only imports so it is safe to
 * pull into the client `EntityForm` for live validation, and directly unit
 * testable. The `'use server'` entity-actions layer imports these validators
 * and enforces them again server-side (a client that skips them still hits the
 * same gate). `slugify` lives here as the canonical implementation; the
 * projection layer re-exports it so there is exactly one slug algorithm.
 */

// ---------------------------------------------------------------------------
// Field-ownership policy (PM decision 3)
// ---------------------------------------------------------------------------

/**
 * Identity fields owned by the projection for a projected (`source.type` !=
 * `manual`) entity. Locked in the edit UI and rejected server-side. Editing any
 * of these on a projected entity is a validation error.
 */
export const PROJECTION_LOCKED_FIELDS = [
  'name',
  'slug',
  'kind',
  'workspace',
  'source',
  'health',
] as const

/**
 * Human-editable curation fields. On a projected entity these stay editable and
 * the projection becomes set-if-absent for them (see
 * `mergeProjectionUpdate` in projection.ts). On a manual entity everything is
 * editable.
 */
export const CURATION_FIELDS = [
  'description',
  'lifecycle',
  'tier',
  'owner',
  'links',
  'metadata',
  // Curation refinements (catalog-representation-gaps P2): a free-form `subtype`
  // and a `runtime` pointer stay editable even on a projected entity — the
  // source owns identity, humans own the descriptive/operational overlay.
  'subtype',
  'runtime',
] as const

// ---------------------------------------------------------------------------
// Input types (consumed by EntityForm + entity-actions)
// ---------------------------------------------------------------------------

export type EntityLifecycle = 'experimental' | 'production' | 'deprecated'
export type EntityTier = 'tier-1' | 'tier-2' | 'tier-3'
export type LinkType = 'docs' | 'dashboard' | 'runbook' | 'repository' | 'other'

/** A single link row on an entity (docs, dashboard, runbook, …). */
export interface EntityLink {
  label: string
  url: string
  type?: LinkType
}

/**
 * Where an entity runs and how to reach it. `url` is the human-facing deployed
 * pointer, `platform` the hosting substrate; topology (runs-in relations to
 * environment entities) is complementary and lives in the graph, not here.
 */
export interface EntityRuntime {
  url?: string | null
  platform?: RuntimePlatform | null
  notes?: string | null
}

/** Payload for creating a new manual entity. `workspaceId: null` = Global. */
export interface CreateEntityInput {
  kind: EntityKind
  name: string
  /** Owning workspace, or null for a global (platform-admin-only) entity. */
  workspaceId: string | null
  description?: string | null
  lifecycle?: EntityLifecycle | null
  tier?: EntityTier | null
  /** Free-form refinement of kind (e.g. `postgresql`, `iot-device`, `website`). */
  subtype?: string | null
  /** Where this entity runs / how to reach it. */
  runtime?: EntityRuntime | null
  /** Owning team entity id (a catalog entity of kind `team`). */
  ownerId?: string | null
  links?: EntityLink[]
  metadata?: Record<string, unknown> | null
}

/**
 * Patch for editing an entity. Identity fields (`name`, `kind`) are only
 * accepted for manual entities — `validateUpdatePatch` rejects them for
 * projected entities. Curation fields are always accepted.
 */
export interface UpdateEntityPatch {
  name?: string
  kind?: EntityKind
  description?: string | null
  lifecycle?: EntityLifecycle | null
  tier?: EntityTier | null
  subtype?: string | null
  runtime?: EntityRuntime | null
  ownerId?: string | null
  links?: EntityLink[]
  metadata?: Record<string, unknown> | null
}

/** Input for creating a typed relation between two entities. */
export interface RelationInput {
  fromId: string
  toId: string
  type: RelationType
}

/** A workspace the caller may author into. */
export interface WorkspaceOption {
  id: string
  name: string
}

/** A pickable entity (relation target / owner team picker). */
export interface EntityOption {
  id: string
  name: string
  kind: EntityKind
  /** Null for a global entity. */
  workspaceName: string | null
}

/** Options driving the create/edit form (workspaces, global capability, team pickers). */
export interface EntityFormOptions {
  /** Workspaces the caller can create entities in. */
  workspaces: WorkspaceOption[]
  /** True when the caller (platform admin) may create global (no-workspace) entities. */
  canCreateGlobal: boolean
  /** Team entities per workspace id, for the owner picker. */
  teamsByWorkspace: Record<string, EntityOption[]>
  /** Global (no-workspace) team entities, for the owner picker on global entities. */
  globalTeams: EntityOption[]
}

// ---------------------------------------------------------------------------
// slugify (canonical) + collision suffixing
// ---------------------------------------------------------------------------

/**
 * URL-safe slug from a display name. Lowercase, diacritics stripped,
 * non-alphanumerics collapsed to single hyphens, trimmed. Deterministic for a
 * given name. Canonical home for the algorithm — projection.ts re-exports this.
 */
export function slugify(name: string | null | undefined): string {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Return `base` if free, else the first `base-N` (N starting at 2) not present
 * in `taken`. Used to make a slug unique within its workspace scope.
 */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const takenSet = taken instanceof Set ? taken : new Set(taken)
  if (!takenSet.has(base)) return base
  let n = 2
  while (takenSet.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const HTTP_URL = /^https?:\/\//i

/** Max length of the free-form `subtype` refinement. */
export const SUBTYPE_MAX_LENGTH = 50

function isEntityKind(value: unknown): value is EntityKind {
  return typeof value === 'string' && (ENTITY_KINDS as readonly string[]).includes(value)
}

function isRelationType(value: unknown): value is RelationType {
  return typeof value === 'string' && (RELATION_TYPES as readonly string[]).includes(value)
}

function isRuntimePlatform(value: unknown): value is RuntimePlatform {
  return typeof value === 'string' && (RUNTIME_PLATFORMS as readonly string[]).includes(value)
}

/**
 * Validate the free-form `subtype`: trimmed, capped at {@link SUBTYPE_MAX_LENGTH}.
 * No vocabulary check — it is an intentionally open refinement of `kind`.
 * Returns an error message, or null when valid (or absent).
 */
export function validateSubtype(subtype: string | null | undefined): string | null {
  if (subtype == null) return null
  if (subtype.trim().length > SUBTYPE_MAX_LENGTH) {
    return `Subtype must be ${SUBTYPE_MAX_LENGTH} characters or fewer.`
  }
  return null
}

/**
 * Validate the `runtime` group: `url` (when present) must be an http(s) URL and
 * `platform` (when present) must be a known {@link RUNTIME_PLATFORMS} value.
 * Returns an error message, or null when valid (or absent).
 */
export function validateRuntime(runtime: EntityRuntime | null | undefined): string | null {
  if (!runtime) return null
  const url = runtime.url?.trim()
  if (url && !HTTP_URL.test(url)) {
    return 'The runtime URL must start with http:// or https://.'
  }
  if (runtime.platform != null && !isRuntimePlatform(runtime.platform)) {
    return 'A valid runtime platform is required.'
  }
  return null
}

/**
 * Validate an array of link rows: each needs a non-empty label and an http(s)
 * url. Returns an error message, or null when valid (or absent).
 */
export function validateLinks(links: EntityLink[] | undefined | null): string | null {
  if (!links || links.length === 0) return null
  for (const link of links) {
    if (!link.label?.trim()) return 'Each link needs a label.'
    if (!link.url?.trim()) return 'Each link needs a URL.'
    if (!HTTP_URL.test(link.url.trim())) return 'Link URLs must start with http:// or https://.'
  }
  return null
}

/**
 * Validate a create payload (shape only — RBAC is enforced separately in the
 * server action). Returns an error message, or null when valid.
 */
export function validateCreateInput(input: CreateEntityInput): string | null {
  if (!input.name?.trim()) return 'Name is required.'
  if (!isEntityKind(input.kind)) return 'A valid entity kind is required.'
  const linkError = validateLinks(input.links)
  if (linkError) return linkError
  const subtypeError = validateSubtype(input.subtype)
  if (subtypeError) return subtypeError
  const runtimeError = validateRuntime(input.runtime)
  if (runtimeError) return runtimeError
  return null
}

/**
 * Validate an update patch against the entity's provenance. For a projected
 * entity (`sourceType` != `manual`) any {@link PROJECTION_LOCKED_FIELDS} key
 * present in the patch is rejected; curation fields are always allowed. Returns
 * an error message, or null when valid.
 */
export function validateUpdatePatch(sourceType: string, patch: UpdateEntityPatch): string | null {
  const isManual = sourceType === 'manual'
  if (!isManual) {
    const locked = new Set<string>(PROJECTION_LOCKED_FIELDS)
    for (const key of Object.keys(patch)) {
      if (locked.has(key)) {
        return `The ${key} of a synced entity is owned by its source and cannot be edited here.`
      }
    }
  }
  if (patch.name !== undefined && !patch.name.trim()) return 'Name cannot be empty.'
  if (patch.kind !== undefined && !isEntityKind(patch.kind)) return 'A valid entity kind is required.'
  const linkError = validateLinks(patch.links)
  if (linkError) return linkError
  const subtypeError = validateSubtype(patch.subtype)
  if (subtypeError) return subtypeError
  const runtimeError = validateRuntime(patch.runtime)
  if (runtimeError) return runtimeError
  return null
}

/**
 * Validate a relation input: known type and `from` != `to`. Returns an error
 * message, or null when valid.
 */
export function validateRelationInput(input: RelationInput): string | null {
  if (!input.fromId || !input.toId) return 'Both entities are required.'
  if (input.fromId === input.toId) return 'A relation cannot point an entity at itself.'
  if (!isRelationType(input.type)) return 'A valid relation type is required.'
  return null
}
