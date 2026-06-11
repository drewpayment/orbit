# Strip Non-Core Capabilities — Implementation

**Date:** 2026-06-10
**Status:** In progress
**Parent:** `docs/plans/2026-06-09-product-focus-strategy.md` §3 (accepted scope)
**Branch:** `chore/strip-non-core-capabilities`

Removes the AWS/GCP launches workers, the plugins gRPC service (+ its Backstage proxy
chain), and the Backstage backend; freezes container registry and health monitoring.
Deleting the GCP worker removes the audit's #1 critical (command injection in
`deploy-static-site.ts`) by removal. Pre-strip state is tagged
`archive/pre-strip-2026-06-10` for archaeology.

Verified dependency facts (from repo-wide reference mapping):
- No code imports across the deleted trees (Azure worker, temporal-workflows, and
  orbit-www have zero imports from the AWS/GCP worker dirs).
- The agent tool registry (`temporal-workflows/internal/activities/agent/tool_registry_activity.go`
  → orbit-www `/api/internal/agent-tools`) is fully independent of `services/plugins`.
  Nothing to migrate.
- The plugins service's only consumers are `orbit-www/src/components/plugins/{JiraIssuesList,GitHubPRsList}.tsx`
  (rendered only by the orphaned, unlinked `/workspaces/[slug]/integrations` page),
  proxying to a Backstage backend that was never deployed. The entire chain is dead surface.

## 1. Deletions

| Path | What |
|---|---|
| `launches-worker-aws/` | AWS worker (292K) |
| `launches-worker-gcp/` | GCP worker — contains audit Critical #1 |
| `services/plugins/` | Plugins gRPC service (unauthenticated listener, 15 TODOs) |
| `services/backstage-backend/` | Orphaned Backstage scaffold |
| `infrastructure/k8s/launches-worker-aws/`, `infrastructure/k8s/launches-worker-gcp/`, `infrastructure/k8s/plugins-service/` | K8s manifests |
| `proto/idp/plugins/v1/plugins.proto` + `proto/gen/go/idp/plugins/` + `orbit-www/src/lib/proto/idp/plugins/` | Proto surface + generated code |
| `orbit-www/src/lib/grpc/plugins-client.ts` | Frontend gRPC client |
| `orbit-www/src/components/plugins/` | JiraIssuesList, GitHubPRsList |
| `orbit-www/src/app/(frontend)/workspaces/[slug]/integrations/` | Orphaned Backstage-plugins page (no inbound links) |
| `orbit-www/src/collections/PluginRegistry.ts`, `PluginConfig.ts` | Orphaned collections (existing Mongo records remain, harmless) |
| `orbit-www/src/seed/plugins-seed.ts`, `orbit-www/src/scripts/seed-plugins.ts` | Plugin seed data |
| `docs/plans/2026-03-03-gcp-launches-{design,implementation}.md` | → move to `docs/archive/` |

## 2. Wiring edits

- `docker-compose.yml`: remove `launches-worker-aws`, `launches-worker-gcp`,
  `plugins-service` service blocks and the commented `backstage-backend` block.
- `Makefile`: remove the two workers from the dev service list; remove
  `services/plugins` from `test-go`/`lint-go`/`security`/`build`; remove the
  `backstage-*` targets and backstage section of `install-deps`.
- `.github/workflows/build-and-push.yml`: remove path filters, `changes` outputs,
  filter rules, and matrix entries for `launches-worker-aws`, `launches-worker-gcp`,
  `plugins-service`.
- `infrastructure/k8s/kustomization.yaml`: remove the three resource lines.
- `orbit-www/src/payload.config.ts`: remove PluginRegistry/PluginConfig imports +
  registrations; regenerate types (`bun run generate:types`) and importmap.

## 3. Provider enum shrink (aws/gcp → azure/digitalocean only)

- `orbit-www/src/components/features/launches/ProviderSelector.tsx` — type union + PROVIDERS array
- `orbit-www/src/components/features/launches/ProviderIcon.tsx` — providerConfig keys
- `orbit-www/src/collections/LaunchTemplates.ts` — provider select options
- `orbit-www/src/collections/Launches.ts` — provider select options
- `orbit-www/src/app/actions/cloud-accounts.ts` — 3 type unions
- `orbit-www/src/app/(frontend)/settings/cloud-accounts/cloud-accounts-settings-client.tsx` —
  form type, defaults, select options, aws/gcp credential input blocks
- `orbit-www/src/seed/launch-templates-seed.ts` — drop AWS/GCP templates

Existing aws/gcp records in Mongo (launches, templates, cloud accounts) remain but
become read-only orphans; acceptable for the current single-tenant install.

## 4. Temporal routing guard

`temporal-workflows/internal/workflows/launch_workflow.go`: `taskQueueForProvider`
currently formats any provider into a queue name; an aws/gcp launch would now hang
forever on a queue with no worker. Add a supported-provider check (azure,
digitalocean) that fails the workflow with a clear error before dispatch. Update
`launch_workflow_test.go` accordingly.

## 5. Freeze notes (no code removal)

- `README.md`: capability status note — container registry + health monitoring frozen.
- `CLAUDE.md`: same note in Important Notes.
- Header comments on `RegistryConfigs.ts`, `RegistryImages.ts`, `HealthChecks.ts`,
  `health_check_workflow.go`.

## 6. Verification

- `cd temporal-workflows && go build ./... && go test -race ./internal/workflows/ -run TestLaunch`
- `cd orbit-www && bun run lint` — zero errors
- `cd orbit-www && DOCKER_BUILD=1 bun run build` — exit 0 (CI-equivalent)
- `grep -ri "launches-worker-aws\|launches-worker-gcp\|plugins-service\|backstage-backend"`
  across compose/Makefile/workflows/k8s returns nothing
- CI `Build and Push Images` green on the PR merge (matrix shrinks by 3 images)
