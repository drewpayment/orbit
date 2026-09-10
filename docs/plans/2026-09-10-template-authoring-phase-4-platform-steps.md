# In-App Template Authoring — Phase 4: Platform Steps + Parity

**Date:** 2026-09-10
**Parent design:** `docs/plans/2026-09-09-in-app-template-authoring-design.md` (§3.4 table, §6 row "4 — Platform steps + parity")
**Depends on:** Phase 1 (`docs/plans/2026-09-09-template-authoring-phase-1-engine.md`) and Phase 2 (`...-phase-2-authoring-ui.md`) — **both are merged** as of this writing (main `74beca7`, PR #104 "generic ScaffolderWorkflow, dispatch activities and v2 gRPC handlers"). This plan is written against the actual Phase 1/2 code, not the Phase 1 plan's proposed shape — several details below diverge from that plan (see §1).
**Status:** Draft.

---

## 0. Scope recap

Seven items from the design's Phase 4 row: `kafka:topic:provision`, `approval:request`, `agent:run`, three ADO publish actions, `fetch:template` (composition), a scheduled re-dry-run check for published templates, and `EntityTypes.goldenPath` pointing at a template definition so scorecards can assert "built from an approved paved path".

**Architecture finding that reshapes this phase:** the Phase 1 `Action` interface (`Execute`/`Plan` dispatched through one Temporal *activity*, §5 below) cannot express a step that must pause a *workflow* and wait on a signal, or that must itself dispatch further Temporal activities/child workflows. Three of the seven items need exactly that: `approval:request` (wait on a human signal), `agent:run` (start and await a child workflow), and `fetch:template` (recursively run another `ScaffolderWorkflow` as a child). These three are **not** implemented as ordinary registered actions dispatched via `ScaffolderExecuteStep`/`ScaffolderPlanStep`; they are handled as special cases inside `ScaffolderWorkflow`'s step loop, before the generic dispatch path. This is called out explicitly per task below and is the single biggest design decision this phase makes — flag it to the lead if a different approach (e.g., a long-polling activity) is preferred; see §9.

`kafka:topic:provision` and the three ADO actions fit the existing Action interface cleanly (they do I/O and return, like `github:repo:create` today) and need no workflow-level changes.

## 1. Current state (verified against the repo, 2026-09-10)

| Piece | File | Notes |
|---|---|---|
| `Action` interface | `temporal-workflows/internal/scaffolder/action.go:75-89` | `Name()`, `InputSchema()`, `OutputSchema()`, `Execute(ctx, rc, input)`, `Plan(ctx, rc, input)`. Optional `PlanDeclarer.SupportsPlan()`, `FamilyDeclarer.Family()`, `PlanPreviewer.PlanPreview(ctx, rc, input, destDir)` (renders a dry-run file tree for the diff viewer). `ErrNoPlan`, `ErrInvalidInput` (non-retryable marker) are the two sentinel errors actions return. |
| Registry | `temporal-workflows/internal/scaffolder/registry.go` | `NewRegistry(actions...)` panics on dup/empty names (assembled once at startup). `Descriptors()` → `ActionDescriptor{Name, Family, InputSchema, OutputSchema, SupportsPlan}`, sorted, served by `ListActions`. `ExportDescriptorsJSON` builds the checked-in `services/repository/internal/grpc/scaffolder_actions.json`. |
| Production action wiring | `temporal-workflows/internal/scaffolder/actions/default_actions.go` | `DefaultActions(deps Deps)` — the list actually registered in the worker (`temporal-workflows/cmd/worker/main.go:432`), **conditionally omitting** an action whose dependency (`TokenService`, `CatalogClient`) is nil rather than registering it broken. `DescriptorActions()` — every action including omitted ones, wired with nil deps, **only** for exporting static schemas (never executed) — this is what `cmd/scaffolder-descriptors` (referenced in `template_scaffolder_server.go:29`, run manually today — **verify this binary exists**: `find temporal-workflows/cmd -iname '*scaffolder-descriptor*'`) runs to regenerate `scaffolder_actions.json`. **Every new action in this phase must be added to both lists, and `scaffolder_actions.json` regenerated in the same commit** or `TestScaffolderDescriptorsExport_MatchesCheckedInFile` (referenced in the embed comment) fails CI. |
| `ScaffolderWorkflow` | `temporal-workflows/internal/workflows/scaffolder_workflow.go` | Per-step loop at `runStep` (line 295): evaluates `step.If` (`scaffolder.EvalBool`), resolves `step.Input` (`scaffolder.ResolveJSON`), dispatches via `workflow.ExecuteActivity(stepCtx, ActivityScaffolderExecuteStep	or ActivityScaffolderPlanStep, ...)`, selects over the activity future and `ctx.Done()` for cancellation (`WaitForCancellation: true` on activity options so cleanup is safe). Dry-run "unplannable" steps (an expression referencing a not-yet-produced output) are recorded as `PlannedChange{Kind: "unsupported"}` via `dryRunSkippable`, not failed — **the pattern items 2/3/6 must reuse** for their own dry-run story. No `workflow.GetSignalChannel` or `ExecuteChildWorkflow` calls exist anywhere in this file today — both are new for this phase. |
| Dispatch activities | `temporal-workflows/internal/activities/scaffolder_activities.go` | `ExecuteStep`/`PlanStep` resolve the action from the registry and call `Execute`/`Plan` (or `PlanPreview` for previewing actions), inside a **Temporal activity** — this is why signal-waiting/child-workflow-starting actions cannot live here (activities cannot call `workflow.GetSignalChannel` or `workflow.ExecuteChildWorkflow`; those are workflow-context-only APIs). `redactSecrets`/`redactSecretsInText` scrub secret-looking output keys before every writeback — new actions whose output may carry a token must use the same `secretKeyFragments` convention (`token`, `secret`, `password`, `apikey`, `credential`, `privatekey`, `authorization`). |
| Run-status writeback | `WriteRunProgressInput` (`scaffolder_activities.go`), POST to `/api/internal/action-runs/[id]/status` | Already carries `steps[]`, `plan`, `outputs`, `error`. `ActionRuns.status` select (`orbit-www/src/collections/actions/ActionRuns.ts:53-64`) already includes `awaiting-approval` — **reuse it**, do not add a new status. `ActionRuns.steps[].status` select (`ActionRuns.ts:88-96`) only has `pending/running/succeeded/failed/skipped` — **item 2 needs `awaiting-approval` added here**, additive, no migration. |
| Proto | `proto/idp/template/v1/template.proto` | `TemplateService`: `StartScaffolderRun`, `GetRunProgress`, `CancelRun`, `ListActions` all exist and are implemented (`services/repository/internal/grpc/template_scaffolder_server.go`). **No signal RPC exists yet** — item 2 needs one (§4.3). |
| Existing signal-gate precedent | `temporal-workflows/internal/workflows/launch_workflow.go:196-243` | `ApprovalSignal`/`AbortSignal` constants, `types.ApprovalSignalInput{Approved, ApprovedBy}` (`temporal-workflows/pkg/types/launch_types.go:29`), a `workflow.NewSelector` over the approval channel, an abort channel, and a 24h `workflow.NewTimer`, sent via `services/repository/internal/grpc/agent_server.go:244`'s `s.temporal.SignalWorkflow(ctx, workflowId, "", agentcontract.SignalApproval, payload)` pattern (that specific call is for the agent's own approval signal, `agentcontract.SignalApproval`, not the launch one — both follow the identical shape). **This is the exact pattern `approval:request` reuses** — same signal-wait-with-timeout shape, new signal name scoped to scaffolder runs. |
| Agent HITL (separate system) | `orbit-www/src/collections/PendingApprovals.ts`, `temporal-workflows/internal/activities/agent/pending_approvals_activity.go` (`OpenPendingApproval`, `ResolvePendingApproval`) | This is the **infra agent's own** approval-gate bookkeeping (a queryable Payload row per gate, `/platform/approvals`). It is a separate mechanism from `ActionRuns.status: awaiting-approval` / `launch_workflow`'s signal gate. `approval:request` as a scaffolder step should use the **PendingApprovals row-for-visibility + signal-for-wait** combination (write a row so `/platform/approvals` lists it, wait on a signal so the workflow actually resumes) — see §3 for the exact mechanics; this is a deliberate merge of the two existing patterns, not a third one. |
| Kafka provisioning | `temporal-workflows/internal/activities/kafka_activities.go` | `KafkaActivitiesImpl.ProvisionTopic(ctx, KafkaTopicProvisionInput) (*KafkaTopicProvisionOutput, error)` (line 300) is a **plain Go method**, not a registered-only-by-Temporal call — `getClusterConfigForTopic` (line 128) resolves cluster config **from an existing `kafka-topics` Payload doc id**, meaning a `kafka-topics` row (with its `virtualCluster`/cluster reference) must exist *before* `ProvisionTopic` runs. **Verify the exact required fields** on `orbit-www/src/collections/kafka/KafkaTopics.ts` before finalizing the action's input schema — a topic doc today is presumably created by a human through the Kafka UI, not headlessly; item 1 needs a Payload client that creates one the same way. No Temporal workflow wraps `ProvisionTopic` in one step (`kafka_topic_workflow.go` exists but **verify** whether it's a multi-activity workflow with its own waits, or a thin single-activity wrapper — if the latter, the new action calls `ProvisionTopic` directly the same way `catalog:entity:register` calls its Payload client; if the former, it needs the same child-workflow carve-out as `approval:request`/`agent:run`). |
| `catalog:entity:register` | `temporal-workflows/internal/scaffolder/actions/catalog_entity_register.go`, `.input.schema.json` | Input has `sourceType`/`sourceId` (required) — today's runs pass `sourceType: "scaffolder-run"`, `sourceId: <runId>`. **No field ties the created entity back to the template *definition*** — item 7 needs an additive optional input field (`templateDefinitionId`/`templateVersionId`), not a reuse of `sourceType`/`sourceId` (those already mean something specific and changing their meaning would break existing definitions and any dry-run fixture asserting on them). |
| ADO connections | `orbit-www/src/collections/connections/GitConnections.ts` (`provider: 'azure-devops'` — **verify exact value**, "Azure DevOps only for now" per line ~78), `temporal-workflows/internal/services/payload_ado_connection_client.go` (`GetConnectionToken(ctx, connectionID) (ADOConnectionToken, error)`), `temporal-workflows/internal/activities/ado_scan_activities.go` (`adoConnection`, `adoGet`, `adoBasicAuth` — PAT-based Basic auth against `dev.azure.com`, used today only for **read-only discovery scans**, not repo/pipeline/PR creation). No write-path ADO client exists yet — item 4 is greenfield except for the auth plumbing. |
| GitHub actions (shape to mirror) | `temporal-workflows/internal/scaffolder/actions/github_repo_create.go` | `Name()/InputSchema()/OutputSchema()/Execute()/Plan()` each ~10-20 lines; `Execute` calls a small typed client (`services.GitHubTemplateClient`) constructed from a `clientFactory` closure taking a resolved token. `Plan` returns a `PlannedChange{Kind: "repo", ...}` describing the create without doing it. This is the template for every action in items 1 and 4. |
| `EntityTypes.goldenPath` | `orbit-www/src/collections/catalog/EntityTypes.ts:84-110` | `group` field: `summary` (textarea), `docsUrl` (text), `requiredRelations` (array of `{relationType, direction}`). **No `templateId`/`templateDefinition` field today** — item 7 adds one. |
| Scorecard rules | `orbit-www/src/collections/scorecards/ScorecardRules.ts:77-90` | `type` select: `field-presence | relation-check | threshold | entity-score`; `expression` is a free-form `json` field "interpreted by the evaluator per type" — **the evaluator itself was not read for this plan; locate it (`grep -rn "field-presence" orbit-www/src/lib` or `orbit-www/src/collections/scorecards`) before implementing §8's check** to confirm whether a golden-path-provenance check fits `field-presence` against a denormalized field on `catalog-entities`, or needs a new rule `type`. |
| Automations schedule trigger | `orbit-www/src/collections/automations/Automations.ts:13-27,86-91` | `trigger.event: 'schedule'` with a cron `trigger.schedule` field already exists in the schema, but its doc comment says it is "swept by the (deferred) Temporal worker via `/api/internal/automations/dispatch`" — **that worker does not exist yet** (confirmed: no dispatch route or schedule worker found under `temporal-workflows` or `orbit-www/src/app/api/internal/automations`). Item 6 should **not** block on finishing that system; see §7 for a narrower, self-contained Temporal Schedule instead. |
| Worker replica constraint | CLAUDE.md, `scaffolder_activities.go`'s `ScaffolderActivities` doc comment | Steps of one run share a **local work directory** on whichever worker picked up the activity; safe only because the Temporal worker deployment is pinned to `replicas: 1`. Nothing in this phase changes that, but `fetch:template`'s child-workflow steps and `agent:run`'s child workflow must **not** assume they land on the same worker process as their parent for anything beyond what the existing work-dir convention already tolerates — call this out in review for any action that touches the filesystem inside a child. |

