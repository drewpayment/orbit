# Catalog Representation Gaps — Self-Hosted / Monorepo Applications

**Date:** 2026-07-19
**Status:** Proposed
**Origin:** Dogfooding exercise — attempting to register `drewpayment/sprinklergoose`
(a monorepo with a Next.js UI, a FastAPI executor, a shared Postgres, a Rain Bird
hardware controller dependency, deployed to a home Kubernetes cluster) exposed six
gaps in how the catalog represents real-world self-hosted applications.

## Gap list (what this plan resolves)

| # | Gap | Resolution (phase) |
|---|-----|--------------------|
| 1 | Go scan worker only collects build manifests/Dockerfiles at repo root, so monorepo sub-apps are never proposed | Phase 1 |
| 2 | No deployed-URL / hosting representation on entities | Phase 2 |
| 3 | No way to distinguish a hardware device / postgres / etc. within a kind (`resource`/`datastore` are opaque buckets) | Phase 2 |
| 4 | `.orbit.yaml` can only declare a single `Application` — no systems, datastores, resources, relations, or ownership | Phase 3 |
| 5 | A public repo without a GitHub App installation can only be an inert manual entry | Phase 4 |
| 6 | Ownership requires a `team` entity — no solo-developer path | Phase 5 |

Phases 1, 4, and 5 are independent of each other. Phase 2 must land before
Phase 3 (the v2 manifest writes the fields Phase 2 adds). Phase 6 is the
end-to-end dogfood verification using sprinklergoose itself.

Each phase is a separate PR off `main`. TDD throughout: write the failing test
first, then implement. Frontend tests are vitest (`bunx vitest run <path>`),
Go tests are table-driven testify (`go test -v -race ./...`).

## Design decisions (recommendations — veto here before implementation)

1. **Subtype over new kinds.** Rather than adding `device`/`website` kinds (each
   new kind touches ~8 files: `constants.ts`, `entity-kind-meta.ts`,
   `EntityKindBadge.tsx`, `projection.ts`, `evaluate.ts`, `rule-builder.ts`,
   `EntityTypes.ts`, discovery UI), add one optional free-text `subtype` field
   rendered as a badge. `resource` + subtype `iot-device`, `datastore` + subtype
   `postgresql`. Kind stays the scoring/graph axis; subtype is descriptive.
