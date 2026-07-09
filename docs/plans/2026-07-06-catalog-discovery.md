# Catalog Discovery — Repository Scanning & Automated Entity Import

**Date:** 2026-07-06
**Status:** Planned (Phase 1 detailed; Phases 2–4 sketched)
**Roadmap:** catalog growth — converts onboarding from "add repos one at a time" to "connect org, approve a list".

## Product vision (PM summary)

Connect a git org → Orbit scans every repo → detects catalog entities with
confidence scores and evidence → proposals land in a review queue → approve
(individually, in bulk, or auto for self-declaring repos) → entities appear in
the catalog and stay in sync.

### PM decisions (approved 2026-07-06, veto in review)

1. **Second platform = Azure DevOps** (after GitHub), delivered in Phase 3 on a
   provider abstraction; generic-git-clone fallback covers the long tail
   (Gitea, self-hosted, plain remotes) from the same phase.
2. **Backstage `catalog-info.yaml` compatibility is in scope** (Phase 2) — the
   migration story for teams leaving Backstage.
3. **Discovered API specs create `api-schemas` rows**, not direct
   `catalog-entities` writes. The catalog stays a projection; the existing
   projection layer (`lib/catalog/projection.ts`) turns source rows into
   entities/relations and its set-if-absent merge protects manual edits.
4. **Auto-approve is limited to explicit manifests** (`.orbit.yaml`, later
   `catalog-info.yaml`). Everything inferred (well-known files, heuristics)
   goes to the review queue. No workspace policy knob in Phase 1.

### Why this shape (discovery findings, 2026-07-06)

- The catalog is a **projection**: `catalog-entities`/`catalog-relations` are
  fed by afterChange hooks on source collections (`apps`, `api-schemas`,
  `kafka-*`) through `lib/catalog/projection.ts` — idempotent upserts keyed on
  `(source.type, source.sourceId)`, set-if-absent for curation fields. An
  importer that writes source rows gets projection, scoring, and edit-safety
  for free.
- **GitHub is the only live provider** (GitHub App, encrypted installation
  tokens in `github-installations`, Temporal-managed refresh, workspace
  scoping via `allowedWorkspaces`). The Go domain has a latent
  `GitProvider` enum (gitlab/bitbucket/azure_devops) with no clients.
- **Repo inspection already exists**:
  `temporal-workflows/internal/activities/agent/repo_inspect_activity.go`
  walks a repo via the GitHub API (shallow-clone fallback) and detects
  manifest files. The scanner generalizes this.
- Today's import is manual and shallow: `importRepository`
  (`app/actions/apps.ts`) creates one App from one URL; `.orbit.yaml` sync
  covers a single App's config. No bulk scan, no auto-detection.

## Architecture

### Split of responsibilities

- **Go Temporal worker = transport & enumeration** (dumb, durable): list an
  installation's repos, walk each repo's tree, fetch a bounded set of
  well-known files, POST the evidence bundle to orbit-www. Reuses the GitHub
  service, token decryption, and the repo-inspect/clone patterns already in
  `temporal-workflows/`.
- **orbit-www = detection & staging** (the brains, unit-testable in Vitest):
  an internal X-API-Key route runs pure detector functions over the evidence,
  upserts `discovered-entities` proposals, and auto-imports Tier 1 manifest
  detections. Approval creates `apps` / `api-schemas` rows; projection does
  the rest.

This mirrors the existing worker→Payload bridge
(`POST /api/internal/catalog/upsert`) rather than the launches per-provider
task-queue pattern — provider adapters are thin HTTP clients, so one scanner
worker with an in-process, fail-closed adapter registry is less operational
surface than a queue+worker per provider.

### Detection tiers

| Tier | Signal | Confidence | Disposition |
|------|--------|------------|-------------|
| 1 | `.orbit.yaml` (later `catalog-info.yaml`) | high | auto-import |
| 2 | OpenAPI/Swagger/AsyncAPI/GraphQL specs, Dockerfile/compose/k8s, package.json/go.mod/pom.xml (language/framework), CODEOWNERS (ownership hints) | high/medium | review queue |
| 3 | Monorepo sub-package layout, naming conventions, (later) LLM-assisted classification | medium/low | review queue (Phase 2+) |

Every proposal carries its evidence (which files fired, at which paths).

## Design — Phase 1 (GitHub org scan, Tier 1/2, review queue)

