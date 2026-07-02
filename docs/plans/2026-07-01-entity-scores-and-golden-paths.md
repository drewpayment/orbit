# Entity Scores & Golden Paths (Scorecards v2)

**Status:** In progress
**Depends on:** IDP refocus P1 (catalog graph) + P2 (scorecards) — see
`docs/plans/2026-06-27-idp-refocus-implementation.md`.

## Product goal

Give an enterprise architect the tools to align leaders on golden paths and drive
architecture adoption through measurement:

1. **Resource types get a definition and a home.** Each catalog `kind` (service, api,
   datastore, …) gets a workspace-scoped *Entity Type Definition* describing what the
   type is, what its golden path looks like, an **inherited base value** every entity
   of that kind starts from, and a scoring weight.
2. **Every entity in the catalog has a score.** A persisted 0–100 score per
   (entity × scorecard) and a single **overall** score per entity. Entities no
   scorecard touches inherit their type's base value — nothing is unscored.
3. **Scorecards compose three ways.** A scorecard's rules may be
   (a) custom rules independent of entity scores (existing field-presence /
   relation-check / threshold), (b) rules that **compile entity scores** (new
   `entity-score` type referencing the entity's own or related entities' scores),
   or (c) any mix of both.
4. **The catalog shows alignment.** Catalog list + entity detail surface the overall
   score, the per-scorecard breakdown, and a **golden-path alignment %** computed
   against the entity's type definition — so you can see how well a deployed catalog
   item aligns with the scoring assignment.

## Design

### New collection: `entity-types` (`orbit-www/src/collections/catalog/EntityTypes.ts`)

One row per (workspace, kind). The definition & home for a resource type.

| field | type | notes |
|---|---|---|
| `workspace` | rel → workspaces, required, index | tenant boundary |
| `kind` | select from `ENTITY_KINDS`, required, index | one definition per kind per workspace (uniqueness enforced in app layer, mirroring catalog projection idempotency) |
| `displayName` | text, required | e.g. "Backend Service" |
| `description` | textarea | what this type means here |
| `baseValue` | number 0–100, default 50 | the **inherited value**: the score an entity of this kind carries when no scorecard applies to it, and the baseline term in the overall score |
| `scoringWeight` | number, default 1 | how much this kind counts in cross-entity aggregation (`entity-score` rules with `aggregate`) |
| `goldenPath` | group | the golden-path definition |
| `goldenPath.summary` | textarea | narrative for leaders |
| `goldenPath.docsUrl` | text | link to the paved-road docs/template |
| `goldenPath.requiredRelations` | array of `{ relationType (select RELATION_TYPES), direction (from/to/either), targetKind (select ENTITY_KINDS, optional), min (number, default 1) }` | structural expectations |
| `goldenPath.requiredMetadata` | array of `{ path (text), label (text) }` | expected `metadata.*`/field paths |

Access mirrors scorecards: workspace members read, owner/admin author (reuse
`collections/scorecards/access.ts` helpers).

Lazy defaults: a resolver (`lib/catalog/entity-types.ts → resolveEntityType`) returns a
built-in default (`baseValue: 50`, `scoringWeight: 1`, empty golden path) when no row
exists, so scoring never blocks on setup.

### New collection: `entity-scores` (`orbit-www/src/collections/scorecards/EntityScores.ts`)

Machine-written (like `scorecard-rule-results`: no direct user writes), one row per
(entity, scorecard) **plus one `overall` row per entity**.

| field | type | notes |
|---|---|---|
| `workspace` | rel, required, index | |
| `entity` | rel → catalog-entities, required, index | |
| `scope` | select `scorecard` \| `overall`, required, index | |
| `scorecard` | rel → scorecards, index | required when scope=scorecard, absent for overall |
| `score` | number 0–100, required, index | |
| `levelName` / `levelRank` | text / number | achieved ladder rung (scorecard scope) |
| `passedRules` / `totalRules` | number | |
| `weightedPoints` / `maxPoints` | number | weighted sum backing `score` |
| `baseValue` | number | the inherited value that seeded this score (overall scope) |
| `goldenPathAlignment` | number 0–100 | overall scope: % of golden-path expectations met |
| `evaluatedAt` | date | |

Indexes: `[workspace, entity, scope]`, `[workspace, scope, score]`, `[scorecard, score]`.

### Scoring semantics (`orbit-www/src/lib/scorecards/scoring.ts` — pure, unit-tested)

