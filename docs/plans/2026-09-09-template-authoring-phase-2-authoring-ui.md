# In-App Template Authoring — Phase 2: Authoring UI

**Date:** 2026-09-09
**Depends on:** Phase 0 (`docs/plans/2026-09-09-template-authoring-phase-0-foundation.md`), Phase 1 (`docs/plans/2026-09-09-template-authoring-phase-1-engine.md`)
**Companion:** `docs/plans/2026-09-09-in-app-template-authoring-design.md` (design doc, especially §3.2, §3.3, §3.6, §3.7)

---

## 0. What Phase 2 needs from Phase 1 (hard dependency list)

Phase 2 cannot start on the step/dry-run/publish surfaces until Phase 1 exposes these. Confirm each exists (exact names may shift; this plan will be adjusted if Phase 1 lands with different signatures) before starting Tasks 6+:

1. **Collections** (Payload): `template-definitions`, `template-definition-versions` per design §5 — `status` (`draft|published|deprecated`), `currentVersion`, `definitionJson`, `fixtures[]`, `usageCount`, `lastDryRunAt`.
2. **Server actions / APIs**:
   - `getTemplateDefinition(id)`, `listTemplateDefinitions({ workspaceId, mine? })` — for the authoring list page.
   - `createTemplateDefinition(input)`, `saveTemplateDefinitionDraft(id, definitionJson, changeNote?)`, `publishTemplateDefinition(id)`, `deprecateTemplateDefinition(id)` — RBAC-gated per design §3.7.
   - `validateTemplateDefinition(definitionJson)` → static validator result (expression references, unknown actions, schema errors) — exposed as a callable server action Task 10 depends on.
   - `listActionRegistry()` → the Go action registry (families in design §3.4) as a JSON array of `{ id, family, name, inputSchema, outputSchema, supportsPlan }` — Task 8 depends on this exact shape.
   - `startDryRun({ templateVersionId, parameters, fixtureId? })` → creates an `action-runs` row with `dryRun: true`, returns `{ runId }`.
   - `getRun(runId)` (extended) → run now carries `steps[]` (id, status, startedAt, finishedAt, logTail) and `plan` (json: `PlannedChange[]` + file-tree diff pointer) per design §3.6/§4.
   - `saveFixture(templateDefinitionId, fixture)`, `deleteFixture(...)`.
   - `exportTemplateDefinitionYaml(id)` / `importTemplateDefinitionYaml(yamlText)` (or a pure client-side serializer if Phase 1 only guarantees the schema, not the exporter — confirm which).
3. **Types**: TypeScript types for the v2 definition document (parameters pages, steps, output) generated or hand-written under `orbit-www/src/lib/templates/definition-types.ts` — if Phase 1 doesn't produce these, Task 1 of this plan creates them from design §3.1's YAML shape and Phase 2 owns them.

If Phase 1 is not yet merged when Phase 2 work starts, Tasks 1–5 (SchemaForm + migrating existing forms) have **no dependency** on Phase 1 and should start immediately in a separate worktree. Tasks 6–15 block on the above.

---

## 1. Current state (verified 2026-09-09)

- **Routes today:** `templates/` (list, `[slug]`, `[slug]/use`, `[slug]/edit`, `import`, `instantiate/[workflowId]`, `progress/[workflowId]`) — git-backed v1 templates, untouched by this phase except a nav link. `self-service/` already exists: `page.tsx` (Actions catalog), `new/page.tsx`, `[id]/edit/page.tsx`, `actions.ts` (run/list/approve — member-facing), `authoring-actions.ts` (create/update/delete — owner/admin-facing), `runs/page.tsx`, `runs/[id]/page.tsx`. This is the pattern Phase 2's `/self-service/templates/**` routes follow (server-actions split into consumer vs. authoring files, RBAC resolved server-side per page with a 404 fallback, not a redirect).
- **Forms today, three bespoke implementations, all hand-rolled `useState` + shadcn primitives, no schema library:**
  - `orbit-www/src/components/features/templates/UseTemplateForm.tsx` — switches on `variable.type` (string/number/boolean/select/multiselect), multiselect is a raw comma-separated `Input` (never built properly).
  - `orbit-www/src/components/features/actions/RunActionDialog.tsx` — switches on `ActionInputField.type` (text/textarea/number/boolean/select), same pattern.
  - `orbit-www/src/components/features/actions/ActionForm.tsx` + `InputSchemaBuilder.tsx` + `input-schema-builder.ts` — the **closest existing analog to the Phase 2 form builder**: ordered `BuilderField[]` rows with add/remove/move, a pure `assembleInputSchema`/`validateBuilderFields`/`parseInputSchemaToBuilderFields` module (fully unit-testable, no React), `createAction`/`updateAction` (`orbit-www/src/app/(frontend)/self-service/authoring-actions.ts`) re-normalize server-side via `normalizeInputSchema` (`orbit-www/src/lib/actions/input-schema.ts`) — never trust the client. **Phase 2's form builder should follow this exact shape**, extended for JSON-Schema draft 2020-12 fields, `ui:` vocabulary, and pages.
  - Patterns' `inputSchemaJson` (`orbit-www/src/collections/Patterns.ts`) is stored raw JSON with no visual editor — out of scope (follow-up).
