# In-App Template Authoring ("Paved Paths") — Design Brainstorm

**Date:** 2026-09-09
**Status:** Decisions accepted 2026-09-09 (see §7). Per-phase plans: `2026-09-09-template-authoring-phase-0-foundation.md`, `-phase-1-engine.md`, `-phase-2-authoring-ui.md`.
**Inspiration:** Spotify Portal Scaffolder (form fields → actions → extensions; draft → dry run → publish; run with live logs + outputs). Backstage's underlying model: `parameters` (JSON Schema) + `steps` (typed actions with `${{ }}` expressions) + `output`.
**Related:** `2026-06-27-idp-refocus-recommendations.md` (Pillar 3: Self-Service Actions + Action Runs), `2026-07-01-entity-scores-and-golden-paths.md` (EntityTypes.goldenPath), `2026-06-09-product-focus-strategy.md` (templates: "keep — polish only" — this doc proposes revisiting that call, see §7).

---

## 1. Where we are today (survey, 2026-09-09)

| Piece | State |
|---|---|
| `Templates` collection | Metadata + git `repoUrl` + read-only `variables` parsed from `orbit-template.yaml`. No versions, no in-app editing. |
| Manifest (`lib/template-manifest.ts`) | `variables[]` (string/number/boolean/select/multiselect + validation), `hooks.postGeneration` (declared, **never executed**). |
| Instantiation (`temporal-workflows/.../template_instantiation_workflow.go`) | Fixed 5-step Go workflow: validate → create repo → clone → substitute → push. GitHub only. |
| Templating engine | Naive `strings.ReplaceAll("{{key}}")` on file contents only. No conditionals, no file/dir renaming (docs claim otherwise). |
| `FinalizeInstantiation` | Stub with TODOs: no usage count, no notification, **no catalog entity**. |
| `Actions` / `ActionRuns` | Exist. `inputSchema` (JSON Schema) + `backend.type` (`temporal-template`, `temporal-pattern`, `temporal-launch`, `kafka-provision`, `agent`, `webhook`, `builtin`) + `approvalPolicy`. Temporal-backed types are **deferred/not wired** (`lib/actions/run.ts`). No `ActionDispatchWorkflow` in Go yet. |
| `Patterns` / `PatternVersions` / `PatternInstances` | Closest thing to a versioned, JSON-Schema-driven, instantiable recipe. Good model to copy. |
| Schema-driven forms | Three bespoke ones (`UseTemplateForm`, Actions `inputSchema`, Patterns `inputSchemaJson`). No shared JSON-Schema form component. |
| Non-GitHub providers | Schema-only. `GitConnections` (ADO PAT) is wired for discovery, not templates. |

**Conclusion:** Orbit has the *nouns* (Actions, ActionRuns, Templates, catalog, API schemas, connections, Bifrost, agent) but no *verb engine* — no step DSL, no real renderer, no dry run, no versioning, no authoring surface.

## 2. The key reframe

Drew's instinct is right: we should not try to make people author a 200-file service skeleton in a browser. Git is the right home for skeleton *files*. But that is not what a Scaffolder template *is*. A Backstage template is a small YAML document: a form, a list of steps, and outputs. The skeleton files are merely one input to one step (`fetch:template`). Portal's in-app editor edits *that document*, not the skeleton.

So the split is:

1. **Template Definition** — form + steps + outputs. Small, structured, versionable. **Authored entirely in Orbit.** This is the thing that is greenfield-creatable today with zero git involvement.
2. **Content Sources** — where a `fetch` step gets files from. Pluggable:
   - existing git repo (what we have today; GitHub template repos stay the fast path),
   - a **GitHub template repo** used as-is (no rendering),
   - an **Orbit-hosted skeleton**: a small bundle (a handful of files) authored in-app or uploaded, stored in MinIO,
   - **generated content**: an OpenAPI/GraphQL/proto spec → server/client stubs,
   - **another published template** (composition).

This means the most valuable greenfield templates need **no files at all**. Examples that are pure orchestration:

- "New backend service": create repo from org's GitHub template → register catalog entity (kind `service`, owner = requesting team) → provision a governed Kafka topic via Bifrost → create ADO pipeline → post a link in Slack.
- "New API": pick contract style → create `APISchema` entity with a starter spec → create repo with spec + CI lint job → register `api` entity with `provides-api` relation.
- "Onboard an existing repo": fetch nothing, register the entity, apply scorecard, open a PR adding `catalog-info` + CODEOWNERS.

These are the paved paths a platform team actually wants, and they are the ones Orbit is uniquely positioned for because Bifrost and the HITL agent become **steps**, not separate products (which is exactly the Pillar 3 recommendation).

## 3. Concepts and controls for template authors

### 3.1 Template Definition (the document)

Proposed shape (serializable to `orbit-template.yaml` v2 for round-tripping to git):

