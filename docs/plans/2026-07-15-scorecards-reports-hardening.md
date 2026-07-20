# Scorecards & Reports Production Hardening

**Date:** 2026-07-15
**Status:** Implementation and pre-PR remediation complete; production rollout gate documented
**Scope:** Security, tenant integrity, projection correctness, scheduled evaluation,
report semantics/scaling, initiatives UX, and accessibility follow-through from the
2026-07-15 implementation review.

## Goal

Make scorecards, reports, and initiatives safe and trustworthy under direct Payload
API access, concurrent/manual evaluation, multiple workspaces, and production-sized
catalogs. Preserve the existing scoring semantics unless this plan explicitly changes
them.

## Design decisions

1. Exported server actions never accept or fall back to a caller-supplied identity.
   Better Auth IDs are used only for membership checks; Payload `users` IDs are used
   for Payload relationships.
2. Tenant identity is immutable after creation. Parent-derived collections validate
   that their workspace, parent, and related records all belong to the same workspace.
3. Evaluation is a reconciliation, not an append-only upsert loop: rows absent from
   the current `(scorecard, rule, entity)` key set are removed before scores are
   recomputed.
4. The scheduled consistency boundary is one workspace. A workspace is recomputed and
   snapshotted once after all of its enabled scorecards finish, never once per
   scorecard midway through a sweep.
5. Reports are workspace-explicit. Cross-workspace views, if retained, aggregate
   snapshots into weighted time buckets instead of plotting raw workspace rows as one
   series.
6. Large result/action-item sets are paginated or aggregated in the database; fixed
   silent ceilings are not treated as complete reads.

## Work packages

### WP1 — Server-action identity and user relationships

Files:

- `orbit-www/src/app/(frontend)/scorecards/actions.ts`
- `orbit-www/src/app/(frontend)/scorecards/page.tsx`
- `orbit-www/src/app/(frontend)/scorecards/[id]/page.tsx`
- `orbit-www/src/components/features/catalog/EntityScorecardsTab.tsx`
- `orbit-www/src/components/features/scorecards/EntityScoreInlineChip.tsx`
- `orbit-www/src/app/(frontend)/scorecards/initiatives/actions.ts`
- `orbit-www/src/app/(frontend)/scorecards/actions.test.ts` (new)
- `orbit-www/src/app/(frontend)/scorecards/initiatives/actions.test.ts` (new)

Tasks:

1. Write adversarial tests proving supplied user IDs cannot select another user's
   workspaces and unauthenticated calls return no data.
2. Remove identity parameters from exported actions and resolve the session internally.
3. Resolve the Payload user bridge before writing `owner`/`assignee` relationships.
4. Test that initiative creation writes the Payload user document ID while membership
   checks continue to use the Better Auth ID.

### WP2 — Collection-level tenant integrity and RBAC

Files:

- `orbit-www/src/lib/access/collection-access.ts`
- `orbit-www/src/lib/access/__tests__/collection-access.test.ts`
- `orbit-www/src/collections/scorecards/access.ts`
- `orbit-www/src/collections/scorecards/Scorecards.ts`
- `orbit-www/src/collections/scorecards/ScorecardRules.ts`
- `orbit-www/src/collections/scorecards/Initiatives.ts`
- `orbit-www/src/collections/scorecards/InitiativeActionItems.ts`
- `orbit-www/src/collections/scorecards/access.test.ts` (new if collection-config
  tests do not fit the shared access suite)

Tasks:

1. Add a mutation guard that validates both the original and requested workspace.
2. Make tenant and parent identity fields immutable for non-platform-admin callers.
3. Gate initiative creation/lifecycle changes on owner/admin while permitting members
   to edit only the action-item fields intended by the product policy.
4. Validate parent and related records are in the denormalized workspace.
5. Validate rule weight, ladder names/ranks, rule level membership, and relationship
   consistency at the collection boundary.

### WP3 — Evaluation reconciliation and uniqueness

Files:

- `orbit-www/src/lib/scorecards/evaluate.ts`
- `orbit-www/src/lib/scorecards/evaluate.test.ts`
- `orbit-www/src/lib/scorecards/initiatives.ts`
- `orbit-www/src/lib/scorecards/initiatives.test.ts`
- `orbit-www/src/collections/scorecards/ScorecardRuleResults.ts`
- `orbit-www/src/collections/scorecards/EntityScores.ts`
- `orbit-www/src/collections/scorecards/InitiativeActionItems.ts`
- `orbit-www/src/app/(frontend)/scorecards/actions.ts`

