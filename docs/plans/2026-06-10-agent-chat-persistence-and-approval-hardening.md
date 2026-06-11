# Agent Chat Persistence & Tool-Approval Hardening

**Status:** In progress
**Owner:** Chief architect (Claude) + agent engineering team
**Branch:** `feat/agent-chat-persistence-and-approvals`
**Date:** 2026-06-10

## Problem statement (confirmed by investigation)

Users report: chats aren't persisted, and old chats can't be opened.

Root causes, each verified against code and the live dev environment:

1. **Conversation history is never persisted durably.** The full transcript lives
   only in Temporal workflow query state (`state.history` / `state.events`,
   `temporal-workflows/internal/workflows/infrastructure_agent_workflow.go:2653-2709`).
   The Mongo `agent-runs` collection stores metadata only — by explicit design
   (`orbit-www/src/collections/AgentRuns.ts:9-12`). Reopening a run renders an
   empty thread (`AgentChatThread.tsx:148`) and replays events from a live
   Temporal query.
2. **Temporal retention is 24h** (verified: `WorkflowExecutionRetentionTtl 24h0m0s`
   on the `default` namespace; all 11 runs in Mongo are from May, and
   `temporal workflow describe` returns *workflow not found* for them). Once a
   workflow is purged, `QueryWorkflow` fails, `fetchNewEvents` returns
   `CodeInternal` (`services/repository/internal/grpc/agent_server.go:274-277`),
   the SSE route 500s, and the client reconnect-loops forever on an empty thread.
3. **Continue-as-new drops the event log.** `continueAsNew()` carries
   `Events: nil` and only the last 30 turns
   (`infrastructure_agent_workflow.go:2746-2766`), so even running chats lose
   their visible history after `defaultMaxHistoryTurns`.
4. **Stale statuses.** Runs whose workflow vanished while non-terminal stay
   `awaiting_user`/`running` in Mongo forever (two such rows exist today).
5. **Tool-approval gaps** (from the approval-process review):
   - `POST /api/internal/agent-tools/[id]/resolve` performs no workspace
     ownership check on the tool being resolved (HIGH).
   - Resolve is not idempotent on the `agent-tools` row (duplicate signal/retry
     re-creates versions / re-patches).
   - `awaitApproval` blocks forever — no approval timeout; gates can stay
     pending indefinitely (`infrastructure_agent_workflow.go:2209-2236`).
   - Orphaned Temporal workflow if `payload.create('agent-runs')` fails after
     the workflow already started (`app/actions/infra-agent.ts:41-65`).

## Architecture decision

**Payload/Mongo becomes the system of record for the chat transcript.** Temporal
remains the execution engine and live-streaming source; Mongo holds the durable
replica. Rationale: survives retention expiry and continue-as-new, gives SSR a
fast read path, keeps tenant access control in one place (Payload access
patterns already exist), and requires no Temporal config coupling.

### New collection: `agent-events` (orbit-www/src/collections/AgentEvents.ts)

| Field | Type | Notes |
|---|---|---|
| `workspace` | relationship → workspaces, required | access control |
| `run` | relationship → agent-runs, required | |
| `workflowId` | text, required | join key used by URLs/stream |
| `sequence` | number, required | workflow event sequence |
| `kind` | text, required | `conversation_turn` \| `proposal_update` \| `approval_request` \| `approval_resolution` \| `status_update` \| `tool_call_output` |
| `payload` | json, required | exact `AgentEvent.Payload` map as emitted by the workflow (same shape the SSE DTO mapper consumes) |
| `emittedAt` | date, required | |

- Indexes: `(workflowId, sequence)` **unique**; `(run)`.
- Access: read = active workspace members (same pattern as `AgentRuns.ts:23-36`);
  `create/update/delete: () => false` — internal API only.