```yaml
apiVersion: orbit/v2
kind: Template
metadata:
  name: backend-service
  title: New Backend Service
  description: Go service on the paved road, with Kafka + catalog registration
  tags: [go, service, kafka]
  owner: team:platform          # who maintains the template
  targetKind: service           # catalog kind this produces (drives goldenPath linkage)
spec:
  parameters:                   # ordered form pages, each a JSON Schema
    - title: Service
      required: [name, owner]
      properties:
        name:  { type: string, pattern: '^[a-z][a-z0-9-]{2,40}$', ui:help: 'kebab-case' }
        owner: { type: string, ui:field: OrbitTeamPicker }
    - title: Messaging
      properties:
        needsTopic: { type: boolean, default: true }
        topicName:  { type: string, ui:visibleIf: '${{ parameters.needsTopic }}' }
  steps:
    - id: repo
      name: Create repository
      action: github:repo:create-from-template
      input:
        connection: ${{ workspace.connections.github }}
        template: my-org/go-service-template
        name: ${{ parameters.name }}
    - id: render
      action: fs:render
      input:
        source: ${{ steps.repo.output.checkout }}
        values: { serviceName: ${{ parameters.name | pascalCase }} }
    - id: push
      action: git:push
      input: { repo: ${{ steps.repo.output.repoUrl }}, path: ${{ steps.render.output.path }} }
    - id: topic
      if: ${{ parameters.needsTopic }}
      action: kafka:topic:provision
      input: { name: ${{ parameters.topicName }}, owner: ${{ parameters.owner }} }
    - id: catalog
      action: catalog:entity:register
      input:
        kind: service
        name: ${{ parameters.name }}
        owner: ${{ parameters.owner }}
        source: { type: template, sourceId: ${{ template.id }} }
        links: [{ title: Repo, url: ${{ steps.repo.output.repoUrl }} }]
  output:
    links:
      - title: Repository
        url: ${{ steps.repo.output.repoUrl }}
      - title: Catalog entry
        entity: ${{ steps.catalog.output.entityId }}
```

### 3.2 Lifecycle and versioning

- **Status:** `draft` → `published` → `deprecated` (Portal: draft / publish). Drafts are only visible to authors.
- **Versions are immutable snapshots** (copy `PatternVersions`): `template-definition-versions` with `versionNumber`, `definitionJson`, `editedBy`, `changeNote`. A `currentVersion` pointer on the parent. Runs record which version they used.
- **Publish gate:** a version cannot be published until (a) static validation passes and (b) at least one saved **dry run** against it succeeded. This is the single most important control — it stops broken paved paths from reaching engineers.
- **Fixtures:** authors can save named sample inputs ("golden inputs") on the template. One-click dry run and, later, a scheduled automation that re-dry-runs published templates so upstream skeleton drift is caught.
- **Export / import parity:** any definition can be downloaded as `orbit-template.yaml` v2 and re-imported; a git-backed template's definition can be "detached" into an Orbit-managed copy. The existing v1 manifest maps mechanically to v2 (variables → one parameters page; the fixed 5 steps → explicit steps).

### 3.3 The form (parameters)

- JSON Schema per page, with an `ui:` vocabulary: `ui:field` (custom pickers), `ui:help`, `ui:visibleIf`, `ui:widget`, `ui:order`. This mirrors Backstage/RJSF, which matters because most platform engineers already know it.
- **Orbit-native field extensions** are the differentiator: `OrbitTeamPicker`, `OrbitWorkspacePicker`, `OrbitEntityPicker(kind)`, `OrbitRepoPicker(connection)`, `OrbitKafkaClusterPicker`, `OrbitApiSchemaPicker`. These give validated, RBAC-filtered choices instead of free text.
- **Form builder UI:** Portal's "Append field" model. A visual list of fields (type, label, help, required, default, validation, visibility rule) with a **live form preview** beside it, plus a **YAML/JSON view** that is two-way synced. Recommend form-first with YAML as an escape hatch, not YAML-first.
- Introduce **one shared schema-driven form component** and migrate `UseTemplateForm`, Actions, and Patterns to it. Three bespoke forms is already debt.

### 3.4 Steps (actions) and the registry

- Each step has `id`, `name`, `action`, `input`, optional `if`, optional `continueOnError`, optional `timeout`.
- **Action registry** with typed input/output JSON Schemas so the builder can validate references at save time and show autocomplete for `${{ steps.x.output.y }}`.
- Built-in action families (initial set):

