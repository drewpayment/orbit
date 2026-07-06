# Automation Detail View (P4.1)

**Date:** 2026-06-27
**Branch:** claude/idp-refactor-service-catalog-g7ch9h

## Goal
A read-only detail page per automation showing: full configuration, when it ran
last + the outcome of that execution, a recent-runs history (~10), and "next run"
(a real timestamp for cron/schedule automations; a descriptive "runs on next
matching event" label for event-driven ones).

## Decisions (confirmed with user)
- **Next run**: event-driven automations show a descriptive label; only
  schedule/cron automations show a computed next-run timestamp.
- **History**: show the last execution prominently + a compact recent-runs table
  (last ~10).

## Changes
1. **Link runs to their automation.** Add `sourceAutomation` (relationship →
   automations, indexed, readOnly) to `action-runs`. Set it in
   `createAndDispatchRun` (new `sourceAutomationId`) and pass `automation.id` from
   the dispatcher. Regenerate payload types.
   - File: `src/collections/actions/ActionRuns.ts`, `src/lib/actions/create-run.ts`,
     `src/lib/automations/dispatch.ts`.
2. **Cron next-run util (pure, TDD).** `src/lib/automations/next-run.ts` —
   `nextCronRun(expr, from): Date | null` for standard 5-field cron (`*`, lists,
   ranges, steps). Minute-stepping with a 366-day cap (returns null beyond).
   Tests first: `next-run.test.ts`.
3. **Detail query.** `getAutomationDetail(userId, id)` in
   `src/app/(frontend)/automations/actions.ts` — workspace-scoped read; returns the
   automation, resolved action, last run + recent runs (by `sourceAutomation`),
   `canManage`, and computed next-run info.
4. **Detail page.** `src/app/(frontend)/automations/[id]/page.tsx` — config section
   (trigger, filter chips, action link, input mapping, schedule), execution section
   (last run outcome + link, next run), recent-runs table (reuse `RunStatusBadge`,
   `formatRelativeTime`; link to `/self-service/runs/[id]`). Edit button when
   `canManage`.
5. **List → detail link.** Make the list card navigate to the detail page; keep the
   edit pencil as a separate control.

## Verify
- Vitest: cron next-run (field parsing, steps/ranges/lists, rollover, cap).
- Unit: dispatch passes `sourceAutomationId`.
- tsc + lint clean.
- agent-browser: create automation → trigger drift → detail shows last run
  Succeeded + outcome + recent-runs row; event-driven "next run" label; for a
  schedule automation a computed timestamp.

## Status — DONE & verified 2026-06-27
- 78 unit tests green (13 new cron-next + dispatch `sourceAutomationId` assertion);
  tsc clean for P4.1 files (baseline 110 unchanged); lint clean.
- **Browser QA passed** (local dev, "Dogfood Test" workspace): list cards link
  through to detail; drift automation detail shows config (filter `transition=drift`,
  action, mapping), **Last run: Succeeded**, **Next run: event-driven label**, and a
  2-row recent-runs history; schedule automation detail shows the cron + a computed
  **Next run = 6/29/2026 9:00 AM** (next Monday) + deferred-worker note; last-run link
  → run detail (confirms "Run created by automation …").
- Run→automation linkage proven via the new `sourceAutomation` field (the recent-runs
  query is keyed on it). Test data cleaned up after QA.