## 2. `kafka:topic:provision`

**New:** `temporal-workflows/internal/scaffolder/actions/kafka_topic_provision.go` + `.input.schema.json` + `.output.schema.json` + `_test.go`.

Shape mirrors `github_repo_create.go`. `Execute`:
1. Create the `kafka-topics` Payload doc (status `pending`) via a **new** narrow client `temporal-workflows/internal/services/payload_kafka_topic_client.go` (mirror `payload_pattern_instance_client.go`'s `XClient`-interface-over-`PayloadXClient` shape per the Phase 1 plan's precedent table), POSTing to a **new** internal route `orbit-www/src/app/api/internal/kafka-topics/route.ts` (or reuse an existing creation path if one is already exposed internally — **verify**: `grep -rn "kafka-topics" orbit-www/src/app/api/internal`) with `X-API-Key` auth, same convention as `action-runs/[id]/status`.
2. Call `KafkaActivitiesImpl.ProvisionTopic` directly (plain method call, not a nested Temporal activity dispatch — activities cannot schedule activities) with the new doc's id, cluster, and the step's input (`name`, `partitions?`, `retentionMs?`, `owner`).
3. On success, output `{ topicId, topicName, physicalName, clusterId }`; on failure, delete or mark-failed the created doc (avoid an orphaned `pending` row — **verify** whether `ProvisionTopic` already handles its own status update via `UpdateTopicStatus`, in which case the action just surfaces the error).

