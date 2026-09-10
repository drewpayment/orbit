# In-App Template Authoring — Phase 0: Foundation Fixes

**Date:** 2026-09-09
**Parent design:** `docs/plans/2026-09-09-in-app-template-authoring-design.md` (§4, §6 Phase 0)
**Status:** Ready for implementation
**Depends on:** nothing (Phase 0 is the base of the phasing chain)
**Blocks:** Phase 1 (`ScaffolderWorkflow`'s `fs:render` action reuses the templating engine built here; `catalog:entity:register` reuses the finalize contract)

## 0. Scope recap

| Item | Current state (verified) | Fix |
|---|---|---|
| (a) Templating engine | `strings.ReplaceAll("{{key}}")` on file **contents only**, no file/dir renaming, no conditionals | Real `text/template` + curated filter set, renders contents **and** names, keeps `{{ }}` delimiters, defines opt-out + parse-failure behaviour |
| (b) `FinalizeInstantiation` | Stub at `temporal-workflows/internal/activities/template_activities.go:376-392` — three `// TODO` comments, no-op | Increments `Templates.usageCount`, creates a `CatalogEntity` with `source.type: 'template'` |
| (c) Cancellation | `CancelInstantiation` RPC forwards to Temporal `CancelWorkflow`, but `TemplateInstantiationWorkflow` has no cancellation handling — no cleanup, no `cancelled` result | Workflow catches cancellation, runs cleanup on a disconnected context, returns a `cancelled` result |
| (d) Dead code / doc drift | `hooks.postGeneration` parsed but never executed (`orbit-www/src/lib/template-manifest.ts`); `orbit-docs/content/docs/features/templates.mdx` overstates capabilities | Remove the dead field; correct the docs |

## 1. Decisions (made here, not deferred)

1. **Engine location:** new package `temporal-workflows/internal/templating/` (not inlined in `template_activities.go`). Phase 1's `fs:render` action reuses it directly.
2. **Bare-token compatibility:** existing v1 skeletons use `{{SERVICE_NAME}}` (no leading `.`), which is not valid Go `text/template` syntax. A preprocessing pass rewrites `{{ KEY }}` → `{{.KEY}}` only when `KEY` exactly matches one of the instantiation's variable keys. Anything else (`{{ .Values.foo }}`, `{{- if .Foo }}`, `{{ range }}`, `{{ include "x" . }}`) is untouched and reaches the Go template parser as-is.
3. **Raw-file opt-out:** optional `rawFiles: string[]` (glob patterns, `filepath.Match` semantics — single-segment globs, no `**`) in the existing v1 manifest (`orbit-template.yaml`), not a separate ignore file. `gopkg.in/yaml.v3` is already a direct dependency.
4. **Per-file template-parse failures are not fatal.** A file that fails to parse/execute is left unchanged, logged, and recorded in a new `SkippedFiles []string` result field. Only genuine I/O errors fail the activity.
5. **File/dir renaming order:** collect all paths via one `filepath.WalkDir` pass, then rename in reverse pre-order (a valid bottom-up order without a second walk).
6. **`FinalizeInstantiation` → Payload:** follows `payload_pattern_instance_client.go` exactly (`X-API-Key`, `ORBIT_INTERNAL_API_KEY`). New route `POST /api/internal/templates/[id]/finalize`.
7. **Catalog entity shape:** `kind: 'service'`, `source: { type: 'template', sourceId: templateId }`, `owner` unset (no team field on `Templates`; Phase 1 concern).
8. **`usageCount` increment is read-then-write**, not atomic — no `$inc` precedent in this codebase.
9. **Cancellation cleanup is best-effort and scoped to the work directory** — no repo-deletion-on-cancel in Phase 0.
10. **No Sprig.** Hand-rolled `FuncMap` avoids `env`/`expandenv`-class functions in user-authored content and a large transitive dependency.

## 2. Tasks

### Task 0.1 — Templating engine package (Go)

**New files:**
- `temporal-workflows/internal/templating/engine.go`
- `temporal-workflows/internal/templating/engine_test.go`
- `temporal-workflows/internal/templating/funcs.go`
- `temporal-workflows/internal/templating/funcs_test.go`

**`funcs.go`** — hand-rolled `template.FuncMap`: `lower`, `upper`, `title`, `trim`, `trimPrefix`, `trimSuffix`, `replace`, `default`, `quote`, `kebabCase`, `snakeCase`, `pascalCase`, `camelCase`, `contains`, `hasPrefix`, `hasSuffix`, `join`, `split`, `indent`, `nindent`, `toJson`.

**`engine.go`** exports:
```go
// Render substitutes vars into content. Bare {{KEY}} tokens are rewritten to
// {{.KEY}} first (only for KEY present in vars); everything else is passed to
// text/template unmodified, so Helm-style {{ .Values.x }} / {{- if }} /
// {{ range }} constructs are preserved for files not marked raw.
func Render(content string, vars map[string]string) (out string, err error)

// RenderName applies the same rules to a single path segment (file or dir base name).
func RenderName(name string, vars map[string]string) (out string, err error)
```

Implementation notes:
- Preprocessing regex: `\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}` — the capture must be an exact key in `vars` (map lookup after the regex match) before rewriting to `{{.KEY}}`.
- `template.New(...).Option("missingkey=error").Funcs(FuncMap()).Parse(content)` then `Execute` into a `bytes.Buffer` with `vars` (`map[string]string`) as the dot-context.
- `Parse` and `Execute` errors are returned as a single `error`; the caller decides fatal vs skippable. Keep the engine dumb.

**TDD — write `engine_test.go` first, confirm it fails (package doesn't exist), then implement.** Table-driven (`testify/assert`, `-race`):
1. Legacy bare token: `{{SERVICE_NAME}}` with `SERVICE_NAME=orders` → `orders`.
2. Legacy token with internal whitespace: `{{ SERVICE_NAME }}` → same.
3. Filter pipe: `{{SERVICE_NAME | pascalCase}}` is **not** rewritten (has a `|`); raw Go-template authors write `{{.SERVICE_NAME | pascalCase}}` → `Orders`. Document this as the authoring pattern.
4. Go-template control flow untouched: `{{- if .Values.foo }}bar{{- end }}` with no `Values` in vars → parses, but `Execute` with `missingkey=error` returns a non-nil error. This is the "Helm chart, not marked raw" case Task 0.2's `SkippedFiles` depends on.
5. Unknown variable `{{.TYPO}}` → non-nil error.
6. `RenderName("{{SERVICE_NAME}}-service", vars)` → `orders-service`.
7. `RenderName` on a name with no template syntax → unchanged, nil error.
8. `funcs_test.go`: one assertion per function (`kebabCase("MyService") == "my-service"`, `pascalCase("my-service") == "MyService"`, `default("", "fallback") == "fallback"`, …).

**Verification:**
```bash
cd temporal-workflows && go test -v -race ./internal/templating/...
```

---

### Task 0.2 — Rewire `ApplyTemplateVariables` + raw-file opt-out (Go)

**Files:**
- `temporal-workflows/internal/activities/template_activities.go` (rewrite `ApplyTemplateVariables`, lines 250-312 today)
- `temporal-workflows/internal/activities/template_activities_test.go` (new tests — none exist for this function today)
- `temporal-workflows/internal/workflows/template_instantiation_workflow.go` (mirror the new activity input/output types — the workflow package duplicates the activity structs by hand; they must stay field-for-field identical since Temporal's JSON data converter serializes by field name)
- `temporal-workflows/internal/workflows/template_instantiation_workflow_test.go` (update `stubApplyTemplateVariables` signature)

**Depends on:** Task 0.1.

**Behaviour change:**
```go
type ApplyTemplateVariablesActivityInput struct {
    WorkDir   string
    Variables map[string]string
}

// NEW — was previously just `error`
type ApplyTemplateVariablesResult struct {
    SkippedFiles []string // paths that failed to parse/execute as a template; left unmodified
}

func (a *TemplateActivities) ApplyTemplateVariables(ctx context.Context, input ApplyTemplateVariablesActivityInput) (*ApplyTemplateVariablesResult, error)
```

Steps:
1. Best-effort read `orbit-template.yaml` / `.yml` at `input.WorkDir` root; parse just `rawFiles []string`. Parse failure or missing file ⇒ empty list, no error.
2. Pass 1 (content, top-down walk): skip binary (existing null-byte heuristic) or `rawFiles`-matched files (`filepath.Match(pattern, relPath)`); otherwise `templating.Render`. On error: append to `skipped`, log a warning, leave content untouched. Do not return early.
3. Pass 2 (rename): iterate the collected path list in reverse, `templating.RenderName` on each base name (skip root, skip raw-matched), `os.Rename` if changed. Errors: same skip-and-log.
4. Return `&ApplyTemplateVariablesResult{SkippedFiles: skipped}, nil`; only real I/O failures return a non-nil `error`.
5. Keep the existing early return when `len(Variables) == 0` (no tokens can match; add a comment).

**TDD — write cases first, confirm each fails against the current implementation, then implement.** Table-driven with `t.TempDir()`:
1. `TestApplyTemplateVariables_ContentSubstitution`
2. `TestApplyTemplateVariables_FileNameSubstitution` — `{{SERVICE_NAME}}.go` → `orders.go`, content also substituted. **The regression test for item (a).**
3. `TestApplyTemplateVariables_DirNameSubstitution` — `src/{{SERVICE_NAME}}/main.go` → `src/orders/main.go`; `os.Stat` new path exists, old doesn't.
4. `TestApplyTemplateVariables_BinaryFileSkipsContentNotName` — `{{SERVICE_NAME}}.png` with a null byte: renamed, bytes identical.
5. `TestApplyTemplateVariables_RawFilesOptOut` — `rawFiles: ["charts/*.yaml"]` (single-segment; document the `**` limitation in a code comment) keeps literal `{{ .Release.Name }}` untouched.
6. `TestApplyTemplateVariables_ParseFailureIsNonFatal` — unresolvable `{{ .Values.foo }}` with no `rawFiles` entry → nil error, content unchanged, path in `SkippedFiles`.
7. `TestApplyTemplateVariables_NoVariables` — empty map → no-op, no error.

**Verification:**
```bash
cd temporal-workflows && go test -v -race ./internal/activities/... -run TestApplyTemplateVariables
cd temporal-workflows && go build ./...
```

---

### Task 0.3 — Manifest: add `rawFiles`, remove `hooks.postGeneration` (TS)

**Files:**
- `orbit-www/src/lib/template-manifest.ts`
- `orbit-www/src/lib/template-manifest.test.ts`

**Independent of the Go tasks** (Go reads `orbit-template.yaml` directly; this module governs the in-app manifest validator).

**TDD:**
1. Remove the `postGeneration` test block (`hooks:\n  postGeneration:` fixture and `manifest?.hooks?.postGeneration` assertions); confirm the rest of the suite passes.
2. Add a failing test: `parseManifest` accepts `rawFiles: ['charts/*.yaml']` and returns it on `TemplateManifest.rawFiles`; a non-array `rawFiles` is a validation error (`rawFiles must be an array of glob strings`). Confirm it fails.
3. Implement: remove `TemplateHook`/`hooks` from the interface, `parseManifest`, and `generateManifestYaml`; add `rawFiles?: string[]` with array-of-strings validation (same style as the `categories` check). Don't add UI for `rawFiles` here (Phase 2/3 scope).

No other `.ts`/`.tsx` file references `postGeneration` (verified by repo-wide grep).

**Verification:**
```bash
cd orbit-www && bunx vitest run src/lib/template-manifest.test.ts
cd orbit-www && bunx tsc --noEmit
```

---

### Task 0.4 — `CatalogEntities`: add `template` to `source.type` (TS)

**File:** `orbit-www/src/collections/catalog/CatalogEntities.ts`

Add `{ label: 'Template', value: 'template' }` to the `source.type` select alongside the existing `manual`/`apps`/`api-schemas`/`kafka`/`sync`/`scan` options.

**Verification:** covered by Task 0.5's route test (`create` with `source.type: 'template'` must not 400).

---

### Task 0.5 — New internal route: `POST /api/internal/templates/[id]/finalize` (TS)

**New files:**
- `orbit-www/src/app/api/internal/templates/[id]/finalize/route.ts`
- `orbit-www/src/app/api/internal/templates/[id]/finalize/route.test.ts`

**Depends on:** Task 0.4.

Modeled on `orbit-www/src/app/api/internal/pattern-instances/route.ts` and `orbit-www/src/app/api/internal/patterns/[id]/route.ts` (`validateInternalApiKey`, `overrideAccess: true`, `force-dynamic`).

**Contract:**
```
POST /api/internal/templates/{id}/finalize
Headers: X-API-Key: <ORBIT_INTERNAL_API_KEY>
Body: { workspaceId: string, repoUrl: string, repoName: string, userId?: string }
200: { catalogEntityId: string, usageCount: number }
404: { error: 'template not found' }
400: { error: '<field> required' }
401: invalid key
```

Behaviour:
1. Validate `X-API-Key`.
2. Validate required body fields.
3. `payload.findByID({ collection: 'templates', id, overrideAccess: true })` — 404 if not found.
4. `payload.update` `usageCount: (template.usageCount ?? 0) + 1` (Decision 8).
5. `payload.create` on `catalog-entities`: `{ name: repoName, slug: kebabCase(repoName), kind: 'service', workspace: workspaceId, source: { type: 'template', sourceId: id }, links: [{ label: 'Repository', url: repoUrl, type: 'repository' }] }`.
6. Return `{ catalogEntityId, usageCount }`.

**TDD — write `route.test.ts` first (every case starts red):**
1. Missing/invalid `X-API-Key` → 401.
2. Missing `workspaceId`/`repoUrl`/`repoName` → 400 with field name.
3. Unknown template id → 404.
4. Happy path: `usageCount` N → N+1, `catalog-entities` row created with `source.type === 'template'` and `source.sourceId === templateId`, response has `catalogEntityId`.
5. Idempotency is **not** claimed: two calls create two entities. Comment that Temporal activity retries could double-call (Risk 4).

Follow the Payload test-harness pattern in `orbit-www/src/app/api/internal/discovery/ingest/route.test.ts` or `orbit-www/src/app/api/internal/scorecards/due/route.test.ts`.

**Verification:**
```bash
cd orbit-www && bunx vitest run "src/app/api/internal/templates/\[id\]/finalize/route.test.ts"
```

---

### Task 0.6 — Go Payload client + real `FinalizeInstantiation` activity

**New file:** `temporal-workflows/internal/services/payload_template_client.go`
**Files:**
- `temporal-workflows/internal/activities/template_activities.go` (`FinalizeInstantiation`, `TemplateActivities` struct, `NewTemplateActivities`)
- `temporal-workflows/internal/activities/template_activities_test.go`

**Depends on:** Task 0.5's contract (develop in parallel against the documented contract; unit tests mock the client interface, as `payload_pattern_instance_client.go`'s consumers do).

**`payload_template_client.go`** (mirrors `payload_pattern_instance_client.go`):
```go
type FinalizeInstantiationInput struct {
    WorkspaceID string `json:"workspaceId"`
    RepoURL     string `json:"repoUrl"`
    RepoName    string `json:"repoName"`
    UserID      string `json:"userId,omitempty"`
}
type FinalizeInstantiationResult struct {
    CatalogEntityID string `json:"catalogEntityId"`
    UsageCount      int    `json:"usageCount"`
}
type PayloadTemplateClient struct { baseURL, apiKey string; httpClient *http.Client; logger *slog.Logger }
func NewPayloadTemplateClient(baseURL, apiKey string, logger *slog.Logger) *PayloadTemplateClient
func (c *PayloadTemplateClient) FinalizeInstantiation(ctx context.Context, templateID string, in FinalizeInstantiationInput) (*FinalizeInstantiationResult, error)
```
POST `{baseURL}/api/internal/templates/{templateID}/finalize`; 404 → typed `ErrTemplateNotFound`, other non-2xx → wrapped error.

**`TemplateActivities` changes:**
```go
type PayloadTemplateClient interface {
    FinalizeInstantiation(ctx context.Context, templateID string, in services.FinalizeInstantiationInput) (*services.FinalizeInstantiationResult, error)
}
type TemplateActivities struct {
    tokenService  TokenService
    payloadClient PayloadTemplateClient // NEW
    workDir       string
    logger        *slog.Logger
}
func NewTemplateActivities(tokenService TokenService, payloadClient PayloadTemplateClient, workDir string, logger *slog.Logger) *TemplateActivities
```
Signature change: update `cmd/worker/main.go` and existing test call sites (`NewTemplateActivities(nil, nil, "/tmp/work", nil)`).

`FinalizeInstantiation` body replaces the TODOs with a call to `payloadClient.FinalizeInstantiation(...)`, wrapping errors (`failed to finalize instantiation: %w`). Notification-sending stays out of scope.

**TDD:**
1. `TestFinalizeInstantiation_Success` — mock client (testify `mock.Mock`, same style as `MockTokenService`) asserts templateID + input fields; activity returns nil.
2. `TestFinalizeInstantiation_ClientError` — mock returns error; activity wraps and returns it.
3. Confirm both fail against the stub, then implement.

**Verification:**
```bash
cd temporal-workflows && go test -v -race ./internal/activities/... -run TestFinalizeInstantiation
cd temporal-workflows && go vet ./...
```

---

### Task 0.7 — Wire the new client into the worker (Go)

**File:** `temporal-workflows/cmd/worker/main.go`

Construct the client next to the existing `patternInstanceClient` (~line 563) and pass it to `NewTemplateActivities` (~line 237):
```go
templateClient := services.NewPayloadTemplateClient(orbitAPIURL, orbitInternalAPIKey, logger)
templateActivities := activities.NewTemplateActivities(tokenService, templateClient, templateWorkDir, logger)
```

**Verification:**
```bash
cd temporal-workflows && go build ./cmd/worker/...
```
Wiring is exercised by `tests/integration/template_instantiation_test.go` (build-tagged `integration`, needs live Temporal).

---

### Task 0.8 — Workflow cancellation handling (Go)

**Files:**
- `temporal-workflows/internal/workflows/template_instantiation_workflow.go`
- `temporal-workflows/internal/workflows/template_instantiation_workflow_test.go`

**Independent of Tasks 0.1–0.7.**

**Gap (confirmed):** no cancellation branch in the workflow. `services/repository/internal/grpc/template_server.go`'s `CancelInstantiation` already forwards to Temporal `CancelWorkflow` (covered by `TestCancelInstantiation_Success`); no server-side change needed. Today a cancelled activity error is treated as a generic failure: `Status: "failed"`, no cleanup.

**Fix**, following the repo idiom (`temporal.IsCanceledError`, see `internal/workflows/infrastructure_agent_workflow.go:681`):
1. Document `TemplateInstantiationResult.Status` values: `completed` / `failed` / `cancelled`. `template_server.go`'s `parseWorkflowStatus("cancelled")` already maps to `WORKFLOW_STATUS_CANCELLED`.
2. After each mid-flow `ExecuteActivity(...).Get(ctx, ...)` (clone, apply-variables, push), check `temporal.IsCanceledError(err)` before the generic path. On cancellation:
   - `cleanupCtx, cancel := workflow.NewDisconnectedContext(ctx); defer cancel()` then `workflow.WithActivityOptions(cleanupCtx, activityOptions)`. A disconnected context is **required**: the original `ctx` is already cancelled, so cleanup on it would never run.
   - Run `ActivityCleanupWorkDir` on `cleanupCtx` if a `workDir` exists (best-effort; log cleanup errors).
   - Return `&TemplateInstantiationResult{Status: "cancelled", Error: "instantiation cancelled"}, nil` — a clean typed result, not the canceled error, so pollers of `GetInstantiationProgress` can distinguish it from infra failure.
3. Decision 9: no GitHub repo deletion on cancel.

**TDD — extend the workflow test first:**
1. `TestTemplateInstantiation_CancelDuringClone` — use `env.RegisterDelayedCallback(..., env.CancelWorkflow())` (pattern in `internal/workflows/spec_sync_workflow_test.go`) or cancel from a mocked activity's `.Run(...)`. Assert `env.IsWorkflowCompleted()`, `env.GetWorkflowError() == nil`, result `Status == "cancelled"`, and `ActivityCleanupWorkDir` ran.
2. `TestTemplateInstantiation_CancelBeforeAnyActivity` — result `cancelled`, no panic on nil `workDir`.
3. Confirm both fail against current code, then implement.

**Verification:**
```bash
cd temporal-workflows && go test -v -race ./internal/workflows/... -run TestTemplateInstantiation
```

---

### Task 0.9 — Docs corrections

**File:** `orbit-docs/content/docs/features/templates.mdx` (56 lines; read in full before editing)

1. *"File and directory names"* under "Variable Substitution" — currently false, **becomes true** with Task 0.2. Don't merge 0.9 ahead of 0.2.
2. *"Set up branch protection, CI/CD, and integrations"* (step 4 of "How Templates Work") — **stays false.** The only post-render step is `git push`. Rewrite to: clone → substitute (content + names) → push. Do not describe post-generation hooks (design §8 non-goal).
3. *"tracked as an Application with lineage back to the template"* — wrong collection and, before Task 0.6, wrong entirely. After 0.6: tracked as a **catalog entity** with `source.type: template` pointing back to the originating template.

**Verification:** manual read-through.

---

### Task 0.10 — End-to-end tie-together (integration test)

**Depends on:** Tasks 0.2, 0.5, 0.6, 0.7, 0.8 merged.

Extend `temporal-workflows/tests/integration/template_instantiation_test.go` (build-tagged `integration`, existing skip pattern) with a case against a running Temporal **and** a running `orbit-www` dev server, asserting:
- A file/dir is renamed by the new engine.
- `SkippedFiles` is populated when a raw-file-eligible template file is present without a `rawFiles` entry.
- `Status: "completed"`, and `Templates.usageCount` / the `catalog-entities` row are visible via a direct Payload query afterwards.

Final sign-off pass, run manually; does not block merging 0.1–0.9:
```bash
cd temporal-workflows && go test -tags=integration -v ./tests/integration/... -run TestTemplateInstantiationWorkflow_Integration
```
Plus a manual instantiation through the "Use Template" UI (`UseTemplateForm`) to confirm renamed files and a new row in `/catalog` (agent-browser per CLAUDE.md: pre-flight `pgrep`, verify, post-flight cleanup).

## 3. Parallelisation

```
Worktree A (Go engine):        0.1 → 0.2
Worktree B (Payload/TS):       0.3, 0.4 → 0.5   (0.3/0.4 independent, both trivial)
Worktree C (Go finalize):      0.6 (mocked against 0.5's contract) → 0.7
Worktree D (Go cancellation):  0.8 — fully independent, no shared files
Docs:                          0.9 — after 0.2 and 0.6 land
Final:                         0.10 — after A–D merge
```

Four subagents in separate worktrees on the cheaper model (mechanical, well-specified work); reserve deeper reasoning for the adversarial review gate on each PR:
- **Agent 1:** 0.1 + 0.2
- **Agent 2:** 0.3 + 0.4 + 0.5
- **Agent 3:** 0.6 + 0.7 (start immediately against the documented contract; rebase once Agent 2 lands)
- **Agent 4:** 0.8

## 4. Risks

1. **Bare-token preprocessing could misfire** if a variable key collides with a Go template keyword (`if`, `else`, `end`, `range`, `with`, `template`, `define`, `block`). Document as an authoring constraint; no runtime guard in Phase 0.
2. **No `**` glob support for `rawFiles`.** Deeply nested Helm charts need one pattern per directory level. Flag a gitignore-style matcher as a Phase 1 candidate if it bites.
3. **Existing templates with unintentional `{{ }}`**: the old `strings.ReplaceAll` only replaced exact `{{key}}` matches for known keys, so unrelated `{{ }}` content already passed through untouched. The new engine's parse-failure path converges to the same "untouched" outcome, now with a logged warning and a `SkippedFiles` entry. **No output regression**, only new visibility.
4. **`FinalizeInstantiation` is not idempotent under Temporal retry** (`MaximumAttempts: 3`): a lost response could double-increment `usageCount` and create a second catalog entity. Pre-existing class of risk for every activity in this workflow. Follow-up: thread the workflow run id as an idempotency key into the route.
5. **`usageCount` race** (Decision 8). Low risk at current traffic.
6. **Cancellation doesn't remove an already-created GitHub repo** (Decision 9). Orphaned empty repo possible if cancelled between create and push. Follow-up ticket; strictly better than today's "cancel does nothing and mislabels the result as failed".

## 5. Non-goals (reaffirmed from design §8)

- No revival of `hooks.postGeneration` or any arbitrary shell execution during instantiation.
- No repo-deletion-on-cancel, no notification system in `FinalizeInstantiation`.
- No `template-definitions`/versioning/dry-run — Phase 1.