- **Not persisted:** `token_delta` and raw `tool_call_output_chunk` (ephemeral
  streaming). Tool output SHOULD be persisted as one aggregated
  `tool_call_output` event per `callId` when the tool call completes, capped at
  64KB (truncate head, keep tail, note truncation in payload).

### New internal route: `POST /api/internal/agent-events`

- Auth: `X-API-Key` via existing `validateInternalApiKey`.
- Body: `{ workflowId, workspaceId, events: [{ sequence, kind, payload, emittedAt }] }`.
- Resolves the `agent-runs` row by `workflowId`; rejects 404 if absent, 409 if
  the run's workspace doesn't match `workspaceId`.
- Upsert semantics keyed on `(workflowId, sequence)` — replays/retries are no-ops.

### Workflow writer (temporal-workflows)

- New activity `PersistAgentEvents(input{WorkflowID, WorkspaceID, Events[]})` in a
  new `agent_events_activity.go`, following the `UpdateAgentRun` /
  `PayloadAgentRunsClient` pattern (X-API-Key HTTP client).
- Workflow buffers durable-kind events and flushes batched via the activity:
  - after each appended turn / proposal update / approval request / approval
    resolution / status update (piggyback on existing barriers is fine),
  - **must flush before ContinueAsNew and before workflow return** (all paths:
    complete, fail, abort, timeout),
  - fire-and-forget tolerance: activity retries per policy; failures must not
    crash the run (log + continue), sequence idempotency makes retries safe.
- Sequence numbering must remain monotonic across continue-as-new (already
  carried via `NextSequence`).

### Read path (orbit-www)

- `[runId]/page.tsx` SSR-loads persisted events (`payload.find('agent-events',
  where workflowId, sort sequence, limit 1000`) and passes them to
  `AgentChatThread` as `initialEvents: AgentEventDTO[]` (map with the same
  Go-event→DTO mapper used by the stream route — extract it for reuse).
- `AgentChatThread` ingests `initialEvents` on mount, then opens SSE with
  `since = max persisted sequence`.
- If run status is terminal (`completed|aborted|failed|timeout`): render history,
  do **not** open SSE, show an ended-state header, disable the composer.
- If status is non-terminal but the stream reports the workflow is gone: stop
  reconnecting, show a banner ("Live connection unavailable — showing saved
  history"), and the route reconciles the run status (below).

### Stream route & gRPC hardening

- `agent_server.go`: map Temporal *not found* on `QueryWorkflow` to
  `CodeNotFound` (not `CodeInternal`).
- `app/api/agent/[runId]/stream/route.ts`: on gRPC NotFound, emit a terminal SSE
  event (`event: gone`) and close cleanly instead of erroring; client treats
  `gone` like `done` plus the banner above.
- Reconciliation: when the workflow is gone and the Mongo run status is
  non-terminal, PATCH the run to `failed` with summary
  "Workflow history no longer available (Temporal retention expired or
  workflow terminated)".

### Start-run compensation

- `startAgentRun`: if `payload.create('agent-runs')` throws after the workflow
  started, call `abortAgentRun` (gRPC) to terminate the orphan workflow, then
  return a failure result.

### Tool-approval hardening

1. `ResolveAgentTool` activity includes `workspace_id`; the resolve route loads
   the tool first and returns 409 when `tool.workspace !== workspaceId`. Same
   cross-check on `pending-approvals/[id]/resolve`.
2. Idempotent resolve: if the tool status is already `approved`/`rejected`,
   return 200 with current state; do not create duplicate version rows.
3. Approval timeout: `awaitApproval` takes a deadline (default 72h, override via
   workflow input/env `AGENT_APPROVAL_TIMEOUT`). On expiry: treat as rejection
   with reason `approval timed out`, resolve the `agent-tools` row to
   `rejected`, resolve the pending-approvals row (`resolution: 'rejected'`,
   notes `expired`), emit `approval_resolution` so the UI gate closes.

### Out of scope (this plan)

