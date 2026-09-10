# In-App Template Authoring — Phase 1: Engine + Data Model

**Date:** 2026-09-09
**Parent design:** `docs/plans/2026-09-09-in-app-template-authoring-design.md` (§3.1, §3.4, §4, §5)
**Depends on:** Phase 0 (`docs/plans/2026-09-09-template-authoring-phase-0-foundation.md`) — real `fs:render` templating engine (replaces `strings.ReplaceAll`), fixed `FinalizeInstantiation` (usage count + `catalog:entity:register` semantics), in-workflow cancellation handling. Phase 1's `fs:render` action and `catalog:entity:register` action wrap those Phase 0 primitives — **do not reimplement them here**; if Phase 0 hasn't landed when a Phase 1 task needs one of these, stub the dependency behind the same interface and file a follow-up, don't fork the logic.
**Status:** Draft.

---

## 0. Scope recap

Build the v2 template engine: a definition schema (TS + Go), an expression evaluator, a Go action registry, a generic `ScaffolderWorkflow`, the Payload data model (`template-definitions`, `template-definition-versions`), `ActionRuns` extensions, `backend.type: 'scaffolder'`, gRPC dispatch wiring, and a v1→v2 migration. Existing `/templates/[slug]/use` must produce identical results through the new engine before `TemplateInstantiationWorkflow` is retired (not deleted in this phase — kept as a fallback until Phase 1's own parity check passes, then removed in a follow-up cleanup task).

## 1. Current state (verified against the repo, 2026-09-09)

| Piece | File | Notes |
|---|---|---|
| v1 instantiation workflow | `temporal-workflows/internal/workflows/template_instantiation_workflow.go` (278 lines) | Fixed 5-activity flow: validate → create-repo(-from-template) → clone → apply-vars → push → finalize. Registered in `temporal-workflows/cmd/worker/main.go:201`. |
| v1 activities | `temporal-workflows/internal/activities/template_activities.go` (403 lines) | `ValidateInstantiationInput`, `CreateRepoFromTemplate`, `CreateEmptyRepo`, `CloneTemplateRepo`, `ApplyTemplateVariables` (naive `strings.ReplaceAll`), `PushToNewRepo`, `CleanupWorkDir`, `FinalizeInstantiation` (stub, TODOs only). Registered `main.go:237-249`. |
| GitHub template client | `temporal-workflows/internal/services/github_template_client.go` (148 lines) | `CreateRepoFromTemplate`, `CreateRepository` — thin GitHub REST wrappers. Reusable as-is inside new actions. |
| gRPC surface | `services/repository/internal/grpc/template_server.go` (204 lines), `proto/idp/template/v1/template.proto` | `TemplateService`: `StartInstantiation`, `GetInstantiationProgress`, `CancelInstantiation`, `ListAvailableOrgs`. `CancelInstantiation` calls `TemporalClientInterface.CancelWorkflow` but the workflow itself has no cancellation handling (Phase 0 scope). |
| Payload `Templates` | `orbit-www/src/collections/Templates.ts` | `name`, `slug`, `visibility`/`sharedWith`, `workspace`, `gitProvider`, git-sync metadata. No versions. |
| `Actions` | `orbit-www/src/collections/actions/Actions.ts` | `ACTION_BACKEND_TYPES` (line 27): `builtin`, `webhook`, `temporal-template`, `temporal-pattern`, `temporal-launch`, `kafka-provision`, `agent`. `backend` group: `{ type, ref }`. |
| Backend metadata (client-safe) | `orbit-www/src/components/features/actions/action-backends.ts` | `BACKEND_TYPE_META` + compile-time exhaustiveness guard (`_exhaustive`) against `Action['backend']['type']` — **must be updated in lockstep with the collection** or the build fails. |
| Dispatch (deferred) | `orbit-www/src/lib/actions/run.ts` | `executeRun()` dispatches `builtin`/`webhook` in-process; `DEFERRED_BACKENDS` set (line ~57) short-circuits `temporal-*`/`kafka-provision`/`agent` to a no-op `pending` log line. This is where `'scaffolder'` dispatch gets wired. |
| Run status writeback | `orbit-www/src/app/api/internal/action-runs/[id]/status/route.ts` | `POST`, `X-API-Key` auth via `validateInternalApiKey`. Body: `{status?, appendLogs?, outputs?, error?, workflowId?, entity?}`. Logs append-only. This is the contract the Go worker writes back through — extend, don't replace. |
| `ActionRuns` collection | `orbit-www/src/collections/actions/ActionRuns.ts` | `action`, `workspace`, `entity`, `inputs`, `status` (`pending`/`awaiting-approval`/`running`/`succeeded`/`failed`), `workflowId`, `logs` (json array), `outputs`, `error`, `triggeredBy`, `trigger`, `sourceAutomation`. `access.update: () => false` — runner uses `overrideAccess: true` exclusively. |
| Access factories | `orbit-www/src/lib/access/collection-access.ts` | `workspaceScopedRead`, `memberCreate`, `manageCreate`, `docWorkspaceMutate` — all key off `user.betterAuthId`, never `user.id`. `adminOnly` for platform-only rows. Every new collection in this phase must use these. |
| Versioned-collection precedent | `orbit-www/src/collections/Patterns.ts` + `PatternVersions.ts` | Parent row holds `currentVersion` pointer; version rows are immutable snapshots with `versionNumber`, `source`/`editedBy`, full field snapshot, `{ fields: ['parent','versionNumber'], unique: true }` index. Both collections are **read-open, write-closed to humans** (`create/update/delete: () => false`) — mutated only via `overrideAccess` from an internal route. `template-definition-versions` follows this shape. |
| Go↔Payload client precedent | `temporal-workflows/internal/services/payload_pattern_instance_client.go`, `internal/activities/agent/pattern_instance_activity.go` | A narrow `XClient` interface consumed by the activity struct (mockable in tests), backed by a concrete `PayloadXClient` (`baseURL`, `apiKey`, `http.Client`) hitting `/api/internal/...` with `X-API-Key`. Mirror this exactly for `TemplateDefinitionClient` / `ActionRunClient`. |
| MinIO/S3 in Go | `temporal-workflows/internal/clients/storage_client.go` (`NewStorageClient`, `minio-go/v7`, already in `go.mod`) | Constructed once in `main.go:395-411`, passed by reference into activity structs (nil-checked — storage is best-effort in `main.go`; see §6.3). |
| Proto codegen | `make proto-gen` → `cd orbit-www && bun run generate:proto` | Go output → `proto/gen/go/`, TS output → `orbit-www/src/lib/proto/`. |

## 2. Data model — Payload

### 2.1 `template-definitions` (new) — `orbit-www/src/collections/TemplateDefinitions.ts`

Modeled on `Patterns.ts` (versioned catalog row) but workspace-scoped like `Templates.ts` (visibility tiers), not platform-global.

Fields:
- `name` (text, required), `slug` (text, required, unique, `^[a-z0-9-]+$` validate — copy `Templates.ts`'s validator)
- `title`, `description` (textarea)
- `workspace` (relationship → `workspaces`, required, index)
- `owner` (relationship → `teams` if that collection exists, else text — **verify**: `grep -l "slug: 'teams'" orbit-www/src/collections/*.ts` before deciding)
- `targetKind` (text — catalog entity kind this produces, e.g. `service`)
- `visibility` (select: `workspace`/`shared`/`public`, default `workspace`) + `sharedWith` (relationship, hasMany, `condition: visibility === 'shared'`) — copy `Templates.ts` pattern verbatim
- `status` (select: `draft`/`published`/`deprecated`, default `draft`, index)
- `currentVersion` (relationship → `template-definition-versions`, readOnly — a pointer to the version row, not an ordinal)
- `sourceMode` (select: `orbit`/`git`, default `orbit`)
- `gitSource` (group: `repoUrl`, `manifestPath`, `lastSyncedAt`, `syncStatus` — moved from `Templates.ts`'s git-sync fields; only populated when `sourceMode: git`)
- `migratedFrom` (relationship → `templates`, readOnly — set by the §7.2 reconciler; its presence is the idempotency key)
- `fixtures` (array: `{ name: text, values: json }` — named sample inputs for one-click dry run, design §3.2)
- `usageCount` (number, default 0, readOnly), `lastDryRunAt` (date, readOnly)
- `createdBy` (relationship → `users`, readOnly)

Indexes: `{ fields: ['slug'], unique: true }`, `{ fields: ['workspace', 'status'] }`, `{ fields: ['workspace', 'visibility'] }`.

Access: `workspaceScopedRead()` from `collection-access.ts` filters by membership only and does NOT know about `visibility`/`sharedWith`. Write a bespoke `read` access fn mirroring `Templates.ts`'s exactly (keeps parity with the collection it replaces); note extending `workspaceScopedRead` with a visibility-aware mode as a follow-up if the pattern repeats a third time. `create: memberCreate()`; `update`/`delete: docWorkspaceMutate('template-definitions', ['owner','admin'])` per design §3.7.

### 2.2 `template-definition-versions` (new) — `orbit-www/src/collections/TemplateDefinitionVersions.ts`

Direct mirror of `PatternVersions.ts`:
- `definition` (relationship → `template-definitions`, required, index)
- `workspace` (relationship → `workspaces`, denormalized from the parent at write time so `workspaceScopedRead()` works without a custom resolver)
- `versionNumber` (number, required); index `{ fields: ['definition','versionNumber'], unique: true }`
- `definitionJson` (json, required — the full v2 document per design §3.1)
- `editedBy` (relationship → `users`, readOnly)
- `changeNote` (textarea)
- `validatedAt` (date, readOnly — set when static validation last passed)
- `dryRunRunId` (relationship → `action-runs`, readOnly — the successful dry run that satisfied the publish gate)

Access: `read: workspaceScopedRead()`; `create/update/delete: () => false` — versions are written exclusively by the helpers in §2.4 using `overrideAccess: true`.

### 2.3 `action-runs` extension — edit `orbit-www/src/collections/actions/ActionRuns.ts`

Add fields (additive, no migration needed):
- `templateVersion` (relationship → `template-definition-versions`, index)
- `dryRun` (checkbox, default `false`)
- `steps` (array: `{ id: text, name: text, status: select[pending/running/succeeded/failed/skipped], startedAt: date, finishedAt: date, logTail: textarea, output: json }`)
- `plan` (json, readOnly — the `PlannedChange[]` from a dry run, or `null`)
- `artifactsPrefix` (text, readOnly — MinIO key prefix, e.g. `scaffolder-runs/{runId}/`)
- add `cancelled` to the `status` select options

Extend the status route (`route.ts`) to accept `steps` and `plan` in the POST body alongside the existing fields — same append-only-for-logs, replace-for-everything-else semantics (Task 1.4).

### 2.4 Versioning helpers — `orbit-www/src/lib/scaffolder/versions.ts` (new)

Since `template-definition-versions` is write-closed to humans, authoring goes through server actions that role-check in application code and then write with `overrideAccess: true` (Phase 2 wires the UI). This phase stands up the helpers and their tests:
- `createDraftVersion(payload, { definitionId, definitionJson, userId, changeNote })` — next `versionNumber`, denormalizes `workspace`, updates parent `currentVersion` only if the parent is still `draft`.
- `publishVersion(payload, { definitionId, versionId, userId })` — enforces the publish gate: `validatedAt` set AND `dryRunRunId` points at a `succeeded` dry run for that version; sets parent `status: published`, `currentVersion`.
- `deprecateDefinition(...)`.
Integration test calls these directly against a test Payload instance.

## 3. Definition schema + validation

### 3.1 TypeScript (Zod) — `orbit-www/src/lib/scaffolder/schema.ts` (new)

```ts
TemplateDefinitionSchema = z.object({
  apiVersion: z.literal('orbit/v2'),
  kind: z.literal('Template'),
  metadata: z.object({
    name: z.string().regex(/^[a-z][a-z0-9-]*$/),
    title: z.string(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    owner: z.string(),
    targetKind: z.string().optional(),
  }),
  spec: z.object({
    parameters: z.array(ParameterPageSchema),   // { title, required?, properties: Record<string, JsonSchemaProperty> }
    steps: z.array(StepSchema),                  // { id, name, action, input, if?, continueOnError?, timeout? }
    output: OutputSchema.optional(),             // { links?: [{ title, url? , entity? }], text?: string }
  }),
})
```

`ParameterPageSchema.properties` values use `.passthrough()` so new `ui:` keys (design §3.3) don't require a schema change. `StepSchema`: `id` regex `^[a-z][a-z0-9-]*$`, `action: string`, `input: record(unknown)`, `if?: string`, `continueOnError?: boolean`, `timeout?: string` (Go duration, e.g. `"5m"`).

### 3.2 Static validator — `orbit-www/src/lib/scaffolder/validate.ts` (new)

`validateDefinition(def, registry: ActionDescriptor[]): { ok, errors[] }`, pure and synchronous (server-side publish gate now; client-side live feedback in Phase 2). Collect all errors, don't fail fast:
1. Unique step ids.
2. Every `${{ steps.X.output.Y }}`: `X` must be an **earlier** step (steps run in array order; no forward/self refs; DAG execution out of scope), `Y` must be a key in that action's `OutputSchema.properties`. `${{ parameters.X }}` must exist on some page. `user.*`, `workspace.*`, `template.*`, `run.id` are opaque well-known namespaces, allowed unconditionally.
3. Each step's `action` exists in the registry.
4. Each step's `input` literal (non-expression) fields validate against the action's `InputSchema` via `ajv` (already a dependency in `orbit-www/package.json`).

Go port: `temporal-workflows/internal/scaffolder/validate.go`, same four checks, run by the workflow before executing (belt-and-suspenders for force-written or migrated definitions).

### 3.3 Go structs — `temporal-workflows/internal/scaffolder/types.go` (new package `scaffolder`)

```go
type Definition struct {
    APIVersion string   `json:"apiVersion"`
    Kind       string   `json:"kind"`
    Metadata   Metadata `json:"metadata"`
    Spec       Spec     `json:"spec"`
}
type Spec struct {
    Parameters []ParameterPage `json:"parameters"`
    Steps      []Step          `json:"steps"`
    Output     *Output         `json:"output,omitempty"`
}
type Step struct {
    ID              string          `json:"id"`
    Name            string          `json:"name"`
    Action          string          `json:"action"`
    Input           json.RawMessage `json:"input"`
    If              string          `json:"if,omitempty"`
    ContinueOnError bool            `json:"continueOnError,omitempty"`
    Timeout         string          `json:"timeout,omitempty"`
}
```
`Input` stays `json.RawMessage`; each action unmarshals into its own typed struct after expression resolution.

## 4. Expression language `${{ }}`

### 4.1 Decision: hand-written evaluator, not `expr-lang/expr`

- The grammar is tiny: dotted-path lookups into known namespaces plus a pipe filter chain. No arithmetic, boolean logic, or control flow (`if` is single-expression truthiness).
- Hand-written is side-effect-free and deterministic by construction, and avoids over-exposing Go structs through a general-purpose evaluator. Template authors are not necessarily platform-team, and `visibility: public` templates cross tenants.
- Zero new dependency. Revisit only if Phase 4's filter list grows materially.

### 4.2 Implementation — `temporal-workflows/internal/scaffolder/expr.go` (new)

```go
type Ctx struct {
    Parameters map[string]any
    Steps      map[string]StepOutput // id -> {Output map[string]any}
    User       map[string]any        // {id, email, name}
    Workspace  map[string]any        // {id, name, slug}
    Template   map[string]any        // {id, name, version}
    RunID      string
}

// Resolve walks a value (string, map, slice) and replaces every "${{ ... }}"
// in string leaves. A whole-string match preserves the resolved value's type
// (bool stays bool); a partial match stringifies.
func Resolve(ctx Ctx, v any) (any, error)

// EvalBool evaluates a step's `if` expression (whole-expression boolean context).
func EvalBool(ctx Ctx, expr string) (bool, error)
```

Grammar (regex-tokenized): `\$\{\{\s*([a-zA-Z_][\w.]*)((?:\s*\|\s*\w+(?:\([^)]*\))?)*)\s*\}\}`. Filters: `lower`, `upper`, `kebabCase`, `pascalCase`, `snakeCase`, `default(x)`, `json`. Unresolvable path → error, **not** silently empty (design §3.2: broken paved paths must fail loudly).

### 4.3 Tests — `temporal-workflows/internal/scaffolder/expr_test.go`

Table-driven: each namespace, each filter alone and chained, whole-value type preservation, partial-string stringification, missing-path error, `default()` masking a missing path, nil-safety for `steps.notrun.output.x`.

## 5. Action registry (Go)

### 5.1 Interface — `temporal-workflows/internal/scaffolder/action.go` (new)

```go
type PlannedChange struct {
    Kind        string `json:"kind"`        // "repo", "entity", "topic", "file", "pr", "unsupported"
    Name        string `json:"name"`
    Description string `json:"description"`
}

type Action interface {
    Name() string                  // e.g. "github:repo:create"
    InputSchema() json.RawMessage  // JSON Schema — static validation + Phase 2 autocomplete
    OutputSchema() json.RawMessage // its `properties` keys are what steps.x.output.Y may reference
    Execute(ctx context.Context, rc ActionRunContext, input json.RawMessage) (json.RawMessage, error)
    Plan(ctx context.Context, rc ActionRunContext, input json.RawMessage) ([]PlannedChange, error) // return ErrNoPlan if unsupported
}

type ActionRunContext struct {
    RunID, WorkspaceID, TemplateVersionID string
    DryRun bool
    // + token service, storage client, payload client handles
}

var ErrNoPlan = errors.New("action does not support dry-run planning")
```

`Execute`/`Plan` run inside Temporal activities. All actions dispatch through **one shared activity pair** (`ExecuteStep`, `PlanStep`) rather than one registered activity per action — keeps `main.go` registration flat and gives a single dispatch point. Long-running actions call `activity.RecordHeartbeat` internally.

### 5.2 Registry — `temporal-workflows/internal/scaffolder/registry.go`

```go
type Registry struct{ actions map[string]Action }
func NewRegistry(actions ...Action) *Registry
func (r *Registry) Get(name string) (Action, bool)
func (r *Registry) Descriptors() []ActionDescriptor // {Name, Family, InputSchema, OutputSchema, SupportsPlan}
```

Expose `Descriptors()` over a small gRPC RPC (`ListActions`, §8.1) so `orbit-www` can serve `listActionRegistry()` to Phase 2 and run the TS validator against the live registry.

### 5.3 Initial actions — `temporal-workflows/internal/scaffolder/actions/` (one file per action, each with a table-driven `_test.go` written first)

| Action | File | Wraps |
|---|---|---|
| `fetch:git` | `fetch_git.go` | Clone half of `CloneTemplateRepo` (`template_activities.go:203`), factored into a shared clone-only helper used by both v1 and this action. |
| `fs:render` | `fs_render.go` | Phase 0's exported render function (file/dir names + content). If Phase 0 isn't landed, stub against `ApplyTemplateVariables` behind the same signature with `// TODO(phase-0)`. |
| `github:repo:create` | `github_repo_create.go` | `GitHubTemplateClient.CreateRepository` (`github_template_client.go:104`). |
| `github:repo:create-from-template` | `github_repo_create_from_template.go` | `GitHubTemplateClient.CreateRepoFromTemplate` (`github_template_client.go:52`). |
| `git:push` | `git_push.go` | `PushToNewRepo` logic (`template_activities.go:288`), generalized to "push whatever is at `workDir`". |
| `catalog:entity:register` | `catalog_entity_register.go` | Calls the Payload catalog internal API. **Read the contract Phase 0 lands for `FinalizeInstantiation` first** and align field names so v1-compat uses the same action. |
| `debug:log` | `debug_log.go` | `slog` the input; `Execute == Plan`. Reference minimal action. |
| `http:request` | `http_request.go` | Bounded HTTP call: timeout, response-size cap, no redirects, **SSRF guard** (deny private/link-local/loopback targets — templates can be `visibility: public`). `Plan` returns `ErrNoPlan`. |

### 5.4 Schema conventions

Each action's `InputSchema`/`OutputSchema` is a sibling `.schema.json` embedded via `go:embed` (diffable, reusable by a future TS sync). Required output keys: `catalog:entity:register` → `entityId`; `github:repo:create*` → `repoUrl`, `repoName`, `checkout` (design §3.1 references these).

## 6. `ScaffolderWorkflow`

### 6.1 File — `temporal-workflows/internal/workflows/scaffolder_workflow.go` (new)

```go
type ScaffolderWorkflowInput struct {
    RunID               string
    DefinitionVersionID string
    Definition          scaffolder.Definition // resolved before Start; workflow code makes no Payload calls
    Parameters          map[string]any
    WorkspaceID         string
    UserID              string
    DryRun              bool
}
type ScaffolderWorkflowResult struct {
    Status  string // succeeded | failed | cancelled
    Outputs map[string]any
    Error   string
}
type StepProgress struct {
    ID, Name, Status string // pending|running|succeeded|failed|skipped
    Output           map[string]any
    Error            string
}
```

Behaviour:
1. Build `Ctx` seeding `Parameters`, `User`, `Workspace`, `Template`, `RunID`; `Steps` fills incrementally.
2. `SetQueryHandler("progress")` returning `[]StepProgress`.
3. For each step in order: evaluate `if` (`EvalBool`) → `skipped` if false; `Resolve` input; `ExecuteActivity(ExecuteStep | PlanStep)` with heartbeat timeout; on success store output in `Ctx.Steps` and call `WriteRunProgress` after **every** step (design §3.6 live per-step status); on failure honour `continueOnError`, else mark run `failed`, write back, return.
4. Cancellation: `workflow.NewSelector` over the activity future and `ctx.Done()`; on cancel write `status: cancelled` with an explicit message.
5. Dry run: dispatch `PlanStep`; accumulate `PlannedChange[]` into `plan`; for `fs:render`, persist the rendered tree to MinIO under `scaffolder-runs/{runId}/` for Phase 2's diff viewer. `ErrNoPlan` records `{Kind: "unsupported"}` rather than failing the dry run.
6. Resolve `spec.output` against the final `Ctx` and return it as `Outputs`.

### 6.2 Dispatch activities — `temporal-workflows/internal/activities/scaffolder_activities.go` (new)

```go
type ScaffolderActivities struct { registry *scaffolder.Registry /* + token service, storage, payload clients */ }
func (a *ScaffolderActivities) ExecuteStep(ctx, in ExecuteStepInput) (json.RawMessage, error)
func (a *ScaffolderActivities) PlanStep(ctx, in PlanStepInput) ([]scaffolder.PlannedChange, error)
func (a *ScaffolderActivities) WriteRunProgress(ctx, in WriteRunProgressInput) error // POST /api/internal/action-runs/[id]/status
```
Register in `main.go` next to the existing `templateActivities` block (~line 237).

### 6.3 MinIO wiring

Share the existing best-effort `storageClient` (`main.go:395`) but have `fs:render`'s `Plan` return an explicit error ("dry-run preview unavailable: storage offline") rather than silently skipping. Flag to ops that dry-run now depends on MinIO uptime.

## 7. v1 → v2 migration

### 7.1 Mapping — `orbit-www/src/lib/scaffolder/v1-migration.ts` (new)

Pure `mapV1TemplateToV2Definition(template, manifest)` using `lib/template-manifest.ts`'s parser:
- `spec.parameters`: one page, one JSON-Schema property per `variables[]` entry (select → `enum`; multiselect → `array` of `enum`; validation → `pattern`/`minLength`/`maxLength`/`minimum`/`maximum`).
- `spec.steps`: the five v1 steps made explicit. Branch on `isGitHubTemplate` exactly as `template_instantiation_workflow.go:159` does: `github:repo:create-from-template` (fast path) vs `github:repo:create` + `fetch:git` + `fs:render` + `git:push`. Then `catalog:entity:register` — the **one intentional behaviour addition** (v1's finalize was a stub); call it out in the PR.

### 7.2 Migration script — `orbit-www/src/scripts/migrate-templates-to-v2.ts` (new; follow `assign-super-admin.ts` / `backfill-catalog-graph.ts` conventions)

Idempotent reconciler per CLAUDE.md:
1. `--dry-run` is the default; `--apply` required to write. Prints, per `templates` row without a `template-definitions.migratedFrom` match, the v2 definition it would create.
2. `--apply`: create `template-definitions` (`sourceMode: git`, `migratedFrom`) + `template-definition-versions` v1 with `overrideAccess: true`.
3. Second run is a no-op (keyed on `migratedFrom`).
4. No downtime: additive only, `Templates` rows untouched. State this in the script header.

Test: `migrate-templates-to-v2.test.ts` with seeded fixtures asserting the dry-run diff and idempotent re-run.

## 8. Proto + gRPC

### 8.1 Extend `proto/idp/template/v1/template.proto`

Add to the existing `TemplateService`:
```protobuf
rpc StartScaffolderRun(StartScaffolderRunRequest) returns (StartScaffolderRunResponse);
rpc GetRunProgress(GetRunProgressRequest) returns (GetRunProgressResponse);
rpc CancelRun(CancelRunRequest) returns (CancelRunResponse);
rpc ListActions(ListActionsRequest) returns (ListActionsResponse); // registry descriptors for Phase 2 + TS validator
```
`StartScaffolderRunRequest`: `run_id`, `definition_version_id`, `workspace_id`, `user_id`, `parameters` as `google.protobuf.Struct` (nested/typed values; v1's `map<string,string>` won't do), `dry_run`. **Verify the TS codegen for `Struct` is ergonomic with a throwaway codegen run first**; fall back to `json_parameters: string` if not. Run `make proto-gen`; check `go build ./...` and `bunx tsc --noEmit`.

### 8.2 `services/repository/internal/grpc/template_server.go`

Add `StartScaffolderWorkflow` to `TemporalClientInterface` (`template_server.go:12-16`). `StartScaffolderRun` mirrors `StartInstantiation`'s validation block (`:60-70`); `GetRunProgress`/`CancelRun` mirror the existing progress/cancel handlers. `ListActions` needs the registry reachable from the repository service — either the worker exposes it via a tiny gRPC endpoint, or the descriptors are generated into a JSON file at build time and embedded in both binaries. **Decide during Task 7.2**; embedded JSON is simpler and keeps the repository service stateless.

## 9. Dispatch wiring — `orbit-www/src/lib/actions/run.ts`

### 9.1 `ACTION_BACKEND_TYPES`
Add `'scaffolder'` in `Actions.ts:27` **and** `action-backends.ts` (`ACTION_BACKEND_TYPES` + `BACKEND_TYPE_META`) in the same commit — the `_exhaustive` guard fails the build otherwise. `backend.ref` = `template-definitions` id.

### 9.2 `run.ts`
Leave `DEFERRED_BACKENDS` unchanged (design §4: `scaffolder` replaces `temporal-*` **over time**). Add after the `webhook` branch (~line 195):
```ts
if (backendType === 'scaffolder') {
  // 1. load template-definitions row (backend.ref) + currentVersion.definitionJson
  // 2. gRPC TemplateService.StartScaffolderRun({ runId, definitionVersionId, parameters: inputs, dryRun: run.dryRun ?? false })
  // 3. write workflowId back; leave status 'running' — the Go worker owns terminal status via the status route
}
```
Check for an existing Next.js→Go gRPC client factory first (`grep -rn "connectrpc\|createGrpcClient\|TemplateServiceClient" orbit-www/src/lib`) and reuse it.

## 10. Behaviour-preservation check

Before routing `/templates/[slug]/use` through the v2 path:
1. Pick 2–3 real `templates` rows from dev seed data.
2. Run each through the old workflow and the mapped v2 definition + `ScaffolderWorkflow` with identical inputs.
3. Diff repo contents file-by-file; the catalog entity is an expected, documented addition.
4. Capture as `orbit-www/src/scripts/verify-v1-v2-parity.ts` plus a checklist in the PR. Manual, but required for the phase exit.

## 11. Task breakdown

| # | Task | Files | Verify |
|---|---|---|---|
| 1.1 | `template-definitions` collection | `orbit-www/src/collections/TemplateDefinitions.ts` (new), register in `payload.config.ts` | access test via vitest; `bun run generate:types` |
| 1.2 | `template-definition-versions` collection | `orbit-www/src/collections/TemplateDefinitionVersions.ts` (new) | same |
| 1.3 | `action-runs` extension + `cancelled` status | `orbit-www/src/collections/actions/ActionRuns.ts` | existing tests green; `bun run generate:types` |
| 1.4 | Status route accepts `steps`/`plan` | `orbit-www/src/app/api/internal/action-runs/[id]/status/route.ts` | route test |
| 1.5 | Versioning helpers + publish gate | `orbit-www/src/lib/scaffolder/versions.ts` (new) | integration test |
| 2.1 | Zod definition schema | `orbit-www/src/lib/scaffolder/schema.ts` (new) | unit tests |
| 2.2 | TS static validator | `orbit-www/src/lib/scaffolder/validate.ts` (new) | table tests, 4 checks × pass/fail |
| 2.3 | Go types | `temporal-workflows/internal/scaffolder/types.go` (new) | `go build ./...` |
| 2.4 | Go static validator | `temporal-workflows/internal/scaffolder/validate.go` (new) | `go test -race ./internal/scaffolder/...` |
| 3.1 | Expression evaluator (TDD) | `temporal-workflows/internal/scaffolder/expr.go` + `expr_test.go` (new) | `go test -race -run TestResolve ./internal/scaffolder/...` |
| 4.1 | Action interface + registry | `.../scaffolder/action.go`, `registry.go` (new) | `go test -race ./internal/scaffolder/...` |
| 4.2 | `debug:log` | `.../scaffolder/actions/debug_log.go` + test | same |
| 4.3 | `http:request` incl. SSRF tests | `.../scaffolder/actions/http_request.go` + test | same |
| 4.4 | `github:repo:create*` | `.../scaffolder/actions/github_repo_create*.go` + tests (fake client) | same |
| 4.5 | `git:push` | `.../scaffolder/actions/git_push.go` + test | same |
| 4.6 | `fetch:git` | `.../scaffolder/actions/fetch_git.go` + test | same |
| 4.7 | `fs:render` (Phase 0 dep) | `.../scaffolder/actions/fs_render.go` + test | same; stub + TODO if Phase 0 pending |
| 4.8 | `catalog:entity:register` | `.../scaffolder/actions/catalog_entity_register.go` + test | same; align with Phase 0's contract |
| 5.1 | `ScaffolderWorkflow` + dispatch activities | `internal/workflows/scaffolder_workflow.go`, `internal/activities/scaffolder_activities.go` (new) | `go test -race -run TestScaffolderWorkflow ./internal/workflows/...` (testsuite harness per existing `*_workflow_test.go`) |
| 5.2 | Cancellation | same | cancel mid-run → `cancelled`, no orphaned activities |
| 5.3 | Dry-run plan + MinIO persistence | same | fake storage client test |
| 5.4 | Worker registration | `temporal-workflows/cmd/worker/main.go` | `go build ./cmd/worker` |
| 6.1 | Payload↔Go clients | `temporal-workflows/internal/services/payload_template_definition_client.go` (new), extend action-run client | fake HTTP server tests |
| 7.1 | Proto RPCs | `proto/idp/template/v1/template.proto` | `make proto-gen`; `go build`; `bunx tsc --noEmit` |
| 7.2 | gRPC handlers + `ListActions` source decision | `services/repository/internal/grpc/template_server.go` | `go test -race ./internal/grpc/...` |
| 8.1 | `scaffolder` backend type | `Actions.ts`, `action-backends.ts` | `bunx tsc --noEmit` |
| 8.2 | `run.ts` dispatch branch | `orbit-www/src/lib/actions/run.ts` | extend `run.test.ts` with a mocked gRPC client |
| 9.1 | v1→v2 mapping | `orbit-www/src/lib/scaffolder/v1-migration.ts` (new) | unit tests, 2–3 manifests |
| 9.2 | Migration reconciler | `orbit-www/src/scripts/migrate-templates-to-v2.ts` (new) | script test; manual `--dry-run` diff pasted into PR |
| 10.1 | Parity check | `orbit-www/src/scripts/verify-v1-v2-parity.ts` (new) | manual run, documented in PR |

## 12. Parallelisation (worktrees)

- **A — Payload data model** (1.1–1.5, 6.1): no Go dependency; cheap model.
- **B — Go engine core** (2.3–2.4, 3.1, 4.1): correctness-critical; stronger model.
- **C — Go actions** (4.2–4.8): after B's interface lands; one sub-agent per action file; cheap model. 4.7/4.8 depend on Phase 0.
- **D — `ScaffolderWorkflow`** (5.1–5.4): after B and the C actions needed for parity.
- **E — Proto + dispatch** (7.1 immediately; 7.2, 8.1, 8.2 after D).
- **F — TS schema/validator + migration** (2.1–2.2, 9.1–9.2): fully parallel with B/C/D; also unblocks Phase 2 early.
- **10.1** last, on the main line after everything merges.

If fewer than six agents are practical: {A, F}, {B}, {C}, {D + 7.1}, {rest of E + 10.1}.

## 13. Risks

- **Expression scope creep**: `if` is single-expression truthiness only in this phase; document the limit, let Phase 4 revisit.
- **`catalog:entity:register` contract drift** vs Phase 0's `FinalizeInstantiation` fix: read Phase 0's PR before finalizing 4.8.
- **`action-backends.ts` exhaustiveness guard** breaks any concurrent work touching the backend union: land 8.1 early, rebase others on it.
- **MinIO becomes a real dependency for dry runs** (§6.3): flag to ops.
- **`google.protobuf.Struct` codegen ergonomics**: verify early with a throwaway codegen.
- **Parity check (10.1) is manual and easy to skip**: required PR checklist item; it is the phase exit criterion.

## 14. Phase 0 dependencies

Blocking: real `fs:render` engine (4.7); `FinalizeInstantiation` catalog contract (4.8, 9.1). Non-blocking: v1 cancellation idiom (5.2 follows the same pattern); dead `hooks.postGeneration` removal (no interaction).
