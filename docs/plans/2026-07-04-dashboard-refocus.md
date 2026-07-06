# Dashboard Refocus — align home dashboard with the product-focus strategy

**Date:** 2026-07-04
**Status:** Implemented on `feat/dashboard-refocus` — QA validated in-browser (all checklist items PASS, populated-hero path verified against /scorecards/reports; verdict: ship)
**Owner:** PM session (Claude) directing engineer + QA agents
**Strategy reference:** `docs/plans/2026-06-09-product-focus-strategy.md`

## Problem

The dashboard (`orbit-www/src/app/(frontend)/dashboard/page.tsx`) still reflects the
pre-strip "generic portal" framing:

- **Scorecards are invisible** — the strategy's top-ranked criterion (standards
  enforcement + exec visibility) shipped in PRs #59–61, with full data model
  (`entity-scores`, `score-snapshots`, `scorecard-rule-results`, `initiatives`,
  `initiative-action-items`) and a reusable report builder
  (`getScorecardReport()` in `scorecards/reports/actions.ts`) — none of it surfaces.
- **Application health has a full panel** (`DashboardAppHealthCard`) — the strategy
  says "strip health monitoring to a badge."
- **AI governance has no presence** — only an "Ask the agent" quick action. Pending
  HITL approvals (`pending-approvals`) and active agent runs (`agent-runs`) are
  queryable but not shown. `DashboardAttention.tsx` exists, is tested, and is never
  imported.
- **The stat row counts inventory** (workspaces/apps/topics/schemas), not posture.
  It also has a bug: `DashboardStatsRow.tsx:39` shows "No workspaces yet" beside a
  non-zero count because the page never passes `workspaceNames`.
- **The activity feed** emits app/topic/schema/doc events only; the `Activity` type
  already supports `'agent'` and severity `kind`, unused.

## Target layout

```
Greeting                                  [New Workspace] [Browse Templates]
─ Attention strip (only when non-empty): pending approvals + active agent runs
─ Stat row: Compliance % · Open action items · Pending approvals · Kafka topics/VCs
─ Main column                             │ Right column
  • Standards posture card (hero)         │  • Activity feed (governance-weighted)
  • Workspaces card (+ app health dots)   │  • Quick actions
```

Removed: `DashboardAppHealthCard` panel, API-schemas stat tile (and its
"Register your first schema" CTA), workspaces/applications stat tiles.

## Work packages

### WP1 (Opus engineer) — data layer, stat row, standards hero, page restructure

Files:
- `orbit-www/src/app/(frontend)/dashboard/page.tsx` — restructure per target layout.
- `orbit-www/src/components/features/dashboard/DashboardScorecardsCard.tsx` (NEW)
  + test. Props (server-computed, keep the component presentational):
  `{ report: { avgScore: number|null, scoredCount, entityTotal, trend: {capturedAt, avgScore}[], worstGroups: {name, avgScore, entityCount}[] }, openActionItems: number, activeInitiatives: number, hasScorecards: boolean }`.
  Content: compliance % headline + 30-day trend sparkline (SVG polyline is fine,
  no chart lib), worst 2–3 teams/kinds from `byTeam`/`byKind`, open action-item
  and active-initiative counts. Links: header → `/scorecards/reports`, initiatives
  line → `/scorecards/initiatives`. Empty state (`hasScorecards === false`):
  "Define your first standard" CTA → `/scorecards/new`.
- `orbit-www/src/components/features/dashboard/DashboardStatsRow.tsx` + test —
  new props: `{ complianceScore: number|null, scoredCount, entityTotal,
  openActionItems, pendingApprovals, kafkaTopicCount, virtualClusterCount }`.
  Tiles: Compliance (→ `/scorecards/reports`; em-dash + "No scorecards yet" when
  null), Action items (→ `/scorecards/initiatives`), Pending approvals
  (→ `/platform/approvals`), Kafka topics (subtitle "N virtual clusters",
  → `/platform/kafka`). This deletes the workspaceNames bug by removal.
- Data (in page.tsx, parallel with existing queries):
  - Reuse `getScorecardReport(30)` from
    `src/app/(frontend)/scorecards/reports/actions.ts` — it self-scopes to the
    session user's memberships. `avgScore` from `kpis`, trend from `trend`,
    worst groups from `byTeam` (fallback `byKind`), `hasScorecards` from
    `scorecards.length > 0`.
  - `payload.count` `initiative-action-items` where
    `{ workspace: {in}, status: {in: ['open','in-progress']} }`.
  - `payload.count` `initiatives` where `{ workspace: {in}, status: {equals:'active'} }`.
  - `payload.count` `pending-approvals` where
    `{ workspace: {in}, status: {equals:'pending'} }`.
  - Counts use `overrideAccess: true` (server component, membership-scoped where —
    same pattern as the existing kafka counts and `getScorecardReport`).
