# Scorecards Capability — Roadmap to Full Delivery

**Date:** 2026-07-02
**Status:** Active roadmap
**Context:** Audit of shipped scorecards work (IDP refocus P2 + PRs #56, #59) vs the
plans in `2026-06-27-idp-refocus-implementation.md`, `2026-07-01-entity-scores-and-golden-paths.md`,
and `2026-07-01-scorecard-reports.md`.

## Where we are

Authoring and measurement are essentially complete on `main`:

- All five P2 collections (`scorecards`, `scorecard-rules`, `scorecard-rule-results`,
  `initiatives`, `initiative-action-items`) plus `entity-types`, `entity-scores`,
  `score-snapshots`.
- TypeScript evaluation engine (`lib/scorecards/evaluate.ts`) with four rule types
  (`field-presence`, `relation-check`, `threshold`, `entity-score`), RBAC-gated
  Rule Builder, level ladders, "Evaluate now".
- Entity scores + golden-path alignment across the catalog (PR #56).
- Reports & Insights at `/scorecards/reports` — KPIs, trend, distributions, team/kind
  breakdowns, rule insights (PR #59).
- Internal X-API-Key routes: `evaluate`, `recompute-scores`, `capture-snapshots`.

## Gaps, in priority order

### 1. Scheduled evaluation (NOW — see `2026-07-02-scheduled-scorecard-evaluation.md`)

Everything today is on-demand ("Evaluate now", catalog save-time seeding, internal
routes). Nothing runs nightly, so scores go stale and the reports trend chart only
accrues history if a human clicks Evaluate. The Temporal automations worker
(`orbit-www/services/automation-worker/`) and Schedule plumbing already exist from
P4.2 — wire a scorecard-evaluation sweep into them. This makes everything already
shipped trustworthy; it ships first.

### 2. Initiatives — data model with no product

`initiatives` + `initiative-action-items` exist and are registered but have **zero
UI** and no auto-generation of action items for failing entities. This is the
remediation half of the story (pick scorecard + target level + deadline → action
items for failing entities → burndown). Also unlocks the "initiative burndown"
reports section deferred in the reports plan.

### 3. Rule-authoring UX

- **Preview / dry-run** — "which entities would pass this rule?" before saving.
  Highest-leverage single authoring improvement.
- **Prebuilt scorecard templates** — production-readiness, security baseline.
- **Metadata-key discoverability** — suggest `metadata.*` keys seen on real entities.
- Bulk rule editing.

### 4. Drift → notification delivery

The P4 drift automation works end-to-end but `notify-owner` only records on the
action run — no email/Slack sink. Failing scorecards don't reach anyone yet.

### 5. Reports follow-ups (explicitly out of scope in the reports plan)

CSV export, scheduled email digests (pairs with #1's scheduling infra),
per-team drill-down pages.

### 6. Smaller items

- AI-governance rules riding the engine (project `agent-runs` / `pending-approvals`
  into entity metadata + template rules).
- RBAC Option B (granular `scorecards:manage`) when the Permissions system activates —
  switch point is `canManageScorecards`.

## Delivery sequence

1. **Scheduled evaluation** — small, makes shipped value real. ← current
2. **Initiatives UI + auto action items** — completes measure→improve loop.
3. **Rule preview + templates** — drives authoring adoption.
4. Notifications, reports follow-ups, governance rules.
