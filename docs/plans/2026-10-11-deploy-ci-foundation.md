# Deploy and CI foundation: make prod run, gate merges, protect data

**Date:** 2026-10-11
**Status:** Plan only. Nothing here is implemented. Follows [2026-10-11-product-direction.md](./2026-10-11-product-direction.md) (item 2 of the order of work).
**Baseline:** `main` at `5ff7d026`, verified 2026-10-11 (section 2).
**Out-of-repo systems:** the ArgoCD Application lives in the gitops repo `drewpayment-hoytlabs-talos` (`apps/orbit/`); secrets live in Doppler and reach the cluster through the `orbit-secrets` ExternalSecret. Tasks that need either are tagged **[manual/out-of-repo]**.

---

## 0. Goal and non-goals

**Goal.** (A) The manifests in `infrastructure/k8s/` start every workload on a fresh sync. (B) One required PR check blocks merges that break build, types, tests or the deploy contract, and images are only published from a green main. (C) Mongo, Postgres and MinIO data can be restored, and we have proven it. (D) We find out about a broken deploy or a missed backup without a user telling us. (E) The default deployment carries only what the product uses.

**Non-goals.** HA, autoscaling, multi-region, a service mesh. Security fixes (separate parallel PRs; this plan only avoids colliding with them, section 3). Feature work.

## 1. Findings verified against the repo

Every finding from the brief was re-checked against files on `main`. Status: **confirmed**, **corrected**, or **new**.

| # | Finding | Status | Evidence / correction |
|---|---|---|---|
| 1 | orbit-www references `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_WEBHOOK_SECRET`, `GITHUB_APP_PRIVATE_KEY_BASE64` that the ExternalSecret does not produce | **Confirmed** | `kustomize build infrastructure/k8s` then diffing all `secretKeyRef`s against `externalsecret.yaml` yields exactly these four missing keys (`infrastructure/k8s/orbit-www/deployment.yaml:69-88`). Pod would sit in `CreateContainerConfigError`. |
| 1a | Canonical names | **Decided** | Code reads `GITHUB_APP_ID`, `GITHUB_APP_WEBHOOK_SECRET`, `GITHUB_APP_PRIVATE_KEY_BASE64` (and `GITHUB_APP_PRIVATE_KEY_PATH`) in `orbit-www/src/lib/github/{octokit,webhooks}.ts`. `DEV_SETUP.md:145-149` uses the same names. **Nothing in the repo reads `GITHUB_APP_CLIENT_ID/_SECRET` or `GITHUB_CLIENT_ID/_SECRET`**, so those four references are dead and should be deleted, not renamed. The ExternalSecret is the odd one out. |
| 2 | orbit-www never receives `ORBIT_SVC_AUTH_SECRET`; only repository-service and kafka-service do | **Confirmed** | Rendered manifests: `ORBIT_SVC_AUTH_SECRET` is wired into `kafka-service` and `repository-service` only. `orbit-www/src/lib/grpc/svc-auth-token.ts` throws when it is unset, so every frontend-to-Go call fails. Both Go services refuse to start without it and default to enforcing (`ORBIT_SVC_AUTH_ENFORCE=true`). |
| 3 | kafka-service cannot reach its database in k8s | **New** | `services/kafka/cmd/server/main.go:147-149` defaults `DATABASE_URL` to `postgres://orbit:orbit@localhost:5433/kafka_service`, and `postgres.NewPool` does `log.Fatalf` on a failed ping (`main.go:50-53`). `infrastructure/k8s/kafka-service/deployment.yaml` sets no `DATABASE_URL`, and `infrastructure/k8s/postgresql/init-configmap.yaml` creates only `temporal` and `orbit`, not `kafka_service` (that database exists only in compose via `infrastructure/postgres-init/02-kafka-service.sql`). As shipped, kafka-service crash-loops. The brief's "single Postgres shared by Temporal and kafka-service" describes the intent, not the manifests. **Confirm against the live cluster before trusting this** (task A0). |
| 4 | temporal-worker has no object-store config | **New** | `temporal-workflows/cmd/worker/main.go:160-180` falls back to `localhost:9000` with `minioadmin`/`minioadmin` and bucket `orbit-archives` when `MINIO_*` is unset; the k8s Deployment sets none, and `infrastructure/k8s/minio/init-job.yaml` creates only `orbit-registry`. Decommissioning archives silently go nowhere. |
| 5 | `ORBIT_REGISTRY_TOKEN` unmapped | **New** | Read in `orbit-www/src/app/actions/builds.ts:176,192` and `app/api/internal/registry-configs/[id]/credentials/route.ts:81`; absent from every manifest and from the ExternalSecret. Affects only the (frozen) Orbit-registry build path. Handled by the Phase E registry decision, tracked as a known gap in A1. |
| 6 | Unused ExternalSecret keys | **New** | `JWT_SECRET` (nothing reads it; the registry uses `ORBIT_REGISTRY_JWT_SECRET`) and `GOOGLE_CREDENTIALS` (GCP worker removed). Any ExternalSecret entry whose Doppler key is missing makes the whole sync fail, so stale entries are a liability. |
| 7 | CI gates almost nothing | **Confirmed** | `.github/workflows/`: `kafka-tests.yml` (path-filtered to `services/kafka/**`), `security.yml` (govulncheck `|| echo ::warning::`; `audit-ci ... || true` plus `continue-on-error`), `build-and-push.yml` (no tests; pushes `:latest` and `:sha-<7>`), `tech-debt-metrics.yml` (report only). No vitest, tsc, eslint, golangci-lint, Playwright, or Go tests for repository, build-service, bifrost, api-catalog, knowledge, temporal-workflows. |
| 8 | Makefile uses pnpm and short-circuits | **Confirmed** | `Makefile:72,76,92,114,141` call `pnpm`; `orbit-www/package.json` pins `bun@1.2.23`, and `test` is `bun run test:int && bun run test:e2e`. `test-go` (lines 62-68) chains seven modules with `&&`, so the first failure hides the rest. |
| 9 | Playwright config uses `pnpm dev`; one test | **Confirmed** | `orbit-www/playwright.config.ts` `webServer.command: 'pnpm dev'`; `orbit-www/tests/e2e/frontend.e2e.spec.ts` is the only spec. |
| 10 | bifrost, api-catalog, knowledge need `go mod tidy` | **Confirmed** | `go vet ./...` in each prints "updates to go.mod needed; to update it: go mod tidy". |
| 11 | Go version skew | **New** | CI pins `go-version: '1.24'` (`kafka-tests.yml`, `security.yml`) but `repository`, `kafka`, `temporal-workflows` declare `go 1.25.0`; it works only through toolchain auto-download. api-catalog and knowledge declare `go 1.21`. Use `go-version-file` per module. Also, `go.mod` at the repo root is `module test` with a stray `test_grpc.go`; it makes `go build ./...` from the root meaningless. |
| 12 | Test baseline | **Partly re-measured** | See section 2. Go numbers differ slightly from the brief because I counted top-level `--- FAIL` separately from subtests. |
| 13 | Orbit-www Docker build skips type-check | **Confirmed** | `orbit-www/next.config.mjs:11` `ignoreBuildErrors: !!process.env.DOCKER_BUILD`. A type error ships. The Dockerfile also installs bun with an unpinned `curl bun.sh/install`. |
| 14 | `:latest` everywhere, dev-grade Temporal | **Confirmed** | 8 Orbit images are `ghcr.io/drewpayment/orbit/*:latest`; third-party floating tags: `registry:2`, `mongo:7`, `postgres:15-alpine`, `redis:7-alpine`. Temporal is `temporalio/auto-setup:1.25.1` with `development-sql.yaml` dynamic config (`infrastructure/k8s/temporal/deployment.yaml:19,43`). |
| 15 | No backups | **Confirmed** | No CronJob or backup resource anywhere under `infrastructure/k8s/`. `docs/plans/2026-03-01-kubernetes-infrastructure-hardening.md` section 6 is unimplemented. PVs are NFS on `192.168.86.44:/mnt/tank/appdata/orbit/*` with `Retain` reclaim, so data survives a PVC delete but not an NFS or pool failure. |
| 16 | Health is static, no metrics | **Confirmed** | `orbit-www/src/app/api/health/route.ts` returns `{status:'ok'}`. Only bifrost serves `/metrics` (`BIFROST_METRICS_PORT`, 8080). `infrastructure/prometheus/prometheus.yml` is used only by `docker-compose.yml` (not k8s) and scrapes undefined `bifrost-stage` / `bifrost-prod`. No Prometheus, OTel or log shipping in `infrastructure/k8s/`. |
| 17 | No PDB / HPA / NetworkPolicy | **Confirmed** | Rendered manifests contain none (NetworkPolicies are coming from the security work). Three workers (`temporal-worker`, `automations-worker`, `launches-worker-azure`) have no readinessProbe. |
| 18 | Buildkit privileged, registry in default kustomization | **Confirmed** | `infrastructure/k8s/buildkit/daemonset.yaml:26` `privileged: true`; `kustomization.yaml` lists `registry` and `buildkit`. |
| 19 | Redis provisioned, unused | **Confirmed** | No `ioredis`/`go-redis`/`REDIS_*` anywhere in code, `package.json` or any `go.mod`; only the StatefulSet, PVC and compose service reference it. |
| 20 | Silent workflow gaps | **Corrected** | `SchemaValidationWorkflow` is started at `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/actions.ts:665` on queue `orbit-workflows` but not registered (`temporal-workflows/cmd/worker/main.go`): confirmed. `DeployToLaunchWorkflow` is started at `services/repository/cmd/server/main.go:499` on `launches_<provider>`; it is defined nowhere and the Azure worker (`launches-worker-azure/src/worker.ts`) registers activities only, no workflows: confirmed. The other defined-but-unregistered workflows are **7**, not "~8" (`CodeGenerationWorkflow`, `KnowledgeSyncWorkflow`, `OffsetCheckpointWorkflow`, `OffsetRestoreWorkflow`, `RepositoryWorkflow`, `TopicShareApprovedWorkflow`, `TopicShareRevokedWorkflow`), and none of those is started by any code today (`kafka-offset-recovery.ts` has the start as a `TODO`). So two real runtime gaps, seven dead definitions. |

