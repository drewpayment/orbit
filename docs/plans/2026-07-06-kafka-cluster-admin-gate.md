# Kafka ClusterHandler platform-admin gate (GitHub issue #50)

**Date:** 2026-07-06
**Status:** In progress on `fix/50-kafka-cluster-admin-gate`
**Owner:** PM session (Claude) directing engineer + QA agents
**Refs:** issue #50, PR #49 review record, `docs/plans/2026-06-10-grpc-auth-interceptor-design.md`

## Problem

PR #49 authenticated the Kafka gRPC service (svcauth HS256 JWT interceptor), but
ClusterHandler RPCs remained the accepted residual: clusters are global in the
domain model (no `WorkspaceID`), so all 11 cluster-level RPCs in
`services/kafka/internal/grpc/cluster_handler.go` perform **no authorization** —
any authenticated tenant can register/delete global clusters, run
`ValidateClusterConnection` with attacker-supplied connection config, and
create/delete topics directly against brokers.

Chosen fix = issue option 1: **platform-admin claim in the svcauth token,
enforced on every ClusterHandler RPC.** Cluster management is already
platform-admin-only on the www side (`requireAdmin()` in
`src/app/actions/kafka-admin.ts:249`), so this closes the direct-gRPC bypass
without a domain-model migration.

Caller analysis (recon, 2026-07-06): the ONLY live gRPC caller of any cluster
RPC is `validateClusterConnection` from the admin-gated `validateCluster`
server action (`kafka-admin.ts:860`). `CreateTopicDirect`/`DeleteTopicByName`
have **no callers anywhere** (Temporal hits brokers via its own adapter, not
this service). No Go service-to-service callers. Net regression risk: zero.

## Design

1. **Claims** (`proto/pkg/svcauth/claims.go:12`): add
   `PlatformAdmin bool \`json:"adm,omitempty"\``. Absent claim ⇒ `false`
   (old tokens are non-admin — fail closed).
2. **Identity** (`claims.go:30`): add `PlatformAdmin bool`; thread it in BOTH
   `grpc.go:62` and `connect.go:42`.
3. **New helper** beside `EnforceWorkspace` (`claims.go:65`):
   `EnforcePlatformAdmin(ctx) error` — no identity ⇒ `codes.Unauthenticated`;
   `!PlatformAdmin` ⇒ `codes.PermissionDenied` ("platform admin required").
4. **ClusterHandler**: first line of ALL 11 RPCs calls `EnforcePlatformAdmin`:
   ListProviders, RegisterCluster, ValidateCluster, ValidateClusterConnection,
   DeleteTopicByName, CreateTopicDirect, ListClusters, DeleteCluster,
   CreateEnvironmentMapping, ListEnvironmentMappings, DeleteEnvironmentMapping.
5. **www minting** (`orbit-www/src/lib/grpc/svc-auth-token.ts:53`):
   `mintServiceToken(subject, workspaceId, opts?: { platformAdmin?: boolean })`
   → sets `adm: true` only when true (omit otherwise).
6. **www interceptor** (`orbit-www/src/lib/grpc/auth-interceptor.ts`): resolve
   the session user's role (it currently only uses the id) and pass
   `platformAdmin: isPlatformAdmin(user)` (from
   `src/lib/access/workspace-access.ts:137`). Role must come from the server
   session/Payload user — never from request input.
7. **No workspace-RPC changes**: topic/share/service-account handlers and their
   `EnforceWorkspace` scoping are untouched.
8. Deployment-skew note: if kafka-service deploys before orbit-www, admin
   "Validate connection" returns PermissionDenied until www ships the `adm`
   claim. Acceptable in dev-stage; both land in one PR here.

## UAC

- **UAC-1** All 11 ClusterHandler RPCs reject: missing token ⇒ Unauthenticated;
  valid token without `adm` ⇒ PermissionDenied; valid token `adm:true` ⇒
  proceeds to handler logic. Table-driven test covers every RPC name.
- **UAC-2** `adm` absent ⇒ non-admin (fail closed); claim cannot be injected
  via request metadata/fields — only from the signed JWT.
- **UAC-3** Topic/share/service-account RPC authz behavior byte-for-byte
  unchanged (existing auth tests still green, no edits to their assertions).
- **UAC-4** www: `mintServiceToken` emits `adm` iff `isPlatformAdmin(user)`;
  interceptor derives it from the server-side session user role.
- **UAC-5** `connect.go` (repository service path) compiles and threads the new
  Identity field; repository behavior unchanged.
- **UAC-6** Tests: svcauth unit tests for claim roundtrip + `EnforcePlatformAdmin`;
  new `cluster_handler_auth_test.go` following the
  `share_handler_auth_test.go` pattern (`mintKafkaToken` gains an admin arg);
  TS tests for svc-auth-token/auth-interceptor updated.
- **UAC-7** `cd services/kafka && go test -race ./...` green;
  `cd proto && go test -race ./pkg/svcauth/...` green;
  `cd orbit-www && bunx vitest run src/lib/grpc` green; golangci-lint clean on
  touched Go packages.
- **UAC-8** Browser QA: admin "Validate connection" flow on `/platform/kafka`
  works end-to-end against a rebuilt kafka-service container (full token path
  www → gRPC); all four admin Kafka tabs render regression-free.

## Work packages

- **WP1 (Opus engineer)** — the full change (Go svcauth + kafka handlers + www
  TS minting/interceptor + all tests). Single package: the change is contained
  and cross-language coordination is the risky part; splitting it would add
  hand-off risk, not remove it. TDD on the new helper + handler gates.
- **QA (agent-browser)** — rebuild kafka-service container from the branch,
  run www dev server from this worktree on :3001, validate UAC-8 as the seeded
  platform-admin user; capture screenshots; check kafka-service logs for the
  denied/allowed audit lines.

## Verification

1. Go: `cd services/kafka && go test -race ./...`; `cd proto && go test -race ./pkg/svcauth/...`
2. TS: `cd orbit-www && bunx vitest run src/lib/grpc`
3. Lint: `golangci-lint run` in services/kafka (and proto if configured); eslint on touched TS.
4. QA browser pass per UAC-8.
5. PR closes #50.
