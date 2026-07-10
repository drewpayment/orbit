# GraphQL schema import support (Catalog Discovery → api-schemas)

**Date:** 2026-07-10
**Status:** Implementation complete (WI1-WI5); manual/agent-browser verification pending
**Branch:** `feat/graphql-schema-import`

## Problem

Catalog Discovery detects GraphQL schemas (`detectApiSpecs` emits `schemaType: 'graphql'`
with high confidence when the file is real SDL), but approving the proposal skips the
import with `unsupported-schema-type:graphql`, shown in the UI as
"GRAPHQL specs aren't importable yet."

Root cause chain:
- `orbit-www/src/collections/api-catalog/APISchemas.ts:174` — `schemaType` select only
  allows `openapi` / `asyncapi`.
- `orbit-www/src/lib/discovery/import.ts:50` — `SUPPORTED_API_SCHEMA_TYPES` mirrors that
  enum, so `importDiscoveredApi` returns the skip.
- Everything downstream (projection, review queue) already passes `schemaType` through
  as an opaque string; the global-entity import path (`importDiscoveredGlobalEntity`)
  already imports graphql rows fine.

## Work items (TDD: write/adjust the failing test first for each)

### WI1 — `api-schemas` collection accepts `graphql` — DONE
File: `orbit-www/src/collections/api-catalog/APISchemas.ts`
- Add `{ label: 'GraphQL', value: 'graphql' }` to the `schemaType` select options;
  update the field + `rawContent` admin descriptions ("OpenAPI, AsyncAPI, GraphQL").
- beforeValidate hook: `extractSpecMetadata` is YAML-based and returns `null` for SDL —
  keep it from misfiring, and add a GraphQL-aware metadata branch when
  `data.schemaType === 'graphql'` (or content sniffs as SDL):
  - use the existing `graphql` dependency (`^16.8.1`, orbit-www/package.json): `parse()`
    the SDL; on success set `endpointCount` = total fields across
    `Query`/`Mutation`/`Subscription` object type definitions (0 if none).
  - never throw from the hook on unparseable content — leave metadata unset.
- Regenerate types: `cd orbit-www && pnpm generate:types` → `payload-types.ts`
  `schemaType: 'openapi' | 'asyncapi' | 'graphql'`.
- Implemented as a new exported `extractGraphQLMetadata()` in `detectors.ts` (parses SDL
  via the `graphql` package, counts Query/Mutation/Subscription fields, returns `null` on
  unparseable content) with its own unit tests in `detectors.test.ts` — the hook branches
  on `data.schemaType === 'graphql'` to call it instead of `extractSpecMetadata`, and
  regenerated `payload-types.ts` (used `bun run generate:types`, not `pnpm` — this repo's
  `package.json` pins `packageManager: bun@1.2.23`; there is no `pnpm-lock.yaml`).

### WI2 — importer allows graphql — DONE
File: `orbit-www/src/lib/discovery/import.ts`
- Add `'graphql'` to `SUPPORTED_API_SCHEMA_TYPES` (line 50) and widen the cast at
  line 338 to `'openapi' | 'asyncapi' | 'graphql'`.
- Update the now-stale doc comments (lines 23, 44–49, 255–258).
- Test: flip `import.test.ts:417` ("SKIPS graphql proposals…") into "imports graphql
  proposals into api-schemas" — assert created row has `schemaType: 'graphql'`,
  `rawContent`, `repositoryPath`, and the discovery row flips to
  `status: 'imported'` + `importedRef`. Keep a skip test for a genuinely unknown
  type (e.g. `protobuf`) so the guard still has coverage.
- Note: filename-only (medium-confidence) graphql proposals have no `rawContent` and
  still skip with `missing-raw-content` — unchanged, already covered.
- Also flipped the equivalent graphql-skip test in `actions-core.test.ts` (the
  `approveDiscoveriesCore` suite had its own copy) to expect a successful import, with a
  new skip test there for a genuinely unsupported type (`protobuf`).

### WI3 — real GraphQL validation — DONE
File: `orbit-www/src/lib/schema-validators.ts`
- Replace the regex-heuristic `validateGraphQL` body with `graphql` package `parse()`:
  syntax errors → `{ valid: false, errors: [{ line, message }] }` (GraphQLError has
  `locations`). Keep the empty-content → valid behavior and the exported signature.
- Update/extend `schema-validators` tests accordingly (check for an existing test file).
- No existing test file was found for `schema-validators.ts`; created
  `orbit-www/src/lib/schema-validators.test.ts` scoped to `validateGraphQL` (empty
  content, valid SDL, unparseable SDL with line/message, dangling `type` keyword).

### WI4 — API detail page renders SDL instead of feeding Scalar — DONE
Files: `orbit-www/src/app/(frontend)/catalog/apis/[id]/api-detail-client.tsx`,
`orbit-www/src/components/features/api-catalog/SwaggerUIViewer.tsx`
- `APISpecViewer` parses spec as JSON/YAML and hands it to Scalar's
  `ApiReferenceReact` — GraphQL SDL would hit the "Invalid specification format" error.
- Add an optional `schemaType` prop to `APISpecViewer`; when `'graphql'`, render the
  SDL in a scrollable `<pre>` code block (match existing dark-theme styling used
  elsewhere in the app) instead of Scalar. Pass the doc's `schemaType` from
  `api-detail-client.tsx` (the api-schemas doc is already loaded there).
- Keep behavior identical for openapi/asyncapi.
- No dedicated component test was added for `APISpecViewer`/`api-detail-client.tsx` (none
  existed prior to this change, and the plan's verification section defers UI checks to
  manual/agent-browser). Covered by `tsc` + the manual verification pass below.

### WI5 — types — DONE
File: `orbit-www/src/types/api-catalog.ts:10` — widen `schemaType` union to include
`'graphql'`. Grep for any other `'openapi' | 'asyncapi'` unions that now conflict
(`tsc` will catch them; keep tsc at 0 errors — that is a repo requirement).
- Grepped for other `'openapi' | 'asyncapi'` unions: only `detectors.ts` (already
  `'openapi' | 'asyncapi' | 'graphql'` pre-existing for the filename-match type) and
  `import.ts` (updated in WI2). `tsc --noEmit` is clean (0 errors).

### Out of scope (follow-ups, do NOT do now)
- Manual "New API" wizard graphql support (`wizard/SchemaContentStep.tsx`,
  `apis/actions.ts:47` hardcodes `openapi`).
- GraphQL-native doc viewer (GraphiQL-style); the SDL code block is Phase 1.
- Go api-catalog service / proto changes — import path is TS-only via Payload.

## Verification
1. `cd orbit-www && pnpm exec vitest run src/lib/discovery/import.test.ts src/lib/discovery/actions-core.test.ts src/lib/schema-validators.test.ts` (only touched suites — main carries ~98 unrelated pre-existing vitest failures; do not chase those).
2. `cd orbit-www && pnpm exec tsc --noEmit` → 0 errors.
3. Manual/agent-browser (done by main session after implementation): approve the
   `drewpayment/booksrus` graphql proposal in Catalog Discovery → row moves to
   Imported, api-schemas row exists, catalog API detail page renders the SDL.
