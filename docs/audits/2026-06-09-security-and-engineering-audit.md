# Security & Principal Engineering Audit — 2026-06-09

**Scope**: Full repo at commit `0d3ed8a` (tip of `main`), with emphasis on recent work:
Better Auth + Payload RBAC integration (#36, #37), Phase 2.6 tech-debt wave / Kafka service (#38),
and the cloud launches workers (AWS/GCP/Azure).

**Method**: Four parallel deep audits — (1) frontend auth/RBAC, (2) Go services,
(3) launches workers, (4) infrastructure/secrets/process.

---

## Executive Summary

The recent RBAC work (#36/#37) meaningfully improved the frontend security posture: session
checks are consistent, the admin-approval flow is solid, credentials are encrypted at rest, and
most `overrideAccess: true` usages are now justified system operations. SQL handling in the new
Kafka Postgres layer is clean and its integration tests are real and well-built.

However, the platform is **not production-safe in its current state**. The dominant theme is a
**trust-boundary gap**: the frontend authenticates users, but almost everything behind it — Go
gRPC services, Temporal activity inputs, internal callbacks — trusts its caller. Combined with
hardcoded default secrets that fail open, an attacker who reaches the internal network (or in
several cases, any authenticated user) can cross tenant boundaries.

**Top 5 risks (fix before anything else):**

1. **Command injection in the GCP deploy worker** — user-controlled `branch`/`repoUrl`/`buildCommand`
   interpolated into `execSync` in a process holding cloud credentials (root in container).
2. **No authentication on Kafka and Plugins gRPC services**; repository service trusts a
   caller-supplied `user-id` metadata header. No tenant isolation at the gRPC layer.
3. **Pulumi state effectively unencrypted** — passphrase absent in K8s, public dev passphrase
   default in compose; provisioned DB passwords also returned plaintext into Temporal history.
4. **IDOR in deployment/launch server actions** — any authenticated user can read generated
   files, trigger deploys, or delete launches in workspaces they don't belong to.
5. **Fail-open default secrets committed to the repo** — `orbit-internal-dev-key`,
   `dev-secret-key` (JWT), `orbit-registry-token`, `orbit-secret-key` (MinIO root),
   `orbit-dev-passphrase` (Pulumi) all authenticate successfully if env vars are unset.

---

## Area 1: Frontend (orbit-www) — Auth, RBAC, Server Actions

### Critical

| ID | Finding | Location |
|----|---------|----------|
| FE-C1 | `GET /api/workspaces` is unauthenticated — anonymous enumeration of all workspaces (names, slugs, settings, hierarchy) | `src/app/api/workspaces/route.ts:7-16` |
| FE-C2 | `POST /api/seed-generators` is an unauthenticated mutation endpoint; idempotency check fails open on empty collection | `src/app/api/seed-generators/route.ts:8-51` |

### High

| ID | Finding | Location |
|----|---------|----------|
| FE-H1 | Kafka admin routes check session but leave `// TODO: Verify platform admin role` — any authenticated user can register/delete clusters | `src/app/api/kafka/admin/clusters/route.ts:21,46`, `clusters/[id]/route.ts:24`, `providers/route.ts:21` |
| FE-H2 | `Workspaces` collection has `read: () => true` — all workspace records (incl. settings JSON, quotas) publicly readable | `src/collections/Workspaces.ts:12` |
| FE-H3 | IDOR: `getGeneratedFiles` fetches deployment with `overrideAccess: true` and returns generated manifests with no workspace membership check | `src/app/actions/deployments.ts:409-435` |
| FE-H4 | IDOR: `startDeployToLaunch` triggers cloud deployment with no workspace membership check | `src/app/actions/deployments.ts:923-965` |
| FE-H5 | IDOR: `startLaunch`/`retryLaunch`/`deleteLaunch`/`getLaunchStatus` operate on launches (real cloud infra) without verifying caller membership; `createLaunch` checks, the rest don't | `src/app/actions/launches.ts:105,223,260,290` |
| FE-H6 | `getCloudAccounts`/`getLaunches` accept arbitrary `workspaceId` without membership verification — cross-tenant enumeration | `src/app/actions/launches.ts:446-496` |

### Medium

- **FE-M1** Inconsistent membership lookups: some collections query `workspace-members` by Payload
  `user.id`, others by `betterAuthId` (the documented field). Whichever is wrong always returns
  0 rows — silently wrong allow/deny. (`src/collections/EnvironmentVariables.ts:80`,
  `Deployments.ts:18` vs `KnowledgeSpaces.ts`, `WorkspaceMembers.ts`)
- **FE-M2** `getActiveLaunchesForWorkspace` — same missing membership check (`deployments.ts:890-921`).
- **FE-M3** `listServiceAccounts` enumerates service accounts for any `virtualClusterId`
  (`kafka-service-accounts.ts:597-636`).
- **FE-M4** `RegistryConfigs` single-doc read returns `true` for any authenticated user; registry
  configs contain encrypted credentials (`src/collections/RegistryConfigs.ts:29-30`).
- **FE-M5** `EnvironmentVariables` uses `user.collection === 'users'` as an admin proxy instead
  of role check — every Payload user gets cross-workspace env-var access
  (`src/collections/EnvironmentVariables.ts:79-81`).
- **FE-M6** Internal API key compared with `===` (timing-unsafe); no rotation story. Use
  `crypto.timingSafeEqual` (all 29 `api/internal/*` routes).
- **FE-M7** Verification URL with one-time token logged to stdout in dev; ensure `NODE_ENV` is
  explicitly set in prod (`src/lib/auth.ts:20-27`).

### Low

- `allowDynamicClientRegistration: true` on the OAuth provider (`src/lib/auth.ts:149`) — disable
  unless required, or enforce strict redirect-URI validation.

### Strengths

- Consistent `getPayloadUserFromSession()` first-line checks across server actions.
- Robust pending/rejected-user session blocking + email-verification enforcement in Better Auth hooks.
- `requireAdmin()` used consistently in bifrost-admin, kafka-admin, cloud-accounts actions.
- Encrypted at-rest credentials (RegistryConfigs, EnvironmentVariables, GitHubInstallations).
- `overrideAccess` inventory: most uses are justified system/hook operations; the exceptions are
  FE-H3/FE-H4 above.
- 5-minute cooldown on service-account password rotation.
- No hardcoded secrets in frontend source.

---

## Area 2: Go Services (gRPC backend)

### Critical

| ID | Finding | Location |
|----|---------|----------|
| GO-C1 | Kafka service has **zero authentication** — only a logging interceptor; any network client can register clusters, create/delete topics, approve access, revoke service accounts | `services/kafka/cmd/server/main.go:76-78` |
| GO-C2 | Plugins service has zero server-level auth (`// TODO: Add interceptors for logging, auth, metrics`); per-handler JWT checks inconsistently applied | `services/plugins/cmd/server/main.go:44-46` |

### High

- **GO-H1** Repository/api-catalog servers accept `user-id` from gRPC metadata without verification —
  forgeable identity used directly in authorization decisions
  (`services/repository/internal/grpc/repository_server.go:550-567`, `api_catalog_server.go:491-508`).
- **GO-H2** No workspace/tenant isolation in Kafka gRPC: `workspace_id` taken from request body,
  never validated against caller identity — cross-tenant read/write.
- **GO-H3** Weak default JWT secret `"dev-secret-key"` hardcoded
  (`services/plugins/internal/config/config.go:40`). Fail fast instead.
- **GO-H4** Temporal Visibility query injection: caller-controlled `WorkflowType`/`Status`
  interpolated via `fmt.Sprintf` into the visibility query
  (`services/repository/internal/grpc/temporal_server.go:261-270`).
- **GO-H5** Service-layer errors forwarded verbatim to gRPC callers via response `Error` fields
  (~15 sites across `services/kafka/internal/grpc/*`, e.g. `cluster_handler.go:53-56`) —
  potential SQL/internal-state leakage.
- **GO-H6** `CreatedBy: uuid.Nil // TODO: Get createdBy from auth context` — audit trail broken
  (`services/kafka/internal/grpc/share_handler.go:177-182`).

### Medium

- **GO-M1** Division by zero when `req.Limit == 0` (`repository_server.go:321-324` — `req.Offset / req.Limit`).
- **GO-M2** No upper bound on `ListWorkflows` page size (`temporal_server.go:256-258`).
- **GO-M3** `CreateTopic` doesn't validate name/partitions/replication (`topic_handler.go:28-56`).
- **GO-M4** Default DB URL `postgres://orbit:orbit@...?sslmode=disable` hardcoded
  (`services/kafka/cmd/server/main.go:137-139`).
- **GO-M5** Stray `test_grpc.go` (`package main`) at repo root — breaks `go build ./...`.
- **GO-M6** `services/kafka/go.mod` declares `go 1.25.0` — verify toolchain pin is intentional/valid.
- **GO-M7** gRPC reflection unconditionally enabled in plugins service (kafka correctly gates on
  non-production) (`services/plugins/cmd/server/main.go:60`).

### Low

- Dead auth helpers (`extractUserID`/`extractWorkspaceID`) defined but never wired (`temporal_server.go`).
- Fire-and-forget `go s.initiateCodeGeneration(context.Background(), ...)` — no timeout/cancellation;
  should be a Temporal workflow (`repository_server.go:228-230`).
- `%v`-formatted internal Temporal errors returned to callers (`temporal_server.go:207`).

### Strengths

- **SQL injection: clean.** All Kafka Postgres repos use parameterized queries; the dynamic WHERE
  builder in `share_repo.go` interpolates only placeholder indices.
- **Integration tests are real**: `//go:build integration`, live Postgres, migrations applied,
  per-test transaction rollback. The `DBTX` interface design is good.
- Consistent UUID parsing → `InvalidArgument`; graceful shutdown in all servers; clean
  golang-migrate embedded-migration setup; good domain-error mapping in
  `repository_server.go:handleServiceError`.

---

## Area 3: Launches Workers (AWS/GCP/Azure) — Highest Blast Radius

### Critical

| ID | Finding | Location |
|----|---------|----------|
| LW-C1 | **Command injection**: `input.branch`, `input.repoUrl` interpolated into `execSync("git clone ...")`; `input.buildCommand` passed as-is to shell. Worker env holds GCP/AWS creds + MinIO/Pulumi creds | `launches-worker-gcp/src/activities/deploy-static-site.ts:36,58` |
| LW-C2 | Pulumi state encryption broken: `PULUMI_CONFIG_PASSPHRASE` **absent from all three K8s deployments**; compose default is the public string `orbit-dev-passphrase`. State in MinIO contains generated DB passwords | `infrastructure/k8s/launches-worker-*/deployment.yaml`, `docker-compose.yml:139` |

### High

- **LW-H1** `destroyInfra` (and `provisionInfra`) accept arbitrary `stackName` with no tenant
  scoping — a forged activity input can destroy/overwrite any tenant's stack
  (all three `src/activities/destroy.ts`).
- **LW-H2** `templatePath` path traversal: user-controlled segment in `path.resolve` with no
  base-dir assertion; Pulumi could execute an arbitrary project at the resolved path
  (all six `provision.ts`/`destroy.ts`).
- **LW-H3** Pulumi **secret** outputs (DB passwords) copied into activity return values ignoring
  the `output.secret` flag → persisted plaintext in Temporal history/Postgres
  (all three `provision.ts`).
- **LW-H4** All three Dockerfiles run as root (no `USER node`); GCP worker installs Pulumi into
  `/root/.pulumi` — root confirmed. Combined with LW-C1 this is container-escape-adjacent.
- **LW-H5** `ORBIT_INTERNAL_API_KEY || "orbit-internal-dev-key"` fallback — the public default
  authenticates against `api/internal/deployments/[id]/status` (which then uses
  `overrideAccess: true`) (`launches-worker-gcp/src/activities/update-deployment-status.ts:4`).

### Medium

- **LW-M1** GCP Cloud SQL provisioned with `ipv4Enabled: true`, no authorized networks, and
  `deletionProtection: false` (`templates/resources/cloud-sql-postgresql/index.ts:23-25`).
- **LW-M2** Azure Postgres firewall `0.0.0.0 → 0.0.0.0` = open to **all Azure tenants**; no
  VNet/private endpoint (`templates/resources/postgresql-flexible/index.ts:53-59`).
- **LW-M3** `input.buildEnv` spread **after** `process.env` — can override worker cloud creds or
  inject `LD_PRELOAD` (`deploy-static-site.ts:62`).
- **LW-M4** Static-site CDN path is HTTP-only (`TargetHttpProxy`, port 80); bucket disables
  uniform bucket-level access (`templates/bundles/static-site/index.ts`).
- **LW-M5** No pod/container `securityContext` on any worker deployment; liveness probe is `ls /tmp`.
- **LW-M6** No egress `NetworkPolicy` — a compromised worker can reach MongoDB/Postgres/Redis/everything.

### Low

- Temporal connection plaintext (no mTLS) — sensitive payloads transit cluster network unencrypted.
- AWS worker K8s deployment maps MinIO root creds into `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` —
  real AWS calls will fail or misroute; use separate creds/IRSA.
- `gcp-sa.json` mount path expected in source dir; only root `.gitignore` covers it
  (worker-level `.gitignore` does not).
- Azure default VNet NSG opens SSH (22) to `0.0.0.0/0` (`templates/resources/vnet/index.ts:36-47`).

### Strengths

- Cloud credentials are **not** passed through workflow payloads — ambient credential chain via
  env (correct architecture).
- External Secrets Operator + Doppler for K8s secrets, consistently applied.
- `pulumi.secret()` correctly wraps generated DB passwords (defeated downstream by C2/H3).
- S3 template defaults to private with full public-access block.
- Resource requests/limits set on all worker pods; Temporal heartbeats on long activities.
- `RESERVED_PARAM_KEYS` prevents user parameters from overriding provider project/region config.

---

## Area 4: Infrastructure, CI, and Process

### Critical

- **IN-C1** MinIO root creds `orbit-admin`/`orbit-secret-key` hardcoded as literals (no env
  indirection) in `docker-compose.yml:287-288`, `infrastructure/registry/config.yml:7-8`, and
  `infrastructure/registry/init-bucket.sh:5`. MinIO backs the Pulumi state and container registry.
- **IN-C2** `ORBIT_REGISTRY_PASSWORD=orbit-registry-token` hardcoded in compose (`:189`), as a
  comparison sentinel in `services/build-service/internal/builder/builder.go:297`, and as a
  runtime fallback in `orbit-www/src/app/actions/builds.ts:185,201`.

### High

- **IN-H1** Fail-open `:-` defaults for all security-critical vars: `ORBIT_INTERNAL_API_KEY`
  → `orbit-internal-dev-key`, `JWT_SECRET` → `dev-secret-key`, `ORBIT_REGISTRY_JWT_SECRET` →
  `...-dev-only-32chars` (`docker-compose.yml:90,141,191,359`).
- **IN-H2** `buildkit` container `privileged: true` + Docker socket mounted into `build-service`
  (`docker-compose.yml:173,193`); BuildKit DaemonSet also `privileged: true` in K8s
  (`infrastructure/k8s/buildkit/daemonset.yaml:26`).
- **IN-H3** Both Postgres instances use trivial creds (`temporal:temporal`, `orbit:orbit`),
  `sslmode=disable`, ports bound to all interfaces.
- **IN-H4** **gosec never runs in CI** — `make security` has no workflow trigger; `security.yml`
  only runs govulncheck. Frontend audit runs with `|| true` + `continue-on-error: true`
  (never blocks). Security workflow's `push` trigger to main is commented out.
- **IN-H5** Root `.gitignore` has **no `.env` coverage**; `orbit-www/test.env` is committed
  (currently benign content).

### Medium

- Mutable image tags (`mongo:latest`, `minio:latest`, `moby/buildkit:latest`).
- MongoDB runs with no authentication, port 27017 published.
- Third-party GitHub Actions pinned to tags, not SHAs (`dorny/paths-filter@v3`, etc.) — and
  `docker/login-action` receives `GITHUB_TOKEN`.
- `kafka-tests.yml` migration-roundtrip job gated on PR title/label containing "kafka" — fragile.
- No top-level `permissions:` block on three workflows.
- No Pulumi state/`.pulumi/` gitignore entries; no `credentials.json`/`*.pem` patterns.
- Two `wip` commits merged directly to `main` (`1a38894`, `b64f388`) — bypassed stated PR workflow.
- Stray root files: `test_grpc.go`, `PROTO_SETUP_COMPLETE.md`, `WORKSPACE_IMPLEMENTATION.md`,
  `contract-tests-summary.md`, `integration-tests-summary.md`.
- `make test-go` `&&`-chains services (one failure silently skips the rest); coverage HTML
  overwritten per service; `make security` runs gosec against the Node-based backstage-backend.

### Low

- No `CODEOWNERS`; no Dependabot config.
- Test-fixture password in `services/bifrost/internal/kafkaconfig/jaas_test.go` will trip
  secret scanners — replace with an obviously synthetic value.

### Strengths

- K8s secrets fully externalized (ExternalSecret/Doppler); no plaintext secrets in manifests.
- `build-and-push.yml` correctly scopes `GITHUB_TOKEN`; no `pull_request_target` anywhere.
- No real committed secrets found (no AKIA keys, no private keys).
- `govulncheck` runs across all Go modules in CI; `-race` on by default everywhere.
- `tech-debt-metrics.yml` (tracking `as any`, stubbed handlers, TODOs with regression
  thresholds) is excellent engineering discipline.

---

## Recommended Remediation Order

### Phase 0 — This week (Critical, small diffs)

1. Fix LW-C1 command injection: `execFileSync` with array args; allowlist `buildCommand`;
   validate `branch`/`repoUrl`.
2. Remove every fail-open secret default (`|| "orbit-internal-dev-key"`, `:-dev-secret-key`,
   `orbit-registry-token` fallbacks, `orbit-dev-passphrase`); fail fast at startup. Rotate all
   affected values.
3. Add `PULUMI_CONFIG_PASSPHRASE` to ExternalSecret + all three worker deployments; plan move to
   a KMS `secretsProvider`.
4. Auth-gate `/api/workspaces` and `/api/seed-generators`; complete the `requireAdmin()` TODOs on
   the Kafka admin routes.
5. Add workspace-membership checks to the deployment/launch server actions
   (FE-H3–H6, FE-M2/M3) — the pattern already exists in `createDeployment`/`startDeployment`.

### Phase 1 — Next 2–4 weeks (Architecture)

6. Introduce a shared gRPC auth interceptor (verified JWT or mTLS) and apply it to kafka,
   plugins, and repository services; derive identity + workspace claims server-side; stop
   trusting `user-id` metadata and request-body `workspace_id`.
7. Tenant-scope Pulumi stack names server-side (`orbit-<workspaceId>-…`) and assert the prefix in
   provision/destroy activities; assert `templatePath` resolves under the templates base dir.
8. Filter `output.secret` values out of activity return values; deliver connection strings via a
   secrets manager reference instead of Temporal history.
9. Non-root Dockerfiles + pod `securityContext` + egress NetworkPolicies for the launches workers.
10. Resolve the `betterAuthId` vs `user.id` membership-lookup inconsistency with a single shared
    helper, and add a regression test for cross-workspace access.

### Phase 2 — Hardening & process

11. CI: enable gosec as a blocking step, remove `|| true` from the frontend audit, re-enable the
    push trigger, pin third-party actions to SHAs, add top-level `permissions:`, add Dependabot
    and CODEOWNERS, enable branch protection (the two `wip` commits on `main` show it's not enforced).
12. Compose hygiene: remove hardcoded MinIO/Postgres creds, bind DB ports to 127.0.0.1, pin
    `:latest` images, add MongoDB auth.
13. Provisioned-infra defaults: private networking for Cloud SQL / Azure Postgres, HTTPS for the
    static-site CDN, drop the default open-SSH NSG rule, `deletionProtection: true`.
14. Cleanup: delete `test_grpc.go` and stray root markdown artifacts; fix `make test-go`
    chaining; add `.env`/Pulumi patterns to root `.gitignore`; remove `test.env` from tracking.
15. Per-handler polish: error-message sanitization at gRPC boundaries, pagination caps,
    `Limit==0` divide-by-zero, input validation on `CreateTopic`, timing-safe internal API key
    comparison.
