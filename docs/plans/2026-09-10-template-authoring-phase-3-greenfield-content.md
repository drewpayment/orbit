# In-App Template Authoring — Phase 3: Greenfield Content

**Date:** 2026-09-10
**Parent design:** `docs/plans/2026-09-09-in-app-template-authoring-design.md` (§3.5, §5, §6 row "3 — Greenfield content", §7 decision 3)
**Depends on:** Phase 1 (`docs/plans/2026-09-09-template-authoring-phase-1-engine.md`) — **already merged** (`74beca7`, PR #104 and earlier): `scaffolder` package, action registry, `ScaffolderWorkflow`, gRPC `ListActions`/`StartScaffolderRun`. Phase 2 (`docs/plans/2026-09-09-template-authoring-phase-2-authoring-ui.md`) — **already merged** (PR #105, #106): `SchemaForm`, `StepsBuilder`, `TemplateEditorShell`, run wizard, run detail. Phase 3 adds new action types and two new content-source surfaces on top of both; it does not touch the engine's control flow.
**Status:** Draft.

---

## 0. Scope recap

"Create from scratch without git" (design §3.5, phasing table row 3):

1. **Orbit-hosted skeletons** — a new `template-skeletons` collection holding a small bundle of files (≤ 50 files, ≤ 1 MB total, text-only), authored in-app with a file tree + textarea-based editor, consumed by a new `fetch:orbit-skeleton` Go action.
2. **Spec-first API templates** — author picks a contract style (OpenAPI 3.1 / GraphQL SDL / proto) and a starter spec; a new `api:schema:register` Go action creates the `api-schemas` + `api-schema-versions` rows; a bounded first-cut generator step is explicitly scoped down (see §5.4) rather than reusing the dead `CodeGenActivities`.
3. **Authoring UI** for both, plus verifying the registry-driven `StepsBuilder` needs zero changes for the two new actions to appear and validate.

## 1. Current state (verified against the repo, 2026-09-10, worktree at `74beca7`)

| Piece | File | Notes |
|---|---|---|
| Action interface | `temporal-workflows/internal/scaffolder/action.go` | `Action{Name, InputSchema, OutputSchema, Execute, Plan}` + optional `PlanDeclarer`, `FamilyDeclarer`, `PlanPreviewer`. `ActionRunContext{RunID, WorkspaceID, TemplateVersionID, UserID, WorkDir, DryRun, Logger, Heartbeat}` — no storage/Payload client fields; concrete action structs hold their own collaborators (`action.go:33-51`). |
| Registry | `temporal-workflows/internal/scaffolder/registry.go` | `NewRegistry(actions...)` (panics on dup/empty name — compile-time-list invariant), `ValidateSchemas()` (called at worker startup, `main.go:436-440`, `log.Fatalf`s on a broken schema), `Descriptors()` → `ActionDescriptor{Name, Family, InputSchema, OutputSchema, SupportsPlan}`. Family = the registry key up to the first `:` unless `FamilyDeclarer` overrides it. |
| Action file shape | `temporal-workflows/internal/scaffolder/actions/*.go` | One file per action + `<name>.input.schema.json` / `<name>.output.schema.json` via `go:embed`, plus a `_test.go`. `fs_render.go` and `catalog_entity_register.go` are the two closest analogs for §3 and §4 below. |
| `fs:render` | `.../actions/fs_render.go` | `Execute` calls `templating.RenderDir(path, values, rawPatterns, logger)` in place; `Plan`/`PlanPreview` render into a **caller-owned temp/dest dir** and diff against the original, returning `[]PlannedChange{Kind:"file"}`. `requireWithinWorkDir(rc.WorkDir, in.Path)` guards path traversal — reuse this helper (`shared.go`) for `fetch:orbit-skeleton`'s destination path. |
| `fetch:git` | `.../actions/fetch_git.go` | Shape to mirror for `fetch:orbit-skeleton`: `Plan` computes and returns the destination without touching disk; `Execute` validates `rc.WorkDir` is set, resolves+validates the dest via `resolveFetchDest` (rejects absolute paths and `..` escapes), then does the I/O. Depends on an injected client interface (`TokenService`) constructed in `deps.go`, not a global. |
| `catalog:entity:register` | `.../actions/catalog_entity_register.go` + `services/payload_catalog_entity_client.go` (implied) | Calls `POST /api/internal/catalog-entities` (`orbit-www/src/app/api/internal/catalog-entities/route.ts`) via `X-API-Key`. **This is the exact pattern `api:schema:register` follows** — a new Go action + a new internal Payload route, not a reuse of an existing route (none exists for API schema creation from a service). |
| Deps wiring | `.../actions/deps.go`, `default_actions.go` | `Deps{TokenService, GitHubClient, GitHubBaseURL, CatalogClient}`; `DefaultActions(deps)` omits an action outright when its required dependency is nil (never registers a broken action) — **`fetch:orbit-skeleton` and `api:schema:register` both need a new `Deps` field** (a Payload client interface each), following this same omit-if-nil convention. `DescriptorActions()` is the *unauthenticated, nil-deps* list the repository service's descriptor export walks — new actions must be added there too, using `nil` for their client (mirrors `NewCatalogEntityRegister(nil)`). |
| Worker registration | `temporal-workflows/cmd/worker/main.go:395-462` | `storageClient` (MinIO) is already constructed here (typed-nil-safe pattern, `scaffolderStorage` copied only when non-nil) and passed into `ScaffolderActivities` for the **dry-run preview upload only** (`fs:render`'s `PlanPreview` tree). Registry construction is `scaffolder.NewRegistry(actions.DefaultActions(actions.Deps{...})...)` at line 432 — add the two new deps here. |
| MinIO client (Go) | `temporal-workflows/internal/clients/storage_client.go` | `UploadJSON`, `EnsureBucket`, `Close`. **No download/GetObject method exists yet** — needed if `fetch:orbit-skeleton` reads bundle bytes from MinIO directly; see §3.1's decision to avoid this. |
| MinIO/S3 from orbit-www | — | **Verified: none.** `grep -rl "minio\|@aws-sdk\|S3Client" orbit-www/src/` matches only `payload-types.ts` (generated types, unrelated) and `ActionRuns.ts` (a field literally named "S3"-adjacent, unrelated). No `@payloadcms/storage-s3` or `@payloadcms/storage-uploadthing` package in `orbit-www/package.json`. The `Media` collection (`orbit-www/src/collections/Media.ts`) uses Payload's default local-disk upload adapter — not wired to MinIO. **Phase 3 must not assume MinIO is reachable from orbit-www.** See §3.1. |
| API catalog collections | `orbit-www/src/collections/api-catalog/{APISchemas,APISchemaVersions}.ts` | `APISchemas`: `name`, `slug` (unique, `^[a-z0-9-]+$`), `description`, `workspace`, `visibility` (private/workspace/public), `schemaType` (openapi/asyncapi/graphql — **no `proto` option today**, see §4.1), `currentVersion` (text, not a relationship), `rawContent` (code field, language yaml), `status` (draft/published/deprecated), `deprecationMessage`, `tags`, `contact*`, `serverUrls`. Access: bespoke visibility-based `read`, `create: memberCreate()`, `update`/`delete`: creator-or-workspace-admin. **Does not use the `collection-access.ts` factories** for `update`/`delete` (bespoke fns) — Phase 3's new collections must still use the factories per CLAUDE.md; note this as an existing inconsistency, not a pattern to copy. |
| API catalog: create action | `orbit-www/src/app/(frontend)/workspaces/[slug]/apis/actions.ts` | `'use server'` `createAPISchema(input)` — the reference for how a human creates an `api-schemas` row today. `api:schema:register` (the Go action) needs its own internal-API route (`/api/internal/api-schemas`, new) rather than calling this — server actions are not callable cross-service, and this one has no `X-API-Key` gate. |
| Code generation (dead code) | `temporal-workflows/internal/activities/codegen_activities.go` | `CodeGenActivities{ValidateSchemaActivity, GenerateCodeActivity, PackageArtifactsActivity, UploadArtifactsActivity}` exists but **is registered nowhere** (`grep` for `CodeGenActivities` outside this file and its test returns nothing) and `generateGoCode`/`generateTypeScriptCode` etc. are template-string stubs, not a real code generator (no `openapi-generator`, no sandbox). **Do not reuse this for the Phase 3 generator step** — it is unfinished, unwired scaffolding from an earlier effort. See §5.4 for the bounded real scope. |
| Sandboxed execution | `temporal-workflows/internal/activities/agent/sandbox_activity.go` + `internal/agent/sandbox/` | `SandboxActivities{executor, outputSignal, logger}` wraps a `SandboxExecutor` (local-exec in dev, K8s in prod) for the HITL agent's shell tool. Has `EnsureSandbox`/`TeardownSandbox`/`SandboxedShellInput` shapes. This IS the right sandboxing primitive to reuse *if* Phase 3 ships a generator step at all — see §5.4's bounded proposal, which reuses `sandbox.SandboxExecutor` directly rather than inventing new isolation. |
| TS registry consumption | `orbit-www/src/lib/clients/template-client.ts` (`listActions()` — gRPC `ListActions`), `orbit-www/src/app/(frontend)/self-service/templates/authoring-actions.ts:334-345` (`listActionRegistry()`, 60s in-process cache, throws `RegistryUnavailableError`) | **Dynamic, not a static list or embedded JSON** — confirms the Phase 1 plan's "decide during Task 7.2" resolved to a live gRPC call, not the embedded-JSON fallback it flagged. No TS-side static list to keep in sync. |
| `StepsBuilder` registry-driven-ness | `orbit-www/src/components/features/template-authoring/StepsBuilder.tsx` | **Verified: fully generic.** `RegistryPicker` groups `registry: ActionDescriptor[]` by family (`groupRegistryByFamily`) and any action appears the moment it's in the Go registry — no per-action-name branching in this file. Each step row renders a `SchemaForm`-style field list built from the descriptor's `InputSchema` via `createFieldRegistry`. **Conclusion: `fetch:orbit-skeleton` and `api:schema:register` require zero `StepsBuilder.tsx` changes** to appear and be configurable, once registered in Go and passing `ValidateSchemas()`. |
| `ui:field` picker registry | `orbit-www/src/components/forms/schema-form/field-registry.tsx:281-301` | `OrbitTeamPicker`, `OrbitRepoPicker`, `OrbitEntityPicker`, `OrbitWorkspacePicker` are registered by name here. **No `OrbitApiSchemaPicker` or `OrbitSkeletonPicker` exists yet** — design §3.3 names `OrbitApiSchemaPicker` as a differentiator; §0 of this doc's task marks `OrbitSkeletonPicker` optional. Both are net-new field components + `registerField` calls if built (§3.3, §4.3). |
| `validate.ts` / static validator | `orbit-www/src/lib/scaffolder/validate.ts` | Validates step ids, `${{ }}` references against `OutputSchema.properties`, action-exists-in-registry, and input literals against `InputSchema` (ajv). **New actions need no validator changes** — it reads the registry generically, same as `StepsBuilder`. |
| `action-backends.ts` exhaustiveness guard | `orbit-www/src/components/features/actions/action-backends.ts:25,113` | `'scaffolder'` is already a registered `ACTION_BACKEND_TYPES` entry (Phase 1 landed this). **Phase 3 adds zero new backend types** — `fetch:orbit-skeleton` and `api:schema:register` are scaffolder *actions* (steps inside a `scaffolder`-backed template), not new Action *backends*. No `action-backends.ts` change needed. |
| Existing code editor deps | `orbit-www/package.json:41,97` | `@monaco-editor/react ^4.7.0` + `monaco-editor ^0.54.0` **already installed** (used by `YamlView.tsx`, Phase 2). Reuse directly for the skeleton file editor (§3.3) — **zero new editor dependency needed**, contrary to the task brief's suggestion to prefer a plain textarea; Monaco is already paid for and gives syntax highlighting per file extension almost for free (`language` prop keyed off the file's extension). |
| `collection-access.ts` factories | `orbit-www/src/lib/access/collection-access.ts` | `workspaceScopedRead()`, `memberCreate()`, `docWorkspaceMutate()`, `adminOnly` — required base for `template-skeletons` (§2). |
| Internal API auth pattern | `orbit-www/src/app/api/internal/catalog-entities/route.ts`, `orbit-www/src/lib/auth/internal-api-auth.ts` | `validateInternalApiKey(req)` + `X-API-Key` header, `force-dynamic`. Idempotency-by-natural-key convention (see its doc comment) — `api:schema:register`'s route should follow the same idempotent-on-retry shape (a Temporal activity retry must not double-create a schema). |
| Templating engine | `temporal-workflows/internal/templating/` (used by `fs:render`) | `RenderDir(path, values, rawPatterns, logger)` — Go `text/template`-based, `{{ }}`/`{{.KEY}}`, renames files/dirs too. `fetch:orbit-skeleton` fetches files into `WorkDir` *unrendered*; a template step composes `fetch:orbit-skeleton` → `fs:render` exactly like `fetch:git` → `fs:render` today — no new templating logic needed. |

## 2. Data model — Payload

### 2.1 `template-skeletons` (new) — `orbit-www/src/collections/TemplateSkeletons.ts`

**Decision: store file content inline in the Payload document, not in MinIO.** Rationale: orbit-www has no MinIO/S3 client today (§1), the design's caps are tiny (≤ 50 files, ≤ 1 MB total, text-only), and Payload/MongoDB comfortably holds a 1 MB document. Adding a first S3-client dependency to orbit-www for a capped-at-1MB feature is disproportionate; MinIO stays exclusively a Go-worker concern (dry-run previews). **This reverses the design doc's "bundle stored in MinIO" framing (§3.5) — flag to Drew as a deliberate scope-fit deviation**, not an oversight. If a future phase needs larger, binary, or CDN-served bundles, that is the trigger to add a storage adapter — not this one.

Fields:
- `workspace` (relationship → `workspaces`, required, index)
- `name` (text, required), `slug` (text, required, unique per workspace — validate `^[a-z0-9-]+$`, mirror `Templates.ts`'s validator)
- `description` (textarea)
- `files` (array, required, max validated in a `beforeValidate` hook, not just `admin`):
  - `path` (text, required — relative, validate no leading `/` and no `..` segment, mirroring `fetch_git.go`'s `resolveFetchDest` escape check but in TS)
  - `content` (textarea/code field — UTF-8 text; binary explicitly out of scope for v1, enforced by the hook rejecting non-UTF-8-decodable content)
  - `size` (number, readOnly, computed in the hook from `content.length`)
  - `isBinary` (checkbox, default `false`, **readOnly in v1** — always `false`; field kept for forward compat with the design doc's shape so a later phase can add real binary support without a migration)
- `version` (number, default `1`, bumped by a `beforeChange` hook on every save — skeletons are **not** versioned like `template-definition-versions`; a single mutable row is enough for v1, `version` is an optimistic-concurrency/cache-bust counter only, not a history)
- `totalSize` (number, readOnly, `beforeValidate`-computed sum of `files[].size`)
- `createdBy` (relationship → `users`, readOnly)

**`beforeValidate` hook** (`orbit-www/src/collections/hooks/validate-skeleton-bundle.ts`, new, unit-tested in isolation):
1. `files.length <= 50` else validation error.
2. `sum(files[].content.length) <= 1_000_000` (1 MB, UTF-8 byte length not JS string length — use `Buffer.byteLength`) else validation error naming the overage.
3. Every `path` is relative, non-empty, no `..` segment, no leading `/`.
4. No duplicate `path` values.
5. Sets `files[].size` and `totalSize`.

This hook is exactly the "one-click export to git" trigger point named in design §7 decision 3: when a validation error fires for size/count, the authoring UI (§3.3) catches it and offers "export as .zip" (client-side `JSZip`-free — build the zip in the browser? **flag as verify-before-implementing**: prefer a tiny server action that streams a zip via Node's built-in `zlib`/a minimal zip writer, or accept a plain multi-file download fallback (sequential `Blob` downloads) to avoid a new dependency; decide in Task 3).

Indexes: `{ fields: ['workspace', 'slug'], unique: true }`.

Access: `read: workspaceScopedRead()`, `create: memberCreate()`, `update`/`delete: docWorkspaceMutate('template-skeletons', ['owner', 'admin', 'member'])` (any active member can edit a skeleton they can see, matching the design's "any workspace member drafts" framing for content, vs. definitions which are owner/admin-gated — **confirm this asymmetry with Drew**; the conservative default if unconfirmed is to gate skeleton edits the same as template definitions, owner/admin only, since a skeleton feeds directly into what a template produces).

### 2.2 `api-schemas` extension — edit `orbit-www/src/collections/api-catalog/APISchemas.ts`

Additive only:
- Add `'proto'` to `schemaType`'s options (currently `openapi`/`asyncapi`/`graphql`; design §3.5 names OpenAPI 3.1 / GraphQL SDL / proto as the three starter contract styles — `proto` is the gap).
- Add `source` (group: `type` (select: `manual`/`scaffolder-run`, default `manual`), `sourceId` (text) — mirrors `CatalogEntities`' `source` shape (§1's `catalog-entities` route) so a schema created by `api:schema:register` is traceable back to its run, matching the idempotency key that route already uses for entities.

No new collection: `api-schemas` + `api-schema-versions` already have everything else `api:schema:register` needs (`rawContent`, `currentVersion`, `visibility`, `workspace`).

## 3. `fetch:orbit-skeleton` action (Go)

### 3.1 Files — `temporal-workflows/internal/scaffolder/actions/fetch_orbit_skeleton.go` (+ `.input.schema.json`, `.output.schema.json`, `_test.go`)

```go
type FetchOrbitSkeleton struct {
    client SkeletonClient // new interface, deps.go
}

type fetchOrbitSkeletonInput struct {
    SkeletonID string `json:"skeletonId"`
    Path       string `json:"path,omitempty"` // dest under WorkDir; default derived from skeleton slug
}
type fetchOrbitSkeletonOutput struct {
    Path  string   `json:"path"`
    Files []string `json:"files"` // relative paths written, for the dry-run diff and for callers that want a manifest
}
```

- `Plan`: fetches skeleton **metadata only** (no file writes) via `client.GetSkeletonManifest(ctx, id)` (new, lighter than a full fetch — returns `{files: [{path, size}], totalSize}`) and returns one `PlannedChange{Kind:"fetch", Name: skeleton.Name}` plus, if `FetchOrbitSkeleton` implements `PlanPreviewer` (it should, to feed the file-tree diff viewer like `fs:render` does), writes the fetched-but-unrendered files into the caller-owned `destDir` so the *composed* plan (fetch → fs:render) shows the real end state. Mirror `fs_render.go`'s `PlanPreview(ctx, rc, input, destDir)` signature exactly.
- `Execute`: validates `rc.WorkDir` is set (same guard as `fetch_git.go`), resolves the destination the same way `resolveFetchDest` does (reuse that helper from `fetch_git.go` — move it to `shared.go` if not already there, since both actions need it now), fetches the full bundle via `client.GetSkeletonBundle(ctx, id)`, writes each file with `os.MkdirAll` + `os.WriteFile`, applying the same path-escape check per-file that the collection's `beforeValidate` hook applies server-side (defense in depth — the Payload data could theoretically be edited around the hook via a script).
- **Reuses `requireWithinWorkDir`/path-join helpers from `shared.go` and `fetch_git.go`** — do not reimplement path safety a third time.

### 3.2 `SkeletonClient` — `temporal-workflows/internal/scaffolder/actions/deps.go` (extend) + `temporal-workflows/internal/services/payload_skeleton_client.go` (new)

```go
type SkeletonClient interface {
    GetSkeletonManifest(ctx context.Context, skeletonID string) (SkeletonManifest, error)
    GetSkeletonBundle(ctx context.Context, skeletonID string) (SkeletonBundle, error)
}
```

Concrete `PayloadSkeletonClient` mirrors `PayloadCatalogEntityClient`/`PayloadActionRunClient`'s shape exactly (`baseURL`, `apiKey`, `http.Client`, hits `/api/internal/template-skeletons/[id]` with `X-API-Key`). **New route**: `orbit-www/src/app/api/internal/template-skeletons/[id]/route.ts` — `GET`, `X-API-Key` auth, returns the full `files[]` (bundle) or a `?manifest=1` query flag for the lighter manifest-only response used by `Plan`. RBAC: internal-API-key-gated only (same as `catalog-entities`), no user session — the run's own workspace scoping already happened when the definition was authored/published.

### 3.3 Add to `Deps`, `DefaultActions`, `DescriptorActions`

- `deps.go`: add `SkeletonClient SkeletonClient` field, doc comment matching `CatalogClient`'s "omitted from DefaultActions when nil" convention.
- `default_actions.go`: `if deps.SkeletonClient != nil { out = append(out, NewFetchOrbitSkeleton(deps.SkeletonClient)) }`; add `NewFetchOrbitSkeleton(nil)` to `DescriptorActions()`.
- `main.go:432`: add `SkeletonClient: services.NewPayloadSkeletonClient(orbitAPIURL, orbitInternalAPIKey, logger)` to the `Deps{}` literal.

### 3.4 Authoring UI — `orbit-www/src/app/(frontend)/self-service/templates/skeletons/**` (new)

- `page.tsx` — Server Component list, RBAC via the same `canManageTemplateDefinitions`-style check (reuse `lib/templates/authz.ts`, do not fork a parallel authz module for one collection).
- `new/page.tsx` + `[id]/edit/page.tsx` — Server Component shells, RBAC + 404-not-redirect (Phase 2's pattern).
- `SkeletonEditorShell.tsx` (new, `orbit-www/src/components/features/template-authoring/`) — client component: a file tree (add/rename/delete file, list only — no folders-as-first-class-objects, a `path` with `/` segments renders as a tree via a pure `buildFileTree(files)` helper, unit-tested) + a Monaco editor pane (`@monaco-editor/react`, already installed — §1) keyed to the selected file, `language` inferred from the extension (small `languageForPath(path)` helper, unit-tested: `.yaml`→yaml, `.json`→json, `.md`→markdown, `Dockerfile`→dockerfile, default→plaintext). `{{ }}`-aware means: no special parsing, just a visible hint/legend that `{{ .key }}` and the filter set (design §3.4/§4.2's filter list, reused verbatim — these are the *definition-level* `${{ }}` filters? **no** — `fs:render`'s file-content substitution uses single-brace `{{ }}` Go `text/template`, a different layer than the definition's `${{ }}` expressions; the skeleton editor's hint text must say `{{ .key }}` / bare `{{KEY}}`, not `${{ }}`, to avoid authors confusing the two delimiters (design §4 calls this out explicitly as a deliberate two-layer split) — get this right in the UI copy, it is a real point of confusion risk.
- Save button calls a `'use server'` action (`saveSkeleton`) that round-trips through the `beforeValidate` hook (§2.1); a client-side pre-check (file count/size) disables Save with a tooltip before the round trip, same "client warns, server is the real gate" convention as the publish-gate button in Phase 2.
- Export-to-zip / oversize handling: see §2.1's open item.
- **`OrbitSkeletonPicker` ui:field is optional per the task brief** — recommend building it (it's small: a `Select`/`Command` over `listSkeletonsForPicker(workspaceId)`, same shape as the four existing Orbit pickers) since without it, an author configuring a `fetch:orbit-skeleton` step must hand-type a skeleton id into a plain text input, which is a materially worse experience for a two-hour add. Scope it as Task 5 (optional, cuttable).

## 4. `api:schema:register` action (Go) + spec-first authoring UI

### 4.1 Files — `temporal-workflows/internal/scaffolder/actions/api_schema_register.go` (+ schemas, test)

```go
type apiSchemaRegisterInput struct {
    WorkspaceID string `json:"workspaceId"`
    Name        string `json:"name"`
    SchemaType  string `json:"schemaType"` // openapi | graphql | proto
    Content     string `json:"content"`    // the starter spec text
    Visibility  string `json:"visibility"` // private | workspace | public, default workspace
}
type apiSchemaRegisterOutput struct {
    SchemaID  string `json:"schemaId"`
    VersionID string `json:"versionId"`
    Slug      string `json:"slug"`
}
```

`Plan`: `PlannedChange{Kind:"entity", Name: in.Name, Description: "register API schema ..."}` — no I/O, mirrors `catalog_entity_register.go`'s `Plan` exactly (same shape, don't diverge).
`Execute`: `POST /api/internal/api-schemas` (new route, §4.2) with `X-API-Key`, idempotent on `(workspaceId, slug)` — same idempotency convention as `/api/internal/catalog-entities`.

Add `'proto'` handling: the action itself does no format-specific validation (that's `ValidateSchemaActivity`'s job in the dead `codegen_activities.go`, which this plan deliberately does not resurrect wholesale — see §5.4) — it stores `content` as-is and lets `APISchemas.schemaType` record the format. Format-specific *syntax* validation is out of scope for this action; note as a follow-up if authors hit this gap in practice.

### 4.2 New route — `orbit-www/src/app/api/internal/api-schemas/route.ts`

`POST`, `X-API-Key`, mirrors `catalog-entities/route.ts`'s doc-comment style and idempotency contract. Body: `{workspaceId, name, schemaType, content, visibility?, source: {type: 'scaffolder-run', sourceId: runId}}`. On success: creates `api-schemas` (via `createAPISchema`-equivalent logic, but server-side/internal — **do not import the `'use server'` action directly**, Next.js server actions are not meant to be called from a route handler this way; instead extract the shared creation logic `createApiSchemaInternal(payload, input)` into a plain function both the server action and this route call, or accept minor duplication if extraction is awkward — verify Payload's local API usage pattern in `createAPISchema` first) and `api-schema-versions` v1 row (`versionNumber: 1`, `contentHash` per `APISchemaVersions.ts`'s existing hook, `rawContent: content`). Response: `201 {schemaId, versionId, slug}`.

### 4.3 Authoring UI

- `StepsBuilder.tsx` needs **no changes** (§1) — once `api:schema:register`'s `InputSchema` includes a `schemaType` enum (`openapi`/`graphql`/`proto`) and a `content` field with `ui:widget: textarea` (or `ui:field: OrbitApiSchemaPicker`... no, this action *creates* a schema, it does not pick an existing one — no picker needed here), the step form renders generically.
- A **starter-spec picker** is a nice-to-have, not required: three canned starter texts (minimal OpenAPI 3.1 doc, minimal GraphQL SDL, minimal `.proto`) the author can insert as `content`'s default via the field's JSON-Schema `default` — set directly on the Go action's `InputSchema` per `schemaType` **is not expressible in plain JSON Schema** (default can't be conditional on a sibling field) — so this needs either (a) a small client-side "insert starter" button next to the textarea (`ui:field: OrbitSpecStarterEditor`, new, wraps a plain `Textarea` + 3 buttons that set canned content) or (b) skip it for v1 and let authors paste their own spec. **Recommend (b) for v1** — the generator step (§5.4) is the harder/valuable part; a starter-picker is cosmetic sugar, cut it if the phase needs to shrink.
- `OrbitApiSchemaPicker` (design §3.3, for a *different* purpose — referencing an existing schema from a parameter, e.g. "which API does this service implement") is **out of scope for Phase 3's `api:schema:register` step** (that action creates, not references) but is cheap to add alongside since the field-registry pattern is established (`field-registry.tsx:293-300`) — list it as an optional Task 6 if time allows, not required for the phase's core deliverable.

### 4.4 Generator step — bounded first cut

**Do not build a general sandboxed `openapi-generator` wrapper in this phase.** Reasoning:
- `codegen_activities.go` is unwired dead code with stub generators (§1) — resurrecting it properly is itself multi-day work (real `openapi-generator` needs a JVM or a prebuilt binary image, sandbox image build, output size/timeout bounds).
- The design doc itself says "optionally a generator step" — it is explicitly optional.

**Bounded v1 proposal**: a new action `openapi:client-stub:go` (single language, single format, deliberately narrow) that runs entirely **without a sandbox**, using a pure-Go OpenAPI-to-struct generator library already vetted for the ecosystem (verify before implementing: check `go.sum`/`go.mod` across `temporal-workflows` and `services/*` for any existing `oapi-codegen`/`deepmap` or similar dependency — none found in this investigation, so this is a **new Go dependency** to weigh against "prefer minimal new dependencies"). Given that cost, the pragmatic v1 recommendation is:

**Ship §3 and §4.1-4.3 in this phase; scope the generator step out entirely as a named follow-up** (`api:codegen:*` action family, tracked as a Phase 3.5/4 item), and say so explicitly in the phase's PR description. This keeps the phase's Go dependency surface at zero and its Temporal/sandbox surface at zero, while still delivering both "create from scratch without git" flows: a skeleton-authored repo, and a spec-first API entity. A template author can already compose `api:schema:register` → `fetch:orbit-skeleton` (a skeleton containing a server stub the author wrote once) → `fs:render` to get generated-feeling output without a real generator, which covers the design's core Backstage-parity intent (a starter spec + a starter repo) without the sandboxed-generator risk.

## 5. Task breakdown for parallel worktrees

| # | Task | Files touched | Depends on | Test commands | Adversarial review focus |
|---|---|---|---|---|---|
| **1** | `template-skeletons` collection + validation hook + internal fetch route | `orbit-www/src/collections/TemplateSkeletons.ts` (new), `orbit-www/src/collections/hooks/validate-skeleton-bundle.ts` (new, +test), `orbit-www/src/app/api/internal/template-skeletons/[id]/route.ts` (new, +test), register in `payload.config.ts` | none | `bunx vitest run src/collections/hooks/validate-skeleton-bundle.test.ts src/app/api/internal/template-skeletons` + `bun run generate:types` | (a) size/count caps enforced server-side, not just `admin`-hint; (b) path traversal (`..`, absolute, duplicate) rejected in the hook, not just in the Go action — two independent layers per §3.1; (c) `X-API-Key` actually checked before any DB read, not after; (d) `docWorkspaceMutate` args match the resolved RBAC decision in §2.1 (owner/admin vs. any member — **flag if left unresolved**). Size: **M**. |
| **2** | `fetch:orbit-skeleton` Go action + `SkeletonClient` | `temporal-workflows/internal/scaffolder/actions/fetch_orbit_skeleton.go` (+schemas+test), `temporal-workflows/internal/scaffolder/actions/deps.go` (extend), `temporal-workflows/internal/scaffolder/actions/default_actions.go` (extend), `temporal-workflows/internal/services/payload_skeleton_client.go` (new, +test with fake HTTP server), `temporal-workflows/cmd/worker/main.go` (wire `Deps.SkeletonClient`) | Task 1 (route contract; can build against a stub client and integrate last) | `go test -race ./internal/scaffolder/... ./internal/services/...` then `go build ./cmd/worker` | (a) path-escape check applied per-file on `Execute`, not just trusted from the manifest; (b) `Plan`/`PlanPreview` never writes outside the caller-owned `destDir`; (c) action omitted (not panicking) from `DefaultActions` when `SkeletonClient` is nil, and present with `nil` in `DescriptorActions`; (d) `ValidateSchemas()` still passes at worker startup with the new action registered. Size: **M**. |
| **3** | Skeleton authoring UI | `orbit-www/src/app/(frontend)/self-service/templates/skeletons/{page,new/page,[id]/edit/page}.tsx` (new), `orbit-www/src/components/features/template-authoring/SkeletonEditorShell.tsx` (+test), `.../skeleton-file-tree.ts` (pure `buildFileTree` helper, +test), `.../skeleton-editor-lang.ts` (`languageForPath`, +test), `orbit-www/src/app/(frontend)/self-service/templates/skeletons/authoring-actions.ts` (new, `'use server'`: `listSkeletons`, `createSkeleton`, `saveSkeleton`, `deleteSkeleton`) | Task 1 (collection + hook) | `bunx vitest run src/components/features/template-authoring/skeleton-*.test.ts src/components/features/template-authoring/SkeletonEditorShell.test.tsx` + agent-browser walkthrough (create skeleton, add 3 files, hit the 50-file/1MB cap, confirm the export/error UX) | (a) client-side cap pre-check never becomes the only gate — server hook is authoritative; (b) RBAC gate present on every server action (mirror Task 7's authz pattern from Phase 2, do not invent a new authz module); (c) Monaco `language` inference has a safe default for unknown extensions (no crash); (d) the `{{ }}` vs `${{ }}` delimiter hint copy is correct (§3.4) — a wrong hint actively misleads authors. Size: **L** (UI-heavy, agent-browser required). |
| **4** | `api:schema:register` Go action + internal route + `api-schemas` extension | `temporal-workflows/internal/scaffolder/actions/api_schema_register.go` (+schemas+test), `deps.go`/`default_actions.go` (extend), `temporal-workflows/internal/services/payload_api_schema_client.go` (new, +test), `temporal-workflows/cmd/worker/main.go` (wire), `orbit-www/src/app/api/internal/api-schemas/route.ts` (new, +test), `orbit-www/src/collections/api-catalog/APISchemas.ts` (add `proto` option + `source` group), `bun run generate:types` | none (fully parallel with 1-3) | `go test -race ./internal/scaffolder/... ./internal/services/...`; `bunx vitest run src/app/api/internal/api-schemas` | (a) idempotency on retry — a Temporal activity retry of `api:schema:register` must not create a duplicate schema/version (check the route's dedupe key exactly, e.g. `(workspace, slug)` or `(source.type, source.sourceId)`); (b) `contentHash` computed identically to `APISchemaVersions.ts`'s existing hook (don't diverge the hashing logic — import/reuse it, don't reimplement); (c) `schemaType: 'proto'` doesn't break any existing `schemaType`-switch in the API catalog UI (grep for exhaustive switches over `schemaType` before merging) — this is this task's own "exhaustiveness guard" risk, analogous to `action-backends.ts` in Phase 1. Size: **M**. |
| **5** *(optional, cut first if the phase needs to shrink)* | `OrbitSkeletonPicker` ui:field | `orbit-www/src/components/forms/schema-form/fields/OrbitSkeletonPicker.tsx` (+test), `field-registry.tsx` (register), `orbit-www/src/app/(frontend)/self-service/templates/picker-data-actions.ts` (extend: `listSkeletonsForPicker(workspaceId)`) | Task 1 (needs the collection + an RBAC-scoped list action) | `bunx vitest run src/components/forms/schema-form/fields/OrbitSkeletonPicker.test.tsx` | RBAC scoping of `listSkeletonsForPicker` — must not leak another workspace's skeleton names (same class of check as Phase 2 Task 20's picker item). Size: **S**. |

Suggested worktree grouping for 3-5 agents: `{1}` alone first (blocking), then `{2, 4}` in parallel once 1 lands (2 depends on 1's route contract; 4 is fully independent), then `{3}` after 1 and in parallel with 2/4 (3 only needs the collection + hook, not the Go action, to build the editor UI against server actions — the `fetch:orbit-skeleton` step itself is exercised end-to-end only once 2 and 3 both land), `{5}` last and optional. If only 3 agents are available: `{1}`, `{2+4 sequentially by one agent}`, `{3}`, skip `5`.

## 6. Risks

1. **MinIO-vs-inline-storage deviation from the design doc (§2.1).** A real decision point, not a detail — flag explicitly in the PR description and get Drew's sign-off before or immediately after Task 1 merges; reverting to MinIO later means a data migration.
2. **Skeleton edit RBAC (owner/admin vs. any member) is unresolved** (§2.1) — pick the conservative default (owner/admin, matching template definitions) if not answered before Task 1 starts, and note it as a one-line follow-up to loosen later; do not block on it.
3. **Generator step is scoped out** (§4.4) — this is a real, deliberate scope cut vs. the design doc's "optionally a generator step" language. It satisfies "optionally" literally, but confirm this reading is acceptable before the phase is called done, since it's the one place this plan diverges most from the spirit of "spec-first templates."
4. **Zip/export-on-oversize UX (§2.1, §3.4) is unspecified beyond "flag before implementing."** Task 3's agent should treat this as an open design question to resolve with the smallest viable option (sequential per-file downloads) rather than pulling in a zip-writing dependency, unless told otherwise.
5. **`api-schemas.schemaType` gaining `'proto'`** could break any existing exhaustive switch over that field elsewhere in the API catalog UI (design doc predates this addition) — Task 4's reviewer must grep for this before merging, not assume it's additive-safe by default the way most Payload field changes are.

## 7. Lead decisions (2026-09-10, resolved before implementation)

1. **Storage: inline in the Payload document (§2.1) — accepted.** MinIO stays a Go-worker concern. The 1 MB / 50-file / text-only caps make a Mongo document the right home; revisit only if binary or >1 MB bundles are ever needed. Deviates from design §3.5 on mechanism, not on capability — flagged to Drew.
2. **Skeleton edit RBAC: owner/admin only**, i.e. `docWorkspaceMutate('template-skeletons', ['owner', 'admin'])`, matching template definitions. Read stays `workspaceScopedRead()`.
3. **Generator step (§4.4): scoped out of Phase 3.** Tracked as a follow-up action family `api:codegen:*`; Phase 3 ships `api:schema:register` only. The PR description must say so.
4. **Oversize UX (§2.1 item, §3.4):** the client pre-check disables Save with a message that names the cap and suggests moving the bundle to git (`fetch:git`). A "Download bundle" button is in scope **only if** a zip library is already in `orbit-www/package.json`; otherwise skip it — no new dependency for this.
5. **Cross-tenant guard on the internal route (§3.2):** `GET /api/internal/template-skeletons/[id]` MUST require a `workspaceId` query param and return 404 when it does not match the skeleton's workspace. The Go action passes `rc.WorkspaceID`. The internal API key alone must never be sufficient to read another workspace's bundle. Same rule for `POST /api/internal/api-schemas`: `workspaceId` in the body must equal the run's workspace (the action passes `rc.WorkspaceID`, the input schema must NOT expose `workspaceId` to template authors).
6. **Task 5 (`OrbitSkeletonPicker`) is in scope**, not optional — hand-typing a Mongo id into a step is not acceptable UX for the flagship "create from scratch" path.
7. **Task 4 must add `ui:widget: textarea`** (or the equivalent already used by the schema-form for multi-line strings — verify the key `SchemaForm` honours) on `content`, and its reviewer must grep for exhaustive `schemaType` switches before merging.