2. **`runtime` group over polluting `links`.** A first-class
   `runtime { url, platform, notes }` group on `catalog-entities` answers
   "where does this run and how do I reach it." Topology ("runs in *which*
   environment") stays in the graph via `runs-in` edges — the two are
   complementary, not redundant.
3. **Manifest v2 is a superset, parsed with zod.** `apiVersion: orbit.dev/v2`,
   `kind: System`, with a `spec.entities` list and inline relation declarations.
   v1 (`kind: Application`) continues to parse forever via the existing
   hand-rolled path; v2 gets a zod schema (zod is already a frontend dep).
4. **Personal ownership via auto-provisioned personal team**, not a polymorphic
   `owner` field. Polymorphic owner (team-or-user) ripples through `owns`
   relations, scorecard golden-path checks, and `isTeamEntity` authz. A
   one-click "Create my personal team" affordance gets the same UX for a tiny
   fraction of the blast radius.
5. **Public-repo import = explicit degraded mode, one-shot anonymous scan.**
   The `importRepository` server action already accepts a URL with no
   `installationId`/`connectionId`; we make that path intentional: label the
   app "read-only / not connected", run a single anonymous GitHub API scan at
   import time (unauthenticated rate limit is 60 req/hr — one tree + ≤10 file
   fetches per import, no polling ever), and surface an "install the GitHub App
   to enable sync/health" upgrade prompt.

---

## Phase 1 — Monorepo-aware discovery (Go worker subdirectory collection)

**Why first:** the TS detectors (`detectService`, `detectApiSpecs`) already
group signals per directory and emit one proposal per subdir — they just never
receive subdirectory build manifests because the Go side filters them out.
Zero schema changes; immediately makes sprinklergoose scan as two services.

### Tasks

1. **Relax `classifyWellKnown`** in
   `temporal-workflows/internal/activities/catalog_scan_activities.go` (~L406):
   - Allow build manifests (`package.json`, `go.mod`, `pom.xml`, `Cargo.toml`,
     `pyproject.toml`, `requirements.txt`), `Dockerfile`, and `docker-compose*`
     at **any non-vendored path up to depth 3**, not just `isRoot`.
   - Allow `.orbit.yaml` / `.orbit.yml` at non-root paths (needed by Phase 3;
     harmless now — the TS detector ignores non-root manifests until then).
   - Keep the vendored-path exclusion (`isVendoredPath`) authoritative.
   - TDD: extend `TestClassifyWellKnown` and `TestSelectWellKnownFiles` in
     `catalog_scan_activities_test.go` with monorepo cases
     (`apps/web-next/package.json`, `apps/api/pyproject.toml`,
     `apps/api/Dockerfile`, and a `node_modules/x/package.json` negative).
2. **Raise the per-repo file cap** (`maxFilesPerRepo`, currently 40) to 80 and
   make selection prioritized: Tier-1 manifests → root files → shallowest
   subdir build manifests → API specs → k8s. Add a test asserting priority
   order when over cap.
3. **Mirror in the ADO activity**
   (`temporal-workflows/internal/activities/ado_scan_activities.go`) — same
   classification change, extend `ado_scan_activities_test.go`.
4. **Keep the sync-pair invariant honest:** update `DISCOVERY_FETCH_PATTERNS`
   in `orbit-www/src/lib/discovery/detectors.ts` (~L39) only if patterns
   actually change; update the invariant header comments in both files
   (detectors.ts L33-38, catalog_scan_activities.go L297-301).
5. **Dedupe check:** confirm `computeDedupeKey`
   (`orbit-www/src/lib/discovery/import.ts` L84) already includes `path` — it
   does — so two services in one repo produce distinct `discovered-entities`
   rows. Add a vitest case in
   `orbit-www/src/app/api/internal/discovery/ingest/route.test.ts`: one bundle
   containing two subdir services → two proposals, re-ingest → no dupes.

### Verification

- `cd temporal-workflows && go test -v -race ./...`
- `cd orbit-www && bunx vitest run src/lib/discovery src/app/api/internal/discovery`
- Manual: trigger a scan against a monorepo installation and confirm two
  service proposals with distinct `path` values appear in `/discovery`.

### Implementation notes (2026-07-20, as shipped)

Implemented as planned, plus changes driven by adversarial review + live QA:

- **Anti-noise gate (new):** a non-root directory needs ≥2 signal classes
  (build manifest / container file / k8s evidence) before `detectService`
  proposes it — otherwise every workspace package in a pnpm/turbo monorepo
  becomes a proposal. Root behavior unchanged. A sub-app with only a build
  manifest can opt in later via a subdir `.orbit.yaml` (Phase 3).
- **Path-aware Apps (new, critical):** live QA proved approving two proposals
  from one repo silently collapsed into one App (`findRepoApp` was repo-keyed,
  second approve no-op'd). Added `repository.path` to `Apps` and keyed
  `findRepoApp` on (workspace, owner, name, path); legacy path-less apps match
  root proposals.
- **Deterministic API→App linking (new):** `importDiscoveredApi` now picks the
  App whose `repository.path` is the longest segment-boundary ancestor of the
  spec's directory (`pickNearestApp`), root App as fallback — previously an
  arbitrary first match, wrong once repos have multiple apps.
- **k8s anchor fix:** `detectService` anchored `apps/svc/k8s/x.yaml` to `apps`
  and root `k8s/x.yaml` to a bogus scope; rewritten as a segment scan
  (pre-existing bug the gate made consequential).
- **Priority/depth details:** composite fetch priority `class*10 + min(depth,9)`
  (clamped so class always dominates); TS enforces the same depth-3 subdir
  bound as Go (`MAX_SUBDIR_SERVICE_DEPTH`); `compose.yml`/`compose.yaml`
  now matched Go-side; k8s dir sets (`deployments`, `charts`) synced TS↔Go.
- **Deliberately not done:** case-sensitive filename matching (pre-existing,
  both sides); deep compose under k8s dirs no longer classified (content was
  never parsed — inert); `catalog-info.yaml` stays root-only and unparsed.

---

## Phase 2 — Entity fields: `runtime` group + `subtype`

### Tasks

1. **Schema** — `orbit-www/src/collections/catalog/CatalogEntities.ts`:
   - `subtype`: optional text, index with kind.
   - `runtime` group: `url` (text, validated URL), `platform` (select:
     `kubernetes | vps | home-server | paas | serverless | other`), `notes`
     (textarea).
2. **CRUD layer** — `orbit-www/src/lib/catalog/entity-crud.ts`:
   - Add `subtype` and `runtime` to `CURATION_FIELDS` (editable even on
     projected entities — they're human curation, not projection-owned).
   - Extend `CreateEntityInput` / `UpdateEntityPatch` + `validateCreateInput` /
     `validateUpdatePatch` (URL validation mirroring `validateLinks`).
   - TDD in `orbit-www/src/lib/catalog/entity-crud.test.ts`.
3. **Form** — `EntityForm` under
   `orbit-www/src/components/features/catalog/entity-form/` (+
   `entity-form-ui.ts`): subtype input with per-kind placeholder suggestions
   (datastore → "postgresql, redis…", resource → "iot-device, bucket…");
   runtime section with URL/platform/notes.
4. **Detail view** — `orbit-www/src/components/features/catalog/EntityDetail.tsx`:
   subtype badge next to `EntityKindBadge`; "Runtime" card on the Overview tab
   (linked URL, platform label, notes) shown only when populated.
5. **List** — `EntityListItem.tsx`: subtype as a muted suffix on the kind badge.
6. **Do not** touch `projection.ts` — both fields are curation-only; verify
   `mergeProjectionUpdate` leaves them intact (add a case to
   `orbit-www/src/lib/catalog/projection.test.ts`).

### Verification

- `bunx vitest run src/lib/catalog`
- `bunx tsc --noEmit` (keep the 0-error baseline)
- agent-browser (with pre/post-flight pgrep hygiene): create a `datastore`
  with subtype `postgresql` and a runtime URL at `/catalog/new`, confirm
  render on detail + list, confirm editing a *projected* entity's
  subtype/runtime persists across a re-projection.

---

## Phase 3 — Manifest v2: declare a whole system in one file

### Format

```yaml
apiVersion: orbit.dev/v2
kind: System
metadata:
  name: sprinklergoose
  description: Self-hosted irrigation control
spec:
  owner: drews-team                # optional: team entity slug
  environment: home-k8s            # optional: environment entity slug → runs-in edges
  entities:
    - kind: service
      name: web-next
      path: apps/web-next          # scopes health/build detection to this dir
      runtime: { url: https://sprinklers.example.com, platform: kubernetes }
      build: { language: typescript, framework: nextjs }
      dependsOn: [api-executor, sprinklergoose-db]
      consumesApis: [executor-api]
    - kind: service
      name: api-executor
      path: apps/api
      health: { endpoint: /healthz, interval: 60 }
      dependsOn: [sprinklergoose-db, rainbird-controller]
      exposesApis:
        - name: executor-api
          schemaType: openapi
          specPath: apps/api/openapi.json
    - kind: datastore
      name: sprinklergoose-db
      subtype: postgresql
    - kind: resource
      name: rainbird-controller
      subtype: iot-device
```

Semantics: the file itself yields a `system` entity; every listed entity gets a
`part-of` edge to it; `dependsOn` → `depends-on` edges; `exposesApis` →
`api-schemas` row (when `specPath` resolves) + `exposes-api` edge;
`consumesApis` → `consumes-api` edge; `environment` → `runs-in` edges from
each service. Relation targets are names within the file (or existing entity
slugs in the same workspace). Unresolvable references are validation errors at
detect time, surfaced as evidence on the proposal — never silently dropped.

### Tasks

1. **Parser** — new `orbit-www/src/lib/app-manifest-v2.ts`: zod schema
   (`AppManifestV2`), `parseManifest(content)` dispatcher that sniffs
   `apiVersion` and routes v1 content to the existing `parseAppManifest` in
   `app-manifest.ts` (untouched). Cross-reference validation (dependsOn/
   consumesApis names resolve within the file). TDD:
   `app-manifest-v2.test.ts` — valid full example, unknown kind, dangling
   dependsOn, v1 passthrough.
2. **Detector** — `orbit-www/src/lib/discovery/detectors.ts`:
   - `detectOrbitManifest` (~L244) handles v2: emits one detection per
     declared entity plus one for the system, all `confidence: 'high'`,
     Tier-1 authoritative for their `path` (suppressing heuristic duplicates,
     same as v1 today).
   - Widen `Detection['kind']` from `'service' | 'api'` to include
     `'system' | 'datastore' | 'resource'`.
   - Carry the declared relations on the proposal JSON
     (`proposal.relations: [{type, targetName}]`).
3. **Review queue schema** —
   `orbit-www/src/collections/discovery/DiscoveredEntities.ts`: widen
   `detectedKind` enum to match; group related proposals visually by a shared
   `manifestKey` (owner/repo/manifestPath) so a v2 manifest reads as one unit
   in `/discovery` (`discovery-ui.tsx`, `ProposalRow.tsx`).
4. **Import** — `orbit-www/src/lib/discovery/import.ts`:
   - `importDiscovery` switch: `datastore`/`resource`/`system` → direct
     `catalog-entities` creation (reuse the `importDiscoveredGlobalEntity`
     shape but workspace-scoped), `source: { type: 'scan' }`, carrying
     `subtype`/`runtime` from the proposal (Phase 2 fields).
   - New `materializeRelations(payload, workspaceId, imported)` — after the
     entities of one manifest are imported, create `catalog-relations` edges
     (`part-of`, `depends-on`, `runs-in`, `exposes-api`, `consumes-api`),
     idempotent on `(from, to, type)`. Import order within a manifest:
     system → non-service entities → services → relations.
   - TDD in `import.test.ts` (FakePayload — note it hides ObjectId casting;
     use doc ids for relationships per prior gotcha).
5. **Apps sync** — `orbit-www/src/collections/Apps.ts` outbound sync and
   `src/app/actions/apps.ts` inbound: v2 manifests are **sync-exempt in this
   phase** (outbound sync short-circuits when the file at `manifestPath`
   parses as v2; log + set `conflictDetected: false`). Bidirectional v2 sync
   is a follow-up — writing a multi-entity file from single-app state is
   lossy and needs its own design.
6. **Subdir v1 manifests** (small bonus): with Phase 1 collecting non-root
   `.orbit.yaml`, drop the root-only restriction in `detectOrbitManifest` so
   `apps/api/.orbit.yaml` (v1) proposes a service at that path — an
   alternative to v2 for people who prefer one file per app.
7. **Docs** — update README catalog section + add
   `.agent/SOPs/orbit-manifest.md` documenting both versions.

### Verification

- `bunx vitest run src/lib/app-manifest-v2.test.ts src/lib/discovery`
- `bunx tsc --noEmit`
- Manual end-to-end: commit the sprinklergoose v2 manifest above to a test
  repo, scan, approve the grouped proposals, confirm in `/catalog`: system +
  2 services + datastore + resource, Relations tab and Neighbourhood graph
  showing part-of / depends-on / exposes-api edges.

---

## Phase 4 — Public repo import without an installation

### Tasks

1. **Form** — `orbit-www/src/components/features/apps/ImportAppForm.tsx`: add
   a third source option "Public repository (read-only)" alongside GitHub
   installations and ADO connections; accepts a `github.com/owner/repo` URL,
   shows an explicit capability note (no sync, no health checks, no webhooks —
   one-time scan only) with an "install the GitHub App to upgrade" link.
2. **Anonymous GitHub client** — new `orbit-www/src/lib/github/public.ts`:
   `fetchPublicRepoInfo`, `fetchPublicTree`, `fetchPublicFile` via
   unauthenticated `api.github.com` (reuse `parseGitHubUrl` from
   `src/lib/github-manifest.ts`). Hard budget: ≤12 requests per import, typed
   rate-limit error mapped to a friendly "GitHub rate limit — try again in an
   hour or connect the App" message. Never called from hooks/cron — import
   action only.
3. **Server action** — `importRepository` in `orbit-www/src/app/actions/apps.ts`
   (~L95): when neither `installationId` nor `connectionId` is present and the
   URL is a valid public GitHub repo, set `origin.type: 'imported'`,
   `repository.provider: 'github'` with no installation, run the one-shot
   scan: fetch tree + root/near-root well-known files, build an
   `EvidenceBundle`, run `runDetectors` **in-process** (no
   `discovered-entities` rows — import directly, reusing the Phase 3 import
   helpers). A v1/v2 `.orbit.yaml` in the repo thus works fully on a public
   repo with zero installation.
4. **Degraded-state UI** — app detail page: "Not connected" badge where
   sync/health status normally renders; verify the existing short-circuits
   (`Apps.ts` outbound sync L87 `!installationId`, health/webhook deletion
   guards) already no-op cleanly — add a vitest around the sync hook guard.
5. **TDD:** extend `orbit-www/src/app/actions/__tests__/apps.test.ts`
   (URL-only import creates app + entities, rate-limit error path) and
   `ImportAppForm.test.tsx` (third source renders, capability note shown).

### Verification

- `bunx vitest run src/app/actions/__tests__/apps.test.ts src/components/features/apps`
- agent-browser: import `https://github.com/drewpayment/sprinklergoose` with
  no installation selected → app appears with "Not connected" badge, catalog
  entities created from its manifest.

---

## Phase 5 — Personal ownership: one-click personal team

### Tasks

1. **Helper** — new `orbit-www/src/lib/catalog/personal-team.ts`:
   `ensurePersonalTeam(payload, { workspaceId, userId, userName })` — find-or-
   create a `catalog-entities` row `kind: 'team'`, slug
   `personal-<user-slug>`, `source: { type: 'manual' }`, `metadata.personalFor:
   <userId>`; idempotent per (workspace, user). TDD:
   `personal-team.test.ts`.
2. **Owner picker** — in `EntityForm`'s owner select: when the workspace has
   no team entities (or none owned by the user), render "＋ Create my personal
   team" which calls a server action wrapping `ensurePersonalTeam` (authz:
   active workspace member, via existing `canCreateEntity`) and selects the
   result.
3. **Import default** — Phase 3/4 import paths: when a manifest declares no
   `owner` and the importing user confirms, default owner to their personal
   team (surfaced in the approve dialog, not silent).
4. Existing `isTeamEntity` validation (`entity-authz.ts` L94) is untouched —
   personal teams are real `team` entities, so scorecards, `owns` edges, and
   golden-path checks work unchanged.

### Verification

- `bunx vitest run src/lib/catalog/personal-team.test.ts`
- agent-browser: fresh workspace with zero teams → create entity → one-click
  personal team → owner renders on detail; second entity reuses the same team.

---

## Phase 6 — Dogfood: register sprinklergoose end-to-end

Not a code phase — the acceptance test for the whole plan.

1. Add the v2 manifest (Phase 3 format above) to `drewpayment/sprinklergoose`.
2. Path A (connected): install the GitHub App on the repo, scan, approve the
   grouped proposals.
3. Path B (public): remove the app from a test workspace and re-import via the
   Phase 4 public-URL flow; confirm parity of the resulting entity graph.
4. Confirm the full graph renders: `system` sprinklergoose; services
   `web-next` + `api-executor` (`part-of`, `runs-in` home-k8s, runtime URLs);
   `datastore` subtype `postgresql`; `resource` subtype `iot-device`;
   `api` executor-api with `exposes-api`/`consumes-api` edges; owner = personal
   team. Legacy `apps/web` deliberately not manifested (or added with
   lifecycle `deprecated`).
5. File any friction found as issues — that output is the point.

---

## Out of scope (explicitly deferred)

- Bidirectional sync of v2 manifests (outbound write-back) — needs its own design.
- Parsing Backstage `catalog-info.yaml` (Go already fetches it; TS ignores it) —
  natural follow-up to the v2 parser, tracked separately.
- Polymorphic (user-valued) `owner` field — rejected in favor of personal teams.
- New entity kinds (`device`, `website`) — rejected in favor of `subtype`.
- ADO public-repo parity and the ADO outbound-sync gap (`Apps.ts` L87
  short-circuits on missing `installationId`, so ADO apps never outbound-sync) —
  pre-existing, worth its own fix.
