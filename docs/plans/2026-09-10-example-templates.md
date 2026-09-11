# Example templates: realistic software-engineering golden paths

**Status:** planned 2026-09-10. Depends on Phases 0–4 of in-app template authoring (all merged, `main` at 1eeacc3).

## 0. Goal

Ship a checked-in, seedable set of realistic `orbit/v2` template definitions and
Orbit-hosted skeleton bundles that exercise the shipped action registry the way a
platform team would actually use it. Every template must pass `validateTemplateDefinition`
and a dry run against a dev workspace. Nothing here changes engine code.

## 1. Constraints verified against the repo

- Definition shape: `orbit-www/src/lib/scaffolder/schema.ts` (`apiVersion: orbit/v2`, `kind: Template`, `metadata.{name,title,description,tags,owner,targetKind}`, `spec.{parameters[],steps[],output}`). Step ids are `^[a-z][a-z0-9-]*$`.
- Expression roots: `parameters.*`, `steps.<id>.output.*`, `user.{id,email,name}`, `workspace.{id,slug,name}`, `template.{id,versionId,...}`. Filters: `lower upper kebabCase pascalCase snakeCase default json` via `${{ x | filter }}` (`temporal-workflows/internal/scaffolder/expr.go`).
- `fs:render` `values` is `map[string]string` — every value must be a string. File content and path names use Go `text/template` with `{{ .KEY }}` and funcs `lower upper title trim trimPrefix trimSuffix replace default quote kebabCase snakeCase pascalCase camelCase contains hasPrefix hasSuffix join split indent nindent toJson` (`temporal-workflows/internal/templating/funcs.go`). Files listed under `rawFiles` in an `orbit-template.yaml` at the bundle root are copied verbatim (needed for GitHub Actions `${{ }}` and Helm files).
- Skeleton bundles: ≤ 50 files, ≤ 1 MB, UTF-8 text only (`orbit-www/src/lib/scaffolder/skeleton-bundle.ts`). Stored inline on `template-skeletons.files[].{path,content}`; unique on `(workspace, slug)`.
- Registered actions and required inputs: `services/repository/internal/grpc/scaffolder_actions.json`. Pickers that exist: `OrbitTeamPicker`, `OrbitEntityPicker`, `OrbitSkeletonPicker` (`ui:field`). Other `ui:*` keys honoured: `ui:help`, `ui:widget` (`textarea`), `ui:placeholder`, `ui:secret`, `ui:visibleIf`.
- `catalog:entity:register` kinds: `service api resource datastore kafka-topic domain system team` (`orbit-www/src/collections/catalog/constants.ts`). Pass `workspaceId: ${{ workspace.id }}`, `templateDefinitionId: ${{ template.id }}`, `templateVersionId: ${{ template.versionId }}` so the golden-path scorecard rule passes.
- `git:push` authenticates only with a GitHub App `installationId`. **Azure DevOps repos cannot receive scaffolded content yet** (follow-up: ADO connection token in `git:push`). This batch therefore targets GitHub only; an ADO variant is listed under follow-ups.
- Dev fixtures: workspace `backend-engineers` (`6a5170666129976230ff0e0d`), GitHub installation `118088915` (`drewpayment`). No Kafka virtual clusters exist in dev, so the Kafka template dry-runs but cannot execute for real locally.

## 2. Deliverables (file paths)

```
templates/examples/
  README.md                                   how to seed, what each template does
  skeletons/
    go-http-service/                          Go 1.22 stdlib HTTP service
      orbit-template.yaml                     rawFiles: [".github/workflows/*.yml"]
      go.mod  main.go  internal/server/server.go  internal/server/server_test.go
      Dockerfile  Makefile  README.md  .gitignore  .github/workflows/ci.yml  catalog-info.yaml
    go-kafka-consumer/                        Go consumer (franz-go) with graceful shutdown
      orbit-template.yaml  go.mod  main.go  internal/consumer/consumer.go  internal/consumer/consumer_test.go
      Dockerfile  Makefile  README.md  .gitignore  .github/workflows/ci.yml  config.example.yaml
    go-openapi-server/                        Go server stub that embeds and serves the registered OpenAPI doc
      orbit-template.yaml  go.mod  main.go  api/openapi.yaml  internal/handlers/handlers.go
      internal/handlers/handlers_test.go  Dockerfile  Makefile  README.md  .gitignore  .github/workflows/ci.yml
  definitions/
    go-http-service.yaml
    nextjs-web-app.yaml
    kafka-event-consumer.yaml
    openapi-rest-api.yaml
    production-service-onboarding.yaml
orbit-www/src/scripts/seed-example-templates.ts
orbit-www/src/scripts/__tests__/seed-example-templates.test.ts
```

Skeleton directories are the source of truth; the seed script reads them from disk and builds the `files[]` array. Skeleton file content uses `{{ .SERVICE_NAME }}`-style keys; the definitions supply exactly those keys in `fs:render.values`.

## 3. The five templates

Shared conventions: page 1 "About the service" (`name` with `pattern ^[a-z][a-z0-9-]*$`, `description`, `owner` via `OrbitTeamPicker`); page 2 "Repository" (`githubOrg` default `drewpayment`, `installationId` with `ui:help` explaining where to find it, `private` boolean default true). Every template ends with `catalog:entity:register` and an `output.links` list. Every step has a `name`; long-running steps set `timeout`.

