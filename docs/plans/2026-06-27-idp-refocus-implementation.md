# Orbit IDP Refocus — Implementation Plan

**Date:** 2026-06-27
**Status:** Plan — ready for review, not yet started
**Branch:** `claude/idp-refactor-service-catalog-g7ch9h`
**Companion:** `docs/plans/2026-06-27-idp-refocus-recommendations.md` (the "why")
**Assumes:** Option (A) "Orbit IS the IDP" + fold Knowledge into the catalog (see recommendations §4).
**Respects security sequencing in:** `docs/plans/2026-06-09-product-focus-strategy.md` §5–6 (strip + gRPC auth interceptor land first).

---

## 0. Scope & shape

Five phases, ordered cheapest-signal-first. Each phase is independently shippable.

| Phase | Deliverable | Risk | Depends on |
|---|---|---|---|
| **P0** | Navigation / IA collapse (30 routes → 5 surfaces) | Low (frontend only) | — |
| **P1** | Unified catalog graph (`catalog-entities` + `catalog-relations`) | Medium (data model) | P0 |
| **P2** | Scorecards + Initiatives (operational excellence) | Medium (new Temporal workflow) | P1 |
| **P3** | Self-Service Actions + Action Runs | Medium (wraps existing workflows) | P1 |
| **P4** | Event automation + drift detection | Medium | P2, P3 |

Conventions every phase follows (from existing collections, verified against
`src/collections/Apps.ts` and `src/collections/PatternInstances.ts`):
- Payload collection: `slug`, `admin.group`, `admin.useAsTitle`, workspace-scoped
  `access` (copy the `workspace-members` lookup pattern verbatim), `fields`, `indexes`,
  `timestamps: true`.
- Register in `orbit-www/src/payload.config.ts` (import near line 11–72, add to the
  `collections: [` array at line 84). Run `bun run generate:types` + importmap after.
- Temporal status writeback from the worker goes through an
  `/api/internal/<thing>/[id]/status` route guarded by `X-API-Key` (bypasses Payload
  access), exactly like `pattern-instances`.
- New Temporal workflows register in `temporal-workflows/cmd/worker/main.go`
  (`w.RegisterWorkflow(...)` / `w.RegisterActivity(...)`, see lines 199–375).
- TDD per CLAUDE.md: write the failing test first. Go uses table-driven + `testify`;
  frontend uses Vitest. UI changes require agent-browser verification.

---

## P0 — Navigation / IA collapse

**Goal:** make Orbit *feel* like one focused IDP before any data work. Pure frontend.

### Target nav (replaces `navMainData` in `orbit-www/src/components/app-sidebar.tsx:43`)

```
Home          /dashboard        (personalized: my services, my action items, my scorecard gaps)
Catalog       /catalog          (unified; entity-type tabs: Services, APIs, Resources, Topics, Domains, Teams)
Scorecards    /scorecards       (P2 — placeholder page until then)
Self-Service  /self-service     (P3 — Templates + Patterns + Launches consolidate here)
Automations   /automations      (P4 — platform-admin only)
```

`Workspaces`, `Settings`, `Feedback`, platform-admin `Approvals`/`Workflows` stay where
they are. `Infra Agent` (`/agent`) moves under **Self-Service** as an execution surface,
not a top-level peer.

### Edits
- `orbit-www/src/components/app-sidebar.tsx`
  - Rewrite `navMainData` (lines 43–94) to the five items above.
  - `API Catalog` (`/catalog/apis`) becomes a tab under `/catalog`, not its own nav row.
  - `Knowledge` (`/knowledge`) leaves top-level nav; it becomes the **Docs tab on a
    catalog entity** in P1. Keep the route alive (no deletion) during transition.
  - `Templates` + `Launches` fold under `/self-service`.
- `orbit-www/src/app/(frontend)/catalog/page.tsx` — **new** catalog landing with entity-type
  tabs. For P0 it can render the existing `/catalog/apis` content under an "APIs" tab and
  stub the other tabs ("Coming in the unified catalog").
- `orbit-www/src/app/(frontend)/self-service/page.tsx` — **new** hub linking Templates,
  Patterns, Launches, Agent (cards). No backend change.
- `orbit-www/src/app/(frontend)/scorecards/page.tsx` + `automations/page.tsx` — **new**
  placeholder pages ("Operational excellence — shipping in P2").

### Verify
- `cd orbit-www && bun run lint && DOCKER_BUILD=1 bun run build` → exit 0.
- agent-browser: load each of the five surfaces, confirm no dead links; old deep links
  (`/catalog/apis`, `/templates`, `/launches`) still resolve.

**No collections, no Go, no migration.** This is the "looks focused tomorrow" win.

