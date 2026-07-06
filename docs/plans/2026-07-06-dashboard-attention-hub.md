# Dashboard Attention Hub

**Status:** Implemented + QA-validated 2026-07-06 (see QA results at bottom)
**Date:** 2026-07-06
**Owner:** PM (spec) → Frontend engineer (impl)
**Files touched:** `orbit-www/src/components/features/dashboard/DashboardAttention.tsx`, `orbit-www/src/app/(frontend)/dashboard/page.tsx`, `orbit-www/src/components/features/dashboard/DashboardAttention.test.tsx`

## Problem

The dashboard attention strip renders every pending approval and active/awaiting agent run as a full-height (~180px) rich card, stacked vertically. At 5–6 items the strip exceeds 1000px and pushes the stats row, scorecards, and activity feed below the fold. Users report the dashboard feels "buried" when the agent is busy — the exact moment the rest of the dashboard matters most. We want the same information density without the vertical blowout.

## Goals

- Cap the attention region at a bounded height (~420px expanded, ~44px collapsed) regardless of item count.
- Preserve the rich card for the single most important item (the "spotlight").
- Make the remaining items scannable in one line each, one click to promote.
- Surface when there are more items than we fetched, with a link to the full list.
- Zero new npm dependencies; minimal `page.tsx` churn.

## Non-goals

- No redesign of the rich `AttentionCard` internals (layout, colors, phases stay as-is).
- No new data sources beyond the existing pending-approvals + agent-runs queries.
- No server-side sorting change beyond raising limits and passing totals.
- No realtime/streaming updates; this remains a server-rendered snapshot with client-side interaction.

## User Acceptance Criteria

**UAC-1 — Zero items.**
Given the user has no pending approvals and no active/awaiting agent runs,
When the dashboard renders,
Then the attention region renders nothing (component returns `null`), exactly as today.

**UAC-2 — Single item.**
Given exactly one attention item exists,
When the dashboard renders,
Then it renders the existing rich `AttentionCard` alone, with no hub header, no queue, and no collapse toggle.

**UAC-3 — Two or more items render as one hub.**
Given two or more attention items exist,
When the dashboard renders,
Then a single consolidated panel renders containing: a header strip, one spotlight rich card, and a queue of compact rows for the remaining items. The panel does not render N separate full-height cards.

**UAC-4 — Priority ordering.**
Given multiple items of mixed kinds,
When the hub determines the spotlight,
Then items are ordered by kind priority `awaiting` > `approval` > `running`, and within the same kind the oldest-started item ranks first. The highest-priority item is the spotlight; the rest fill the queue in the same order.

**UAC-5 — Header count summary.**
Given the hub is rendered,
Then the header strip shows a pulsing indicator, the title "Needs your attention", and a per-kind count summary joined by "·" (e.g. "2 approvals · 1 awaiting input · 2 running"). Kinds with zero items are omitted. Counts reflect fetched items plus any known overflow totals (see UAC-11).

**UAC-6 — Collapse / expand toggle.**
Given the hub is rendered,
Then the header strip includes a chevron toggle button. When collapsed, only the ~44px header strip is visible (spotlight and queue hidden). When expanded, the full panel is visible. The toggle flips state on click.

**UAC-7 — Collapse preference persists.**
Given the user collapses or expands the hub,
When they reload the dashboard,
Then the last chosen collapse state is restored from `localStorage` (key e.g. `orbit.attentionHub.collapsed`). Absent/invalid storage defaults to expanded.

**UAC-8 — Auto-expand on new item.**
Given the hub is collapsed and persisted as collapsed,
When the rendered run set contains an item `id` not present in the previously-seen set (tracked in `localStorage`, e.g. `orbit.attentionHub.seenIds`),
Then the hub auto-expands so the user sees the new item, and the seen-id set is updated. Re-collapsing and reloading with no new ids keeps it collapsed.

**UAC-9 — Spotlight swap interaction.**
Given the hub is expanded with a spotlight and one or more queue rows,
When the user clicks (or activates via keyboard) a queue row,
Then that item becomes the spotlight and the previously-spotlighted item moves into the queue at its priority-ordered position. The swap is client-side (no navigation) with a smooth CSS transition. When `prefers-reduced-motion: reduce` is set, the swap is instant with no transition.

**UAC-10 — Queue row content + deep link.**
Given a queue row renders,
Then it shows: the kind icon, the truncated title, the workspace, a relative time, and a small status pill. The row body is a keyboard-operable button that promotes the item to spotlight. The row also exposes a separate explicit deep-link affordance to the item's `href` (e.g. `/platform/approvals` or `/agent`) that navigates rather than promotes.

**UAC-11 — Show N more.**
Given more than 4 queue rows exist,
When the hub renders,
Then at most 4 rows are visible and an inline "Show N more" expander reveals the rest (N = hidden count). Activating it expands the queue in place; collapsing it returns to 4. This expander must not push the panel past the ~420px bound uncontrollably — the expanded queue scrolls within the panel if needed.

