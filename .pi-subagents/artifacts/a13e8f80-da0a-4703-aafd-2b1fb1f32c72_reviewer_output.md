## Review

**No blocker/high remains. No new blocker/high issue was introduced by these fixes.**

- **Resolved — High:** Duplicate-cleanup rollout now requires write quiescence through cleanup and unique-index creation: `docs/2026-07-16-scorecards-reports-hardening-verification.md:109-149`.
- **Resolved — High:** Workspace changes invalidate pending refreshes, responses are workspace-checked, and page instances are workspace-keyed: `orbit-www/src/components/features/scorecards/reports/ReportView.tsx:59-89`; `orbit-www/src/app/(frontend)/scorecards/reports/page.tsx:27-34`. Regression coverage: `ReportView.test.tsx:43-81`.
- **Resolved — Medium:** Snapshot keys and both existing-row lookups are workspace-bound: `orbit-www/src/lib/scorecards/snapshots.ts:177-204,268-284`. Cross-workspace coverage: `snapshots.test.ts:373-394`.
- **Resolved — Medium:** Trend reads are database-bounded using `capturedAt >= trendCutoff`, supported by the compound index: `orbit-www/src/app/(frontend)/scorecards/reports/actions.ts:207-211,249-261`; `orbit-www/src/collections/scorecards/ScoreSnapshots.ts:112-116`.
- **Resolved — Medium:** Window state resets from the new report, with workspace-keyed remount as additional protection: `ReportView.tsx:59-65`; `reports/page.tsx:29-34`.
- **Note:** Focused Vitest execution could not start because Bun could not resolve `vitest`; typecheck and `git diff --check` passed. The trend cutoff and window reset lack direct assertions in their focused tests.