### Schema: `discovered-entities` collection
NEW `orbit-www/src/collections/discovery/DiscoveredEntities.ts`, registered in
`payload.config.ts`. Access via the **`lib/access/collection-access.ts`
factories** (mandatory for new collections): read/update = workspace members,
delete = workspace owner/admin, no public create (internal route uses local
API with `overrideAccess`).

Fields:
- `workspace` (rel→workspaces, required), `installation`
  (rel→github-installations)
- `repo` group `{ owner, name, url, defaultBranch }`, `path` (text, `''` =
  repo root; monorepo subdirectory otherwise)
- `detectedKind` (select: `service | api`), `confidence`
  (select: `high | medium | low`)
- `evidence` (json: `[{ detector, file, excerpt? }]`)
- `proposal` (json: prefilled entity — name, description, buildConfig for
  services; schemaType, specPath, rawContent ref for APIs)
- `status` (select: `proposed | approved | ignored | imported | stale`,
  default `proposed`), `importedRef` group `{ collection, id }`
- `dedupeKey` (text, unique index): `sha1(installationId:owner/name:path:detectedKind)`
- `scanRunId` (text — Temporal workflow run that last touched it),
  `lastSeenAt` (date)

Run `bun run generate:types` after.

### Detectors: `orbit-www/src/lib/discovery/detectors.ts` (pure, TDD)
Input: `{ tree: string[], files: Record<path, content> }` (evidence bundle).
Output: `Detection[]` `{ kind, confidence, name, path, evidence, proposal }`.
- `detectOrbitManifest` — parse via existing `lib/app-manifest.ts`; Tier 1.
- `detectApiSpecs` — filename + content sniff for OpenAPI/Swagger/AsyncAPI/
  GraphQL (reuse the schemaType auto-detection already in
  `collections/api-catalog/APISchemas.ts` beforeChange — extract it into this
  lib and re-import from the hook so there is ONE sniffing implementation).
- `detectService` — Dockerfile / compose / k8s manifests + build manifest
  (package.json, go.mod, pom.xml, Cargo.toml, requirements.txt/pyproject) →
  service proposal with `buildConfig.language/framework` prefilled.
- `detectOwnershipHints` — CODEOWNERS → owner suggestions attached to
  evidence (surfaced in the review UI; NOT auto-written in Phase 1).
- `runDetectors(bundle)` — composes the above, dedupes (a repo with both a
  Dockerfile and an openapi.yaml yields one service + one api proposal).

Well-known path list exported as `DISCOVERY_FETCH_PATTERNS` (consumed by the
Go activity via the ingest contract doc-comment; keep the two lists in sync —
note in both files).

### Ingest route: `orbit-www/src/app/api/internal/discovery/ingest/route.ts`
POST, X-API-Key (same guard as `api/internal/catalog/upsert`). Body:
`{ installationId, workspaceId, repo, scanRunId, bundle }`.
1. `runDetectors(bundle)` → detections.
2. Upsert `discovered-entities` by `dedupeKey` (never resurrect `ignored`;
   refresh `evidence`/`proposal`/`lastSeenAt` on `proposed`).
3. Tier 1 (`.orbit.yaml`) → call the import lib immediately, status
   `imported` (row kept for traceability).
4. Returns `{ proposed, imported, skippedIgnored }` counts (workflow logs them).

### Import lib: `orbit-www/src/lib/discovery/import.ts` (pure-ish, TDD)
- `importDiscoveredService(payload, discovery)` — creates an `apps` row:
  `origin.type: 'discovered'` (NEW enum value on `Apps.ts` `origin.type`),
  repository group from `discovery.repo`, buildConfig from proposal,
  `syncEnabled: false`. Existing App for same repo+path ⇒ no-op link
  (idempotent), record `importedRef`.
- `importDiscoveredApi(payload, discovery)` — creates `api-schemas` row
  (rawContent from the fetched spec, `repository` rel→ the repo's App if one
  exists, `repositoryPath`), letting the existing projection emit the `api`
  entity + `exposes-api` relation.
- Both set `status: 'imported'` + `importedRef` on the discovery row.

### Temporal (Go, `temporal-workflows/`)
- NEW `internal/workflows/catalog_scan_workflow.go` — `CatalogScanWorkflow`
  input `{ InstallationID, WorkspaceID }`:
  1. Activity `ListInstallationRepos` (respects `repositorySelection`).
  2. Fan out `ScanRepoActivity` (bounded parallelism ~5; continue-as-new
     past ~200 repos, following the CAN patterns already in the agent
     workflows).
  3. Aggregate counts; final activity posts a scan summary (log-only Phase 1).
