# Initiatives UI + Auto-Generated Action Items

**Date:** 2026-07-02
**Status:** In progress
**Roadmap:** `2026-07-02-scorecards-roadmap.md` item 2.
**Depends on:** P2 collections (`initiatives`, `initiative-action-items` — already
registered, no schema changes), scorecard evaluation pipeline
(`lib/scorecards/evaluate.ts`), nightly sweep (PR #60) which will keep initiatives
fresh once merged.

## Product goal

Close the measure→improve loop (the Cortex Initiatives model). An engineering
leader picks a scorecard + target level + deadline; Orbit generates one action
item per (failing entity × failing rule at/below the target level), teams work
the items, and progress is visible at a glance. Re-evaluation keeps items in
sync automatically: fixed things complete themselves, regressions reopen.

## Design

### Sync semantics (`orbit-www/src/lib/scorecards/initiatives.ts`)

Definitions, given an initiative `(scorecard, targetLevel)`:
- **Target rank** = rank of `targetLevel` in the scorecard's `levels` ladder.
- **In-scope rules** = the scorecard's rules whose `level` name has rank ≤ target
  rank; rules with NO level are in scope at every target (they gate every rung —
  match `computeEntityLevel`'s existing interpretation; read it and stay
  consistent).
- **Failing pair** = (entity, in-scope rule) whose LATEST `scorecard-rule-results`
  row has `passed: false`.

`syncInitiativeActionItems(payload, initiativeId)` diffs failing pairs against
existing items:
- Pair failing, no item → **create** (`status: open`).
- Item exists (any status), pair failing → leave untouched (user state wins).
- Item `open`/`in-progress`, pair now passing (or rule/entity no longer in
  scope) → **auto-complete** (`status: done`, append a note "auto-completed:
  rule now passing").
- Item `done`, pair failing again → **reopen** (`status: open`, append note).
- Item `waived` → NEVER touched by sync, in either direction.

The diff itself is a pure, unit-tested function
`diffActionItems(existingItems, failingPairs)` → `{ toCreate, toComplete,
toReopen }`; the payload-touching wrapper stays thin (mirror the
`evaluate.ts` style: paginated reads via the page-loop convention).

**Progress** = pure `computeInitiativeProgress(items)` → `{ total, open,
inProgress, done, waived, pctComplete }` where `pctComplete = round(100 × (done
+ waived) / total)`, 100 when total = 0.

**Evaluation hook-in:** at the end of `runScorecardEvaluation`, fire-and-forget
(same pattern as `captureScoreSnapshots`): sync every `active` initiative of the
evaluated scorecard. A sync failure must never fail an evaluation. With PR #60's
nightly sweep this keeps every active initiative current daily.

### Server actions (`orbit-www/src/app/(frontend)/scorecards/initiatives/actions.ts`)

Tenancy identical to `scorecards/actions.ts` (`getMemberWorkspaceIds`, session
user server-side). Contract (exact — UI codes against this):

- `listInitiatives(): Promise<InitiativeSummary[]>` — workspace-scoped, each with
  scorecard name, targetLevel, owner name, deadline, status, progress.
- `getInitiativeDetail(id: string): Promise<InitiativeDetail | null>` — initiative
  + progress + items enriched with entity name/kind (link target id), rule
  title/level, assignee name.
- `createInitiative(input: { name: string; description?: string; scorecardId:
  string; targetLevel: string; deadline?: string }): Promise<{ id: string }>` —
  validates scorecard is in a caller-managed workspace and targetLevel is one of
  its level names; creates with `status: active`, `owner` = current user,
  workspace = scorecard's workspace; then runs the initial sync inline.
- `updateInitiativeStatus(id: string, status: 'active'|'completed'|'cancelled'):
  Promise<void>`
- `syncInitiative(id: string): Promise<{ created: number; completed: number;
  reopened: number }>`
- `updateActionItem(id: string, patch: { status?: ItemStatus; assigneeId?:
  string | null; notes?: string }): Promise<void>`
- `listScorecardOptions(): Promise<{ id; name; levels: { name; rank }[] }[]>` —
  for the create form (enabled scorecards with ≥1 level).

**RBAC:** initiative lifecycle (create / status / sync) requires
`canManageScorecards` (workspace owner/admin — same gate as scorecard
authoring). Action-item updates (status/assignee/notes) are open to any
workspace member (assignees work their items). Enforced in the server actions.

### UI

Routes (mirror the scorecards pages' server-component + client-island style):
- `/scorecards/initiatives/page.tsx` — list: cards with name, scorecard,
  target-level chip, status badge, deadline (overdue highlighted), progress bar
  (done+waived / total), owner. Empty state + "New initiative" (gated).
- `/scorecards/initiatives/new/page.tsx` — form: name, description, scorecard
  select → targetLevel select populated from that scorecard's levels, deadline
  date picker. Create → redirect to detail.
- `/scorecards/initiatives/[id]/page.tsx` — header (status badge, deadline,
  owner, scorecard link, progress bar + counts), actions (Sync now,
  Complete/Cancel/Reactivate — gated), items table.

Components in `orbit-www/src/components/features/scorecards/initiatives/`:
`InitiativeCard`, `InitiativeForm`, `InitiativeHeader`, `ActionItemsTable`
(columns: entity (link to `/catalog/[id]`), rule, status select (inline update,
member-editable), assignee, notes (popover/inline edit), updated), plus a small
`ProgressBar` reusing existing Progress styling patterns. Pure presentational
helpers (status→badge tone, overdue check, progress math already in lib) go in
`initiative-ui.ts` with unit tests, mirroring `scorecard-ui.ts`.

Navigation: "Initiatives" link in the `/scorecards` page header (next to
Reports), and an "Initiatives" count/link on the scorecard detail page if cheap.

Out of scope (follow-ups): reports burndown section, email/Slack nudges,
per-item comments/history, bulk assignment.

## User Acceptance Criteria

- **UAC-1 (Create):** owner/admin can create an initiative from a scorecard +
  target level (+ optional deadline); creation generates action items for every
  failing (entity × in-scope rule) immediately; members cannot create (gated in
  UI and server action).
- **UAC-2 (List):** `/scorecards/initiatives` shows workspace-scoped initiatives
  with status, deadline (overdue visually flagged), and accurate progress;
  linked from the `/scorecards` header; empty state renders without errors.
- **UAC-3 (Detail):** detail page shows progress counts and all items with
  entity links, rule titles, editable status/assignee/notes; a member (non-admin)
  can update item fields; lifecycle buttons are hidden from members.
- **UAC-4 (Sync):** re-running evaluation (or Sync now) auto-completes items
  whose rule now passes, reopens `done` items that regressed, never touches
  `waived` items, and reports `{created, completed, reopened}`.
- **UAC-5 (Evaluation hook):** `runScorecardEvaluation` fire-and-forget syncs
  active initiatives of that scorecard; a sync failure does not fail evaluation
  (unit-tested); completed/cancelled initiatives are not synced.
- **UAC-6 (Tenancy/RBAC):** every action is bounded to caller's workspace
  memberships; lifecycle actions reject non-managers server-side (not just
  hidden UI).
- **UAC-7 (Quality):** diff/progress/UI-helper logic is pure + vitest-covered;
  all scorecards suites pass; `tsc --noEmit` clean for touched files.
- **UAC-8 (Browser QA):** live agent-browser pass validates UAC-1..4 end-to-end
  against the dev server (seeded login, real scorecard with failing entities),
  including the item status round-trip and a Sync-now after flipping a rule
  result.

## Work packages

| WP | Owner | Scope |
|---|---|---|
| WP1 (lib+actions) | opus agent | `lib/scorecards/initiatives.ts` (+`initiatives.test.ts`), `evaluate.ts` hook-in (+test), `app/(frontend)/scorecards/initiatives/actions.ts` |
| WP2 (UI) | opus agent | pages under `app/(frontend)/scorecards/initiatives/`, components under `components/features/scorecards/initiatives/`, `initiative-ui.ts` (+test), header links |
| QA | opus agent | UAC audit: suites + tsc + live agent-browser pass |

## Verification

- `cd orbit-www && bunx vitest run src/lib/scorecards src/components/features/scorecards src/app/api/internal/scorecards`
- `cd orbit-www && bunx tsc --noEmit` (touched files clean)
- agent-browser QA per UAC-8 (pre/post-flight pgrep hygiene per CLAUDE.md).