`Plan`: `PlannedChange{Kind: "topic", Name: <topicName>, Description: "would provision a governed Kafka topic on cluster <id> owned by <owner>"}` — no side effects, no Payload doc created during a dry run.

Input schema (draft, confirm required cluster-selection field name against `KafkaTopics.ts` before finalizing):
```json
{
  "type": "object",
  "required": ["name", "virtualClusterId", "owner"],
  "properties": {
    "name": { "type": "string", "minLength": 1 },
    "virtualClusterId": { "type": "string", "minLength": 1 },
    "owner": { "type": "string", "minLength": 1 },
    "partitions": { "type": "integer", "minimum": 1, "default": 3 },
    "retentionMs": { "type": "integer", "minimum": 1 }
  }
}
```

**Verify before implementing:** the exact required-field set on `KafkaTopics.ts` (owner as a team relationship vs. free text; whether `virtualCluster` or `cluster` is the correct relation name); whether `kafka_topic_workflow.go` does more than `ProvisionTopic` (schema registration, ACLs) that this action would need to replicate or explicitly defer.

**Tests (TDD):** table tests with a fake `KafkaProvisioner` interface (narrow the same way `ActionRunStatusWriter` narrows `PayloadActionRunClient` in `scaffolder_activities.go`) covering: success, cluster-not-found, provisioning failure leaves no orphaned doc, `Plan` performs no writes.
**Verify:** `cd temporal-workflows && go test -race -run TestKafkaTopicProvision ./internal/scaffolder/...`

## 3. `approval:request`

This is a **workflow-level special case**, registered in the action registry **only** for its `InputSchema`/`OutputSchema`/descriptor (so the StepsBuilder UI — `orbit-www/src/components/features/template-authoring/StepsBuilder.tsx`, fully registry-driven via `groupRegistryByFamily`/`ActionDescriptor`, needs **zero UI changes** for any action in this phase, new or not) and for static validation. Its `Execute`/`Plan` methods are never actually invoked; they return a hard error (`panic`-free, just an error) as defense-in-depth so a regression that accidentally lets it reach the generic dispatch path fails loudly in a test rather than hanging a workflow forever waiting on a signal an activity can never receive.

### 3.1 Signal + proto

**Edit:** `proto/idp/template/v1/template.proto` — add
```protobuf
rpc ResolveScaffolderApproval(ResolveScaffolderApprovalRequest) returns (ResolveScaffolderApprovalResponse);

message ResolveScaffolderApprovalRequest {
  string workflow_id = 1;
  string approval_id = 2;   // matches the step's generated approval id, disambiguates multiple approval:request steps
  bool approved = 3;
  string approver_id = 4;
  string comment = 5;
}
message ResolveScaffolderApprovalResponse { bool success = 1; }
```
Run `make proto-gen`.

**New Go constants** in `temporal-workflows/internal/workflows/scaffolder_workflow.go` (or a new `scaffolder_approval.go` in the same package):
```go
const ScaffolderApprovalSignal = "ScaffolderApprovalSignal"

type ScaffolderApprovalSignalInput struct {
    ApprovalID string `json:"approvalId"`
    Approved   bool   `json:"approved"`
    ApproverID string `json:"approverId"`
    Comment    string `json:"comment"`
}
```
One channel per workflow (not per step): the selector's receive handler checks `ApprovalID` against the step it's currently waiting on and ignores a signal for a different (already-resolved or not-yet-reached) approval id — this is simpler than one dynamically-named channel per step and matches how `agentcontract.SignalApproval` is a single channel name reused across the agent's many possible gates.

### 3.2 `runStep` special case

In `ScaffolderWorkflow`'s step loop (`scaffolder_workflow.go:190`, the `for i := range input.Definition.Spec.Steps` loop), before calling `run.runStep` for the generic path, branch on `step.Action == "approval:request"`:
1. Resolve `step.Input` as usual (`scaffolder.ResolveJSON`) — fields: `message` (string, required), `approvers` (array of user/team refs — **first cut: free-text list of emails or team ids, not RBAC-validated at definition-author time**, document as a known gap), `timeoutHours` (number, default 24).
2. Mark the step `awaiting-approval` (new step status, see §3.3) and write run status `awaiting-approval` (existing `ActionRuns.status` value) via `WriteRunProgress` — this is what makes the run-detail page (`orbit-www/src/app/(frontend)/self-service/templates/[id]/run/[runId]/`) show the gate.
3. Call a **new activity** `ScaffolderOpenApproval` (mirrors `OpenPendingApproval` at `pending_approvals_activity.go:59`) that writes a `pending-approvals` row (`kind: 'custom'`, `payload: {message, approvers}`, linking `workflowId`/`runId`) — this is what makes `/platform/approvals` list it, satisfying the design's "reuses existing `PendingApprovals`" requirement. Skip this write during a dry run (see §3.4).
4. `workflow.NewSelector` over: `workflow.GetSignalChannel(ctx, ScaffolderApprovalSignal)` (filtering by `ApprovalID`), the workflow's own cancellation (`ctx.Done()`, same as the generic step path), and a `workflow.NewTimer(ctx, timeoutHours)`.
5. On approve: step → `succeeded`, output `{approved: true, approverId, comment}`, continue the loop. On reject/timeout/cancel: step → `failed`; honour `step.continueOnError` exactly as the generic path does (`run.finish(... ScaffolderStatusFailed ...)` unless `continueOnError`); call a **new activity** `ScaffolderResolveApproval` (mirrors `ResolvePendingApproval`) to flip the `pending-approvals` row.