---

## P1 — Unified catalog graph

**Goal:** one entity model + typed relations, replacing the siloed `apps` / `api-schemas`
/ Kafka-topic views as the *primary* catalog. Existing collections remain as
sources/backing; the graph is the read model the catalog UI renders.

### New collections

**`orbit-www/src/collections/catalog/CatalogEntities.ts`** — `slug: 'catalog-entities'`,
`admin.group: 'Catalog'`. Fields:
- `name` (text, required, index), `slug` (text, index), `description` (textarea)
- `kind` (select, required, index): `service | api | resource | datastore | kafka-topic | domain | system | team | environment`
- `workspace` (relationship → workspaces, required, index) — copy Apps access pattern
- `owner` (relationship → catalog-entities, filtered to `kind: team`) — ownership keyed to a Team entity, not a user (survives personnel change, Cortex pattern)
- `lifecycle` (select): `experimental | production | deprecated`
- `tier` (select): `tier-1 | tier-2 | tier-3` (drives scorecard expectations in P2)
- `links` (array of `{ label, url, type }`) — docs, dashboards, runbooks
- `source` (group): `{ type: 'manual'|'apps'|'api-schemas'|'kafka'|'sync', sourceId: text }` — provenance back to the backing collection
- `metadata` (json) — freeform, queryable by scorecard rules
- `health` (select, readonly): folds the old health badge in (`healthy|degraded|down|unknown`)
- Indexes: `['workspace','kind']`, `['workspace','slug'] unique`, `['source.type','source.sourceId']`

**`orbit-www/src/collections/catalog/CatalogRelations.ts`** — `slug: 'catalog-relations'`.
Fields:
- `workspace` (relationship, required, index)
- `from` (relationship → catalog-entities, required, index)
- `to` (relationship → catalog-entities, required, index)
- `type` (select, required, index): `owns | depends-on | exposes-api | consumes-api | produces-topic | consumes-topic | runs-in | built-from | part-of`
- `metadata` (json)
- Index: `['workspace','from','type']`, `['workspace','to','type']`

Register both in `payload.config.ts` (+ a `collections/catalog/index.ts` barrel mirroring
`collections/api-catalog/index.ts`).

### Projection (keep silos as sources, graph as read model)
Add `afterChange`/`afterDelete` hooks that upsert a `catalog-entities` row from each
backing collection — same fire-and-forget style as the Apps manifest-sync hook
(`src/collections/Apps.ts:57`):
- `apps` → entity `kind: service` (also seeds `exposes-api` relations from app→API links)
- `api-schemas` → entity `kind: api`
- `kafka-topics` → entity `kind: kafka-topic`
- **Kafka lineage** (`kafka-lineage-edge`) → `produces-topic` / `consumes-topic`
  relations. **This is the differentiator** — a real dependency graph competitors can't
  easily harvest. Project `KafkaLineageEdge` rows into `catalog-relations` in the
  `lineage_aggregation_workflow.go` writeback path.

A one-time backfill script `orbit-www/src/scripts/backfill-catalog-graph.ts` projects
existing rows (mirror an existing `src/scripts/seed-*.ts`).

### Catalog UI (replaces P0 stubs)
- `src/app/(frontend)/catalog/page.tsx` — entity list with `kind` tabs + filters; reads
  `catalog-entities`.
- `src/app/(frontend)/catalog/[id]/page.tsx` — entity detail: metadata, owner, links,
  **Relations** (graph neighbors), **Docs** tab (renders linked `knowledge-pages` —
  this is where Knowledge folds in), **Scorecards** tab (P2).
- Reuse `src/components/features/api-catalog/*` for the APIs tab; new
  `src/components/features/catalog/EntityGraph.tsx` for the relation view.

### Verify
- Vitest: projection hooks produce correct entity/relation rows (mock payload).
- `go build ./...` in temporal-workflows (lineage projection edit).
- agent-browser: create an app → appears as a service entity; Kafka topic with lineage →
  shows producer/consumer relations on the detail page.

---

## P2 — Scorecards + Initiatives (operational excellence)

**Goal:** the gap from issue #45. Port's "scorecards-as-data" model + Cortex's Initiatives.

### New collections (`orbit-www/src/collections/scorecards/`)

**`Scorecards.ts`** (`slug: 'scorecards'`): `name`, `description`, `workspace`,
`appliesTo` (group: `{ kind, filter (json) }` — which entities are scored),
`levels` (array of `{ name, color, rank }` — Basic→Bronze→Silver→Gold),
`enabled` (checkbox). Index `['workspace']`.