- Remove `DashboardAppHealthCard` import/render from page.tsx. Keep the component
  file (deleted in WP2 after its replacement lands).
- Update `index.ts` exports for the new card.

### WP2 (Sonnet engineer) — attention strip, workspace health dots, feed, quick actions

Files:
- `orbit-www/src/components/features/dashboard/DashboardAttention.tsx` + test —
  loosen agent-specific required props: make `phases`, `lastThought`, `elapsed`,
  `app` optional (render those sections only when present); add
  `kind: 'approval'` variant (Shield icon, "Needs approval" pill, CTA
  "Review & approve"). Keep existing visual language.
- `orbit-www/src/app/(frontend)/dashboard/page.tsx` — build `AttentionRun[]`:
  - `pending-approvals` (status pending, limit 3, sort `-createdAt`, depth 1):
    kind `'approval'`, title, workspace name, `startedRel` from `createdAt`,
    href `/platform/approvals`.
  - `agent-runs` (status in `running`/`awaiting_user`/`awaiting_approval`,
    limit 3, sort `-startedAt`, depth 1): kind `'awaiting'` for the two awaiting
    statuses else `'running'`, title, workspace name, app from `repository`,
    href `/agent`.
  - Render `<DashboardAttention runs={...}/>` directly under the greeting
    (component already returns null when empty).
- `orbit-www/src/components/features/dashboard/DashboardWorkspacesCard.tsx` + test —
  extend `WorkspaceRowMeta` with `degraded?: number`; render app count and an
  amber/red dot + "N degraded" when > 0. Page computes `metaById` from a single
  `apps` find (`limit: 100`, fields workspace/status only) — no per-workspace queries.
- Activity feed (page.tsx): add governance events, set `workspace` and `kind` on
  all items:
  - recent `agent-runs` (limit 3, any status, sort `-startedAt`): type `'agent'`,
    title "Agent run {completed|failed|started|…}", kind `err` for failed/timeout,
    `ok` for completed, `accent` otherwise.
  - recently resolved `pending-approvals` (status resolved, limit 2, sort
    `-resolvedAt`): type `'agent'`, title "Approval {approved|rejected}",
    kind `info`.
  - Existing app/topic/schema/doc items keep working; doc items rank last on tie.
  - Sort desc, keep top 6.
- `orbit-www/src/components/features/dashboard/DashboardQuickActions.tsx` + test —
  swap "Register schema" (`/catalog/apis`) → "Scorecard reports"
  (`/scorecards/reports`, ClipboardCheck or similar icon). Other five unchanged.
- Delete `DashboardAppHealthCard.tsx` + its test; remove from `index.ts`.

### QA (agent-browser)

Live validation on the branch dev server (worktree checkout, seeded dev login):
1. Dashboard renders with zero scorecards data → empty states everywhere, no
   crashes, no "No workspaces yet" contradiction, no Application health panel.
2. Create a scorecard via `/scorecards/new` (dev user is workspace owner), run an
   evaluation if entities exist → verify compliance tile + hero populate.
3. Attention strip absent when nothing pending; feed shows governance events if any.
4. Quick actions: six tiles, "Scorecard reports" navigates to `/scorecards/reports`.
5. Screenshot the final dashboard.

## Constraints

- Server-component data fetching follows the page's existing pattern
  (membership-scoped `where` + `overrideAccess: true` where collection access
  can't see the session user). Do NOT touch collection access rules — new-collection
  access must come from `src/lib/access/collection-access.ts` and none is needed here.
- No new dependencies (sparkline = inline SVG).
- All touched components keep their `.test.tsx` in sync; new card gets tests
  written first (TDD).
- Test runner: `cd orbit-www && bunx vitest run` (NOT pnpm). Lint:
  `bunx eslint src/components/features/dashboard src/app/\(frontend\)/dashboard`.
  Typecheck: `bunx tsc --noEmit` — main has a pre-existing error baseline
  (~111); requirement is zero NEW errors.

## Verification

1. `bunx vitest run src/components/features/dashboard` — all green, new tests
   cover: scorecards card empty vs populated; stats row null-compliance state;
   attention approval variant + optional props; workspaces card degraded dot;
   quick actions swap.
2. Full `bunx vitest run` — no regressions vs baseline.
3. Lint + typecheck as above.
4. agent-browser QA pass (steps above) with screenshots.