Tasks:

1. Add failing tests for entities leaving `appliesTo`, disabled scorecards, removed
   rules, and scorecard deletion.
2. Reconcile stale results before recomputation and exclude disabled/deleted
   scorecards from overall scoring.
3. Remove stale per-scorecard entity-score rows and complete deletion cleanup.
4. Add unique compound indexes for result, entity-score, and generated action-item
   identities, with deterministic duplicate handling for existing data.
5. Ensure manual and scheduled runs cannot race into duplicate rows.

### WP4 — Workspace-consistent scheduled evaluation and snapshots

Files:

- `orbit-www/services/automation-worker/src/shared.ts`
- `orbit-www/services/automation-worker/src/activities/scorecard-sweep.ts`
- `orbit-www/services/automation-worker/src/activities/scorecard-sweep.test.ts`
- `orbit-www/services/automation-worker/src/workflows/scorecard-sweep.ts`
- `orbit-www/services/automation-worker/src/workflows/scorecard-sweep.test.ts` (new)
- `orbit-www/src/app/api/internal/scorecards/evaluate-workspace/route.ts` (new)
- `orbit-www/src/app/api/internal/scorecards/evaluate-workspace/route.test.ts` (new)
- `orbit-www/src/lib/scorecards/evaluate.ts`
- `orbit-www/src/lib/scorecards/snapshots.ts`
- `orbit-www/src/lib/scorecards/snapshots.test.ts`
- `orbit-www/src/collections/scorecards/ScoreSnapshots.ts`

Tasks:

1. Group due scorecards by workspace in the workflow contract.
2. Evaluate a workspace's enabled scorecards, recompute once, sync initiatives, and
   capture one final snapshot set.
3. Remove fire-and-forget snapshot writes from request-bound evaluation paths.
4. Add a capture ID/bucket and make snapshot sets recoverable/idempotent if a partial
   write fails.
5. Keep Temporal overlap/retry behavior explicit and observable.

### WP5 — Reports correctness and scale

Files:

- `orbit-www/src/app/(frontend)/scorecards/reports/actions.ts`
- `orbit-www/src/app/(frontend)/scorecards/reports/actions.test.ts` (new)
- `orbit-www/src/lib/scorecards/reporting.ts`
- `orbit-www/src/lib/scorecards/reporting.test.ts`
- `orbit-www/src/components/features/scorecards/reports/ReportView.tsx`
- `orbit-www/src/components/features/scorecards/reports/TrendChart.tsx`
- `orbit-www/src/components/features/scorecards/reports/BreakdownTabs.tsx`
- `orbit-www/src/components/features/scorecards/reports/ScorecardSection.tsx`
- `orbit-www/src/app/(frontend)/scorecards/reports/page.tsx`

Tasks:

1. Add an explicit workspace selector/query parameter and validate membership.
2. Replace raw multi-workspace snapshot plotting with workspace-specific or weighted,
   time-bucketed trends.
3. Report data freshness (`lastEvaluatedAt`, stale counts) separately from fetch time.
4. Define failing entities from failed current results/target attainment, not merely
   lowest score.
5. Separate baseline coverage from evaluated coverage.
6. Replace fixed-limit full reads with pagination or database aggregation.
7. Add refresh error handling and stale-response protection.

### WP6 — Initiatives UX and accessibility

Files:

- `orbit-www/src/app/(frontend)/scorecards/initiatives/actions.ts`
- `orbit-www/src/components/features/scorecards/initiatives/ActionItemsTable.tsx`
- `orbit-www/src/components/features/scorecards/initiatives/InitiativeCard.tsx`
- `orbit-www/src/components/features/scorecards/LevelEditor.tsx`
- `orbit-www/src/components/features/scorecards/ScorecardCard.tsx`
- report components listed in WP5

Tasks:

1. Restrict initiative scorecard options to manageable workspaces and display the
   workspace name.
2. Add assignee editing and workspace-member options.
3. Add action-item pagination/filtering and governed waiver metadata.
4. Restore visible focus styles, label repeated controls, expose chart values in an
   accessible summary/table, and use URL-backed report tabs/window state.
5. Honor reduced motion for new or touched animations.

## Verification