### 3.3 Data model additions

- `ActionRuns.steps[].status` (`orbit-www/src/collections/actions/ActionRuns.ts:88-96`) — add `{ label: 'Awaiting approval', value: 'awaiting-approval' }`. Additive.
- Run-detail UI (`TemplateRunDetail.tsx`) needs an "Approve / Reject" control when a step is `awaiting-approval` **and** the viewer is an authorized approver — reuse `canApproveActionRun`-equivalent RBAC (`orbit-www/src/lib/templates/authz.ts` if Phase 2 created it, else mirror `orbit-www/src/lib/actions/authz.ts`'s `canApproveActionRun`). The button calls a new server action `resolveScaffolderApproval(runId, approvalId, approved, comment)` in `orbit-www/src/app/(frontend)/self-service/templates/[id]/run/actions.ts` (or wherever Phase 2 put run-page server actions — **verify path**) that calls the new `ResolveScaffolderApproval` RPC.

### 3.4 Dry run

A dry run must never actually block on a human. `Plan` for `approval:request` (still only reached through the descriptor, not real dispatch) — actually: since this step is intercepted before dispatch, the **workflow's own dry-run branch** for this action name returns immediately: `PlannedChange{Kind: "unsupported", Name: step.ID, Description: "requires human approval — not evaluated in a dry run"}`, exactly the shape `dryRunSkippable` already produces for other steps, without writing a `pending-approvals` row and without touching the signal selector.

**Tests (TDD, workflow-level using the Temporal test suite the way `scaffolder_workflow_test.go` already does):**
- Approve → step succeeds, run continues, later steps see `${{ steps.<id>.output.approved }}`.
- Reject → run fails (no `continueOnError`) / continues with `failed` step (with it).
- Timeout fires the timer branch, not the cancel branch.
- Workflow cancellation while awaiting approval → `finishCancelled`, no orphaned `pending-approvals` row (resolve-on-cancel).
- A signal with a mismatched `approvalId` is ignored, selector keeps waiting.
- Dry run never opens a `pending-approvals` row (spy client).
**Verify:** `cd temporal-workflows && go test -race -run TestScaffolderWorkflow_Approval ./internal/workflows/...`

## 4. `agent:run`

Also a **workflow-level special case**, same registration-for-schema-only pattern as §3.

**Bounded first cut, explicitly deferring:**
- No live chat surface embedded in the template run page — the run page shows only "Agent run started → view thread" (link to the existing `AgentChatThread`/agent run detail page) and the final status once the child workflow completes. Full inline streaming is a follow-up.
- The agent's own internal approval gates (`AgentSignalApproval`) are untouched and unaffected — they are the agent workflow's own concern, orthogonal to `approval:request`. A template author who wants a gate *before* the agent runs uses a separate `approval:request` step ahead of it.
- Only one shape supported this phase: run the infra agent with a fixed initial prompt built from the step's resolved input (`prompt: string`, required) and `workspaceId`/`userId` from context. No mid-run parameter injection back into the template.

### 4.1 Mechanics

In `ScaffolderWorkflow`'s step loop, on `step.Action == "agent:run"`:
1. Resolve input.
2. `workflow.ExecuteChildWorkflow(ctx, workflows.InfrastructureAgentWorkflow, agentInput)` — **verify the exact registered workflow function name and its input struct** (`grep -n "func InfrastructureAgentWorkflow" temporal-workflows/internal/workflows/infrastructure_agent_workflow.go`) — with `workflow.ChildWorkflowOptions{ ParentClosePolicy: enums.PARENT_CLOSE_POLICY_TERMINATE, WorkflowID: <deterministic id, e.g. runID+"-"+stepID> }`. `TERMINATE` so cancelling the template run tears down the agent run rather than abandoning it (`ABANDON` would leave an orphaned agent burning tokens).
3. Selector over the child's future and the workflow's own `ctx.Done()`, mirroring the generic step's cancellation handling. On template-run cancellation, the child terminates (parent-close-policy), the step is marked `failed`/`cancelled` consistent with `finishCancelled`.
4. Output: `{ agentRunId, status }` once the child completes — **verify** the agent workflow's result type exposes an `AgentRunID`/similar the parent can read (it should, since `AgentRuns` rows already exist and are queryable independent of the workflow result, so worst case the action reads the id from `ChildWorkflowExecution().ID` and derives the `AgentRuns` doc id via the same convention the agent workflow itself uses to create that row — **verify this convention** before finalizing the output schema).

### 4.2 Dry run

Same `unsupported`/"requires running the infra agent — not evaluated in a dry run" treatment as `approval:request`. No child workflow is started during a dry run.

**Tests:** Temporal test-suite child-workflow mocking (`env.OnWorkflow(...)` or equivalent — match whatever pattern existing tests in this repo use for child workflows, e.g. search `ExecuteChildWorkflow` in `*_test.go` under `temporal-workflows/internal/workflows`) covering: success, agent failure propagates as step failure, cancellation terminates the child, dry run starts no child.
**Verify:** `cd temporal-workflows && go test -race -run TestScaffolderWorkflow_AgentRun ./internal/workflows/...`

**Open question for the lead:** should `agent:run`'s prompt be allowed to reference `${{ steps.*.output }}` from *prior* template steps (almost certainly yes — that's the whole point of composing it with e.g. a freshly-created repo) — confirm the resolved input threading through `scaffolder.ResolveJSON` already covers this (it should, since resolution happens before the special-case branches, identically to the generic path) before writing the test suite.

## 5. ADO publish actions

