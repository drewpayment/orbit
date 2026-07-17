# Scorecards & Reports Hardening — Verification Report

**Date:** 2026-07-16

**Related plan:** [`docs/plans/2026-07-15-scorecards-reports-hardening.md`](plans/2026-07-15-scorecards-reports-hardening.md)
**Status:** Code verified; production rollout requires the documented pre-index cleanup

## Executive summary

The scorecards and reports hardening tranche now has focused regression coverage for
the security, tenant-integrity, projection-reconciliation, retry-idempotency,
workspace-scoping, pagination, report-semantics, and accessibility changes in this PR.

The final focused suite passes **403 tests across 23 files**. TypeScript passes, lint
exits successfully with existing repository warnings, the local duplicate-cleanup
dry run reports no duplicate logical keys, and the changed UI passed desktop/mobile
browser verification.

The release still has one operational prerequisite: run the idempotent scorecard
projection cleanup command against each target database **before** starting the new
application version that creates the compound unique indexes.

## Verified behavior

| Area | Evidence |
| --- | --- |
| Identity and session security | `src/app/(frontend)/scorecards/actions.test.ts` verifies read actions expose no caller identity parameter and ignore an injected identity in favor of the authenticated session. `initiatives/actions.test.ts` verifies Better Auth IDs are used for authorization while Payload user IDs are stored in relationships. |
| Direct mutation boundary | `scorecards/actions.test.ts` verifies direct scorecard and rule create/update/delete access is denied even to a platform admin. Authenticated server actions remain the service-owned mutation boundary and perform cleanup, validation, reevaluation, and cascades with `overrideAccess`. |
| Tenant integrity and RBAC | `src/lib/access/__tests__/collection-access.test.ts` and `src/collections/scorecards/invariants.test.ts` cover workspace movement, manager-only authoring, selected cross-workspace relationships, target levels, assignees, and logical-key index configuration. |
| Stale projection reconciliation | `src/lib/scorecards/evaluate.test.ts` covers deleted rules, disabled scorecards, changed `appliesTo`, stale per-scorecard rows, baseline restoration, and idempotent recomputation. |
| Unique-index rollout | `src/scripts/dedupe-scorecard-projections.test.ts` verifies deterministic survivor selection, dry-run behavior, deletion, and rerun idempotency. The operator command covers rule results, entity scores, and generated initiative items. |
| Workspace sweep consistency | `services/automation-worker/src/workflows/scorecard-sweep.test.ts` executes the workflow function with mocked Temporal activities and proves sequential scorecard evaluation within a workspace, stable capture keys, final capture ordering, and no capture after a failed evaluation. Activity tests verify the HTTP contract. |
| Snapshot retry recovery | `src/lib/scorecards/snapshots.test.ts` verifies keyed retries reuse completed rows and resume partially written workspace/scorecard snapshot sets without duplicates. The internal route test validates and forwards the capture key. |
| Complete aggregation inputs | Snapshot and report actions use `page`/`hasNextPage` traversal instead of treating fixed ceilings as complete datasets. Tests force multiple pages and verify later rows contribute to results. |
| Workspace-correct reports | `reports/actions.test.ts` verifies active membership before data access, one explicit workspace on every report query, rejection of non-member workspaces, and multi-page report aggregation. |
| Report semantics | `src/lib/scorecards/reporting.test.ts` separates baseline coverage from evaluated coverage and ranks entities with actual failed rules rather than merely low baseline scores. |
| UI/accessibility | `ReportView.test.tsx` proves an old-workspace refresh cannot overwrite newly selected workspace data. Browser snapshots expose labeled ladder controls, a labeled workspace selector, report refresh behavior, chart descriptions, and action-item controls. Desktop and 390×844 mobile checks completed with zero document-level horizontal overflow. |

## Automated verification

Run from `orbit-www`:

