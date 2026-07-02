# Catalog Entity CRUD — Entities as First-Class Primitives

**Date:** 2026-07-02
**Status:** In progress
**Roadmap:** new top item (catalog refinement); follows scorecards items 1–2 (PRs #60, #61).

## Product vision (PM summary)

Entities become a first-class primitive, created and edited by humans — not just
projections from apps/APIs/Kafka:

- **The catalog is the org-wide discovery surface.** Every authenticated user sees
  ALL entities in the system. You manage the ones you have rights to; you view the
  rest. Platform admins (`users.role` = `super_admin`/`admin`) manage everything.
- **Workspaces are the team landpage.** A workspace surfaces its own entities, is
  where teams create their **team entity** (none can be created today — the
  `owner` relationship dangles) and relate it to services/APIs/etc.
- **Workspace becomes optional on entities.** Entities with a workspace are managed
  by that workspace's members; global entities (no workspace) are platform-admin
  managed. ServiceNow-sourced entities will later slot in via the existing
  `source` provenance group (add nothing now; the design must not preclude a
  `servicenow` source type + bidirectional sync).

### PM decisions (approved direction, veto in review)
1. Catalog read = org-wide for any authenticated user.
2. Create/edit = active workspace **members** (any role) for their workspace's
   entities; **delete** = workspace owner/admin; platform admins = everything,
   everywhere, incl. global entities.
3. **Field-ownership policy for projected entities** (`source.type` ≠ `manual`):
   projection owns identity fields (`name`, `slug`, `kind`, `workspace`,
   `source`, `health`) — locked in the edit UI, rejected server-side; curation
   fields (`description`, `lifecycle`, `tier`, `owner`, `links`, `metadata`) are
   human-editable and the projection becomes **set-if-absent** for them on
   update (today it clobbers description/links/metadata on every re-sync —
   `lib/catalog/projection.ts upsertEntity`). Manual entities: fully editable.
   Projected entities are NOT deletable from the catalog (delete the source).
4. Relations are part of this feature: create/remove typed relations from entity
   detail + workspace surface; RBAC = manage rights on the **from** entity.

## Security fix (in scope — found during discovery)

`CatalogEntities.ts`/`CatalogRelations.ts` collection access is a no-op:
`user.collection === 'users'` is true for every authenticated user (users is the
only auth collection), so read/update/delete short-circuit to `true` and
`create` is `!!user`. The dead fallback also compares `workspace-members.user`
(a Better-Auth id) against the Payload `user.id`. Fix the collection access to
mirror the new model (defense in depth; server actions with `overrideAccess`
stay the primary gate):
- read: any authenticated user (org-wide — now correct BY DESIGN, not by bug)
- create/update: platform admin, or active workspace membership via
  `user.betterAuthId` (entity's workspace; null workspace ⇒ platform admin only)
- delete: platform admin or workspace owner/admin, AND `source.type == 'manual'`
Projections/internal routes use the local API (`overrideAccess` default) — unaffected.

## Design

### Schema (`collections/catalog/CatalogEntities.ts`, `CatalogRelations.ts`)
- `workspace` → `required: false` on BOTH collections (relation workspace is
  derived from the `from` entity at write time; absent for global-from-global).
- No other field changes. Run `bun run generate:types` after.

### Authz lib (`orbit-www/src/lib/catalog/entity-authz.ts` — single source of truth)
Follow `lib/scorecards/authz.ts` conventions (Better-Auth id in, payload query,
`status: 'active'`). Reuse `isPlatformAdmin` from `lib/access/workspace-access.ts`.
- `canCreateEntity(payload, betterAuthId, isPlatformAdmin, workspaceId | null)`
- `canManageEntity(payload, betterAuthId, isPlatformAdmin, entity: { workspaceId: string | null })`
- `canDeleteEntity(payload, betterAuthId, isPlatformAdmin, entity: { workspaceId, sourceType })`
- `getManageableWorkspaceIds(payload, betterAuthId)` (active memberships — reuse
  `lib/access/workspace-access.ts` helpers where they fit)
All pure-ish, unit-tested with the FakePayload convention.

### CRUD lib (`orbit-www/src/lib/catalog/entity-crud.ts` — pure, tested)
- Types: `CreateEntityInput`, `UpdateEntityPatch`, `EntityFormOptions`,
  `RelationInput`, `PROJECTION_LOCKED_FIELDS`, `CURATION_FIELDS`.
- `validateCreateInput` / `validateUpdatePatch(sourceType, patch)` (rejects
  identity-field edits on projected entities), `slugify(name)` (+ collision
  suffixing helper), link-array validation (label+url required, url http(s)).

### Projection ownership fix (`lib/catalog/projection.ts`)
`upsertEntity` update path: always write identity fields; write curation fields
ONLY when the existing doc's value is empty/undefined (set-if-absent). Unit-test
the merge (existing description survives re-projection; empty one gets filled).

### Server actions — NEW file `orbit-www/src/app/(frontend)/catalog/entity-actions.ts`
('use server'; async-only exports; types live in the libs. Session via
`getCurrentUser()` (Better-Auth id) + `getPayloadUserFromSession()` for role.)
- `createCatalogEntity(input: CreateEntityInput): Promise<{ id: string }>` —
  RBAC canCreateEntity; `source.type: 'manual'`; slug from name (unique within
  workspace scope by suffixing); revalidates catalog + workspace paths.
- `updateCatalogEntity(id: string, patch: UpdateEntityPatch): Promise<void>` —
  RBAC canManageEntity; validateUpdatePatch enforces field ownership.
- `deleteCatalogEntity(id: string): Promise<void>` — RBAC canDeleteEntity;
  also deletes relations referencing the entity (both directions).
- `createCatalogRelation(input: { fromId, toId, type }): Promise<{ id: string }>`
  — RBAC canManageEntity(from); validates type ∈ RELATION_TYPES, from ≠ to,
  dedupes (workspace, from, to, type); `source.type: 'manual'`.
- `deleteCatalogRelation(id: string): Promise<void>` — RBAC via from entity;
  manual relations only (projected relations belong to their projector).
- `getEntityFormOptions(): Promise<EntityFormOptions>` — workspaces the caller
  can create in, `canCreateGlobal` (platform admin), team entities per
  workspace for the owner picker.
- `searchEntitiesForPicker(query: string, opts?: { kind?, excludeId? }):
  Promise<{ id, name, kind, workspaceName }[]>` — org-wide, for relation/owner
  pickers (limit 20).

### Read-path changes (existing files)
- `catalog/actions.ts searchCatalogEntities` + `getCatalogKindCounts`: drop the
  workspace-membership filter → org-wide; add `scope?: 'all' | 'mine'` param
  ('mine' = my active workspaces, the old behavior; default 'all'); return a
  per-entity `canManage` boolean (computed from one manageable-ids set +
  isPlatformAdmin — no N+1).
- `catalog/[id]/actions.ts getCatalogEntityDetail`: explicit org-wide read
  (authenticated check + `overrideAccess: true` — stop leaning on the broken
  collection access); returns `canManage`, `canDelete`, `sourceType`, and the
  relation rows with ids so the UI can delete manual ones.

### UI — catalog (`app/(frontend)/catalog/**`, `components/features/catalog/**`)
- List page: "New entity" button (shown when the caller can create anywhere);
  scope toggle All ↔ My workspaces; subtle "managed" affordance on cards the
  caller can manage; workspace column/badge (or "Global").
- `/catalog/new`: `EntityForm` (create mode) — kind, name, workspace select
  (user's manageable workspaces; + "Global (no workspace)" for platform
  admins), description, lifecycle, tier, owner (team picker), links editor.
- `/catalog/[id]/edit`: `EntityForm` (edit mode) — projected entities render
  identity fields read-only with a provenance note ("Synced from Apps");
  curation fields editable. Delete button (manual only, confirm dialog).
- Entity detail: "Edit" button (gated); Relations tab gains "Add relation"
  (direction, type select, org-wide entity picker) + remove on manual relations.
- Empty catalog list gets a "Create your first entity" CTA when the user can.

### UI — workspace landpage (`app/(frontend)/workspaces/[slug]/page.tsx`)
- New **Entities card** in the dashboard grid: the workspace's entities grouped
  by kind (counts + top entries linking to `/catalog/[id]`), "View all in
  catalog" (catalog pre-filtered to the workspace), and — for members —
  "New entity" (prefilled workspace) plus a first-class **"Create team"**
  affordance when the workspace has no team entity yet (fills the dangling
  `owner` relationship gap).

## User Acceptance Criteria

- **UAC-1 (org-wide catalog):** any authenticated user sees ALL entities in the
  catalog (incl. other workspaces' + global); scope toggle "My workspaces"
  restores the scoped view; entity detail is viewable org-wide.
- **UAC-2 (create from catalog):** a workspace member can create a manual
  entity into their workspace from the catalog; a platform admin can create
  into any workspace or as Global; a member cannot create into a workspace
  they don't belong to (server-side reject, not just UI).
- **UAC-3 (edit):** members edit their workspace's entities; on projected
  entities identity fields are locked (UI read-only AND server-side reject)
  while curation fields save; manual entities are fully editable.
- **UAC-4 (delete):** workspace owner/admin (or platform admin) can delete a
  MANUAL entity (with its relations); members cannot; projected entities are
  not deletable anywhere.
- **UAC-5 (relations):** a user with manage rights on the from-entity can add
  a typed relation to any org-visible entity and remove manual relations;
  duplicates are rejected; from ≠ to enforced.
- **UAC-6 (workspace landpage):** the workspace page shows its entities grouped
  by kind with catalog links; members can create entities (incl. a team entity)
  from it; non-members see the list but no authoring affordances.
- **UAC-7 (projection ownership):** re-projecting a source (e.g. saving an app)
  no longer clobbers manually edited description/links/metadata (set-if-absent),
  while name/kind/health stay projection-owned. Unit-tested.
- **UAC-8 (security fix):** collection-level access on catalog-entities/relations
  enforces the model for direct Payload API calls: cross-workspace update/delete
  by a plain member is rejected; org-wide read allowed for authenticated users
  only; the betterAuthId comparison bug is fixed. Regression: projections and
  internal X-API-Key routes still work.
- **UAC-9 (quality):** authz/crud/projection-merge logic pure + vitest-covered;
  all catalog/scorecards suites pass; `tsc --noEmit` clean for touched files;
  `bun run generate:types` regenerates cleanly.
- **UAC-10 (browser QA):** live agent-browser pass validates UAC-1..6 end-to-end
  (create entity + team from workspace page, edit projected vs manual entity,
  add/remove relation, delete manual entity, scope toggle).

## Work packages

| WP | Owner | Scope |
|---|---|---|
| WP1 core | opus | schema relax + types regen, entity-authz.ts, entity-crud.ts, projection fix, collection access fix, entity-actions.ts, read-path changes, tests |
| WP2 catalog UI | opus | EntityForm + pickers + links editor, /catalog/new, /catalog/[id]/edit, list scope toggle + New button, detail Edit + relations add/remove |
| WP3 workspace UI | sonnet | workspace Entities card + create/team affordances (reuses WP2's EntityForm) |
| QA | opus | UAC audit incl. RBAC probing + live browser pass |

## Verification

- `cd orbit-www && bunx vitest run src/lib/catalog src/lib/scorecards src/components/features/catalog src/app/api/internal`
- `cd orbit-www && bunx tsc --noEmit` (touched files clean)
- agent-browser QA per UAC-10 (pre/post-flight pgrep hygiene per CLAUDE.md)

## Future (explicitly out of scope)
ServiceNow bidirectional sync (needs: `servicenow` source.type, external-id
mapping on `source.sourceId`, conflict policy = this plan's field-ownership
model, outbound webhooks); entity ownership transfer between workspaces (v1:
platform admin edits workspace directly); granular per-entity permissions.