**New:** `temporal-workflows/internal/scaffolder/actions/ado_repo_create.go`, `ado_pr_open.go`, `ado_pipeline_create.go` (+ schemas + tests), plus a **new** `temporal-workflows/internal/services/ado_write_client.go` (the write-path counterpart to the read-only `ado_scan_activities.go`'s inline HTTP calls — factor a proper client the way `GitHubTemplateClient` wraps GitHub, rather than inlining `http.NewRequest` calls into the action files).

All three follow the `github_repo_create.go` shape exactly: `Execute` resolves an ADO PAT via `PayloadADOConnectionClient.GetConnectionToken` (already exists, `temporal-workflows/internal/services/payload_ado_connection_client.go:75`), builds Basic auth the same way `ado_scan_activities.go:386`'s `adoBasicAuth` does, and calls the ADO REST API.

- **`ado:repo:create`** — `POST https://dev.azure.com/{org}/{project}/_apis/git/repositories?api-version=7.1`. Input: `connection` (GitConnections id), `project`, `name`. Output: `{ repoUrl, repoId, cloneUrl }`. Full implementation this phase — same complexity class as `github:repo:create`.
- **`ado:pr:open`** — `POST .../_apis/git/repositories/{repoId}/pullrequests?api-version=7.1`. Input: `connection`, `repoId`, `sourceBranch`, `targetBranch`, `title`, `description`. Output: `{ prUrl, prId }`. Full implementation this phase.
- **`ado:pipeline:create`** — **bounded first cut**: creates a YAML-backed pipeline pointing at a caller-supplied path (default `azure-pipelines.yml`) via `POST .../_apis/pipelines?api-version=7.1`, assuming that file already exists in the repo (from an earlier `fs:render`/`git:push` step) — the action does **not** generate pipeline YAML content. If the file is missing, ADO's own API error surfaces as the step failure (no special-cased friendly message needed initially). Defer: multi-stage pipeline templates, variable-group wiring, environment approvals. Flag this scope cut explicitly in the PR description.

`Plan` for all three returns a `PlannedChange{Kind: "repo"|"pr"|"unsupported"}` describing the action without calling ADO.

**Verify before implementing:** exact `GitConnections.provider` enum value for Azure DevOps (the current comment says "Azure DevOps only for now" but the literal select value wasn't read); ADO API version pinning convention already used in `ado_scan_activities.go` (reuse the same `api-version` query param across all new calls for consistency); whether Drew's real-ADO smoke-test credentials (referenced in project memory as "still open") should gate merging this beyond unit tests with a faked HTTP transport.

**Tests:** table tests per action with a fake ADO transport (mirror `github_repo_create_test.go`'s fake client pattern) — auth header construction, success, 4xx (bad PAT → clear error), 404 project/repo not found, `Plan` performs no HTTP calls.
**Verify:** `cd temporal-workflows && go test -race -run TestADO ./internal/scaffolder/actions/...`

## 6. `fetch:template` (composition)

Third and last **workflow-level special case**. On `step.Action == "fetch:template"`:

1. Input: `templateDefinitionId` (required), `version` (optional — pins to a specific `template-definition-versions` doc; omitted means "current published version at run time," resolved by an activity, not by the workflow directly reading Payload), `parameters` (object — mapped into the nested run's `Parameters`, values may themselves be `${{ }}` expressions against the *outer* run's context, resolved by the normal `ResolveJSON` pass before this branch runs).
2. **Cycle detection:** add `TemplateStack []string` (a list of `definitionVersionId`s already in progress) to `ScaffolderWorkflowInput`. A new activity `ScaffolderResolveTemplateVersion` (Payload lookup: definition → its current published version, or the pinned one) resolves the target version id; if that id is already in `TemplateStack`, fail the step immediately with a non-retryable "template composition cycle detected: A → B → A" error — **do not** rely on a depth counter alone, since two independent cycles of different lengths both need catching, and a stack gives the reader the actual cycle path in the error.
3. Also cap total nesting depth (e.g. `len(TemplateStack) >= 5`) as a second, independent guard against accidental very-deep (not necessarily cyclic) composition chains — cheap insurance, small constant, document it as tunable.
4. `workflow.ExecuteChildWorkflow(ctx, workflows.ScaffolderWorkflow, nestedInput)` where `nestedInput` carries the resolved nested definition (fetched by an activity, the same "workflow code makes no Payload calls" rule Phase 1 established for the top-level input — `docs/plans/2026-09-09-template-authoring-phase-1-engine.md:257`), `TemplateStack: append(outer.TemplateStack, thisVersionID)`, `DryRun: outer.DryRun` (a dry run of the outer template must dry-run the nested one too, never execute it for real), and a **fresh** `RunID` for the nested run's own `action-runs` row (so its progress is independently inspectable) linked back via a new optional `ActionRuns.parentRun` relationship field (additive) — **or**, simpler and possibly sufficient for this phase, no separate `action-runs` row at all and the nested run's steps are flattened into the outer run's `steps[]` with a naming convention (`<outerStepId>.<nestedStepId>`) — **flag this as a decision for the lead**: a separate row is cleaner and matches "a template run is one `ActionRuns` doc" but adds a `parentRun` field and extra UI (nested run link) that flattening avoids at the cost of a less clean progress model. Recommend the separate-row approach for auditability, sized as its own task (§10, Task F) so it can be deferred to a fast-follow if the lead prefers to ship without it.
5. Cancellation and dry-run "unplannable" handling both delegate straight to the child workflow's own handling (it is, after all, a full `ScaffolderWorkflow`) — the outer selector only needs to watch the child's future and its own `ctx.Done()`, same shape as `agent:run`.
6. Output propagation: the nested run's resolved `spec.output` (its `ScaffolderWorkflowResult.Outputs`) becomes this step's output object, so `${{ steps.<id>.output.<key> }}` in the outer definition reads whatever the nested template's `output:` block declared — this is the entire point of composition and needs its own dedicated test.

**Tests:** two-level composition succeeds and propagates output; direct self-reference (A fetches A) is caught; indirect cycle (A→B→A) is caught with the full path in the error message; depth cap trips on a long non-cyclic chain; dry run of the outer never executes the nested workflow's real actions (only plans it); nested run's own cancellation on outer cancel.
**Verify:** `cd temporal-workflows && go test -race -run TestScaffolderWorkflow_FetchTemplate ./internal/workflows/...`

## 7. Scheduled re-dry-run automation

**Recommendation: do not wire the deferred `Automations` schedule dispatcher in this phase** (§1's finding — that system doesn't exist yet and finishing it is a materially different, cross-cutting piece of work unrelated to templates specifically). Instead, a narrow, self-contained mechanism:

**New:** `temporal-workflows/internal/workflows/template_dry_run_sweep_workflow.go` — `TemplateDryRunSweepWorkflow(ctx, input{})`:
1. Activity `ListPublishedTemplatesWithFixtures` (new, small Payload client method) — queries `template-definitions` where `status: published` and `fixtures` is non-empty.
2. For each, for each fixture, `workflow.ExecuteChildWorkflow(ctx, ScaffolderWorkflow, { ...DryRun: true, Parameters: fixture.values })`, `ParentClosePolicy: ABANDON` is wrong here (the sweep shouldn't wait on all of them serially and block on one slow dry run) — instead **fire-and-forget each as its own independently-scheduled unit**: simplest correct shape is the sweep workflow itself just calls a small **activity** `TriggerTemplateDryRun(definitionId, versionId, fixtureId)` that does the equivalent of what `StartScaffolderRun`'s gRPC handler does (create an `action-runs` row, start the workflow) and returns immediately without awaiting the result — the *existing* run/progress infrastructure (run page, status writeback) already handles the rest, no new tracking needed in the sweep workflow itself.
3. After triggering, write `lastDryRunAt` (already a field, per Phase 1's `template-definitions` schema) — **triggered**, not **completed**, timestamp; a genuine "did it pass" signal needs a second small piece: a **new** field `lastDryRunStatus` (select: `unknown|ok|drifted|failed`, default `unknown`) on `template-definitions`, updated by a **new** activity called from `ScaffolderWorkflow`'s `finish()` **only when `DryRun && input.Trigger == "scheduled-sweep"`** (a new input field distinguishing a consumer-initiated preview from the automated sweep, so a person clicking "Preview" doesn't silently flip the drift badge) — comparing the dry run's `PlannedChange[]`/preview file hashes against the previous sweep's stored snapshot (a simple content hash of the sorted preview manifest is enough to detect drift; a full diff view is out of scope here, that's Phase 2's `FileTreeDiff.tsx` on the run page already).

**Temporal Schedule:** create the schedule once via `temporal-workflows/cmd/worker/main.go` startup (or a small one-off `cmd/schedule-setup` — **verify** whether the repo already has a convention for provisioning Temporal Schedules at deploy time before inventing one) using the Go SDK's `client.ScheduleClient().Create(...)`, cron `"0 6 * * *"` (daily, 06:00 UTC — arbitrary, confirm with the lead), workflow `TemplateDryRunSweepWorkflow`.

**Data model additions:** `template-definitions.lastDryRunStatus` (select, additive). `action-runs.trigger` already has `manual|automation` (`ActionRuns.ts` per Phase 1's plan) — **add `scheduled-sweep`** as a third option, additive, so the run list can filter/badge sweep-triggered dry runs distinctly from a human's "Preview" click.

**Tests:** sweep workflow triggers one dry run per fixture across N templates (activity call count assertion); a template with no fixtures is skipped with a logged reason (not silently — design's "broken paved paths must fail loudly" principle extends to "silently never re-checked" being its own failure mode); drift detection flips `lastDryRunStatus` from `ok`→`drifted` on a changed preview hash and stays `ok` on an unchanged one; a genuine dry-run failure sets `failed`, distinct from `drifted`.
**Verify:** `cd temporal-workflows && go test -race -run TestTemplateDryRunSweep ./internal/workflows/...`; manual: `temporal schedule list` (or the Temporal UI on port 8080) shows the schedule after worker startup in dev.

## 8. `EntityTypes.goldenPath.templateId` + scorecard check

### 8.1 Schema

**Edit:** `orbit-www/src/collections/catalog/EntityTypes.ts` — inside the `goldenPath` group (after `docsUrl`, `EntityTypes.ts:84-92`), add:
```ts
{
  name: 'templateDefinition',
  type: 'relationship',
  relationTo: 'template-definitions',
  admin: { description: 'The approved paved-path template that should produce entities of this kind.' },
}
```
`bun run generate:types` after.

### 8.2 Provenance on the entity

**Edit:** `temporal-workflows/internal/scaffolder/actions/catalog_entity_register.input.schema.json` and `catalog_entity_register.go` — add optional `templateDefinitionId`/`templateVersionId` string properties (additive, not required — a `catalog:entity:register` step not authored from a template composition context, or an older definition, simply omits them). When present, the Go action passes them through to the Payload internal route; **edit** the corresponding `catalog-entities` create/update path (**verify**: `grep -rn "catalog:entity:register\|sourceType" orbit-www/src/app/api/internal` to find the exact handler) to store them as new **additive** fields `sourceTemplateDefinition`/`sourceTemplateVersion` (relationships) on `catalog-entities` — do not overload the existing `sourceType`/`sourceId` pair, which already has a fixed meaning (§1's finding).

A definition author populates this automatically for free: the `catalog:entity:register` step in a template built from the `/self-service/templates/new` flow can set `templateDefinitionId: ${{ template.id }}` (the `Ctx.Template.id` value `scaffolder_workflow.go:264` already seeds into the expression context today — **no engine change needed**, only a convention the *default* generated step input should follow). Consider adding this as a default when the StepsBuilder inserts a new `catalog:entity:register` step (Phase 2 UI, small follow-up, not required for this phase's exit).

### 8.3 Scorecard check

**Verify the rule evaluator first** (§1's flagged unknown). If a `field-presence` rule can already assert "a relationship field on the entity/its EntityType is non-null and matches a specific value," express the check as data (an admin-authored `field-presence` rule targeting `sourceTemplateDefinition == entityType.goldenPath.templateDefinition`) with **no new code**. If the evaluator only supports simple non-null / threshold checks against the entity itself (not a cross-reference to its `EntityTypes` row), add a small new rule `type: 'golden-path-provenance'` (no `expression` payload needed beyond the rule existing) evaluated by a new, small function in the evaluator module comparing `entity.sourceTemplateDefinition` to `EntityTypes[entity.kind].goldenPath.templateDefinition` and additionally checking the resolved `template-definitions.status === 'published'` (an entity built from an unpublished draft should not pass, even if the ids match — the definition could since have been unpublished/deprecated).

**Tests:** entity built via a matching, published golden-path template passes; entity with no `sourceTemplateDefinition` fails; entity pointing at a *different* template than the kind's golden path fails; entity pointing at a since-deprecated golden path template fails.
**Verify:** `cd orbit-www && bunx vitest run <evaluator test path found in §8.3's verify step>`

## 9. Cross-cutting items every task shares

- **Registry export regen.** Any new action added to `DefaultActions`/`DescriptorActions` (§1) requires re-running the descriptor export and committing the regenerated `services/repository/internal/grpc/scaffolder_actions.json` in the **same commit** — CI fails otherwise (`TestScaffolderDescriptorsExport_MatchesCheckedInFile`). Add this to every task's checklist below.
- **No `action-backends.ts` changes needed.** Confirmed in §1: the authoring UI (`StepsBuilder.tsx`) is fully registry-driven off `ListActions` — a new Go action with a valid schema appears in the "Add step" picker automatically, grouped by family (`family := name-before-first-colon`, e.g. `kafka:topic:provision` groups under "kafka", `ado:*` under "ado"). `action-backends.ts` governs `Actions.backend.type` (a different, coarser concept — which *execution engine* an Action row dispatches through), not template steps; do not touch it for this phase.
- **`go:embed` schema files.** Every new action needs `.input.schema.json`/`.output.schema.json` siblings (per Phase 1's convention, `docs/plans/2026-09-09-template-authoring-phase-1-engine.md:245-247`) — a missing or malformed one fails `Registry.ValidateSchemas()` at worker startup, which is the intended fail-fast behaviour; write the schema file before the Go struct, not after.
- **Secrets discipline** (CLAUDE.md, design §8): no action in this phase accepts a raw credential in `input` — `kafka:topic:provision` and the ADO actions resolve credentials from a connection id exactly as `github:repo:create` resolves a GitHub token, never from a step input field.
- **`Plan`/dry-run for every new action.** Even the three workflow-level special cases (§3/§4/§6) must produce *some* dry-run signal (`unsupported`, explained) rather than silently vanishing from the plan — StepsBuilder's dry-run panel (`DryRunPanel.tsx`) already renders `PlannedChange[]` generically, so this is a discipline item for each task, not new UI work.
- **Worker registration.** New activities (`ScaffolderOpenApproval`, `ScaffolderResolveApproval`, `ScaffolderResolveTemplateVersion`, `TriggerTemplateDryRun`, `ListPublishedTemplatesWithFixtures`, and any Kafka/ADO client wiring) register in `temporal-workflows/cmd/worker/main.go` next to the existing `scaffolderActivities` block (~line 443). New workflows (`TemplateDryRunSweepWorkflow`) register alongside `ScaffolderWorkflow`'s own registration (**locate it** — `grep -n "ScaffolderWorkflow" temporal-workflows/cmd/worker/main.go`).

## 10. Task breakdown for parallel worktrees

Dependency shape: **A and B are fully independent of everything else and of each other** (different files, different action families) and should start immediately. **C depends on A having landed the `ActionRunClient`/Payload-client conventions it also needs** only loosely — C can start in parallel and rebase once A merges if there's file overlap in `services/payload_*_client.go`, which there shouldn't be (different files). **D depends on C** (needs the approval signal/selector pattern proven before adding a second and third special case, to avoid three people inventing three slightly different child-workflow-cancellation idioms). **E is independent** (pure data-model + scorecard, touches `orbit-www` only). **F (the `fetch:template` parent-run-linking sub-decision, §6.4) is a follow-up, not required for this phase's exit** — call it out to the lead rather than scheduling it.

| Task | Scope | Files | Depends on | Size | Test commands |
|---|---|---|---|---|---|
| **A — `kafka:topic:provision`** | §2, full | `temporal-workflows/internal/scaffolder/actions/kafka_topic_provision.{go,input.schema.json,output.schema.json,_test.go}`, `temporal-workflows/internal/services/payload_kafka_topic_client.go` (new), possibly `orbit-www/src/app/api/internal/kafka-topics/route.ts` (new, if no creation path exists), `default_actions.go`, `scaffolder_actions.json` regen | none | M | `go test -race ./internal/scaffolder/actions/... -run KafkaTopicProvision`; `go build ./cmd/worker` |
| **B — ADO publish actions** | §5, `ado:repo:create` + `ado:pr:open` full, `ado:pipeline:create` bounded | `temporal-workflows/internal/scaffolder/actions/ado_repo_create.{go,...}`, `ado_pr_open.{go,...}`, `ado_pipeline_create.{go,...}`, `temporal-workflows/internal/services/ado_write_client.go` (new), `default_actions.go`, `scaffolder_actions.json` regen | none | L | `go test -race ./internal/scaffolder/actions/... -run TestADO`; `go build ./cmd/worker` |
| **C — `approval:request`** | §3, full, including proto RPC and run-page approve/reject control | `proto/idp/template/v1/template.proto`, `services/repository/internal/grpc/template_scaffolder_server.go`, `temporal-workflows/internal/workflows/scaffolder_workflow.go` (+ new `scaffolder_approval.go`), `temporal-workflows/internal/activities/scaffolder_approval_activity.go` (new), `orbit-www/src/collections/actions/ActionRuns.ts` (step-status enum), `orbit-www/src/components/features/template-authoring/TemplateRunDetail.tsx`, a new run-page server action file | none (first to land the signal/child-workflow pattern) | L | `go test -race ./internal/workflows/... -run TestScaffolderWorkflow_Approval`; `make proto-gen && go build ./... && bunx tsc --noEmit`; `cd orbit-www && bunx vitest run` (run-detail component test) |
| **D — `agent:run` + `fetch:template`** | §4 and §6, both reuse C's child-workflow/cancellation idiom | `temporal-workflows/internal/workflows/scaffolder_workflow.go` (further special cases), `temporal-workflows/internal/activities/scaffolder_activities.go` (`ScaffolderResolveTemplateVersion`), new schema files for both actions' descriptors-only registration | **C** (needs the proven signal/child-workflow selector pattern; also touches the same `runStep` switch, so sequencing avoids a 3-way merge conflict in one function) | L | `go test -race ./internal/workflows/... -run 'TestScaffolderWorkflow_(AgentRun\|FetchTemplate)'` |
| **E — golden path + scorecard check** | §8, full | `orbit-www/src/collections/catalog/EntityTypes.ts`, `temporal-workflows/internal/scaffolder/actions/catalog_entity_register.{go,input.schema.json}`, catalog-entities internal route, scorecard evaluator (path TBD by the §8.3 verify step) | none | S–M | `bun run generate:types`; `cd orbit-www && bunx vitest run <scorecard evaluator test>`; `go test -race ./internal/scaffolder/actions/... -run CatalogEntityRegister` |
| **G — scheduled re-dry-run sweep** | §7, full | `temporal-workflows/internal/workflows/template_dry_run_sweep_workflow.go` (new), a small Payload client + activity for listing published+fixtured templates, `orbit-www/src/collections/Templates...` / `template-definitions` (`lastDryRunStatus` field), `ActionRuns.trigger` enum, `cmd/worker/main.go` schedule provisioning | none (reads `ScaffolderWorkflow` as a black box, no code changes to it) | M | `go test -race ./internal/workflows/... -run TestTemplateDryRunSweep`; manual: schedule visible in Temporal UI after `make dev` |

**Adversarial reviewer checklist (apply to every task's PR per CLAUDE.md's gate):**
- Does `scaffolder_actions.json` match a fresh regen of the export (a stale committed file is the single easiest thing to miss and the easiest to silently pass local tests if the drift test itself isn't run)?
- Does every new action's `Execute` treat a caller-input-caused failure as `scaffolder.ErrInvalidInput` (non-retryable) vs. a transient one as a plain error (retryable) — mislabeling either burns the retry budget on a broken definition, or retries something that will never succeed?
- Does any new action's output object contain a value that `redactSecrets`'s `secretKeyFragments` list won't catch (e.g. a raw PAT under a key like `pat` or `token_value` that doesn't literally contain "token")? Check every ADO/Kafka output field name against that list by hand.
- For C/D: does the selector correctly distinguish "workflow cancelled" from "signal/timer fired" in every branch, and does a cancellation during an awaiting-approval or agent-run step leave no orphaned `pending-approvals` row or non-terminated child workflow?
- For D's `fetch:template`: does the cycle-detection error message actually include the cycle path (not just "cycle detected"), and is the depth cap tested independently of the cycle check (a long acyclic chain must not be mistaken for a cycle in the test suite, and vice versa)?
- For B: is the ADO PAT ever logged, including in an error message that echoes a failed request's headers?
- For E: does the scorecard check correctly fail (not silently pass) when `sourceTemplateDefinition` is unset — a missing-field check that defaults to "pass" defeats the entire point of the gate.
- For G: does a dry run triggered by a human's "Preview" click ever get mistaken for a sweep-triggered one (the `trigger` field discipline from §7's `finish()` note) — this would corrupt `lastDryRunStatus` with a manual preview's result.
- Every task: is there a real, previously-failing-then-passing test for the change (TDD per CLAUDE.md), not just a happy-path test authored after the fact?

## 11. Risks

- **Three workflow-level special cases in one function (`runStep`)** is the phase's main structural risk — a fourth future platform step needing the same treatment should prompt extracting a small `stepHandler` interface (`canHandle(action string) bool`, `run(ctx, ...) (cancelled bool, failure string)`) rather than a fourth `if` branch; not required now, flagged for whoever does item 5 of a hypothetical Phase 5.
- **`agent:run`'s child-workflow result contract is unverified** (§4.1) — if `InfrastructureAgentWorkflow`'s result type doesn't cleanly expose an `AgentRunID`, Task D may need a small addition to that workflow (out of this phase's file list as scoped) rather than a workaround in the scaffolder side; flag early.
- **ADO write-path is entirely unverified against a real org** (§5, memory: "real-ADO smoke test with Drew's creds still open" from the discovery-parity work) — unit tests with a faked transport are necessary but not sufficient; recommend a manual smoke-test checklist item before calling Task B done, same caveat the discovery work already carries.
- **`fetch:template`'s run-linking decision (§6.4) is unresolved** — implement the simpler flattened-steps version if the lead doesn't weigh in before Task D starts, and file the separate-row version as an explicit follow-up rather than blocking.
- **Scheduled sweep's drift-detection hash is coarse** (content hash of the preview manifest) — a template whose *non-file* planned changes (a Kafka topic name, an ADO project) change without any file content changing won't be flagged as drift by this first cut; acceptable for a first version, note it in the PR.
- **Scorecard rule evaluator's actual capability is unverified** (§8.3) — this is the one item in this phase most likely to change shape (new rule type vs. existing one) once someone reads that code; sized as S–M assuming the simpler path, could grow to M–L if a new rule type and its evaluator plumbing is needed.

## 12. Open questions for the lead

1. §6.4: separate `action-runs` row per nested `fetch:template` run, or flattened steps in the outer run? (Recommendation: separate row, deferrable.)
2. §7: is a self-contained Temporal Schedule an acceptable substitute for finishing the deferred `Automations` schedule dispatcher, or does the lead want this phase to finish that system instead (materially larger scope)?
3. §5: how much ADO scope is acceptable for `ado:pipeline:create` — is the "assumes YAML already exists in the repo" bounded first cut sufficient, or does the lead want basic pipeline YAML generation included?
4. §4: is a link-out-to-the-agent-thread sufficient for `agent:run`'s UI in this phase, or is inline streaming a hard requirement now?

## 13. Lead decisions (2026-09-10, resolved before implementation)

1. **§12.1 `fetch:template` run linking: flatten.** Nested steps are recorded in the outer run's `steps[]` as `<outerStepId>.<nestedStepId>`; no `parentRun` field and no nested-run page this phase. A separate `action-runs` row per nested run is a named follow-up.
2. **§12.2 Scheduled sweep: self-contained Temporal Schedule** (§7 as written). Do not touch the deferred Automations dispatcher. Daily at 06:00 UTC is accepted; make the cron an env var (`TEMPLATE_DRY_RUN_SWEEP_CRON`, empty disables the schedule) so dev machines do not run it by default.
3. **§12.3 `ado:pipeline:create` bounded first cut accepted** (YAML must already exist in the repo). No YAML generation.
4. **§12.4 `agent:run` link-out accepted.** No inline streaming.
5. **§4 open question: yes**, `agent:run`'s `prompt` may reference `${{ steps.*.output }}` from prior steps; the test suite must cover it.
6. **Approval signal RPC ownership:** `ResolveScaffolderApproval` lives on `TemplateService` in the repository service; the orbit-www server action must check the caller can approve (workspace owner/admin, or listed in `approvers`) before calling it. The internal API key alone is never an approver.
7. **Descriptor export regen** (§9) is mandatory in every action-adding PR: `cd temporal-workflows && go run ./cmd/scaffolder-descriptors > ../services/repository/internal/grpc/scaffolder_actions.json`.
8. **Execution order:** A, B, C, E start immediately in parallel worktrees; D starts after C merges; G starts once a worktree slot frees. Phase 3 runs concurrently (its Task 1 blocks its Tasks 2, 3, 5).
