# API Catalog Integration (Phase 2.2) — Design

**Date:** 2026-02-21
**Status:** Approved
**Branch:** TBD

---

## Scope

Five workstreams:

1. **Replace Swagger UI with Scalar** — Swap `swagger-ui-react` for `@scalar/api-reference-react`. Rename component to `APISpecViewer`. Scalar handles both OpenAPI and AsyncAPI natively.

2. **Auto-discover specs via Temporal** — Long-running `RepositorySpecSyncWorkflow` per repository. Scans for OpenAPI/AsyncAPI spec files, imports into catalog, stays in sync via webhook signals.

3. **AsyncAPI support** — Add `asyncapi` schema type to collection, validator, metadata extraction, and wizard template.

4. **Deprecation workflow** — Deprecation action with confirmation, deprecation message field, visual banner, catalog filtering.

5. **Polish cleanup** — Finish ~6 remaining tasks from the existing polish plan (dead code, types, auth guards).

**Deferred:** Usage analytics (view/download counters, consumer tracking).

---

## 1. Scalar Integration

Replace `SwaggerUIViewer` internals with `@scalar/api-reference-react`.

- Install `@scalar/api-reference-react`
- Remove `swagger-ui-react` and `@types/swagger-ui-react`
- Rename component to `APISpecViewer`, keep re-export from old name
- Same props interface: `spec`, `version`, `className`
- Scalar handles OpenAPI and AsyncAPI — one component for both
- Dark mode support via Scalar's built-in theming (replaces CSS filter hack)

---

## 2. Temporal Workflow: RepositorySpecSyncWorkflow

### Overview

One workflow instance per repository (keyed by app ID). Long-running workflow that sleeps until signaled.

### Signals

| Signal | Trigger | Payload |
|--------|---------|---------|
| `ScanForSpecs` | Repo first linked, or manual user action | `{ appId, repoFullName }` |
| `WebhookPush` | GitHub webhook on push touching spec files | `{ appId, changedPaths[] }` |
| `ForceResync` | Manual trigger from UI | `{ appId }` |

### Workflow Loop

```
Start → Scan repo tree → Import/update specs → Sleep (wait for signal)
  ↑                                                         |
  └──────────── Signal received ────────────────────────────┘
```

### Activities

1. **`ListRepoSpecFiles`** — Uses GitHub API to list files matching known patterns:
   - `**/openapi.{yaml,yml,json}`
   - `**/asyncapi.{yaml,yml,json}`
   - `**/swagger.{yaml,yml,json}`
   - Returns file paths + SHAs.

2. **`FetchSpecContent`** — Downloads a specific spec file's content from the repo via GitHub API.

3. **`UpsertAPISchemaToCatalog`** — Calls Payload's local API to create or update an `APISchema` record.
   - Uses content hash to skip no-op updates.
   - Sets `repository` and `repositoryPath` fields automatically.
   - Auto-creates with status `draft`.

4. **`RemoveOrphanedSpecs`** — If a previously-discovered spec file is deleted from the repo, marks the catalog entry as `deprecated` with message "Spec file removed from repository." Does not hard-delete.

### Location

`temporal-workflows/internal/` alongside existing Kafka workflows. The existing worker picks up the new workflow automatically.

### Webhook Integration

Leverages the existing GitHub webhook infrastructure from Phase 2.1 (GitOps manifest sync). The webhook handler checks if pushed files match spec patterns and sends a `WebhookPush` signal to the workflow.

---

## 3. AsyncAPI Support

- Add `'asyncapi'` to `schemaType` field options in `APISchemas` collection (currently only `'openapi'`)
- Add `validateAsyncAPI()` in `schema-validators.ts` — check for `asyncapi` key, `info`, and `channels`
- Update `beforeValidate` hook in `APISchemas.ts` to detect AsyncAPI specs and extract metadata (title, description, version from `info.*`)
- Update creation wizard `SchemaContentStep` to offer AsyncAPI template alongside OpenAPI
- No separate viewer — Scalar handles both formats natively

**Not in scope:** Protobuf, GraphQL, Avro support in UI.

---

## 4. Deprecation Workflow

- **"Deprecate" button** on API detail page (visible to editors only) with confirmation dialog
- **`deprecationMessage`** text field added to `APISchemas` collection
- **Visual banner** on deprecated API detail pages: "This API has been deprecated. [reason]"
- **Catalog treatment** — deprecated APIs show dimmed/strikethrough in listings
- **Filter** in catalog to show/hide deprecated APIs (default: hidden)
- **Auto-discovery integration** — when a spec file is removed from repo, workflow marks it deprecated with reason "Spec file removed from repository"

No consumer notification system — deferred to usage analytics phase.

---

## 5. Polish Cleanup

Remaining tasks from `docs/plans/2026-02-14-api-catalog-polish.md`:

| Task | Description |
|------|-------------|
| 2 | Remove dead code: `SchemaEditor.tsx`, `APICreationWizard.tsx`, `grpc/api-catalog-client.ts` |
| 4 | Replace `any` types in `EditAPIClient` |
| 5 | Fix `canEdit` to check workspace membership |
| 7 | Fix release notes dialog state leak |
| 9 | Add auth guard to workspace APIs list |

---

## Existing Infrastructure Leveraged

- **Payload collections:** `APISchemas`, `APISchemaVersions` — full CRUD already works
- **Frontend:** Catalog listing, detail page, wizard, search/filters — all implemented
- **Server actions:** Full CRUD, search, version restore — all working
- **GitHub webhooks:** Webhook registration/cleanup from Phase 2.1
- **Temporal worker:** Existing worker in `temporal-workflows/`
- **Schema validation:** `schema-validators.ts` with OpenAPI validator

---

## What We're NOT Building

- Usage analytics / view counters (deferred)
- Consumer tracking UI (deferred)
- Protobuf/GraphQL/Avro support (deferred)
- Consumer notification on deprecation (deferred)
- Code generation from specs (deferred)
- MeiliSearch integration for spec search (deferred)