| Family | Actions | Notes |
|---|---|---|
| Fetch | `fetch:git`, `fetch:orbit-skeleton`, `fetch:template` (another Orbit template) | Produces a workspace path |
| Render | `fs:render` (files **and** file/dir names), `fs:rename`, `fs:delete` | Real engine (see §4) |
| Publish | `github:repo:create`, `github:repo:create-from-template`, `git:push`, `github:pr:open`, `ado:repo:create`, `ado:pipeline:create`, `ado:pr:open` | Reuse `GitHubInstallations` and `GitConnections` |
| Catalog | `catalog:entity:register`, `catalog:relation:add`, `api:schema:register`, `entity:link:add` | Fixes the missing lineage today |
| Platform | `kafka:topic:provision` (Bifrost), `launch:azure` / `launch:do` | Reframes flagship features as steps |
| Governance | `approval:request` (HITL gate, reuses `PendingApprovals`), `agent:run` (infra agent with its own HITL) | AI governance story |
| Utility | `http:request`, `debug:log`, `notify:slack` | |

- **Expressions:** `${{ ... }}` with `parameters.*`, `steps.<id>.output.*`, `user.*`, `workspace.*`, `template.*`, `run.id`, plus a small filter set (`lower`, `upper`, `kebabCase`, `pascalCase`, `snakeCase`, `default(x)`, `json`). Portal calls these "extensions: filters / functions / values" — same idea.
- **Secrets never live in parameters.** Steps reference a **connection** by id, and the worker resolves credentials server-side. `ui:secret` fields (for one-off tokens) are held only for the run and redacted from `ActionRuns.inputs` and logs.

### 3.5 Content sources for greenfield templates

- **Orbit-hosted skeleton** (`template-skeletons`): a bundle of ≤ ~50 files stored in MinIO, authored in-app with a lightweight file tree + code editor, `{{ }}`-aware. Good for: `catalog-info.yaml`, CI workflow, Dockerfile, README, `.github/CODEOWNERS`. This is where "I don't have a repo yet" starts.
- **Spec-first API templates:** the author picks a contract style (OpenAPI 3.1 / GraphQL SDL / proto) and a starter spec; the run creates the `APISchema` + version, then optionally runs a generator step (`openapi-generator` in a sandboxed activity) to produce server/client stubs into the repo. Ties directly into the existing API catalog.
- **GitHub template repo, unrendered:** keep the fast path; wrap it in a step so it composes with catalog + Kafka + approval steps.

### 3.6 Running templates (consumer side)

- Runs are `ActionRuns` (the model already exists). Add `templateVersion`, `steps[]` (per-step status, started/finished, log tail), `dryRun: boolean`.
- Wizard: form pages → **Review** (rendered summary + what will be created) → Submit → live per-step logs → Outputs with links. Approval-gated templates park at `awaiting-approval` using the existing `approvalPolicy`.
- **Dry run for consumers too:** "Preview" button on the run form shows the plan (repos, entities, topics) and, for render steps, a file tree with a diff viewer. No side effects.

### 3.7 Permissions

| Capability | Who |
|---|---|
| Run a published template | workspace member (subject to `approvalPolicy`) |
| Create/edit drafts, dry run | workspace admin/owner (Portal: platform engineer) |
| Publish / deprecate | workspace admin; **platform admin** required for `visibility: shared|public` |
| Register new action types | code only (platform team) |
| Manage connections used by steps | existing admin gates (unchanged) |

Use the `lib/access/collection-access.ts` factories for every new collection.

## 4. Engine architecture

- **Where:** Go, in `temporal-workflows`. The template workflow, GitHub client, token service, and Bifrost live there; the TS automations worker is for lightweight event fan-out. One generic `ScaffolderWorkflow(input{definitionVersionId, runId, parameters, dryRun})` iterates steps, evaluates `if`, resolves expressions, dispatches each step to a registered activity, records per-step progress via a query handler and heartbeats, and honours cancellation (the existing proto has `CancelInstantiation` but no in-workflow handling).
- **Dry run:** each action implements `Execute` and `Plan`. `Plan` returns a `PlannedChange[]` (kind, name, description) and, for render steps, a rendered file tree persisted to MinIO under the run id for the diff viewer. Steps without a `Plan` cannot be dry-run and the builder warns.
- **Templating engine:** replace `strings.ReplaceAll` with a real engine. Recommend Go `text/template` with a hand-rolled filter set (no Sprig — it drags in `env`/`expandenv`-class functions unsuitable for user-authored content) for file contents and paths, keeping `{{ }}` so existing v1 skeletons keep working (bare `{{KEY}}` tokens are rewritten to `{{.KEY}}` only for known variable keys; see Phase 0 plan §1). Use a distinct delimiter for the definition-level expressions (`${{ }}`) so the two layers never collide.
- **Existing workflow:** `TemplateInstantiationWorkflow` becomes a v1 compatibility path expressed as a definition with five steps. `FinalizeInstantiation` TODOs are subsumed by `catalog:entity:register` + a run-finalize activity that bumps `usageCount`.
- **Dispatch:** implement the deferred `ActionDispatch` in `lib/actions/run.ts` → gRPC `StartRun` on the repository service → Temporal. `backend.type: 'scaffolder'` with `backend.ref = templateDefinitionId` replaces `temporal-template` / `temporal-pattern` / `temporal-launch` over time.