**`ScorecardRules.ts`** (`slug: 'scorecard-rules'`): `scorecard` (rel, required, index),
`title`, `level` (text — which ladder rung this rule belongs to),
`type` (select): `field-presence | relation-check | threshold`,
`expression` (json — the rule definition; see below), `weight` (number, default 1).
Three v1 rule shapes (per #45):
- `field-presence`: `{ path: 'owner', op: 'exists' }`
- `relation-check`: `{ relationType: 'built-from', target: { kind:'pattern', approved:true } }`
- `threshold`: `{ path: 'health', op: 'eq', value: 'healthy' }` / `{ path:'metadata.costTags', op:'exists' }`

**`ScorecardRuleResults.ts`** (`slug: 'scorecard-rule-results'`) — auto-generated,
queryable (Port 2.0): `scorecard` (rel, index), `rule` (rel, index),
`entity` (rel → catalog-entities, index), `passed` (checkbox, index),
`evaluatedAt` (date), `detail` (textarea). Index `['workspace','entity','passed']`,
`['scorecard','rule']`. **This is the table automations (P4) watch.**

**`Initiatives.ts`** (`slug: 'initiatives'`) — Cortex's campaign loop:
`name`, `scorecard` (rel), `targetLevel` (text), `owner` (rel → users),
`deadline` (date), `status` (`active|completed|cancelled`).

**`InitiativeActionItems.ts`** (`slug: 'initiative-action-items'`):
`initiative` (rel, index), `entity` (rel, index), `rule` (rel),
`assignee` (rel → users), `status` (`open|in-progress|done|waived`), `notes`.

### Evaluation workflow (Go)
- `temporal-workflows/internal/workflows/scorecard_evaluation_workflow.go`
  - `ScorecardEvaluationWorkflow(ctx, ScorecardEvalInput{ ScorecardID, WorkspaceID })`
  - Activities (`internal/activities/scorecard/`):
    - `LoadScorecardAndEntities` — fetch scorecard + matching entities via Payload REST.
    - `EvaluateRule` — pure rule eval (unit-tested heavily; table-driven).
    - `WriteRuleResults` — POST to `/api/internal/scorecard-rule-results/upsert` (X-API-Key).
    - `ComputeEntityLevel` — derive ladder level (all rules at a rung pass → advance).
  - Triggers: **nightly** via a Temporal Schedule (mirror `health_check_workflow.go`
    scheduling) + **on-change** signal when a `catalog-entities` row changes (P1 hook
    fires a lightweight "evaluate this entity" signal).
- Register in `cmd/worker/main.go` (`RegisterWorkflow` + the four `RegisterActivity`s).

### API
- `src/app/api/internal/scorecard-rule-results/upsert/route.ts` — X-API-Key writeback.
- `src/app/(frontend)/scorecards/page.tsx` — scorecard list + **org rollup** (the
  exec-visibility deliverable; one page, per #45).
- `src/app/(frontend)/scorecards/[id]/page.tsx` — rule editor + per-entity results.
- Score chip component `src/components/features/scorecards/ScoreChip.tsx`, embedded on
  the catalog entity detail "Scorecards" tab (P1) and the entity list.

### AI-governance rules ride this engine (no new subsystem, per #45)
"Uses an approved AI framework" = relation-check against approved patterns; "agent
actions have approval records" = field-presence/threshold over existing
`agent-runs` / `pending-approvals` data projected as entity metadata.

### Verify
- Go: table-driven `EvaluateRule` tests (every rule type, pass/fail/edge); workflow test
  with Temporal test env (mirror `health_check_workflow_test.go`).
- Vitest: rollup aggregation, ScoreChip rendering.
- agent-browser: define a scorecard with one rule of each type → run eval → chips appear
  on entities, rollup shows distribution; create an Initiative → action items generated
  for failing entities.

---

## P3 — Self-Service Actions + Action Runs

**Goal:** one model unifying Templates, Patterns, Launches, Bifrost Kafka provisioning,
and the agent — executed durably on Temporal (Port's Action + Action Run, mapped onto
infra Orbit already has).

### New collections (`orbit-www/src/collections/actions/`)

**`Actions.ts`** (`slug: 'actions'`): `name`, `description`, `workspace`,
`inputSchema` (json — JSON Schema for the form, reuse the Patterns `inputSchemaJson`
convention), `approvalPolicy` (select: `none|workspace-admin|platform-admin`),
`backend` (group): `{ type: 'temporal-template'|'temporal-pattern'|'temporal-launch'|'kafka-provision'|'agent'|'webhook', ref: text }`,
`enabled` (checkbox). The `backend.type` discriminates which existing workflow to invoke
— **no existing workflow is rewritten**, they're wrapped.

**`ActionRuns.ts`** (`slug: 'action-runs'`) — the durable execution record:
`action` (rel, index), `workspace` (rel, index), `entity` (rel → catalog-entities — what
it produced/targeted), `inputs` (json), `status` (`pending|awaiting-approval|running|succeeded|failed`),
`workflowId` (text, readonly — the Temporal id, same convention as PatternInstances),
`logs` (json/array), `outputs` (json), `error` (textarea), `triggeredBy` (rel → users),
`trigger` (select: `manual|automation` — P4 reuses this). Indexes `['workspace','status']`,
`['action','status']`.

### Dispatcher workflow
- `temporal-workflows/internal/workflows/action_dispatch_workflow.go`
  - `ActionDispatchWorkflow(ctx, ActionDispatchInput{ ActionRunID, BackendType, Ref, Inputs })`
  - Handles approval gate (reuse `pending-approvals` + the existing agent approval
    signal pattern), then **child-workflows** the appropriate existing workflow by
    `BackendType` (`TemplateInstantiationWorkflow`, pattern instantiate, `LaunchWorkflow`,
    `TopicProvisioningWorkflow`, agent run). Streams status to
    `/api/internal/action-runs/[id]/status` (X-API-Key).
- Register in `cmd/worker/main.go`.

### Reframing (UI only — backends untouched)
- `/self-service` (from P0) becomes the **Actions catalog**; Templates/Patterns/Launches
  render as Actions. `/self-service/runs` lists Action Runs.
- Infra agent (`/agent`) presented as the `agent` backend type — the AI execution path
  with HITL, satisfying the 2026-06-09 "AI governance" framing.

### Verify
- Go: dispatcher test per backend type (child-workflow mocked); approval-gate path.
- agent-browser: run a template Action end-to-end → Action Run shows
  pending→running→succeeded with logs; produced repo appears as a catalog service entity.

---

## P4 — Event automation + drift detection

**Goal:** "when X changes, do Y" — close the loop between scorecards (P2) and actions (P3).

### New collection
**`orbit-www/src/collections/automations/Automations.ts`** (`slug: 'automations'`):
`name`, `workspace`, `trigger` (group): `{ event: 'rule-result-changed'|'entity-changed'|'schedule', filter (json) }`,
`action` (rel → actions), `inputMapping` (json), `enabled` (checkbox).

### Engine
- `catalog-entities` and `scorecard-rule-results` `afterChange` hooks emit a normalized
  event (fire-and-forget) to `src/app/api/internal/automations/dispatch/route.ts`, which
  matches enabled automations and creates an `action-runs` row with `trigger: 'automation'`
  → reuses the P3 dispatcher. **Drift detection** = an automation on
  `rule-result-changed` where `passed: false` (notify owner / open remediation action).
- Schedule-type automations run via a Temporal Schedule sweeping matches.

### Verify
- Vitest: event matcher (filters, input mapping).
- agent-browser: flip a rule to failing → automation fires → remediation Action Run
  created and visible; owner notified.

---

## Cross-cutting

- **Security:** every new collection copies the `workspace-members` access pattern
  (`Apps.ts:167`); every `/api/internal/*` writeback requires `X-API-Key`. Land *after*
  the 2026-06-09 strip + shared gRPC auth interceptor.
- **Frozen capability cleanup:** P1 folds the health badge into `catalog-entities.health`
  and a P2 threshold rule → the standalone `health-checks` concept can then be retired
  (separate follow-up).
- **No deletions of backing collections** in this plan — `apps`, `api-schemas`, Kafka
  collections, `knowledge-pages`, `patterns`, `launches` all remain as sources/backends.
  The refocus is structural (graph + actions + scorecards on top), not destructive.
- **Migrations:** MongoDB/Payload — new collections need no migration; the one-time
  backfill script handles projection of existing rows.

## Suggested issue/PR breakdown
1. P0 nav collapse (1 PR, frontend).
2. P1a catalog collections + projection hooks + backfill (1 PR).
3. P1b catalog UI + lineage→relations + Knowledge fold (1 PR).
4. P2a scorecard collections + eval workflow (1 PR).
5. P2b scorecard UI + Initiatives (1 PR).
6. P3 actions + dispatcher + self-service reframe (1–2 PRs).
7. P4 automations + drift (1 PR).

## Open questions before P1
1. Graph as **projection** (hooks keep `catalog-entities` in sync from silos — this plan's
   default) vs **migration** (silos become entity subtypes outright)? Projection is lower
   risk and reversible; migration is cleaner long-term. Recommend projection now,
   revisit after P2.
2. Confirm the Knowledge fold (recommendations §4 Q2): entity-linked docs tab (assumed
   here) vs keep standalone.
3. Scorecard eval cadence: nightly + on-change (assumed) — acceptable load, or on-change
   only?