## 2. Test baseline (main `5ff7d026`)

| Suite | Result | Notes |
|---|---|---|
| orbit-www `tsc --noEmit` | 0 errors (per 2026-10-10 run) | Keep at 0; becomes a hard gate in B4. |
| orbit-www vitest | 26 failed / 2783 passed, 22 failed files (per 2026-10-10 run) | Env (`DATABASE_URI`, `ENCRYPTION_KEY` missing) plus knowledge UI, kafka-topic-shares/catalog, AgentChatThread assertions. Not re-run here. |
| `services/kafka` | pass | Only module with a CI job. |
| `services/build-service` | 1 failing: `TestExtractBuildErrorSummary` (package `internal/builder`) | Re-measured 2026-10-11. |
| `services/repository` | `internal/service`, `tests/contract`, `tests/performance` fail to **build**; `tests/security` `TestAuthorizationSecurity` fails | Re-measured 2026-10-11. The brief mentioned only `internal/service`; being fixed in `fix/sec-go-grpc-authz`. |
| `temporal-workflows` | 14 top-level failing tests (43 counting subtests) in `internal/activities` and `internal/clients` | Re-measured 2026-10-11. `TestPayloadClient_*` (5), `TestDecommissioningActivities_*` (4), `TestKafkaActivities_ProvisionTopic`, `TestTopicSyncActivities_*` (2), `TestPerformHealthCheckActivity_Healthy`, `TestProcessActivityBatch_NewEdge`. The brief said 29; depends on whether subtests are counted. |
| `services/bifrost`, `api-catalog`, `knowledge` | cannot run until `go mod tidy` | |
| Playwright | 1 spec, never run in CI | |

## 3. Coordination with in-flight work

Do not start a task below until the listed PR is merged, or rebase onto it.