## 5. Data model (Payload)

- `template-definitions`: `name`, `slug`, `title`, `description`, `workspace`, `visibility`, `sharedWith`, `owner` (team), `targetKind`, `status` (draft/published/deprecated), `currentVersion`, `sourceMode` (`orbit` | `git`), `gitSource` (repoUrl, manifestPath, sync fields — moved from `Templates`), `fixtures[]`, `usageCount`, `lastDryRunAt`, `createdBy`.
- `template-definition-versions`: `definition` (rel), `versionNumber`, `definitionJson`, `editedBy`, `changeNote`, `validatedAt`, `dryRunRunId`.
- `template-skeletons`: `workspace`, `name`, `files[]` (path, storageKey, size, isBinary), `version`.
- `action-runs` (extend): `templateVersion`, `dryRun`, `steps[]`, `plan` (json), `artifactsPrefix`.
- Migration: `Templates` rows become `template-definitions` with `sourceMode: git` and an auto-generated v2 definition. Keep the `templates` slug as an alias during transition or rename routes under `/self-service/templates`.

## 6. Phasing

| Phase | Deliverable | Why first |
|---|---|---|
| **0 — Foundation fixes** | Real templating engine incl. file/dir names; implement `FinalizeInstantiation` (usage count + catalog entity with `source.type: template`); wire workflow cancellation; delete dead `hooks.postGeneration`. | Fixes lies in the docs, unblocks lineage/scorecards, zero UX risk. |
| **1 — Engine + model** | `template-definitions` + versions; action registry with the Fetch/Render/Publish(GitHub)/Catalog/Utility families; `ScaffolderWorkflow` with `Plan` (dry run); `ActionDispatch` wired; v1 manifest → v2 mapping; existing templates run through the new engine. | Everything else sits on this. Behaviour-preserving for current users. |
| **2 — Authoring UI** | `/self-service/templates/new`: form builder + live preview, step builder with registry-driven inputs and expression autocomplete, YAML view (two-way), dry-run panel with plan + file diff, fixtures, draft/publish/versions, export to YAML. Shared schema-driven form component. | The Portal-style experience. |
| **3 — Greenfield content** | Orbit-hosted skeletons (MinIO + in-app file editor); spec-first API templates (`api:schema:register` + generator step). | "Create from scratch" without git. |
| **4 — Platform steps + parity** | `kafka:topic:provision`, `approval:request`, `agent:run`, ADO publish actions, template composition (`fetch:template`), scheduled re-dry-run automation, `EntityTypes.goldenPath.templateId` link so scorecards can assert "built from an approved paved path". | Turns Bifrost/agent/launches into steps (Pillar 3 payoff). |

Phases 0 and 1 can run in parallel worktrees (engine vs. data model), as can 2 and 3 once 1 lands.

## 7. Decisions (accepted 2026-09-09)

1. ✅ **Strategy call.** The 2026-06-09 doc marks templates "polish only — no expansion". The 2026-06-27 refocus doc reframes self-service as Pillar 3 and this design is that pillar. Confirm we are overriding the June-09 call.
2. ✅ **Form-first vs YAML-first editor.** Recommendation: form-first with a synced YAML view (Portal's model). YAML-only is faster to build but excludes non-Backstage people.
3. ✅ **Host skeleton files in Orbit at all?** Recommendation: yes, but capped (small bundles in MinIO); anything larger belongs in git. Skipping this keeps Phase 3 to API-first only. Accepted with caps: ~50 files, 1 MB total, text only; larger bundles get a one-click export-to-git prompt.
4. ✅ **Engine language.** Recommendation: Go in `temporal-workflows` (reuses GitHub client, tokens, Bifrost). The TS worker stays for automations fan-out.
5. ✅ **Collection naming.** Rename `Templates` → `template-definitions` (clean model) vs. extend `Templates` in place (less migration). Recommendation: new collection + migration, since `Templates` fields are ~80% git-sync metadata.
6. ✅ **Shared JSON-Schema form component:** adopt a library (RJSF is the Backstage choice) or build on shadcn + zod. Recommendation: build thin on shadcn using JSON-Schema → zod conversion; RJSF's Material UI defaults fight the existing design system.

## 8. Explicit non-goals (v1)

- A full in-browser IDE for large skeletons.
- Executing arbitrary shell in templates (no `hooks.postGeneration` revival). Sandboxed generators are named actions, not user shell.
- Cross-tenant template marketplace beyond the existing `visibility: public`.
- Productivity metrics on template usage beyond `usageCount`.