- **Dependencies already installed** (`orbit-www/package.json`): `zod ^4.1.11`, `react-hook-form ^7.63.0`, `@hookform/resolvers ^5.2.2`, `yaml ^2.8.2`, `@monaco-editor/react ^4.7.0` + `monaco-editor ^0.54.0` (YAML view + expression editor use this), `ajv ^8.18.0` + `ajv-draft-04`. **No RJSF** — confirms design §7.6's "build thin on shadcn + zod" decision is buildable today with zero new deps for the core form engine.
- **shadcn/ui components present:** alert(-dialog), avatar, badge, breadcrumb, button, card, checkbox, collapsible, command (→ comboboxes for pickers), context-menu, dialog, dropdown-menu, **form** (react-hook-form wrapper, unused elsewhere — adopt it), input, label, popover, progress, scroll-area, select, separator, sheet, sidebar, skeleton, sonner, switch, table, tabs, textarea, tooltip. **Missing and needed:** a multi-select/combobox-tags component (build on `command.tsx` + `popover.tsx`, no new dep), a resizable split-pane (build with plain CSS grid, no new dep — avoid pulling in `react-resizable-panels` unless a later task proves it's needed).
- **RBAC:** `orbit-www/src/lib/actions/authz.ts` — `canManageActions` (owner/admin), `canRunActions` (any active member), `canApproveActionRun`. Phase 2 needs the template-specific analogs: `canManageTemplateDefinitions` (owner/admin; **platform admin required for `visibility: shared|public`** per design §3.7 — this extra gate does not exist in the Actions analog and must be added new), `canRunTemplateDefinitions` (any active member, gated further by the definition's own `approvalPolicy`/visibility). `orbit-www/src/lib/access/collection-access.ts` factories are the required base for the two new Phase 1 collections' Payload `access` — Phase 2 only needs the server-action-level wrappers in `lib/templates/authz.ts` (new), mirroring `lib/actions/authz.ts`.
- **Runs today poll, they don't stream:** `RunRefreshButton.tsx` is a manual `router.refresh()` button — there is **no SSE/WebSocket channel** for `action-runs`. The "live per-step logs" in design §3.6 will be built as **client-side polling** (a `setInterval` re-invoking a `getRun`-style server action every ~2s while `status` is `running`/`pending`, matching existing infra) — not a new streaming transport. This is an explicit scope/complexity control, called out as a risk in §6.
- **`action-ui.ts`** (`orbit-www/src/components/features/actions/action-ui.ts`) is a pure, framework-light presentation-helper module (icons/labels/status badges/relative time) already unit-tested (`action-ui.test.ts`) — Phase 2 adds template/run-specific entries here rather than forking a new file, to keep one source of truth for status badges across Actions and Templates runs.

---

## 2. Architecture decisions for this phase

1. **`SchemaForm` is the only new form engine.** One component tree under `orbit-www/src/components/forms/schema-form/`, framework: JSON Schema (subset) → zod (pure, unit-tested conversion) → `react-hook-form` (`useForm` + shadcn's `form.tsx` wrapper, adopted for the first time in this repo) → a field registry that renders shadcn primitives or a pluggable custom field.
2. **Server Component pages, Client Component islands.** Every route under `/self-service/templates/**` is a Server Component that resolves auth + RBAC + initial data, and 404s (not redirects) on denial — matching `self-service/[id]/edit/page.tsx`. All interactive editing (builder, YAML view, dry-run panel) is client components fed via props, mutating through server actions — no client-side Payload/gRPC calls.
3. **Two-way YAML sync lives in one reducer, not two sources of truth.** Builder state (pages/fields/steps/output) is the single source of truth in a `useReducer`. The YAML view is a **derived, debounced serialization** of that state for display/editing; typing in the YAML editor parses on blur/debounce and, only if parse+shape-validate succeeds, dispatches a `REPLACE_ALL` action back into the reducer. Invalid YAML sets a `yamlError` string and does **not** touch the reducer (per design §3.2 "editing YAML re-parses into builder state, invalid YAML shows errors without clobbering state").
4. **Definition JSON is the wire format; YAML is a view.** The reducer's state shape is exactly Phase 1's `definitionJson` (typed by `orbit-www/src/lib/templates/definition-types.ts`), so `saveTemplateDefinitionDraft` never needs a builder→JSON adapter beyond what `assembleInputSchema`-equivalent purity already gives us.
5. **Registry-driven step inputs reuse `SchemaForm`.** Each action in the registry ships an `inputSchema` (JSON Schema); the step builder's "configure this step" panel is literally a `SchemaForm` instance rendering expression-aware fields (see #6) instead of a bespoke per-step UI.
6. **Expression fields are a `SchemaForm` field-type, not a separate system.** A step input field can be marked expression-capable (any string/number field where the step's input schema allows `${{ }}`); the registry object stores which fields allow this. The field renders a plain `Input`/`Textarea` with a small `${{ }}` insert-menu (Popover + Command) that autocompletes `parameters.*` (from the current pages) and `steps.<id>.output.*` (from earlier steps' declared output schema) — built on the existing `command.tsx`, no new editor dependency for this; full syntax highlighting is a non-goal.

---

## 3. Tasks

### Group A — `SchemaForm` core (no Phase 1 dependency, start immediately)

**Task 1 — JSON-Schema→zod conversion module**
- **New:** `orbit-www/src/components/forms/schema-form/schema-to-zod.ts`
- **New (test-first):** `orbit-www/src/components/forms/schema-form/schema-to-zod.test.ts`
- Write failing table tests first: string (`minLength`/`maxLength`/`pattern`/`format: email`/enum), number/integer (`minimum`/`maximum`/`multipleOf`), boolean, array-of-string (`minItems`/`maxItems`/`uniqueItems`), object (nested, `required[]`), `default`, `oneOf`-of-enum-like unions is explicitly **out of scope** (document as a thrown `UnsupportedSchemaError` with a clear message, not a silent wrong conversion). Watch every case fail (function doesn't exist yet), then implement `jsonSchemaToZod(schema: JsonSchema): z.ZodTypeAny`.
- Also define `orbit-www/src/components/forms/schema-form/types.ts`: `JsonSchema` (draft 2020-12 subset — the exact same subset Phase 1's validator supports; cross-check against Phase 1's schema validator once merged, note as a TODO if Phase 1 isn't landed yet), `UiSchema` (`ui:field`, `ui:help`, `ui:widget`, `ui:visibleIf`, `ui:order`, `ui:secret`).
- **Verify:** `cd orbit-www && bunx vitest run src/components/forms/schema-form/schema-to-zod.test.ts`

**Task 2 — `ui:` vocabulary + field registry**
- **New:** `orbit-www/src/components/forms/schema-form/field-registry.tsx` — a `Map`-like registry: default renderers per JSON-Schema type/format (string→Input, string+enum→Select, string+`ui:widget: textarea`→Textarea, number/integer→Input type=number, boolean→Switch (not Checkbox — matches `ActionForm`'s `enabled` toggle convention), array-of-string→a tag input built on `command.tsx`+`popover.tsx` (this finally fixes the comma-separated-string `multiselect` hack in `UseTemplateForm.tsx`), object→nested `SchemaForm` recursion.
- `registerField(name, Component)` for Orbit-native pickers (Task 5) and consumers to extend without modifying the core.
- **New (test-first):** `orbit-www/src/components/forms/schema-form/field-registry.test.tsx` — resolve-by-type/format/`ui:widget`/`ui:field` precedence table tests (write failing tests before the resolver).
- **Verify:** `cd orbit-www && bunx vitest run src/components/forms/schema-form/field-registry.test.tsx`

**Task 3 — `visibleIf` evaluator**
- **New:** `orbit-www/src/components/forms/schema-form/visible-if.ts` — parses `${{ parameters.foo }}` / `${{ parameters.foo == 'bar' }}` (small expression subset: equality, boolean field truthy, `!`) against the current form values. Reuse this exact evaluator later for the expression-preview panel (Task 9) rather than writing two parsers.
- **New (test-first):** `orbit-www/src/components/forms/schema-form/visible-if.test.ts` — truthy boolean ref, equality, negation, missing-field-defaults-to-hidden, malformed-expression-defaults-to-visible (fail open so authors aren't locked out by a typo — document this choice).
- **Verify:** `cd orbit-www && bunx vitest run src/components/forms/schema-form/visible-if.test.ts`

**Task 4 — `SchemaForm` component**
- **New:** `orbit-www/src/components/forms/schema-form/SchemaForm.tsx` — client component. Props: `pages: { title: string; schema: JsonSchema; uiSchema?: UiSchema }[]` (single-page callers pass one entry), `values`, `onChange`, `onSubmit?`, `fieldRegistry?` (defaults to the shared one), `mode?: 'wizard' | 'single'` (wizard renders page tabs/stepper for multi-page parameters per design §3.1; single is today's Actions/Use-Template one-pager). Wires `useForm` (react-hook-form) with `zodResolver(jsonSchemaToZod(mergedSchema))`, iterates fields in `ui:order` (fallback: JSON-Schema property order), applies `visibleIf` per field (hidden fields are unregistered from validation, not just visually hidden — avoids phantom required-field errors), renders via the field registry, secret fields (`ui:secret`) render a password-style `Input` and are flagged in the emitted value object (`{ value, secret: true }`) so callers can redact before persisting/logging.
- **New (test-first):** `orbit-www/src/components/forms/schema-form/SchemaForm.test.tsx` (Vitest + Testing Library — confirm `@testing-library/react` is already a devDependency; if not, add it as this phase's only new dependency and note in the PR) — renders required/optional fields, enum→Select, visibleIf show/hide + validation exemption, submit validation errors surface per-field, custom field via `fieldRegistry` override.
- **Verify:** `cd orbit-www && bunx vitest run src/components/forms/schema-form/SchemaForm.test.tsx`

**Task 5 — Orbit-native pickers**
- **New:** `orbit-www/src/components/forms/schema-form/fields/OrbitTeamPicker.tsx`, `OrbitWorkspacePicker.tsx`, `OrbitEntityPicker.tsx` (prop: `kind`), `OrbitRepoPicker.tsx` (prop: `connection` — resolves to a `GitConnections`/`GitHubInstallations` id at render time via a passed-in server action, not a direct DB call from the client).
- **New:** `orbit-www/src/app/(frontend)/self-service/templates/picker-data-actions.ts` — `'use server'` functions each picker calls: `listTeamsForPicker(workspaceId)`, `listEntitiesForPicker(workspaceId, kind)`, `listReposForPicker(connectionId)`. Each is RBAC-scoped to the caller's workspace membership (reuse `getMemberWorkspaceIds` pattern from `self-service/actions.ts`) — never trust a `kind`/`connection` prop alone to scope data.
- Register all four in the shared field registry under their design-doc names (`OrbitTeamPicker` etc.) so `ui:field: OrbitTeamPicker` resolves automatically.
- **New (test-first):** unit tests for the picker-data server actions' RBAC scoping (mirror `self-service/actions.ts`'s existing test patterns if any exist — check `orbit-www/src/app/(frontend)/self-service/*.test.ts` for a convention first) plus component tests stubbing the server action prop.
- **Verify:** `cd orbit-www && bunx vitest run src/components/forms/schema-form/fields/`

**Task 6 — Migrate `UseTemplateForm` and Actions' run form to `SchemaForm`**
- **Edit:** `orbit-www/src/components/features/templates/UseTemplateForm.tsx` — replace the manual variable-type switch with `SchemaForm` fed a JSON Schema built from `TemplateVariable[]` (a small adapter `templateVariablesToJsonSchema` — **new**, `orbit-www/src/lib/templates/legacy-variables-adapter.ts`, unit-tested, this is also reusable for Phase 1's v1→v2 manifest mapping if not already done there). This finally fixes the broken comma-separated `multiselect` input.
- **Edit:** `orbit-www/src/components/features/actions/RunActionDialog.tsx` — replace `ActionField` switch with `SchemaForm` fed from `normalizeInputSchema(action.inputSchema)` converted to JSON Schema (adapter: `orbit-www/src/lib/actions/input-schema-to-json-schema.ts`, **new**, unit-tested).
- **Do NOT migrate** `ActionForm.tsx`/`InputSchemaBuilder.tsx` (the *authoring* side of Actions) in this phase — Patterns migration and the Actions input-schema *builder* are follow-ups; only the *run* forms move.
- **Verify:** `cd orbit-www && bunx vitest run src/lib/templates/legacy-variables-adapter.test.ts src/lib/actions/input-schema-to-json-schema.test.ts` + existing `action-ui.test.ts`/`input-schema-builder.test.ts` still green (`cd orbit-www && bunx vitest run src/components/features/actions/`) + manual agent-browser check: submit a real `UseTemplateForm` instantiation and a real `RunActionDialog` run end to end (see §5).

### Group B — Authoring data plumbing (blocks on Phase 1)

**Task 7 — `lib/templates/authz.ts`**
- **New:** `orbit-www/src/lib/templates/authz.ts` — `canManageTemplateDefinitions(payload, userId, workspaceId)` (owner/admin, mirrors `canManageActions`), `canPublishTemplateDefinition(payload, userId, workspaceId, visibility)` (owner/admin for `workspace` visibility; **`isPlatformAdmin` required for `shared`/`public`** — the new gate per design §3.7, use `isPlatformAdmin` from `lib/access/workspace-access.ts`), `canRunTemplateDefinition(payload, userId, workspaceId)` (any active member, mirrors `canRunActions`).
- **New (test-first):** `orbit-www/src/lib/templates/authz.test.ts` — table tests for each role × visibility combination, esp. the platform-admin-required-for-shared/public case (the one new rule vs. the Actions analog).
- **Verify:** `cd orbit-www && bunx vitest run src/lib/templates/authz.test.ts`

**Task 8 — Authoring routes: list + metadata**
- **New:** `orbit-www/src/app/(frontend)/self-service/templates/page.tsx` — Server Component: tabs/filter for drafts-mine / drafts-workspace / published, "New template" CTA gated like `self-service/page.tsx`'s `NewActionButton`.
- **New:** `orbit-www/src/app/(frontend)/self-service/templates/authoring-actions.ts` — `'use server'`: `listTemplateDefinitions`, `createTemplateDefinitionDraft`, `getManageableTemplateWorkspaces` (mirrors `getManageableActionWorkspaces`). Thin wrappers over the Phase 1 server actions/collection calls listed in §0, adding the RBAC gate from Task 7 before every mutation (never trust Phase 1's own access rules alone — same "gate then `overrideAccess: true`" convention as `self-service/authoring-actions.ts`).
- **New:** `orbit-www/src/app/(frontend)/self-service/templates/new/page.tsx` — metadata-only create form (name/title/description/tags/owner/targetKind/visibility/sourceMode), on submit creates a draft definition + version 1 and redirects to `/self-service/templates/[id]/edit`.
- **Verify (manual, no new logic to unit-test here beyond Task 7):** agent-browser — create a draft, confirm it 404s for a non-admin workspace member.

**Task 9 — Builder state + reducer**
- **New:** `orbit-www/src/components/features/template-authoring/builder-state.ts` — pure `useReducer` reducer over the `definitionJson` shape (`definition-types.ts`): actions for `SET_METADATA`, `ADD_PARAMETER_PAGE`/`REMOVE_PARAMETER_PAGE`/`REORDER_PARAMETER_PAGES`, `ADD_FIELD`/`UPDATE_FIELD`/`REMOVE_FIELD`/`REORDER_FIELDS` (within a page — mirror `input-schema-builder.ts`'s `moveField` shape), `ADD_STEP`/`UPDATE_STEP`/`REMOVE_STEP`/`REORDER_STEPS`, `SET_OUTPUT`, `REPLACE_ALL` (used by the YAML-view two-way sync).
- **New (test-first):** `orbit-www/src/components/features/template-authoring/builder-state.test.ts` — one test per action type, plus a round-trip test (`serialize → REPLACE_ALL → serialize` is idempotent) that Task 13's YAML sync depends on.
- **Verify:** `cd orbit-www && bunx vitest run src/components/features/template-authoring/builder-state.test.ts`

**Task 10 — Form (parameters) builder panel**
- **New:** `orbit-www/src/components/features/template-authoring/ParametersBuilder.tsx` — Portal-style "Append field": per page, a list of fields (name/type/label/help/required/default/validation/`ui:visibleIf` rule/`ui:field` picker choice) editing via the Task 9 reducer, structurally identical in spirit to `InputSchemaBuilder.tsx` but targeting full JSON Schema + `ui:` instead of `ActionInputField`. Includes "Add page" for the ordered-pages model.
- **New:** `orbit-www/src/components/features/template-authoring/ParametersPreview.tsx` — live `SchemaForm` (Task 4) rendered submit-disabled beside the builder, fed directly from reducer state (no serialize round-trip needed since builder state *is* JSON Schema pages).
- **New (test-first):** `orbit-www/src/components/features/template-authoring/ParametersBuilder.test.tsx` — add/remove/reorder field and page interactions dispatch the right reducer actions (test with a mock dispatch; extract non-trivial logic into pure helpers first, matching `input-schema-builder.test.ts`'s style).
- **Verify:** `cd orbit-www && bunx vitest run src/components/features/template-authoring/ParametersBuilder.test.tsx`

**Task 11 — Step builder panel**
- **New:** `orbit-www/src/components/features/template-authoring/StepsBuilder.tsx` — ordered step list; "Add step" opens a registry picker (Command palette over `listActionRegistry()`, grouped by family per design §3.4 table); each step row expands to a `SchemaForm` instance (Task 4) driven by the selected action's `inputSchema`, with expression-capable fields (§2.6) offering the `${{ }}` insert menu; `if` condition field uses the same expression input; `continueOnError`/`timeout` as plain optional fields.
- **New:** `orbit-www/src/components/features/template-authoring/expression-autocomplete.ts` — pure function: given current builder state + step index, returns the available `parameters.*` and `steps.<earlier-id>.output.*` completion candidates (walks earlier steps' registry-declared output schemas). Unit-testable without React.
- **New:** `orbit-www/src/components/features/template-authoring/ExpressionInput.tsx` — shared expression-capable input sub-component (also used by Task 12).
- **New (test-first):** `expression-autocomplete.test.ts` (candidates exclude later/self steps, include nested object output paths) + `StepsBuilder.test.tsx` (add/remove/reorder steps, `if` field round-trips).
- **Verify:** `cd orbit-www && bunx vitest run src/components/features/template-authoring/expression-autocomplete.test.ts src/components/features/template-authoring/StepsBuilder.test.tsx`

**Task 12 — Output builder panel**
- **New:** `orbit-www/src/components/features/template-authoring/OutputBuilder.tsx` — simple repeatable list of `{ title, url }` / `{ title, entity }` link rows, expression-capable `url`/`entity` fields via `ExpressionInput`.
- **Verify:** covered by `builder-state.test.ts`'s `SET_OUTPUT` case + a light component smoke test, `bunx vitest run src/components/features/template-authoring/OutputBuilder.test.tsx`.

**Task 13 — Two-way YAML view**
- **New:** `orbit-www/src/components/features/template-authoring/YamlView.tsx` — Monaco editor (`@monaco-editor/react`, language `yaml`) showing `YAML.stringify(reducerState)` (the `yaml` package); on change (debounced ~400ms), attempts `YAML.parse` then a shape-check against `definition-types.ts` (reuse Phase 1's validator if it exports a pure function, else a light structural check here), dispatches `REPLACE_ALL` on success, sets an inline error banner (Monaco markers, not a toast) on failure — never dispatches on failure, per architecture decision #3.
- **New (test-first):** `YamlView.test.tsx` — serialize→display round trip, valid-edit→dispatch, invalid-edit→no dispatch+error shown, uses the `builder-state.test.ts` round-trip fixture from Task 9.
- **Verify:** `cd orbit-www && bunx vitest run src/components/features/template-authoring/YamlView.test.tsx`

**Task 14 — Edit page shell, validation panel, dry-run panel, fixtures, versions, draft/publish**
- **New:** `orbit-www/src/app/(frontend)/self-service/templates/[id]/edit/page.tsx` — Server Component: loads the definition + current version (404 + RBAC via Task 7), passes to a client shell.
- **New:** `orbit-www/src/components/features/template-authoring/TemplateEditorShell.tsx` — client component owning the Task 9 reducer, laying out: metadata panel (top), tabs for Parameters (Task 10) / Steps (Task 11) / Output (Task 12), a YAML view (Task 13) as a collapsible side panel (CSS grid split, no new dep), a persistent bottom bar with Save draft / Validate / Dry run / Publish / Deprecate / Export buttons.
- **New:** `orbit-www/src/components/features/template-authoring/ValidationPanel.tsx` — calls Phase 1's `validateTemplateDefinition` server action on demand, renders a list of errors/warnings with jump-to-field links (best-effort: match by field path, fall back to a flat list).
- **New:** `orbit-www/src/components/features/template-authoring/DryRunPanel.tsx` — fixture selector (or "fill the form" → embeds `SchemaForm` for the current parameters) → `startDryRun` → polling (Task 15's `useRunPolling`) showing per-step status list + a file-tree diff viewer (**new**, `orbit-www/src/components/features/template-authoring/FileTreeDiff.tsx` — renders the `plan.fileTree` from the run; a simple added/removed/changed tree, no Monaco diff editor in v1 to control scope — flagged as a follow-up if authors need line-level diffs).
- **New:** `orbit-www/src/components/features/template-authoring/FixturesPanel.tsx` — CRUD list calling `saveFixture`/`deleteFixture`.
- **New:** `orbit-www/src/components/features/template-authoring/VersionsPanel.tsx` + `version-diff.ts` — lists `template-definition-versions`, a "Diff" action between two versions (basic line diff over `YAML.stringify` of each side, no new diff-library dependency).
- **Publish gate enforcement:** the Publish button calls `publishTemplateDefinition`; the *client* pre-checks `validatedAt`/`dryRunRunId` presence on the current version to disable the button with a tooltip explaining why, but the **server action is the real gate** (Phase 1's responsibility) — this UI never trusts the disabled state alone.
- **Export** button calls `exportTemplateDefinitionYaml` and hands the string to the browser via `Blob` + `URL.createObjectURL` download.
- **New (test-first, where logic is extractable):** `version-diff.test.ts` (pure diff function), `ValidationPanel.test.tsx`, `FixturesPanel.test.tsx` (stub server actions).
- **Verify:** `cd orbit-www && bunx vitest run src/components/features/template-authoring/version-diff.test.ts src/components/features/template-authoring/ValidationPanel.test.tsx src/components/features/template-authoring/FixturesPanel.test.tsx` + full agent-browser walkthrough (§5).

### Group C — Consumer run wizard (blocks on Phase 1 for run data; SchemaForm-only parts can start once Group A lands)

**Task 15 — `useRunPolling` hook + run status UI reuse**
- **New:** `orbit-www/src/components/features/template-authoring/use-run-polling.ts` — client hook: given a `runId` and a `getRun` server action, polls every 2s while `status` is `pending|awaiting-approval|running`, stops on `succeeded|failed`, exposes `{ run, error }`. Used by both `DryRunPanel` (Task 14) and the consumer wizard (Task 17).
- Extend `orbit-www/src/components/features/actions/action-ui.ts` with step-status variants (`pending|running|succeeded|failed|skipped`) alongside the existing run-status map.
- **New (test-first):** `use-run-polling.test.ts` (fake timers: starts polling, stops on terminal status, cleans up interval on unmount) + extend `action-ui.test.ts` for any new step-status entries.
- **Verify:** `cd orbit-www && bunx vitest run src/components/features/template-authoring/use-run-polling.test.ts src/components/features/actions/action-ui.test.ts`

**Task 16 — Consumer routes: list-to-run, review**
- **Edit:** `orbit-www/src/app/(frontend)/self-service/templates/page.tsx` (Task 8) — published templates get a "Run" affordance; tabs "Templates I can run" vs "Drafts I author" on the same page (avoid a second list route).
- **New:** `orbit-www/src/app/(frontend)/self-service/templates/[slug]/run/page.tsx` — Server Component, loads the published definition + current version, RBAC via `canRunTemplateDefinition` (Task 7), 404 otherwise.
- **New:** `orbit-www/src/components/features/template-authoring/RunWizard.tsx` — client component: paged `SchemaForm` (`mode: 'wizard'`) over the definition's parameter pages → "Review" step (calls a `planRun` server action — same shape as dry run's plan; confirm exact Phase 1 API name once landed) showing the summary + planned changes → Submit calls `startRun` (real, non-dry-run) → redirects to `[slug]/run/[runId]`.
- **Verify:** manual agent-browser (no new pure logic beyond what Tasks 4/9/15 already cover).

**Task 17 — Consumer run detail: live logs, outputs, approval gate**
- **New:** `orbit-www/src/app/(frontend)/self-service/templates/[slug]/run/[runId]/page.tsx` — Server Component initial load (reuse `getRun`), hands off to a client component.
- **New:** `orbit-www/src/components/features/template-authoring/TemplateRunDetail.tsx` — client component: `useRunPolling` for live per-step status (ordered list with a status badge per step, reusing `RunLogs.tsx`'s log-entry rendering filtered per step if `logTail` is per-step, else the existing whole-run `RunLogs`), outputs section rendering the definition's `output.links[]` resolved values as clickable links, and — when `status === 'awaiting-approval'` — reuse `orbit-www/src/components/features/actions/ApprovalButtons.tsx` if its props generalize to template runs, else a thin template-specific wrapper.
- **Verify:** manual agent-browser walkthrough is the primary verification; note in the PR whether `ApprovalButtons` was reused or forked.

### Group D — Tests, verification, cleanup

**Task 18 — Playwright E2E**
- **New:** `orbit-www/tests/e2e/template-authoring.spec.ts` — happy path: log in as the seeded dev admin (local only), create a draft template (one parameter page, one step from Phase 1's initial registry), validate, dry run (assert plan renders), publish, then run it via the consumer wizard, confirm the run reaches a terminal state and outputs render.
- **Verify:** `cd orbit-www && bun run test:e2e -- template-authoring.spec.ts` (confirm exact script name in `package.json`; adjust if different, e.g. `bunx playwright test`).

**Task 19 — agent-browser manual verification pass**
- Per CLAUDE.md's mandatory UI-verification rule: pre-flight `pgrep` check, walk through create → parameters → steps → YAML round-trip (edit YAML directly, confirm builder reflects it) → dry run → publish gate (confirm Publish is disabled pre-dry-run, enabled after) → run as consumer → approval gate if any step has `approvalPolicy` → post-flight cleanup + `pgrep` re-check. Screenshot each major panel. Do it last, after Tasks 1–18 are code-complete, against a running `make dev-local`.

**Task 20 — Adversarial review gate**
- Per CLAUDE.md: run an adversarial review subagent against the full Phase 2 diff before marking any worktree's PR ready — specifically target: (a) every `overrideAccess: true` write actually preceded by the Task 7 RBAC gate, (b) the platform-admin-for-shared/public rule is enforced server-side, not just UI-disabled, (c) `ui:secret` fields are genuinely redacted before persistence/logging (not just masked in the input), (d) the YAML two-way sync never silently drops fields on a round trip (cross-check against `builder-state.test.ts`'s round-trip test), (e) polling hooks clean up intervals (memory leak), (f) no step's expression autocomplete leaks another workspace's entity/team names (Task 5's picker RBAC). Fix findings, re-review.

---

## 4. Parallelisation (separate git worktrees)

| Worktree | Tasks | Depends on | Notes |
|---|---|---|---|
| `wt-schema-form` | 1–5 | none | Start immediately. Pure logic + one new component tree; highest test density, good fit for a fast/cheap model. |
| `wt-form-migration` | 6 | wt-schema-form merged | Small; can be sequenced after Tasks 1–5 land on `main` instead of a separate worktree. |
| `wt-authoring-shell` | 7–10, 13–14 | Phase 1 merged | The largest chunk — metadata/parameters/YAML/publish flow. Needs deep reasoning for the reducer + YAML sync edge cases; keep on a stronger model. |
| `wt-step-builder` | 11–12 | Phase 1 merged (registry API) + wt-schema-form | Registry integration + expression autocomplete is the trickiest logic in the phase — isolate it so a bug here doesn't block the authoring shell. |
| `wt-run-wizard` | 15–17 | Phase 1 merged (run/plan APIs) + wt-schema-form | Consumer-facing; fully parallel to the authoring worktrees once Phase 1's run APIs exist. |
| (main, after merges) | 18–20 | all above merged | E2E, manual verification, and adversarial review must see the composed whole — do not parallelize these. |

Tasks 1–5 have zero file overlap with 7–17 and should not block on Phase 1 at all. 11–12 and 15–17 both read the registry/run APIs but touch disjoint files. 13–14 share `TemplateEditorShell.tsx` — keep them in one worktree.

---

## 5. Manual verification (agent-browser) checklist

1. Pre-flight: `pgrep -fl "agent-browser-darwin-arm64|agent-browser-chrome-"`, kill + re-check if anything returns.
2. `make dev-local`, log in at `/login` with the seeded dev account (see CLAUDE.md).
3. Navigate `/self-service/templates` → New → fill metadata → Parameters tab: add a page, add a string + boolean + enum field, verify live preview updates → Steps tab: add a step from the registry, fill its inputs, add a second step referencing the first via `${{ steps.<id>.output.* }}` autocomplete → Output tab: add a link → open YAML view, confirm it reflects all of the above, hand-edit a field name in YAML, confirm the builder updates → Save draft.
4. Validate (expect pass or a clear error), Dry run (expect plan + step statuses to populate via polling, confirm no runaway interval after completion), confirm Publish is disabled until dry run succeeds, then enabled.
5. Publish, navigate to the consumer run page, run it through to a terminal state, confirm outputs render as links.
6. Post-flight: close the agent-browser session, re-run the `pgrep` check to confirm no orphaned Chrome processes.

---

## 6. Risks

1. **No streaming transport for run status.** Design §3.6 says "live per-step logs"; this plan delivers 2s polling, not push. If dry-run/run steps are chatty, polling may visibly lag. Explicit scope control — raise before Task 15 if a tighter latency bar is required (SSE is new infra, out of this phase's budget).
2. **JSON-Schema→zod subset gaps.** `oneOf`/`anyOf`/`$ref` are explicitly unsupported in Task 1; `SchemaForm` throws a clear `UnsupportedSchemaError` rather than silently mis-rendering. Revisit after Phase 1's initial action registry schemas are known.
3. **File-tree diff viewer is shallow (v1).** No line-level diff. Monaco diff editor is already a dependency, so it's a contained addition later.
4. **Phase 1 API shapes are assumed, not confirmed.** Treat every "depends on Phase 1's Y" in §0 as a checkpoint to revalidate, not a locked contract.
5. **`ApprovalButtons.tsx` reuse is unverified.** If its props are Actions-specific, fork rather than force a bad abstraction.
6. **Worktree conflict on `TemplateEditorShell.tsx`.** Tasks 13 and 14 share it — sequence them in one worktree.

---

## 7. File summary (new files only)

```
orbit-www/src/components/forms/schema-form/
  types.ts, schema-to-zod.ts(+.test), field-registry.tsx(+.test), visible-if.ts(+.test),
  SchemaForm.tsx(+.test), fields/{OrbitTeamPicker,OrbitWorkspacePicker,OrbitEntityPicker,OrbitRepoPicker}.tsx
orbit-www/src/lib/templates/
  definition-types.ts, authz.ts(+.test), legacy-variables-adapter.ts(+.test)
orbit-www/src/lib/actions/input-schema-to-json-schema.ts(+.test)
orbit-www/src/app/(frontend)/self-service/templates/
  page.tsx, authoring-actions.ts, picker-data-actions.ts,
  new/page.tsx,
  [id]/edit/page.tsx,
  [slug]/run/page.tsx, [slug]/run/[runId]/page.tsx
orbit-www/src/components/features/template-authoring/
  builder-state.ts(+.test), ParametersBuilder.tsx(+.test), ParametersPreview.tsx,
  StepsBuilder.tsx(+.test), expression-autocomplete.ts(+.test), ExpressionInput.tsx,
  OutputBuilder.tsx(+.test), YamlView.tsx(+.test), TemplateEditorShell.tsx,
  ValidationPanel.tsx(+.test), DryRunPanel.tsx, FileTreeDiff.tsx,
  FixturesPanel.tsx(+.test), VersionsPanel.tsx, version-diff.ts(+.test),
  use-run-polling.ts(+.test), RunWizard.tsx, TemplateRunDetail.tsx
orbit-www/tests/e2e/template-authoring.spec.ts
```