```bash
bun run test:int -- \
  'src/app/(frontend)/scorecards' \
  src/lib/scorecards \
  src/lib/access/__tests__/collection-access.test.ts \
  src/collections/scorecards \
  services/automation-worker/src \
  src/app/api/internal/scorecards \
  src/scripts/dedupe-scorecard-projections.test.ts
```

Result:

```text
Test Files  23 passed (23)
Tests       403 passed (403)
```

Additional checks:

```bash
bun run typecheck
bun run lint
bun run scorecards:dedupe
```

Results:

- `bun run typecheck`: exit 0.
- `bun run lint`: exit 0; existing repository warnings remain.
- `bun run scorecards:dedupe`: exit 0 in dry-run mode; zero duplicate groups in
  `scorecard-rule-results`, `entity-scores`, and `initiative-action-items` locally.
- `git diff --check`: exit 0.

## Broader-suite status

A full `bun run test:int` was also attempted. It reported 123 passing files and 25
failing files (1,591 passing tests and 98 failures). The failures are outside the
scorecard tranche and are dominated by existing authentication mocks returning
`Not authenticated` plus knowledge-page imports attempting to construct Mongo with an
empty `DATABASE_URI`.

This report does not represent the repository-wide integration suite as green. The
focused scorecard suite and typecheck are green; the unrelated full-suite baseline
should be repaired separately.

## Browser verification

The required `agent-browser` process was followed:

1. Confirmed no orphaned browser processes before launch.
2. Signed in with the seeded local development account.
3. Verified the scorecard list, report, new-scorecard ladder, initiative list, and
   initiative detail pages on desktop.
4. Verified the report workspace selector lists only active memberships and updates
   the URL to `?workspace=<id>`.
5. Switched to the workspace containing scorecard data and confirmed KPI, breakdown,
   and per-scorecard sections changed with the selected workspace.
6. Triggered report refresh and observed no error state.
7. Verified report and initiative pages at 390×844 with zero document-level
   horizontal overflow.
8. Captured local screenshots during verification.
9. Closed the browser and killed/verified the remaining agent-browser helper process;
   no Chrome-for-Testing process remained.

## Production rollout gate

The new unique logical-key indexes are safe only after existing duplicates are
removed. Cleanup and index creation must run inside one controlled write-quiescence
window so an old instance cannot recreate a duplicate between verification and index
synchronization.

For each deployment database:

1. Pause the Temporal scorecard schedule and block manual evaluations/initiative sync.
2. Stop every old application/worker instance that can write scorecard projections.
3. Keep scorecard writes quiesced while running:

```bash
cd orbit-www

# Required reviewable dry run
bun run scorecards:dedupe

# Required pre-deploy cleanup
bun run scorecards:dedupe:apply

# Required confirmation; must report zero groups
bun run scorecards:dedupe
```

4. Start exactly one new application instance and wait for Payload/Mongo index
   synchronization to complete successfully.
5. Confirm the three unique indexes exist, then scale the new application and resume
   Temporal/manual scorecard writes.

The script:

- connects directly through `DATABASE_URI`, so it does not require Payload startup or
  successful index synchronization;
- retains the newest `evaluatedAt`, then newest `updatedAt`, then stable greatest ID;
- supports dry-run and explicit `--apply` modes;
- verifies no duplicate groups remain after apply;
- is idempotent when rerun.

Do not permit any scorecard writer during the interval from the first cleanup command
through confirmed unique-index creation. Abort the rollout if the final dry run reports
duplicates or the single new instance cannot create the indexes.

## Residual risks and follow-ups

- The duplicate cleanup is unit-tested and locally dry-run, but was not applied to a
  production database during this development session.
- Snapshot workflow tests execute the actual workflow function with mocked Temporal
  activity proxies; a Temporal test-environment integration test would provide an
  additional sandbox/retry layer.
- Payload/Mongo database-backed concurrency tests would provide stronger proof of the
  compound indexes and duplicate-key race recovery than the current fake/config tests.
- The unrelated repository-wide integration-suite authentication/environment failures
  remain and should be fixed independently.