- Backfilling transcripts for the 11 legacy runs (impossible — Temporal history
  is gone). They will open showing metadata + "no saved transcript" ended state.
- Bumping Temporal namespace retention (ops nicety, not the fix).
- Tool `invocationCount` tracking, version-note linking (LOW findings — file as
  follow-up issues).

## Acceptance criteria (owned by architect; QA verifies each)

**AC-1 — Mid-run refresh keeps history.** Given a running agent chat with ≥1
user and ≥1 assistant turn, when the user reloads the page, then all prior
turns render from persisted data before/while the SSE connects, and streaming
resumes without duplicated turns.

**AC-2 — Completed runs reopen with full transcript.** Given a run that has
reached a terminal status, when the user opens it from the run list (even after
Temporal retention would have expired — simulate by seeding/terminating), then
the full persisted transcript, proposals, and approval outcomes render; no SSE
reconnect loop; composer disabled with a clear ended state.

**AC-3 — Purged workflow degrades gracefully.** Given a run whose Temporal
workflow no longer exists and whose Mongo status is non-terminal, when the user
opens it, then the UI shows saved history plus an unavailability notice (no
infinite "reconnecting"), and the run status is reconciled to `failed`.

**AC-4 — Idempotent persistence.** Replaying the same event batch (activity
retry) creates no duplicate `agent-events` rows ((workflowId, sequence) unique)
and the UI never renders duplicate turns.

**AC-5 — Continue-as-new survives.** Given a run that crosses
`defaultMaxHistoryTurns`, the persisted transcript in Mongo remains complete
(no gap, monotonic sequences) even though the workflow compacted in-memory
history.

**AC-6 — Tenant isolation on transcripts.** A user who is not an active member
of the run's workspace cannot read its `agent-events` via Payload REST/admin or
open its stream (existing 403 behavior preserved).

**AC-7 — Tool resolve workspace check.** A resolve call whose `workspace_id`
does not match the tool's workspace is rejected (409) and changes nothing.

**AC-8 — Idempotent tool resolve.** Delivering the same approval resolution
twice yields one version-history entry set and a single stable final state.

**AC-9 — Approval timeout.** A tool-registration gate left unresolved past the
configured timeout auto-rejects: tool → `rejected`, pending approval resolved
with expiry note, `approval_resolution` event emitted (and persisted), run
continues/handles rejection.

**AC-10 — No orphan workflows.** If the Payload run-row creation fails at
start, the just-started workflow is aborted and the user gets an error (no
zombie workflow, verified via Temporal CLI).

**AC-11 — No regressions.** `make test-go` passes; orbit-www vitest suite
passes; `cd orbit-www && pnpm build` succeeds; existing live-streaming behavior
(token deltas, approval cards, abort) still works.

## Verification plan

- **Automated:** Go table-driven tests for the persistence activity, flush
  barriers (Temporal test framework), timeout path, resolve idempotency/
  workspace checks; vitest for the SSR backfill mapper, AgentChatThread initial
  ingest + terminal/gone states; route tests for `/api/internal/agent-events`.
- **Manual (QA, agent-browser):** walk AC-1/2/3 against the live dev app —
  including seeding a synthetic completed run with `agent-events` rows in Mongo
  to verify the read path without requiring a live LLM, plus a real run if an
  LLM provider is available.

## Work breakdown

| # | Owner | Scope (exclusive file ownership) |
|---|---|---|
| 1 | go-engineer | `temporal-workflows/**` (persistence activity, flush barriers, CAN, approval timeout, resolve payload workspace_id) + `services/repository/internal/grpc/agent_server.go` (NotFound mapping) |
| 2 | web-engineer | `orbit-www/**` (AgentEvents collection, internal events route, SSR backfill, stream-route gone-handling + reconciliation, AgentChatThread initial ingest/terminal UX, startAgentRun compensation, tool-resolve route hardening) |
| 3 | qa | Test-suite execution + agent-browser E2E per ACs, bug reports back to 1/2 |