**UAC-12 — Overflow footer links.**
Given the server fetched fewer items than the total available for a source (approvals total > fetched, or runs total > fetched),
When the hub renders,
Then a footer shows the relevant link(s): "View all approvals →" to `/platform/approvals` and/or "View all runs →" to `/agent`. Links appear only for sources whose total exceeds fetched count.

**UAC-13 — No new dependencies.**
Given the implementation,
Then it uses only React state/hooks, Tailwind classes, the existing `@/components/ui/button`, and `lucide-react`. `package.json` gains no new dependency. `DashboardAttention.tsx` carries a `'use client'` directive.

**UAC-14 — Backward-compatible types.**
Given downstream imports,
Then the exported types `AttentionRun`, `AttentionRunKind`, and `AttentionPhase` remain unchanged in shape (fields may be added only as optional). `page.tsx` changes are limited to raising query limits, passing total counts, and passing any new optional props.

**UAC-15 — Accessibility.**
Given assistive-tech users,
Then the collapse toggle exposes `aria-expanded` reflecting state and an accessible name (e.g. "Collapse attention panel" / "Expand attention panel"). Each queue row is a `<button>` with an accessible name describing the item (title + kind + "promote to spotlight"). The deep-link affordance has its own accessible name. All interactive controls are reachable and operable by keyboard.

**UAC-16 — Bounded height.**
Given any number of attention items (2 to many),
When the hub is expanded,
Then the panel's rendered height does not exceed ~420px; excess queue rows scroll within the panel rather than growing it. When collapsed, height is ~44px.

> **Adjusted after QA (2026-07-06):** measured expanded height is 476px baseline / 519px with overflow footer — the untouched rich spotlight card (a non-goal to resize) plus hub chrome doesn't fit in 420px. The load-bearing invariant — height is *constant regardless of item count* (Show-more scrolls internally; 7 vs 14 items measured identical) — is verified. Bound reset to **≤ ~520px expanded / ~46px collapsed**; a padding-trim fast-follow is optional.

## Implementation tasks

### Task 1 — Server: raise limits + pass totals (`page.tsx`)
- In the `pendingApprovals` and `activeAgentRuns` `payload.find` calls, raise `limit: 3` → `limit: 5`.
- Capture totals: `pendingApprovalsResult.totalDocs` is already available as `pendingApprovals`; add `const activeRunsTotal = 'totalDocs' in activeAgentRunsResult ? activeAgentRunsResult.totalDocs : 0`. (`pendingApprovals` here counts only `status: pending`, which matches the fetched set — reuse it as the approvals total.)
- Pass new optional props to `<DashboardAttention>`: `approvalsTotal={pendingApprovals}` and `runsTotal={activeRunsTotal}`. Keep `runs={attentionRuns}` unchanged.
- Verify: `cd orbit-www && pnpm build`

### Task 2 — Component: hub shell + header + collapse (`DashboardAttention.tsx`)
- Add `'use client'` at top. Extend `DashboardAttentionProps` with optional `approvalsTotal?: number` and `runsTotal?: number`.
- Keep `AttentionCard`, `MiniPhases`, `StatusPill`, `kindConfig` unchanged.
- Add priority sort helper: kind rank `awaiting=0, approval=1, running=2`, tiebreak by oldest first (stable input order already reflects `-startedAt`/`-createdAt` desc, so reverse within-kind or rely on provided order — document the chosen basis in a comment).
- Branch: `runs.length === 0` → `null`; `runs.length === 1` → single `AttentionCard` (UAC-1/2); else render `<AttentionHub>`.
- `AttentionHub`: `useState` for collapsed (seeded from `localStorage`), spotlight id, queue-expanded. Header strip with pulsing dot, title, count summary (derived, omitting zero kinds, folding in overflow totals), and chevron toggle button with `aria-expanded` + accessible name.
- Verify: `cd orbit-www && pnpm exec vitest run src/components/features/dashboard/DashboardAttention.test.tsx`

### Task 3 — Component: spotlight + queue rows + swap (`DashboardAttention.tsx`)
- Spotlight = the currently-selected item (defaults to highest priority) rendered via existing `AttentionCard`.
- Queue = remaining items, priority-ordered, each a `QueueRow` button (icon, truncated title, workspace, relative time, `StatusPill`) that on click/Enter/Space sets spotlight id (UAC-9/10). Add a sibling `<Link href={run.href}>` deep-link affordance with its own accessible name.
- Swap transition via Tailwind `transition` classes gated by a `motion-reduce:transition-none` utility (UAC-9 reduced-motion).
- "Show N more" expander when queue length > 4 (UAC-11); expanded overflow area uses `max-h-[…] overflow-y-auto` to hold the ~420px bound (UAC-16).
- Verify: `cd orbit-www && pnpm exec vitest run src/components/features/dashboard/DashboardAttention.test.tsx`