- `fix/sec-go-grpc-authz` (Go gRPC object-level authz, Bifrost admin auth): owns the `services/repository` build failures and may add a service-auth secret to the Bifrost Deployment. **A3 must re-check `bifrost/deployment.yaml` after it lands.** B3 waits for it before quarantining anything in `services/repository` or `services/bifrost`.
- NetworkPolicies (security work): adds files under `infrastructure/k8s/`. Any new egress we add (orbit-www to Postgres is not needed; kafka-service to postgresql is, A4; backup Jobs to NFS/object store, Phase C) must be added to its allow-lists. Re-run `kubectl get pods` after the policies sync.
- Feature-flag pass (`hide-unfinished`): decides which surfaces stay. E2 (registry/buildkit) and B5 (the two unregistered-workflow starters) must follow its list, not contradict it.

## 4. Phase A: make prod actually run

Goal: every Deployment in the default kustomization reaches Ready on a clean sync, and the frontend can call the Go services. Order: A0, A1 (test first, watch it fail), A2-A5, A6.

### A0. Confirm the live state **[manual/out-of-repo]**
- Steps: `kubectl -n orbit get pods`; `kubectl -n orbit describe pod -l app=orbit-www | grep -A3 -i 'secret\|Error'`; `kubectl -n orbit logs deploy/kafka-service --tail=20`; `kubectl -n orbit get externalsecret orbit-secrets`; list keys in the live secret: `kubectl -n orbit get secret orbit-secrets -o json | jq -r '.data|keys[]'`.
- Verify: written down which of findings 1-4 are true in the live cluster (the gitops repo may carry patches this repo does not). Adjust A2-A4 if the live cluster differs. Record the currently running image digests (`kubectl -n orbit get deploy -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.spec.template.spec.containers[0].image}{"\n"}{end}'` and `imageID` from pods) for A5.

### A1. Secret/env contract checker, written first
- Files:
  - `orbit-www/src/scripts/ci/check-k8s-secret-contract.ts` (new): reads `kustomize build infrastructure/k8s` (or `kubectl kustomize`) output, parses with the `yaml` package already in `orbit-www/package.json`, and exits non-zero on any violation of:
    1. every non-optional `secretKeyRef` to `orbit-secrets` names a `spec.data[].secretKey` of the ExternalSecret;
    2. every ExternalSecret `secretKey` is referenced by at least one workload or is listed in `unusedAllowlist`;
    3. every `(workload, ENV_NAME)` in the contract file is present on that workload's container `env`.
    4. no rendered image uses `:latest` or lacks a tag (enforced from A5 on; before A5 it is reported as a warning).
  - `infrastructure/k8s/env-contract.yaml` (new, hand-maintained): per workload, the env names that must be set. Seed with: orbit-www `ORBIT_SVC_AUTH_SECRET`, `ORBIT_INTERNAL_API_KEY`, `GITHUB_APP_ID`, `GITHUB_APP_WEBHOOK_SECRET`, `GITHUB_APP_PRIVATE_KEY_BASE64`, `ENCRYPTION_KEY`, `PAYLOAD_SECRET`, `BETTER_AUTH_SECRET`; kafka-service `DATABASE_URL`, `ORBIT_SVC_AUTH_SECRET`; repository-service `ORBIT_SVC_AUTH_SECRET`, `ORBIT_INTERNAL_API_KEY`; temporal-worker `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET`. Section `knownGaps` lists `orbit-www ORBIT_REGISTRY_TOKEN` with a pointer to E2 so the checker does not block until that decision.
  - `orbit-www/src/scripts/ci/check-k8s-secret-contract.test.ts` (new): pure-function tests over inline YAML fixtures (missing key, unused key, missing required env, allowlisted gap, optional ref).
- Steps (TDD): write the tests and the checker; run `cd orbit-www && ./node_modules/.bin/vitest run src/scripts/ci/check-k8s-secret-contract.test.ts` (fixtures pass); then run the checker against the real manifests and **save the failing output**: it must list `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY_BASE64`, `GITHUB_APP_WEBHOOK_SECRET` (rule 1), `JWT_SECRET`, `GOOGLE_CREDENTIALS` (rule 2), the A3/A4 env gaps (rule 3), and the `:latest` images (rule 4, warning only until A5).
- Verify: `cd orbit-www && bun run src/scripts/ci/check-k8s-secret-contract.ts ../infrastructure/k8s` exits 1 on `main`, exits 0 after A2-A4.