- **Per-scorecard score** = `round(100 × Σ(weight of passed rules) / Σ(weight of all rules))`.
  Empty rule set ⇒ no row (a scorecard with no rules doesn't score).
- **Golden-path alignment** = `round(100 × met / expected)` over the type definition's
  `requiredRelations` + `requiredMetadata` checks (reuses the relation/field evaluators).
  No expectations defined ⇒ 100.
- **Overall score**: let `S` = per-scorecard scores applying to the entity, `B` = type
  `baseValue`.
  - No applicable scorecards: `overall = B` (pure inherited value).
  - Otherwise: `overall = round(mean(S))` — scorecards *replace* the baseline once
    standards exist; `baseValue` is still stored on the row for transparency.
- **Coverage invariant:** `recomputeWorkspaceScores(payload, workspaceId)` upserts an
  `overall` row for **every** catalog entity in the workspace (base-value fallback),
  then per-scorecard rows for evaluated entities. Called from `runScorecardEvaluation`
  and from a backfill entry point (`/api/internal/scorecards/recompute-scores`).

### New rule type: `entity-score` (extends `ScorecardRules.type`)

Expression (interpreted in `lib/scorecards/evaluate.ts`):

```jsonc
{
  "target": "self" | "related",         // whose score to read
  "scoreScope": "overall" | "scorecard", // which score; default "overall"
  "scorecardId": "…",                   // when scoreScope=scorecard
  // when target=related — selects the related entities whose scores compile:
  "relationType": "depends-on", "direction": "from" | "to" | "either", "targetKind": "service",
  "aggregate": "min" | "avg" | "max",   // default "min" (weakest-link)
  "op": "gte" | "gt" | "lte" | "lt" | "eq", "value": 70
}
```

Evaluation order inside `runScorecardEvaluation`: non-score rules evaluate first and
scores are recomputed; `entity-score` rules then read the **latest stored**
`entity-scores` rows (single pass, no fixpoint — documented so cross-scorecard chains
converge on the next evaluation run, matching the existing eventual-consistency model).
Weighted aggregation over related entities uses each related entity's type
`scoringWeight`.

### UI

- `components/features/scorecards/ScoreChip.tsx` (extend) + catalog list
  (`EntityListItem`) show the overall numeric score for every entity.
- Entity detail (`app/(frontend)/catalog/[id]`, `EntityScorecardsTab`): overall score,
  per-scorecard score rows, golden-path alignment meter with per-expectation pass/fail.
- **Types home:** `app/(frontend)/catalog/types/page.tsx` (+ `[kind]/page.tsx` editor)
  — list all kinds with their definitions, base values, weights, golden paths;
  owner/admin can edit. Linked from the catalog page header.
- Rule builder (`components/features/scorecards/rule-builder.ts` + `RuleBuilder.tsx`):
  add the `entity-score` type with its fields; validation in `validateExpression`.
- Scorecard detail: score column alongside level chips.

### Registration & plumbing

- `payload.config.ts`: register `EntityTypes`, `EntityScores`.
- `pnpm generate:types` to refresh `payload-types.ts`.
- Internal API: `app/api/internal/scorecards/recompute-scores/route.ts` (X-API-Key),
  mirroring `evaluate/route.ts`.
- `EntityScores` gets the same read access as rule results; create/update/delete `false`.

## Work packages

| WP | Scope | Owner files |
|---|---|---|
| WP1 | `EntityTypes` collection + constants + resolver lib + registration | `collections/catalog/EntityTypes.ts`, `lib/catalog/entity-types.ts`, `payload.config.ts` |
| WP2 | `EntityScores` collection + pure scoring lib + tests | `collections/scorecards/EntityScores.ts`, `lib/scorecards/scoring.ts`, `scoring.test.ts` |
| WP3 | Evaluator integration: recompute pipeline, `entity-score` rule type, internal API | `lib/scorecards/evaluate.ts`, `evaluate.test.ts`, `api/internal/scorecards/recompute-scores/route.ts` |
| WP4 | Rule-builder + validation for `entity-score` | `components/features/scorecards/rule-builder.ts`, `RuleBuilder.tsx`, `rule-builder.test.ts` |
| WP5 | Catalog UI: score chips everywhere, entity detail breakdown + alignment, types home | `app/(frontend)/catalog/**`, `components/features/catalog/**`, `components/features/scorecards/ScoreChip.tsx` |

## Verification

- `cd orbit-www && pnpm exec vitest run src/lib/scorecards src/components/features/scorecards src/lib/catalog`
- `cd orbit-www && pnpm exec tsc --noEmit` (via `pnpm build` typecheck path)
- Acceptance criteria (loop until all hold):
  1. Every catalog entity gets an `overall` entity-scores row after
     `recomputeWorkspaceScores` (base-value fallback proves out in a unit test).
  2. A scorecard can be built from only non-score rules (existing types untouched).
  3. A scorecard can include `entity-score` rules that compile self/related scores.
  4. Mixed scorecards evaluate deterministically in one pass.
  5. Catalog list + entity detail render the overall score; types home renders and
     gates editing on owner/admin.
- agent-browser UI verification of the catalog + types pages after implementation.
