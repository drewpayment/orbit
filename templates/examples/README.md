# Example templates

Five checked-in `orbit/v2` template definitions and three Orbit-hosted
skeleton bundles, seeded into a workspace with
`orbit-www/src/scripts/seed-example-templates.ts`. They exist to exercise
the shipped scaffolder action registry the way a platform team would
actually use it — not as toy demos.

## Seed it

```sh
cd orbit-www
bun run seed:example-templates -- --workspace <workspace-slug> [--installation <github-app-installation-id>] [--publish] [--user <email>]
```

- `--workspace <slug>` (required) — which workspace's `template-skeletons`
  and `template-definitions` rows to upsert into. On the local dev stack
  this is `backend-engineers`.
- `--installation <id>` — a GitHub App installation id, substituted for
  every `${installation}` placeholder in the definitions' `installationId`
  default. On the local dev stack this is `118088915` (the `drewpayment`
  installation). Omit it and the seed script removes the `installationId`
  parameter's `default` entirely, rather than leaving the literal
  `${installation}` text visible as a default value — the field is simply
  blank until an author fills it in.
- `--publish` — attempts to publish each definition's latest version. **This
  will fail** the first time you seed a definition — see "About `--publish`"
  below — that failure is expected, reported per template, and does not
  stop the rest of the run.
- `--user <email>` — attribute the seeded rows' `createdBy` to this user.
  Defaults to the first `super_admin`/`admin` user found in the workspace's
  workspace if omitted.

The script is idempotent: re-running it with unchanged source files is a
no-op (no new skeleton version, no new template-definition-versions row).
Edit a skeleton file or a definition YAML and re-run to push the update —
a changed skeleton bumps its `template-skeletons.version`; a changed
definition creates a new `template-definition-versions` draft snapshot.

## About `--publish`

Publishing a template version requires (enforced by
`lib/scaffolder/versions.ts#publishVersion`, the same gate the in-app
"Publish" button goes through):

1. The version has passed static validation (`validatedAt` is set), and
2. The version has a recorded, **succeeded**, **dry** run of that exact
   version.

Neither of those can happen from a script — they require actually invoking
the Temporal-backed scaffolder engine, which only happens through the
authoring UI or a live template run. So the realistic flow is:

1. `bun run seed:example-templates -- --workspace <slug> --installation <id>`
   to create the draft definitions.
2. For each template, open `/self-service/templates/<id>/edit`, confirm the
   validator panel is clean, then run a dry run from
   `/self-service/templates/<id>/run`.
3. Re-run the seed command with `--publish` (or publish from the editor UI
   directly) — the gate now passes.

## The five templates

| Template | Steps | Demonstrates |
| --- | --- | --- |
| **`go-http-service`** — Go HTTP service (stdlib) | fetch skeleton → render → create repo → push → register in catalog | The baseline golden path: skeleton fetch + render + GitHub + catalog. |
| **`nextjs-web-app`** — Next.js web app from a GitHub template repository | create-from-template → register in catalog → log | A template with no rendering step at all — `github:repo:create-from-template` does the work. `sourceOwner`/`sourceRepo` default to a placeholder (`vercel/next-learn`); point them at your own org's Next.js template repo before running for real. |
| **`kafka-event-consumer`** — Event consumer with provisioned topic | (optional) approval → provision topic → fetch skeleton → render → create repo → push → register | Composes a real infrastructure side effect (`kafka:topic:provision`) with the scaffold. Production-style approval gating via a `requireApproval` boolean parameter (see below). |
| **`openapi-rest-api`** — Spec-first REST API | register API schema → fetch skeleton → render → create repo → push → register (kind `api`) | Spec-first flow: the OpenAPI document is both registered in the API catalog *and* embedded into the scaffolded server via `fs:render`. |
| **`production-service-onboarding`** — Production service onboarding (composed) | approval → fetch:template (composes `go-http-service`) → agent:run → log | Template composition (`fetch:template`) plus kicking off an Infrastructure Agent run to propose CODEOWNERS/Dependabot config. |

### Prerequisites per template

- **`go-http-service`, `nextjs-web-app`, `kafka-event-consumer`,
  `openapi-rest-api`, `production-service-onboarding`**: a GitHub App
  installation connected at Settings → Connections → GitHub (its
  installation id is the `installationId` parameter).
- **`kafka-event-consumer`**: a Kafka virtual cluster (Platform → Kafka →
  Virtual Clusters) to pass as `virtualClusterId`. **No virtual clusters
  exist on the local dev stack**, so this template's dry run will show the
  step but cannot execute for real locally.
- **`production-service-onboarding`**: depends on `go-http-service` already
  being seeded in the same workspace (the seed script resolves
  `${template:go-http-service}` for you — no manual step needed as long as
  both definitions are in `templates/examples/definitions/`).

### The `kafka-event-consumer` approval gate

A step's `if` is evaluated as boolean truthiness of a single `${{ }}`
expression — there is no `==` operator in the expression language. So
"require approval only in production" is modeled as an explicit
`requireApproval` boolean parameter (default `false`, with `ui:help`
"Required for production") rather than
`if: ${{ parameters.environment == 'production' }}`. Leave it unchecked for
a dev/staging run (the approval step is skipped); check it before running
against `production`.

## The three skeletons

All three are real, compiling Go 1.22 code (verified with `go build`,
`go vet`, and `go test` against a rendered copy) — not placeholders:

- **`go-http-service`** — stdlib `net/http` service: `GET /healthz`,
  `GET /`, graceful shutdown, Dockerfile, Makefile, GitHub Actions CI.
- **`go-kafka-consumer`** — [franz-go](https://github.com/twmb/franz-go)
  consumer with a small `Consumer` type (config validation, poll loop,
  graceful shutdown), unit-tested without a live broker.
- **`go-openapi-server`** — embeds `api/openapi.yaml` via `go:embed` and
  serves it at `GET /openapi.yaml`, plus a `/widgets` example resource
  matching the default OpenAPI document from `openapi-rest-api.yaml`.

Each skeleton's `orbit-template.yaml` lists its `.github/workflows/*.yml`
under `rawFiles` so `fs:render` copies GitHub Actions' own `${{ }}`
expressions verbatim instead of trying to resolve them as Orbit
expressions.

## Layout

```
templates/examples/
  README.md                    this file
  skeletons/<slug>/             source of truth for each template-skeletons bundle;
                                 the seed script reads this directory tree into files[]
  definitions/<slug>.yaml       source of truth for each template-definitions version
```

Skeleton file content uses Go `text/template` syntax (`{{ .KEY }}`,
uppercase snake_case keys) — the exact keys each definition's `fs:render`
step supplies in `values`. Definition YAML uses `${skeleton:<slug>}` /
`${template:<slug>}` / `${installation}` placeholders, rewritten to real
Payload ids by the seed script before the document is validated and
written.