### A2. GitHub App secret names
- Files: `infrastructure/k8s/externalsecret.yaml`, `infrastructure/k8s/orbit-www/deployment.yaml`, `infrastructure/k8s/README.md` (Doppler table), `DEV_SETUP.md` (drop the unread `GITHUB_APP_CLIENT_ID/_SECRET` lines).
- Steps:
  1. Doppler first **[manual/out-of-repo]**: add `ORBIT_GITHUB_APP_PRIVATE_KEY_BASE64` (base64 of the App's PEM, single line); confirm `ORBIT_GITHUB_WEBHOOK_SECRET` and `ORBIT_GITHUB_APP_ID` exist. An ExternalSecret entry whose remote key is missing fails the entire sync, so Doppler must be ready before the manifest change merges.
  2. `externalsecret.yaml`: rename `secretKey: GITHUB_WEBHOOK_SECRET` to `GITHUB_APP_WEBHOOK_SECRET` (keep `remoteRef: ORBIT_GITHUB_WEBHOOK_SECRET`, no Doppler rename needed); add `secretKey: GITHUB_APP_PRIVATE_KEY_BASE64` with `remoteRef: ORBIT_GITHUB_APP_PRIVATE_KEY_BASE64`; delete `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `JWT_SECRET`, `GOOGLE_CREDENTIALS`.
  3. `deployment.yaml`: delete the `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET` env entries.
- Verify (automated): the A1 checker's rules 1 and 2 pass; `kustomize build infrastructure/k8s >/dev/null`. Verify (manual): after ArgoCD sync, `kubectl -n orbit get externalsecret orbit-secrets` is `Ready/SecretSynced`; the live secret has `GITHUB_APP_PRIVATE_KEY_BASE64`; `orbit-www` pod is Running; `POST` a test delivery from the GitHub App settings page and see HTTP 200 (signature accepted) in `kubectl logs`.

### A3. `ORBIT_SVC_AUTH_SECRET` for orbit-www
- Files: `infrastructure/k8s/orbit-www/deployment.yaml` (+ `infrastructure/k8s/bifrost/deployment.yaml` only if `fix/sec-go-grpc-authz` has added svcauth to Bifrost).
- Steps: add an env entry with `secretKeyRef` `orbit-secrets` / `ORBIT_SVC_AUTH_SECRET` next to the existing ones. The same Doppler value already feeds repository-service and kafka-service, so the secrets match by construction. Minimum length is 32 bytes (`svc-auth-token.ts` and Go `svcauth.LoadSecret` both enforce it); check the Doppler value is not shorter.
- Verify (automated): A1 rule 3 passes for orbit-www. Verify (manual): `kubectl -n orbit exec deploy/orbit-www -- sh -c 'printf %s "$ORBIT_SVC_AUTH_SECRET" | wc -c'` prints 32 or more; sign in, open a workspace Kafka page and a template dry-run (both call Go services), and see `method=... err=<nil>` in `kubectl logs deploy/kafka-service` rather than `Unauthenticated`.

### A4. Go-service env gaps (kafka-service database, temporal-worker object store)
- Files: `infrastructure/k8s/kafka-service/deployment.yaml`, `infrastructure/k8s/postgresql/init-configmap.yaml`, new `infrastructure/k8s/postgresql/ensure-databases-job.yaml` (+ its `kustomization.yaml` entry), `infrastructure/k8s/temporal-worker/deployment.yaml`, `infrastructure/k8s/minio/init-job.yaml`, `infrastructure/k8s/externalsecret.yaml` only if a new secret is needed.
- Steps:
  1. The init script runs only on an empty data directory, so an already-initialised Postgres will never create `kafka_service`. Add an idempotent Job (PreSync-style, `restartPolicy: OnFailure`, `psql ... SELECT 'CREATE DATABASE kafka_service' WHERE NOT EXISTS (...) \gexec`) and also add `CREATE DATABASE kafka_service` to the init script for fresh installs.
  2. kafka-service: set `DATABASE_URL` to `postgres://$(POSTGRES_USER):$(POSTGRES_PASSWORD)@postgresql:5432/kafka_service?sslmode=disable` using `secretKeyRef`s for the two variables (same pattern as `DATABASE_URI` in orbit-www). Caveat: the password must be URL-safe; note it in the Doppler README table. Dedicated least-privilege role is E5.
  3. temporal-worker: set `MINIO_ENDPOINT=minio:9000`, `MINIO_BUCKET=orbit-archives`, `MINIO_USE_SSL=false`, and `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` from the existing `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` keys (root credentials are a stopgap; a scoped MinIO user belongs in E5).
  4. minio init job: add `mc mb orbit/orbit-archives --ignore-existing`.
- Verify (automated): A1 rule 3 passes. Verify (manual): `kubectl -n orbit exec statefulset/postgresql -- psql -U "$POSTGRES_USER" -lqt | grep kafka_service`; `kubectl -n orbit logs deploy/kafka-service` shows migrations applied and `Using PostgreSQL persistence`; the MinIO console (or `mc ls orbit/` from a debug pod) shows `orbit-archives`; temporal-worker log line "Decommissioning activities registered with MinIO endpoint: minio:9000".

### A5. Pin images
- Files: `infrastructure/k8s/kustomization.yaml` (new `images:` block), `infrastructure/k8s/*/deployment.yaml|statefulset.yaml` (third-party tags), `orbit-www/Dockerfile` (bun version).
- Steps:
  1. Add a kustomize `images:` block mapping each `ghcr.io/drewpayment/orbit/<svc>` to `newTag: sha-<7>` using the digests recorded in A0 (or the latest known-good build). Leave the `:latest` in the per-service files; the kustomize override is what pins, and it is the single place B6's automation edits.
  2. Pin floating third-party tags to exact versions currently running: `mongo:7` to `7.0.x`, `postgres:15-alpine` to `15.x-alpine`, `redis:7-alpine` (until E1 removes it), `registry:2` to `2.8.x`. Read the running versions from the pods first; do not pull new majors. Data directories are on NFS, so a minor bump must be a deliberate, backed-up change.
  3. `orbit-www/Dockerfile`: replace `curl -fsSL https://bun.sh/install | bash` with the same installer pinned to `bun-v1.2.23` (matches `packageManager`).
- Verify (automated): `kustomize build infrastructure/k8s | grep -E 'image: ' | grep -E ':latest|image: [^:]+$'` prints nothing (add this as rule 4 of the A1 checker: no `:latest`, no tag-less image). Verify (manual): after sync, `kubectl -n orbit get pods -o jsonpath='{..image}' | tr ' ' '\n' | sort -u` shows only pinned tags and no pod restarted unexpectedly.

### A6. Rollout order and rollback **[manual/out-of-repo]**
1. Doppler changes (A2 step 1, any A4 secret). 2. Merge A2-A5 as one PR (they are one contract). 3. Let ArgoCD sync; watch `kubectl -n orbit get pods -w` and the ExternalSecret. 4. Smoke: sign in, open catalog, run a template dry-run, open Kafka page, confirm webhook delivery. 5. Rollback is `git revert` of the PR and a sync; the Doppler additions are harmless to leave.

## 5. Phase B: one CI gate

Goal: a single workflow, `ci`, whose aggregate job `ci-gate` is the only required status check. `build-and-push` runs only after it passes. Known failures are quarantined with a tracked issue, never silently skipped.

### B1. Fix the Makefile
- File: `Makefile`.
- Steps: replace `pnpm` with `bun run` / `./node_modules/.bin/...` (`test-frontend`: `cd orbit-www && bun run test:int`; `lint-frontend`: `bun run lint`; `build`: `bun run build`; `test-e2e`: `bunx playwright test`; `security`: `bunx audit-ci --moderate`; `install-deps`: `bun install`). Rewrite `test-go`, `lint-go`, `security`, `build` as a loop over `GO_MODULES := services/repository services/build-service services/kafka services/bifrost services/api-catalog services/knowledge temporal-workflows proto` that records failures and exits non-zero at the end (`failed=0; for m in ...; do (cd $$m && go test -race -count=1 ./...) || failed=1; done; exit $$failed`). Use the same variable in CI (B4) so local and CI agree.
- Verify: `make test-go` runs all modules even when the first fails and exits non-zero; `make lint-frontend` and `make test-frontend` work without pnpm installed.

### B2. Make every Go module build
- Files: `services/bifrost/go.{mod,sum}`, `services/api-catalog/go.{mod,sum}`, `services/knowledge/go.{mod,sum}`; optionally delete root `go.mod` and `test_grpc.go` (ask Drew first; they look like leftovers).
- Steps: `cd <module> && go mod tidy`; review the diff (should only add missing requires/sums); commit. Do not mix with `fix/sec-go-grpc-authz` edits to bifrost: rebase after it lands.
- Verify: `go vet ./... && go build ./...` clean in each of the three; `go test -race -count=1 ./...` runs (failures, if any, go to B3).

### B3. Triage the baseline; quarantine with a ratchet
- Files: `docs/testing/quarantine.md` (new, the register), `orbit-www/src/scripts/ci/check-quarantine.ts` (new), plus the tests themselves.
- Steps:
  1. Re-run the suites with CI-like env (below) and classify each failing file: **env** (fix by supplying env), **real bug** (fix now if small, else quarantine), **stale test** (fix or delete).
  2. For vitest env failures: give CI a `mongo:7` service container, `DATABASE_URI=mongodb://localhost:27017/orbit-ci`, and a fixed test `ENCRYPTION_KEY` (32 random bytes, base64, checked into the workflow as a non-secret test value) so those 22 files exercise real code instead of being excluded.
  3. For each remaining failure: open a GitHub issue, then mark the test `it.skip` / `t.Skip` with a comment `QUARANTINE(#<issue>): <reason>`. Known candidates: `TestPayloadClient_*` (the `/api` vs `/api/internal` prefix mismatch is a one-line fix in `temporal-workflows/internal/clients`; fix rather than quarantine), `TestExtractBuildErrorSummary`, kafka-topic-shares/catalog and AgentChatThread vitest assertions, knowledge UI tests. `services/repository` build failures wait for `fix/sec-go-grpc-authz`.
  4. `check-quarantine.ts` greps for `QUARANTINE(#` and fails if the count exceeds the number recorded in `docs/testing/quarantine.md` (ratchet: it may only go down) or if any skip lacks an issue number.
- Verify: with the B4 environment, vitest and `go test` are green; `check-quarantine.ts` passes and fails when a bare `it.skip` is added in a scratch branch.

### B4. The `ci` workflow
- Files: `.github/workflows/ci.yml` (new; `on: pull_request, merge_group, workflow_call`), `.github/workflows/kafka-tests.yml` (remove only its `unit-tests` job, which `ci` now covers; keep `migration-roundtrip` and `integration-tests`, which need a Postgres service container and run path-filtered, and fold them into `ci` as `kafka-migrations` / `kafka-integration` later), `.golangci.yml` (new, root, default linters plus `gosec` off initially).
- Jobs (all `permissions: contents: read`, actions pinned to full SHAs or major tags consistently with the repo):
  - `changes`: `dorny/paths-filter` (already used in `build-and-push.yml`) to decide which of go/web/k8s/workflows jobs run.
  - `go` (matrix over `GO_MODULES`): `actions/setup-go` with `go-version-file: <module>/go.mod`, `go vet ./...`, `go build ./...`, `go test -race -count=1 ./...`. `proto/**` changes run every module (they all `replace` the proto module).
  - `lint-go`: `golangci/golangci-lint-action` pinned version, `--new-from-rev=origin/main` so only new findings fail (no mass cleanup).
  - `web`: `oven-sh/setup-bun` at the `packageManager` version, `bun install --frozen-lockfile`, `bun run typecheck` (hard gate, baseline 0), `bun run lint`, `bun run test:int` with the mongo service container and test env from B3. Cache `~/.bun/install/cache`.
  - `contracts`: `bun run src/scripts/ci/check-k8s-secret-contract.ts ../infrastructure/k8s` (A1), `check-workflow-registration.ts` (B5), `check-quarantine.ts` (B3), plus `kustomize build infrastructure/k8s | kubeconform -strict -ignore-missing-schemas -schema-location default -schema-location 'https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json' -summary -` (ExternalSecret and HTTPRoute schemas come from the CRDs catalog; pin the kubeconform version).
  - `images`: on PRs touching a service directory, `docker/build-push-action` with `push: false` and the existing gha cache, same matrix as `build-and-push.yml`, so a Dockerfile break is caught before main.
  - `ci-gate`: `needs: [all above]`, `if: always()`, fails if any needed job result is `failure` or `cancelled` (skipped counts as success). This is the single required check, which keeps path filters from deadlocking merges.
- Verify (automated): open a throwaway PR that (a) breaks a Go test, (b) adds a TS type error, (c) removes a `secretKeyRef` target; each turns `ci-gate` red for the right job; a clean PR is green. Verify (manual): record median wall-clock; if over about 12 minutes, split `web` into typecheck+lint and test shards.

### B5. Workflow-registration contract test
- Files: `orbit-www/src/scripts/ci/check-workflow-registration.ts` and `.test.ts` (new); `infrastructure/ci/workflow-registration-allowlist.yaml` (new).
- Design: build a map `taskQueue -> registered workflow names` from (1) `RegisterWorkflow(workflows.X)` / `RegisterWorkflowWithOptions` in `temporal-workflows/cmd/worker/main.go` (queue from `worker.New(c, "<queue>", ...)`), (2) exported `*Workflow` functions in `orbit-www/services/automation-worker/src/workflows/` (queue `orbit-automations`), (3) workflows in `launches-worker-azure/src` (queue `launches_azure`; currently none). Then collect **starts**: TS `client.workflow.start('<Name>', { taskQueue: ... })`, Go `ExecuteWorkflow(ctx, client.StartWorkflowOptions{TaskQueue: ...}, "<Name>" | <const>, ...)`, and child-workflow executions. Resolve Go constants (`types.ScaffolderWorkflowName`, `agentcontract.WorkflowInfrastructureAgent`) through a small explicit table in the script; an unresolved non-literal start fails the check with a "add to resolver" message rather than being ignored. Task-queue values that are templates (`launches_%s`) are expanded for providers `azure` and `digitalocean`.
- Failing cases today (write the tests from these first, watch them fail): `SchemaValidationWorkflow` on `orbit-workflows`; `DeployToLaunchWorkflow` on `launches_azure` and `launches_digitalocean`.
- Resolution of the two real gaps (decide with the feature-flag pass; each is a separate PR, not part of this task): either implement and register, or remove the starter and flag the UI. The seven dead definitions go in the allowlist with a reason ("defined, never started") so the allowlist documents them and the check fails the day someone starts one.
- Verify (automated): `vitest run src/scripts/ci/check-workflow-registration.test.ts`; on `main` the script exits 1 listing exactly the two gaps; after the allowlist and the two decisions, exits 0.

### B6. Gate publishing on CI and pin by SHA
- Files: `.github/workflows/build-and-push.yml`, `.github/workflows/bump-images.yml` (new).
- Steps:
  1. In `build-and-push.yml` add `jobs.ci: uses: ./.github/workflows/ci.yml` and make `build` `needs: [changes, ci]`. Keep the `workflow_dispatch` path but require `ci` there too.
  2. Stop pushing `:latest` (nothing deploys it after A5). Push `:sha-<full 12>` and the git SHA label; keep the short tag only if the gitops flow needs it.
  3. `bump-images.yml`: after a successful build on main, edit the `images:` block in `infrastructure/k8s/kustomization.yaml` for the services that changed and **open a PR** (never push to main, per repo rules) titled `chore(deploy): bump images to sha-<7>`. Merging that PR is the deploy; reverting it is the rollback. Alternative if Drew prefers: Argo CD Image Updater in the gitops repo **[manual/out-of-repo]**; trade-off is that deploy state then lives outside this repo and is not reviewable here.
- Verify: merge a trivial `orbit-www` change; `build-and-push` does not start until `ci` is green; a bump PR appears with only the changed tag; after merging it ArgoCD rolls only that Deployment. Break a test on a scratch branch targeting main in a fork or with `workflow_dispatch` and confirm no image is pushed.

### B7. Make security scanning real
- File: `.github/workflows/security.yml`.
- Steps: remove `|| true` / `continue-on-error` from the audit step; run `govulncheck` per module and fail on findings (govulncheck already reports only reachable vulnerabilities; keep `GOTOOLCHAIN` consistent with B4); `bunx audit-ci --high` (start at `high`, ratchet to `moderate` once clean); pin `govulncheck@<version>` instead of `@latest`; add `gosec` as non-blocking annotations first. Add a weekly `schedule:` trigger because vulnerabilities appear without code changes.
- Verify: a deliberately vulnerable pinned dependency in a scratch branch fails the job; the clean main passes. Make it a second required check only after it has been green for a week.

### B8. Playwright
- Files: `orbit-www/playwright.config.ts`, new `.github/workflows/e2e.yml`.
- Steps: change `webServer.command` to `bun run dev`; set `baseURL`; run e2e on `schedule` and `workflow_dispatch` against a docker-compose stack (`make docker-up` equivalent with mongo only), **not** in `ci-gate` until the suite has more than a smoke test and is stable. Add a login-and-open-catalog smoke spec using the seeded dev account pattern.
- Verify: the workflow passes on `main` three nights running before it is promoted to required.

### B9. Branch protection **[manual/out-of-repo]**
- GitHub repo settings: require PR, require status check `ci-gate`, require branch up to date, no force-push to `main`, enable merge queue if PR volume warrants (the workflow already listens for `merge_group`). Do not require the path-filtered `kafka-tests` jobs (a skipped required check blocks merges).
- Verify: a PR with a failing check cannot be merged by an admin without override.

## 6. Phase C: data safety

Goal: any single store can be restored from a backup that lives in a different failure domain than the NFS export, and a restore drill has been run.

### C1. Inventory and targets
- File: `docs/runbooks/backup-restore.md` (new; also creates `docs/runbooks/`).
- Content: what is stored where. MongoDB `orbit-www` database (all application data, including encrypted credentials; useless without `ENCRYPTION_KEY`, so key escrow in Doppler is part of the backup story). PostgreSQL databases `temporal`, `temporal_visibility` (if present), `orbit`, `kafka_service`. MinIO buckets `orbit-registry` (frozen feature) and `orbit-archives`. Redpanda topics are tenant data but out of scope here (state the decision: no topic backup; rely on retention and the customers' own producers). Targets proposed for Drew to confirm: RPO 24 h (6 h for Mongo), RTO 4 h.
- Verify: Drew signs off the RPO/RTO line.

### C2. MongoDB backup CronJob
- Files: `infrastructure/k8s/backup/mongodb-cronjob.yaml`, `infrastructure/k8s/backup/kustomization.yaml` (new), `infrastructure/k8s/kustomization.yaml`.
- Steps: CronJob every 6 h, `mongo:7` pinned image, `mongodump --uri=... --archive --gzip` streamed to the destination chosen in C5, `concurrencyPolicy: Forbid`, `successfulJobsHistoryLimit: 3`, `failedJobsHistoryLimit: 3`, `activeDeadlineSeconds`. The Mongo deployment is a single node, not a replica set, so `--oplog` is unavailable; accept point-in-time inconsistency across collections or run the dump against a brief `fsyncLock` (document the choice). Write a `last-success` timestamp object next to the dump for the D4 alert.
- Verify (automated): `kustomize build` + kubeconform clean. Verify (manual): `kubectl -n orbit create job --from=cronjob/mongodb-backup manual-1`; the archive appears at the destination and `mongorestore --archive --gzip --dryRun` accepts it.

### C3. PostgreSQL backup CronJob
- File: `infrastructure/k8s/backup/postgres-cronjob.yaml`.
- Steps: nightly `pg_dump -Fc` per database (`temporal`, `orbit`, `kafka_service`) plus `pg_dumpall --globals-only`, with the same retention and timestamp mechanism. Use the pinned `postgres` image matching the server major.
- Verify (manual): `pg_restore --list` on each dump succeeds; sizes are non-trivial.

### C4. MinIO backup
- File: `infrastructure/k8s/backup/minio-cronjob.yaml`.
- Steps: nightly `mc mirror --overwrite --remove=false orbit/orbit-archives <destination>`; `orbit-registry` only if E2 keeps the registry. Pin `minio/mc`.
- Verify (manual): object counts match source and destination.

### C5. Destination and credentials **[manual/out-of-repo]**
- Decision for Drew. Options: (a) rclone/`mc` push to an off-site S3-compatible bucket (Backblaze B2 or similar), credentials in Doppler (`ORBIT_BACKUP_*`), added to the ExternalSecret; (b) NAS ZFS snapshots of `/mnt/tank/appdata/orbit/*` plus (a) for off-site. Do **not** write backups into the same NFS dataset as the live data (same failure domain) or into the in-cluster MinIO (same cluster). Recommendation: (a), with (b) as a cheap extra layer.
- Verify: backup bucket visible from outside the cluster; lifecycle rule keeps 14 daily and 8 weekly.

### C6. Restore drill
- Files: `scripts/ops/restore-drill.sh` (new), `docs/runbooks/backup-restore.md`.
- Steps: script creates a scratch namespace, restores the latest Mongo and Postgres dumps into throwaway pods, runs counts (`users`, `workspaces`, Temporal `executions`) and prints them next to production counts. Run it once for real, record time taken, and fix the runbook where it was wrong. Repeat quarterly (calendar entry).
- Verify: drill completes within the RTO; counts match within the RPO window.

## 7. Phase D: observability minimum

Goal: a broken deploy, a crash loop, a full disk or a missing backup produces a notification within minutes. No tracing project.

### D1. Real health endpoints
- Files: `orbit-www/src/app/api/health/route.ts` (keep as liveness, static), `orbit-www/src/app/api/ready/route.ts` (new), `orbit-www/src/app/api/ready/route.test.ts`, `infrastructure/k8s/orbit-www/deployment.yaml`.
- Steps (test first): `/api/ready` pings Mongo through the Payload/Mongoose connection with a short timeout and returns 503 on failure; it must not call Temporal or the Go services (a downstream blip must not take the frontend out of rotation). Point `readinessProbe` at `/api/ready`; leave `livenessProbe` on `/api/health` so a DB outage does not restart-loop the pod. Exempt both paths from auth and from the NetworkPolicy deny rules; they must be reachable by the kubelet.
- Verify (automated): vitest covers up/down. Verify (manual): scale Mongo to 0, orbit-www goes NotReady but is not restarted; scale back, it recovers.

### D2. Worker readiness
- Files: the three worker Deployments (`temporal-worker`, `automations-worker`, `launches-worker-azure`).
- Steps: they expose no HTTP port. Add a minimal health listener to each (Go: `net/http` handler on `:8086` returning 200 once `worker.Start()` succeeds; Node: same) or, if Drew prefers no code change, an exec probe that checks the process is connected. Recommend the HTTP listener; it is also the hook for D3.
- Verify: `kubectl get pods` shows READY only after the worker registered; a worker that cannot reach Temporal stays NotReady.

### D3. Metrics and alerts (assumes a cluster Prometheus; confirm in A0)
- Files: `infrastructure/k8s/observability/prometheusrule.yaml`, `infrastructure/k8s/observability/servicemonitor-bifrost.yaml` (new), `infrastructure/prometheus/prometheus.yml`.
- Steps: if the cluster has no Prometheus Operator, installing one (kube-prometheus-stack) belongs in the gitops repo **[manual/out-of-repo]**; keep these files out of the default kustomization until the CRDs exist (`infrastructure/k8s/observability/kustomization.yaml` as an optional component) so the sync does not fail. Rules need no app instrumentation, only kube-state-metrics and kubelet: pod restarts > 3 in 15 min, Deployment unavailable > 5 min, PVC > 80% full, CronJob failed, **backup age**: alert if `time() - kube_job_status_completion_time{job_name=~"(mongodb|postgres|minio)-backup.*"}` for the latest successful job > 26 h (> 8 h for Mongo). ServiceMonitor scrapes Bifrost `:8080/metrics`. Fix the compose-only `prometheus.yml` by deleting the undefined `bifrost-stage` / `bifrost-prod` jobs.
- Verify (manual): kill a pod repeatedly in a test namespace and see the restart alert fire; pause the Mongo CronJob (`suspend: true`) and see the backup-age alert after the threshold in a shortened-threshold test.

### D4. Alert delivery **[manual/out-of-repo]**
- Alertmanager receiver (email or Slack webhook from Doppler). Verify with a synthetic alert (`amtool alert add`).

### D5. Log sink
- Options, decision for Drew: (a) Grafana Alloy or promtail to Loki in-cluster with 14-day retention (cheap, matches a kube-prometheus-stack/Grafana setup); (b) ship to a hosted service (Grafana Cloud free tier, Axiom). Minimum bar: logs survive pod restarts and are searchable by `namespace=orbit, app=<name>`. Orbit services already log to stdout; no code change needed. The agent and workflow runs also keep their own audit trails in Payload/Temporal, so this is for operations, not audit.
- Files: collector manifests in the gitops repo **[manual/out-of-repo]**; a note in `docs/runbooks/` on how to query.
- Verify: after `kubectl delete pod -l app=orbit-www`, the previous pod's last log lines are still searchable.

### D6. Deferred (explicitly)
OpenTelemetry tracing, per-request metrics in orbit-www, SLOs, uptime probes from outside the cluster (one external HTTP check on `https://orbit.hoytlabs.app/api/health` is a cheap exception; add it to whatever uptime service Drew already uses).

## 8. Phase E: footprint reduction

Each task is optional-order; do them after A and B. All of them shrink what an operator must reason about.

### E1. Drop Redis
- Files: `infrastructure/k8s/redis/` (delete), `infrastructure/k8s/kustomization.yaml`, `docker-compose.yml` (service and `redis-data` volume), `infrastructure/k8s/README.md` (NFS directory list), docs mentioning Redis in `README.md` / `CLAUDE.md` data-layer line (only if Drew approves touching CLAUDE.md).
- Evidence: no Redis client in any manifest of dependencies or source (finding 19). Re-run `grep -rniE "ioredis|go-redis|REDIS_"` on the day, and check `.agent/system/` docs for planned use.
- Verify: `kustomize build` has no redis; full smoke (A6 step 4) passes; the NFS directory can be archived and removed manually.

### E2. Registry and Buildkit out of the default kustomization
- Files: `infrastructure/k8s/kustomization.yaml`, move `infrastructure/k8s/registry` and `infrastructure/k8s/buildkit` under `infrastructure/k8s/optional/` with their own kustomization (a Kustomize component Drew can opt into from the gitops repo), and decide `build-service` (it needs both: `BUILDKIT_HOST`, `ORBIT_REGISTRY_*`).
- Why: both are frozen capabilities (CLAUDE.md), `buildkit` is a `privileged: true` DaemonSet, and the build flow is not on the core journey. Resolves the `ORBIT_REGISTRY_TOKEN` known gap from A1 (the code path is unreachable when the feature is hidden; remove the entry from `knownGaps`).
- Depends on: the feature-flag pass hiding builds and the Orbit-registry UI first; otherwise users can click into a feature whose backend is gone.
- Verify: A1 and B4 checks pass on the reduced kustomization; `kubectl get ds,deploy -n orbit` shows no buildkit or registry after sync and the UI shows no dead links.

### E3. Replace Temporal `auto-setup` (options, decision needed)
`temporalio/auto-setup` is documented as a development convenience (it runs schema setup and the server in one container) and the dynamic config is `development-sql.yaml`.

| Option | What changes | Pros | Cons |
|---|---|---|---|
| (a) Keep auto-setup, pin it, replace dynamic config with a reviewed `production-sql`-style file, add a PVC-backed Postgres backup (C3) | Smallest; mostly config | Zero migration risk; one pod | Still the dev image; upgrades re-run schema setup implicitly |
| (b) Plain manifests with `temporalio/server` plus an admin-tools schema Job (`temporal-sql-tool`) as a PreSync hook | New Job, Deployment splits into frontend/history/matching/worker or stays single-process `temporalio/server` | Separates schema migration from serving; explicit upgrades | More YAML to own; still single-node durability |
| (c) Temporal Cloud | Worker/client config gets namespace, endpoint, mTLS cert or API key; drop the temporal Deployment, Temporal UI proxy and the `temporal`/`temporal_visibility` databases | No Temporal operations; real HA and retention; backups are theirs | Recurring cost; workflow data leaves the cluster (matters for the data-handling story); an auth/secret contract to add to A1 |
- Recommendation: (a) now (cheap, covered by C3), revisit (c) when the hosted-trial work starts, because that is when Temporal operations become someone else's pager. Do not adopt (b) unless (a) causes an incident.
- Note: temporal-worker must stay at `replicas: 1` and two worker builds must not share a task queue (existing ops constraint).
- Verify (for (a)): temporal dynamic config reviewed against Temporal's production sample; pod restarts without losing running workflows (start a long workflow, delete the pod, confirm it resumes).

### E4. Availability primitives, deliberately small
- PodDisruptionBudgets and HPAs are not worth adding at `replicas: 1` (a PDB with `minAvailable: 1` on a single replica blocks node drains). Set `strategy.type: Recreate` where a PVC is mounted read-write-once. Leave NetworkPolicies to the security work. Revisit if any Deployment goes to 2 replicas.
- Verify: documented here; nothing to ship.

### E5. Postgres roles and sharing
- Files: `infrastructure/k8s/postgresql/init-configmap.yaml`, the ensure-databases Job from A4, `externalsecret.yaml`.
- Steps: one Postgres instance is acceptable, but give Temporal and kafka-service separate roles scoped to their own databases instead of the superuser, and stop passing the superuser password into app pods. Same for MinIO: a scoped user for `orbit-archives` instead of root credentials in temporal-worker. Backups (C3) already dump per database, so separation does not complicate restore.
- Verify: `psql -U kafka_service -d temporal` is denied; services still start.

## 9. Sequencing and ownership

| Order | Work | Can run in parallel with |
|---|---|---|
| 1 | A0, A1, then A2-A5 in one PR, A6 | security PRs (touch different files) |
| 2 | B1, B2, B3, B4 (then B5, B6, B7) | A; B3 waits for `fix/sec-go-grpc-authz` for repository/bifrost |
| 3 | C1-C6 | B (needs only A done) |
| 4 | D1-D5 | C |
| 5 | E1-E5 | after the feature-flag pass lands (E2) |

Suggested slicing for parallel agents: slice 1 = A1-A5 (manifests + checker); slice 2 = B1+B2+B4+B7 (Makefile, tidy, `ci.yml`, security); slice 3 = B3 (triage, needs a human decision on each failure); slice 4 = B5 (contract test) and B6; slice 5 = C. Each slice on its own branch, each reviewed adversarially before its PR is opened.

## 10. Definition of done

1. A fresh `kustomize build infrastructure/k8s` applied to an empty namespace reaches all-Ready with Doppler populated per `infrastructure/k8s/README.md`, and the A6 smoke passes.
2. A PR that breaks a Go test, a type, a lint rule, the secret contract or workflow registration cannot merge; images are published only from a green main and referenced by SHA.
3. The quarantine register is committed, every entry has an issue, and the count is ratcheted.
4. A restore drill has been performed from an off-site backup and timed.
5. Pod crash-loops, NotReady Deployments, full volumes and stale backups page a human.

## 11. Issues to open when work starts
One tracking issue per phase (A-E), plus: kafka-service k8s DB wiring (finding 3), temporal-worker MinIO config (finding 4), `SchemaValidationWorkflow` unregistered, `DeployToLaunchWorkflow` undefined, `ORBIT_REGISTRY_TOKEN` unmapped, and one issue per quarantined test from B3.