- NEW `internal/activities/catalog_scan_activities.go`:
  - `ListInstallationRepos` — via GitHubService (installation token).
  - `ScanRepoActivity` — GitHub git-tree API for the file list; fetch
    well-known files (size-capped, ~256KB/file, ~40 files/repo); POST bundle
    to the ingest route (`ORBIT_INTERNAL_API_KEY`, same env the catalog
    upsert worker path uses). API-only in Phase 1 — no clone fallback
    (generic-git arrives in Phase 3).
- Register workflow + activities in `cmd/worker/main.go`. Table-driven tests
  with Temporal's test framework (mock activities; assert fan-out, CAN
  boundary, partial-failure tolerance — one failing repo must not fail the
  scan).

### Server actions: `orbit-www/src/app/actions/discovery.ts` ('use server')
RBAC mirrors the catalog conventions (Better-Auth id via `getCurrentUser()`,
active-membership checks per `lib/scorecards/authz.ts` style; **query members
by `betterAuthId`, not Payload `id`** — the recurring gotcha).
- `startWorkspaceScan(workspaceId)` — workspace member; resolves the
  workspace's installations (`getWorkspaceGitHubInstallations`), starts
  `CatalogScanWorkflow` per installation via `lib/temporal/client.ts`
  (deterministic workflow ID `catalog-scan-<installationId>`, USE_EXISTING —
  idempotent "Scan now").
- `getScanStatus(workspaceId)` — describe workflow(s), return running/last-run.
- `listDiscoveries(workspaceId, { status?, kind? })`
- `approveDiscoveries(ids: string[])` — member; calls import lib per row.
- `ignoreDiscoveries(ids: string[])` — member; status `ignored`.

### UI (`app/(frontend)/workspaces/[slug]/discovery/`, `components/features/discovery/`)
- Discovery page: scan trigger + status banner, proposal list grouped by repo
  — kind badge, confidence chip, evidence expander, ownership hints; row
  select + bulk Approve/Ignore; tabs Proposed / Ignored / Imported.
- Entry points: "Scan organization" alongside the existing import flow
  (`ImportAppForm` surface) + workspace nav item.