Automated:

```bash
cd orbit-www
bunx vitest run src/app/\(frontend\)/scorecards src/lib/scorecards \
  src/lib/access/__tests__/collection-access.test.ts \
  src/components/features/scorecards src/app/api/internal/scorecards \
  services/automation-worker/src
bunx tsc --noEmit
```

Run the smallest relevant suite after each red/green step. For each production bug,
record that its new regression test failed before implementing the fix.

Manual/browser verification after UI changes:

1. Run the mandatory agent-browser pre-flight orphan check.
2. Sign in with the seeded local account.
3. Verify workspace selection cannot expose or mix another workspace's scorecards.
4. Create an initiative and confirm owner/assignee relationships render correctly.
5. Change `appliesTo`, disable/delete a scorecard, evaluate, and confirm stale rows
   disappear from detail, catalog, and reports.
6. Run a workspace sweep and verify one complete snapshot/trend point is produced.
7. Exercise report refresh failures, window deep links, keyboard focus, chart summary,
   and paginated action-item flows.
8. Close agent-browser and perform the mandatory post-flight orphan check.

## Review checklist

- No exported server action accepts identity from its arguments.
- Every direct Payload mutation preserves tenant and parent consistency.
- Evaluation/recompute/snapshot writes are idempotent under concurrency.
- Disabled or no-longer-applicable standards never contribute current scores.
- Reports disclose their workspace, evaluation freshness, coverage semantics, and
  truncation/pagination state.
- All new security/correctness behavior has a regression test.
- UI changes pass real browser verification before completion.

## 2026-07-15 implementation record

Completed in this tranche:

- Removed caller-controlled identity from scorecard reads and corrected Better Auth
  versus Payload user relationship IDs.
- Hardened direct collection policies, immutable tenant/parent fields, relationship
  tenant validation, level validation, rule weight validation, and assignee
  membership validation.
- Reconciled stale rule results and per-scorecard scores, cleared disabled scorecard
  projections, cascaded scorecard deletion, and re-evaluated after rule changes.
- Added unique logical-key indexes plus race recovery for evaluator and initiative
  upserts.
- Made Temporal sweeps sequential within a workspace, suppressed intermediate
  snapshots, and forced one final workspace snapshot.
- Corrected evaluated-entity and failing-entity report semantics, separated data
  freshness from fetch time, and protected refresh from errors/stale responses.
- Restored keyboard focus visibility, labeled repeated controls, described trend
  charts for assistive technology, and verified desktop/mobile behavior with
  `agent-browser` (including zero mobile horizontal overflow).

The initial verification covered 246 focused tests and browser interaction. The
2026-07-16 pre-PR review below superseded that result and required additional blocker
remediation before publication.

The remaining non-blocking product follow-ups are editable assignee selection,
governed waiver metadata, and action-item filtering/pagination UX.

## 2026-07-16 pre-PR remediation

A fresh pre-commit review reclassified the deferred data-model and scaling items above
as merge blockers because the tranche claims production-safe direct API access,
retry-idempotent snapshots, workspace-correct reports, and production-sized datasets.
The PR must complete these work packages before publication:

### R1 — Close direct mutation bypasses

Files:

- `orbit-www/src/collections/scorecards/Scorecards.ts`
- `orbit-www/src/collections/scorecards/ScorecardRules.ts`
- `orbit-www/src/app/(frontend)/scorecards/actions.test.ts`
- `orbit-www/src/app/(frontend)/scorecards/initiatives/actions.test.ts`

Tasks:

1. Add failing collection-policy tests proving REST/admin-style direct scorecard and
   rule mutations cannot bypass action-owned cleanup, validation, and reevaluation.
2. Make scorecard/rule authoring service-owned; authenticated server actions remain the
   supported mutation boundary and write with `overrideAccess: true`.
3. Keep collection invariant hooks as defense in depth.

### R2 — Make unique indexes deployable

Files:

- `orbit-www/src/scripts/dedupe-scorecard-projections.ts` (new)
- `orbit-www/src/scripts/dedupe-scorecard-projections.test.ts` (new)
- `orbit-www/package.json`
- `orbit-www/src/collections/scorecards/ScorecardRuleResults.ts`
- `orbit-www/src/collections/scorecards/EntityScores.ts`
- `orbit-www/src/collections/scorecards/InitiativeActionItems.ts`

Tasks:

1. Write failing tests for deterministic survivor selection, dry-run reporting, and
   idempotent duplicate cleanup for all three logical keys.
2. Add an explicit operator-run pre-deploy cleanup command; never mutate production
   data from application startup.
3. Require a write-quiescence window spanning cleanup, verification, and confirmed
   unique-index creation so an old writer cannot recreate duplicates mid-rollout.

### R3 — Make final snapshot capture retry-idempotent

Files:

- `orbit-www/src/collections/scorecards/ScoreSnapshots.ts`
- `orbit-www/src/lib/scorecards/snapshots.ts`
- `orbit-www/src/lib/scorecards/snapshots.test.ts`
- `orbit-www/src/app/api/internal/scorecards/capture-snapshots/route.ts`
- `orbit-www/services/automation-worker/src/activities/scorecard-sweep.ts`
- `orbit-www/services/automation-worker/src/activities/scorecard-sweep.test.ts`
- `orbit-www/services/automation-worker/src/workflows/scorecard-sweep.ts`

Tasks:

1. Add a stable capture key and per-row snapshot key to the internal API/activity
   contract.
2. Upsert every keyed workspace/scorecard/team snapshot row so a retry resumes a
   partially written set without appending duplicates.
3. Add failing repeat/recovery/activity contract tests.

### R4 — Make reports workspace-explicit and complete

Files:

- `orbit-www/src/app/(frontend)/scorecards/reports/actions.ts`
- `orbit-www/src/app/(frontend)/scorecards/reports/actions.test.ts` (new)
- `orbit-www/src/app/(frontend)/scorecards/reports/page.tsx`
- `orbit-www/src/components/features/scorecards/reports/ReportView.tsx`
- `orbit-www/src/lib/scorecards/snapshots.ts`
- `orbit-www/src/lib/scorecards/snapshots.test.ts`

Tasks:

1. Add failing tests proving a report request validates active membership in one
   explicit workspace and never joins another workspace's rows.
2. Thread the selected workspace through initial load and refresh calls.
3. Replace aggregation-critical fixed limits with `page`/`hasNextPage` traversal and
   test multi-page inputs.
4. Preserve an intentional bounded trend window only when the query is explicitly
   time-bounded and disclose any remaining cap.

### R5 — Final verification and publication

1. Run targeted scorecard, worker, route, report, and cleanup-script tests.
2. Run `bun run typecheck` and the broader integration suite; distinguish baseline
   environment/auth failures from regressions.
3. Repeat mandatory `agent-browser` desktop/mobile verification and cleanup.
4. Run a fresh read-only code review with no unresolved blocker/high findings.
5. Commit only the scorecard hardening plan, verification report, code, and tests;
   exclude unrelated README, strategy, agent configuration, and subagent artifacts.
6. Push `fix/scorecards-reports-hardening` and open a PR against `main` with commands,
   browser evidence, rollout steps, and residual risks.

## 2026-07-16 remediation completion record

- Locked scorecard and rule mutations behind authenticated service actions so direct
  Payload writes cannot bypass validation, reevaluation, cleanup, or cascades.
- Added a dry-run/apply duplicate-cleanup command for the three new logical-key indexes
  and documented a write-quiesced cleanup/index-creation rollout.
- Added workspace-bound snapshot/capture keys and resumable per-row upserts for Temporal
  activity retries and partial writes.
- Added workflow-function coverage for sequential workspace evaluation, stable capture
  identity, final-capture ordering, and failed-workspace behavior.
- Made reports explicitly workspace-selected and membership-validated, paginated all
  aggregation-critical reads, bounded trend queries in Mongo, and isolated in-flight
  refreshes across workspace changes.
- Added report action, report component, snapshot recovery, route contract, workflow,
  collection-boundary, and cleanup-script regression tests.
- Final focused verification: 403 tests across 23 files passed; `bun run typecheck`,
  `bun run lint`, and `git diff --check` exited 0. The local cleanup dry run found zero
  duplicate groups.
- Desktop/mobile `agent-browser` verification covered workspace selection, URL state,
  refresh, report data, labels, and zero document-level mobile overflow; post-flight
  cleanup left no browser process.
- Final independent review reported no remaining blocker/high finding. The broader
  repository suite retains unrelated authentication/environment baseline failures,
  recorded in `docs/2026-07-16-scorecards-reports-hardening-verification.md`.