1. **`go-http-service`** — "Go HTTP service (stdlib)". Steps: `fetch:orbit-skeleton` (skeletonId is a parameter with `ui:field: OrbitSkeletonPicker`, default resolved by the seed script to the `go-http-service` skeleton id) → `fs:render` (values: `SERVICE_NAME`, `MODULE_PATH`, `PORT`, `OWNER`, `DESCRIPTION`) → `github:repo:create` → `git:push` (`commitMessage: "chore: scaffold ${{ parameters.name }} from Orbit template"`) → `catalog:entity:register` kind `service` with links to repo. Output: repo link, catalog entity link.
2. **`nextjs-web-app`** — "Next.js web app from a GitHub template repository". Page 2 adds `sourceOwner`/`sourceRepo` (defaults `vercel/next-learn`-style placeholder the seed README tells the user to change) . Steps: `github:repo:create-from-template` → `catalog:entity:register` kind `service` with `links[{title: Repository}]` → `debug:log` summarising. Shows that not every template needs rendering.
3. **`kafka-event-consumer`** — "Event consumer with provisioned topic". Page 1 adds `topicName` (pattern), `environment` enum `dev|staging|production`, `partitions` integer default 3, `virtualClusterId` (text, `ui:help`). Steps: `approval:request` with `if: ${{ parameters.environment == 'production' }}` (check the `if` operator support in `expr.go` first; if equality is not supported, use a boolean parameter `requireApproval` with `ui:visibleIf`) → `kafka:topic:provision` → `fetch:orbit-skeleton` (go-kafka-consumer) → `fs:render` (values include `TOPIC_NAME: ${{ steps.topic.output.topicName }}`) → `github:repo:create` → `git:push` → `catalog:entity:register` kind `service`. Output links: repo, topic.
4. **`openapi-rest-api`** — "Spec-first REST API". Page 1 adds `openapiSpec` (`ui:widget: textarea`, default = a small valid OpenAPI 3.1 doc with `/healthz` and one resource path, `ui:help`). Steps: `api:schema:register` (`schemaType: openapi`, `content: ${{ parameters.openapiSpec }}`) → `fetch:orbit-skeleton` (go-openapi-server) → `fs:render` (values include `OPENAPI_SPEC: ${{ parameters.openapiSpec }}` written into `api/openapi.yaml` via `{{ .OPENAPI_SPEC }}`) → `github:repo:create` → `git:push` → `catalog:entity:register` kind `api` linking to the schema (`/api-catalog/${{ steps.register-schema.output.slug }}`) and repo.
5. **`production-service-onboarding`** — "Production service onboarding (composed)". Demonstrates composition, approval and the agent. Page 1: `name`, `owner`, `justification` textarea; page 2 as shared. Steps: `approval:request` (message includes requester `${{ user.email }}` and justification, `timeoutHours: 48`) → `fetch:template` (`templateDefinitionId` resolved by the seed script to the `go-http-service` definition id, `parameters` passthrough of name/owner/githubOrg/installationId/private) → `agent:run` (`title: "Post-scaffold review for ${{ parameters.name }}"`, prompt asks the agent to review the new repository `${{ parameters.githubOrg }}/${{ parameters.name }}` and propose a CODEOWNERS and dependabot config) → `debug:log`. Verify in `scaffolder_fetch_template.go` how nested outputs surface; if the outer template cannot read nested outputs, the prompt uses parameters only (as written).

## 4. Seed script

`bun run seed:example-templates -- --workspace backend-engineers [--installation 118088915] [--publish]`

- Uses `getPayload` like `src/scripts/seed-permissions.ts`.
- Upserts skeletons by `(workspace, slug)`; bumps `version` when content changed (the existing `skeleton-version-bump` hook handles this).
- Upserts definitions by `(workspace, slug)`. Rewrites placeholders `${skeleton:<slug>}` and `${template:<slug>}` in the YAML to real ids **before** creating the version. Default `installationId` is rewritten from `--installation`. Creates a new version only when `definitionJson` differs from the current version.
- `--publish` sets `status: published` and `currentVersion`, via the same code path as `publishTemplateDefinition` in `authoring-actions.ts` (import and reuse, do not duplicate).
- Calls `validateTemplateDefinition`-equivalent shape validation (`TemplateDefinitionSchema.safeParse`) and refuses to write an invalid document.
- `createdBy` is required on both collections: resolve the first platform-admin user or accept `--user <email>`.
- Unit tests (vitest) cover placeholder rewriting, dedupe-by-hash, and skeleton dir → files[] conversion (including `orbit-template.yaml` being included as a file).

## 5. Verification

Automated:
- `cd orbit-www && bunx vitest run src/scripts/__tests__/seed-example-templates.test.ts`
- `cd orbit-www && bunx tsc --noEmit` stays at 0 errors.
- A vitest that loads every `templates/examples/definitions/*.yaml`, substitutes dummy ids for placeholders, and asserts `TemplateDefinitionSchema.safeParse` succeeds.
- `cd temporal-workflows && go test ./internal/templating/... ./internal/scaffolder/...` unchanged (no code changes expected).

Manual (lead):
- Seed into `backend-engineers` on the dev stack, open each template at `/self-service/templates/<id>/edit`, confirm the validator panel is clean (registry-level validation runs there), and run a dry run of each from `/self-service/templates/<id>/run`. `go-http-service` and `openapi-rest-api` dry runs must show rendered file previews; `kafka-event-consumer` must show the approval gate as skipped for `dev` and pending for `production`.
- agent-browser with the pgrep pre/post-flight from CLAUDE.md.

## 6. Follow-ups (not in scope)

- Azure DevOps variant blocked on `git:push` ADO token support (also `ado:pipeline:create` needs a pushed `azure-pipelines.yml`).
- No `OrbitKafkaClusterPicker`/`OrbitConnectionPicker`/installation picker exist; those fields are plain text with help.
- `fs:render` preview is "unsupported" when `path` comes from a prior step (known Phase 4 follow-up), so dry-run file previews for skeleton→render chains may be limited; report what the UI actually shows.