- Empty state explains Tier 1 auto-import ("repos with `.orbit.yaml` were
  imported automatically — N imported").

## User Acceptance Criteria

- AC-1: Member triggers a scan for a workspace with a GitHub installation →
  all selected repos scanned; proposals appear with kind, confidence, evidence.
- AC-2: A repo containing a valid `.orbit.yaml` is auto-imported (App row,
  `origin.type: 'discovered'`) with a traceability row `status: imported`;
  the catalog shows the service entity.
- AC-3: A repo with `openapi.yaml` yields an `api` proposal; approval creates
  an `api-schemas` row and the projection emits the `api` entity +
  `exposes-api` relation (when the repo's App exists).
- AC-4: Re-scan is idempotent: no duplicate proposals (dedupeKey), `ignored`
  rows stay ignored, `lastSeenAt` refreshes.
- AC-5: Manual edits on previously imported entities survive re-scan/re-import
  (projection set-if-absent; import lib no-ops on existing App).
- AC-6: A repo the scanner cannot read (permissions, deleted mid-scan) is
  skipped with a logged warning; the scan completes.
- AC-7: Non-members cannot trigger scans or act on another workspace's
  proposals (server-action RBAC + collection access).

## Work packages (Phase 1)

1. **WP1 — detectors lib + tests** (`lib/discovery/detectors.ts`): TDD; extract
   schema-type sniffing from `APISchemas.ts` hook into the lib.
2. **WP2 — collection + types** (`DiscoveredEntities.ts`, `Apps.ts`
   `origin.type: 'discovered'`, `generate:types`), access-factory tests.
3. **WP3 — ingest route + import lib** (TDD with FakePayload; dedupe,
   ignored-stays-ignored, Tier 1 auto-import, idempotent import).
4. **WP4 — Go workflow + activities** (Temporal test framework; register in
   worker main).
5. **WP5 — server actions + UI** (RBAC tests; discovery page + components).
6. **WP6 — end-to-end verification** (below) + docs update.

## Verification

- `cd orbit-www && bun run tsc --noEmit` — stays at 0 errors.
- `pnpm exec vitest run src/lib/discovery src/app/api/internal/discovery`
  (+ the touched APISchemas hook tests).
- `cd temporal-workflows && go test -v -race ./internal/workflows/... ./internal/activities/...`
- `make lint`.
- Manual (agent-browser, seeded dev login): trigger scan against a dev GitHub
  installation → review queue renders → approve an API proposal → entity
  visible in catalog with relation → re-scan produces no dupes. Pre/post
  orphan-Chrome checks per CLAUDE.md.

## Phase 1.5 — cross-workspace visibility + workspace-less import (approved 2026-07-07)

Two additions Drew requested after Phase 1 review:

### WP7 — Attention Hub proposals card
Dashboard-level visibility: a bounded card beside `DashboardAttention` on
`app/(frontend)/dashboard/page.tsx` showing proposed-discovery counts grouped
by workspace (member workspaces only; platform admins also see the global
queue). Each row links to that workspace's `/discovery` page (or `/discovery`
for global). Purely additive files: `lib/discovery/attention-core.ts` (tested
query core), `app/actions/discovery-attention.ts`, and
`components/features/discovery/DiscoveryAttentionCard.tsx`; hidden entirely
when there is nothing to review (the hub is bounded — no empty chrome).

### WP8 — workspace-less discovery
`apps`/`api-schemas` require a workspace, but `catalog-entities.workspace` is
already optional (global entities, platform-admin managed — see
2026-07-02-catalog-entity-crud.md). Model:
- `discovered-entities.workspace` → `required: false`. Global rows (no
  workspace) are platform-admin managed (read/update/delete), mirroring the
  CatalogEntities global-entity access rules.
- Scan without a workspace: platform admins trigger an installation-level
  scan (no workspaceId); the Go workflow already treats WorkspaceID as an
  opaque string — empty means global. Ingest accepts an absent workspaceId.
- Platform-level review UX at `app/(frontend)/discovery` (org-level page,
  admin-gated): pick an installation, scan, review the global queue.
- Approval of a GLOBAL proposal offers two affordances:
  1. **Assign to workspace** → the existing apps/api-schemas import path runs
     in the chosen workspace.
  2. **Import as global entity** → direct `catalog-entities` create with
     `workspace: null`, `source: { type: 'scan', sourceId: dedupeKey }`
     (new `scan` option on the CatalogEntities source enum), kind
     service/api. Platform admin only, consistent with `canCreateGlobal`.
     APIs imported globally skip `api-schemas` (it is workspace-bound) — the
     entity carries `metadata.specPath`/`schemaType` instead; assigning to a
     workspace later re-imports properly (Phase 2 follow-up).
- Tier-1 auto-import for global scans creates the global entity directly
  (same trust rationale: the repo self-declares).

## Phase 1.6 — GitHub connection lifecycle + Azure DevOps scanning (approved 2026-07-07)

Pulled forward from Phase 3 after live local testing.

### WP10 — GitHub installation lifecycle control (`/settings/github`)
- **Remove connection**: confirm dialog (shows count of Apps referencing the
  installation), deletes the `github-installations` doc, cancels the refresh
  workflow (`cancelGitHubTokenRefreshWorkflow`), links to GitHub to uninstall
  the app itself (we cannot uninstall server-side without the app acting on
  itself). Apps keep working until their next token use; the dialog says so.
- **Remediation**: existing Refresh (signal-with-start) + Reconnect install
  link on `needs_reconnect`; add "Restart refresher" == Refresh (no new verb).
- **Edit**: existing `[id]/configure` (allowedWorkspaces) is the edit surface;
  linked from each card (done in the previous round).

### WP11 — `git-connections` + Azure DevOps scanning
- NEW collection `git-connections`: `name`, `provider` (select: `azure-devops`
  — fail-closed registry, more later), `organization` (ADO org), `project`
  (optional filter; empty = all projects), `baseUrl` (default
  `https://dev.azure.com`, overridable for ADO Server), `credentials` group
  `{ pat: text ENCRYPTED via lib/encryption (AES-256-GCM, beforeChange
  encrypt, never returned by APIs) }`, `allowedWorkspaces`, `status`
  (active | error), `lastValidatedAt`, `lastError`. Admin-managed
  (create/update/delete = platform admin; read = admin; workspace exposure
  comes later).
- NEW internal route `POST /api/internal/git-connections/token` (X-API-Key):
  `{ connectionId }` → `{ provider, organization, project?, baseUrl, pat }`
  (decrypted server-side for the Go worker only — mirrors the GitHub token
  route).
- `discovered-entities`: add optional `connection` (rel→git-connections);
  ingest body gains optional `connectionId` (mutually exclusive with a
  numeric GitHub `installationId` — the shared `installationId` body field
  carries the connection doc id for non-GitHub scans and is used verbatim in
  the dedupeKey, so no key-shape change).
- Go scanner: `CatalogScanWorkflow` input gains `Provider`
  (`github` default | `azure-devops`) + `ConnectionID`. ADO activities via
  REST 7.1 (PAT basic auth): list repos
  (`{org}/{project}/_apis/git/repositories` or org-wide via projects
  enumeration), tree (`.../items?recursionLevel=Full`), file content
  (`.../items?path=`). Same vendored filter, caps, and ingest POST.
- Scan triggers: `/discovery` picker lists GitHub installations AND ADO
  connections; `startConnectionScan(connectionId)` (admin) starts
  `catalog-scan-ado-<connectionId>`.
- Connections UI: NEW `/settings/connections` (platform admin): list/add/
  edit/remove ADO connections; PAT entry (write-only — edit shows "PAT set",
  replace field), **Validate** button (server action calls ADO
  `_apis/projects` with the PAT → status/lastValidatedAt/lastError), Scan
  shortcut. Sidebar Settings group entry "Connections".

### WP12 — Entra service-principal auth for Azure DevOps (approved 2026-07-08)

Microsoft context: ADO's legacy OAuth is sunset in 2026 and global PATs stop
working 2026-12-01; the recommended automation identity is an Entra service
principal. `git-connections.authType` gains `service-principal`
(tenantId/clientId + encrypted clientSecret). The internal token route mints
short-lived Entra access tokens via client-credentials against the ADO
resource scope (`499b84ac-…/.default`), cached in-module until 5 min before
expiry, returned as `{ authMode: 'bearer', token }` — PAT connections return
`{ authMode: 'basic-pat', token }`. The Go scanner builds the Authorization
header per authMode (absent mode = basic-pat for compatibility). Validate
proves the Entra sign-in AND org access in one pass. PAT stays for ADO Server
(on-prem). Entra OAuth user flow (one-click connect) deferred until a
deployment-owned Entra app registration exists.

## Future phases (sketch, out of Phase 1 scope)

- **Phase 2 — richer manifests & monorepos:** multi-entity `.orbit.yaml`
  (several services/APIs + ownership + `depends-on` in one document;
  extend `lib/app-manifest.ts` with a versioned schema), **Backstage
  `catalog-info.yaml` reader** (map Component/API/System/Group → our kinds,
  ownership → `kind:team`), monorepo sub-package detection (workspaces globs,
  nested go.mod) as Tier 3.
- **Phase 3 — multi-platform:** narrow TS `GitProvider` interface
  (`listRepos, getTree, getFileContent, getDefaultBranch, verifyWebhook,
  parsePushEvent`); NEW `git-connections` collection (provider, baseUrl,
  credentials **AES-256-GCM encrypted via `lib/encryption`** — not the
  plaintext-json `CloudAccounts` shortcut; `allowedWorkspaces`); **Azure
  DevOps adapter first** (PAT/service principal); **generic-git fallback**
  (shallow clone via the existing git CLI activities, token scrubbed from
  `.git/config` per `orbit_repo_clone_activity.go`) so any credentialed
  remote is scannable; fail-closed provider registry per
  `launch_workflow.go`'s `supportedProviders` pattern.
- **Phase 4 — continuous sync & lifecycle:** push-webhook → debounced
  single-repo re-scan (extend the `app-sync` route; per-provider webhooks via
  the Phase 3 interface), scheduled org re-scans (cron workflow),
  **stale detection** (entity's source file/repo gone → propose archival,
  never hard-delete), workspace auto-approve policy knob, optional
  LLM-assisted classification.

## Explicitly out of scope

- Writing ownership automatically from CODEOWNERS (hints only until team
  mapping UX exists).
- Scanning non-default branches.
- Kafka topology discovery (owned by the kafka lineage feature).
- Backstage *export* (we read `catalog-info.yaml`; we do not write it).