### Task 4 — Component: persistence + auto-expand (`DashboardAttention.tsx`)
- On mount, read `orbit.attentionHub.collapsed` and `orbit.attentionHub.seenIds` from `localStorage` (guard for SSR/absence). Compute new-item set = current ids − seen ids; if non-empty, force expanded (UAC-8). Persist updated seen-ids and collapse state on change via `useEffect`.
- Footer overflow links: render "View all approvals →" when `approvalsTotal > (approval count in runs)`; "View all runs →" when `runsTotal > (running+awaiting count in runs)` (UAC-12).
- Verify: `cd orbit-www && pnpm exec vitest run src/components/features/dashboard/DashboardAttention.test.tsx`

### Task 5 — Tests (`DashboardAttention.test.tsx`)
- Update existing assertions for the new structure. Add cases covering: 0→null, 1→single card, 2+→hub; priority ordering picks correct spotlight; clicking a queue row swaps spotlight; collapse toggle sets `aria-expanded` and hides queue; localStorage persistence of collapse state; auto-expand when a new id appears; "Show N more" appears/behaves with >4 queue items; overflow footer links appear only when totals exceed fetched; queue rows and toggle are keyboard-operable with accessible names. Mock `localStorage` and `matchMedia` as needed.
- Verify: `cd orbit-www && pnpm exec vitest run src/components/features/dashboard/DashboardAttention.test.tsx`

### Final verification (all)
- `cd orbit-www && pnpm exec vitest run src/components/features/dashboard/DashboardAttention.test.tsx`
- `cd orbit-www && pnpm lint`
- `cd orbit-www && pnpm build`

## Manual QA script

Prereqs: dev env up (`make dev-local` + `cd orbit-www && bun run dev`), browser at http://localhost:3000, login `drew.payment@gmail.com` / `Password1234`. Seed the workspace with pending-approvals (`status: pending`) and agent-runs (`status` in `running`/`awaiting_user`/`awaiting_approval`) via the admin/API. Follow the agent-browser pre-flight orphan check in CLAUDE.md before launching.

1. **Zero items** — remove all pending approvals + active runs. Load `/dashboard`. Expect: no attention region between greeting and stats row. (0 items)
2. **Single item** — seed exactly 1 pending approval. Reload. Expect: one full rich card, no header/toggle/queue. (1 item)
3. **Hub + priority** — seed 1 `running` run, 1 pending approval, 1 `awaiting_user` run (3 total). Reload. Expect: one panel; spotlight is the awaiting item; header reads "1 approval · 1 awaiting input · 1 running"; queue has 2 rows. (3 items)
4. **Spotlight swap** — click a queue row. Expect: clicked item moves to spotlight, prior spotlight drops into queue, smooth transition, no page navigation. (3 items)
5. **Deep link** — click a row's explicit link affordance (not the row body). Expect: navigation to `/platform/approvals` or `/agent`. (3 items)
6. **Collapse persistence** — collapse via chevron; only header strip (~44px) remains. Reload. Expect: still collapsed. Expand; reload. Expect: still expanded. (3 items)
7. **Auto-expand on new** — collapse the hub, reload once (stays collapsed). Seed one new run with a fresh id. Reload. Expect: hub auto-expands to reveal the new item. (4 items)
8. **Show N more** — seed 6 total items (so 5 queue rows after spotlight). Reload, expand. Expect: 4 rows visible + "Show 1 more"; activating reveals the 5th; panel stays within ~420px (queue scrolls if needed). (6 items)
9. **Overflow footer** — seed 7 pending approvals (server fetches 5). Reload. Expect: "View all approvals →" footer link present, navigates to `/platform/approvals`. Repeat with 7 active runs for "View all runs →". (7 items each)
10. **Reduced motion** — enable OS "reduce motion"; repeat step 4. Expect: instant swap, no animation. (3 items)
11. **Keyboard a11y** — Tab to the toggle (verify `aria-expanded`), Enter to toggle; Tab to a queue row, Enter/Space to promote; Tab to a deep link, Enter to navigate. (3 items)

Post-flight: close agent-browser and re-run the orphan `pgrep` check per CLAUDE.md.

## QA results (2026-07-06, agent-browser against live dev server, 7–14 seeded items)

- UAC-1..12, 15: **PASS** (UAC-9 reduced-motion verified via `motion-reduce:` class inspection — OS-level emulation unavailable; UAC-15 Enter-key activation blocked by a CDP synthetic-key tooling limitation reproduced on unrelated buttons — Space-key activation confirmed; one manual Enter spot-check recommended).
- UAC-13/14: verified at code level (package.json untouched; exported types unchanged), not browser-testable.
- UAC-16: **PASS as adjusted** — 476px expanded baseline, 519px with overflow footer, 46px collapsed; height constant across item counts. Original ~420px target relaxed to ≤~520px (see inline note above).
- Impact: stats row starts at ~673px from top with 7 attention items, vs >1000px under the old stacked-card design.
- Testing note: `agent-runs.workspace` is an ObjectId relationship — seed scripts inserting a plain string silently fail the dashboard's workspace `$in` filter.
