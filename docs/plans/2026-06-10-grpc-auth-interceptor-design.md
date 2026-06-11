# gRPC Auth Interceptor Design — Phase 0 Trust Boundary

**Date:** 2026-06-10
**Author:** Security architect (team orbit-security)
**Status:** Design — ready for implementation (task #4)
**Audit findings addressed:** GO-C1, GO-H1, GO-H2, GO-H6

## Problem

The Go gRPC layer has no real trust boundary:

- **GO-C1 (critical):** `services/kafka` has **zero** authentication. The only
  interceptor is `loggingInterceptor` (`services/kafka/cmd/server/main.go:77,148`).
  Any client that can reach `:50055` can register clusters, create/delete topics,
  approve cross-workspace shares, and mint service accounts.
- **GO-H1 (high):** `services/repository` trusts a forgeable `user-id` gRPC metadata
  header. See `RepositoryServer.extractUserID`
  (`services/repository/internal/grpc/repository_server.go:550-568`),
  `APICatalogServer.extractUserID`
  (`services/repository/internal/grpc/api_catalog_server.go:491-509`), and
  `TemporalServer.extractUserID` / `extractWorkspaceID`
  (`services/repository/internal/grpc/temporal_server.go:415-444`). Anyone can set
  `user-id: <any uuid>` and act as that user.
- **GO-H2 (high):** `workspace_id` arrives in request bodies (e.g.
  `CreateRepositoryRequest.WorkspaceID`, `ListRepositoriesRequest.WorkspaceID`,
  every kafka share/service-account RPC) and is never validated against caller
  identity. No tenant isolation.
- **GO-H6 (high):** `services/kafka/internal/grpc/share_handler.go:177-182` sets
  `CreatedBy: uuid.Nil` with a `TODO: Get createdBy from auth context`.

The only caller is **orbit-www** (Next.js, server-side). Its Connect-ES clients live
in `orbit-www/src/lib/grpc/` and `orbit-www/src/lib/clients/`. The plugins service and
AWS/GCP workers were deleted; only **kafka** and **repository** need coverage.

## Topology discovered (this drives the design)

The two services use **different transport stacks**, so we need two interceptor shapes
sharing one verification core:

| Service | Transport | Server type | Interceptor API |
|---|---|---|---|
| `services/kafka` | gRPC (HTTP/2) | `google.golang.org/grpc` `grpc.NewServer` (`main.go:76`) | `grpc.UnaryServerInterceptor` / `grpc.StreamServerInterceptor` |
| `services/repository` | Connect over h2c | `connect-go` handlers on an `http.ServeMux` (`cmd/server/main.go:398-471`) | `connect.UnaryInterceptorFunc` + h2c-level guard, OR a `http.Handler` wrapper |

Important nuance about `services/repository`: the running `main.go` wires only the
**Connect** handlers (Template, Deployment, Health, Build, Launch, Agent). The
`RepositoryServer`, `APICatalogServer`, and `TemporalServer` types that read `user-id`
from `metadata.FromIncomingContext` are defined but **not registered** in the current
binary — they are the legacy raw-gRPC handlers. The design covers both so that:
1. the live Connect handlers gain identity, and
2. when/if the raw-gRPC handlers are wired, they consume the same verified identity and
   the forgeable `extractUserID` path is deleted (not just bypassed).

On the client side: `kafka-client.ts` uses `createGrpcTransport`
(`@connectrpc/connect-node`); the repository-family clients (`repository-client.ts`,
`clients/build-client.ts`, `clients/launch-client.ts`, `clients/deployment-client.ts`,
`grpc/agent-client.ts`, `grpc/health-client.ts`) use `createConnectTransport`. Both
accept a Connect-ES `interceptors: [...]` option, so **one shared client-side
interceptor** attaches the token regardless of transport.

The proto module (`proto/go.mod`, module `github.com/drewpayment/orbit/proto`) is the
**only** Go module both services already depend on via
`replace github.com/drewpayment/orbit/proto => ../../proto`. There is no `proto/pkg/`
today. orbit-www already depends on **`jose` (^6.1.3)** for signing JWTs; server-side
identity is available via `getCurrentUser()` / `getSession()` in
`orbit-www/src/lib/auth/session.ts` (`session.user.id` is the betterAuth id).

## 1. Token format & claims

**Short-TTL HMAC-signed JWT (HS256), minted per-request server-side by orbit-www.**

- Algorithm: **HS256** (shared secret). No new key-server infrastructure. Asymmetric
  (RS256/ES256) and mTLS are the documented upgrade path (see §7).
- TTL: **120 seconds.** Tokens are minted fresh on every outbound call from a trusted
  server context, so the TTL only needs to cover one RPC plus clock skew. Short TTL
  bounds the blast radius of a leaked token without needing revocation.

Claims:

```jsonc
{
  "iss": "orbit-www",                 // fixed issuer string, verified
  "aud": "orbit-services",            // fixed audience, verified
  "sub": "<betterAuthId>",            // session.user.id — the verified user identity
  "wid": "<workspace-uuid>",          // AUTHORIZED workspace for this request (see below)
  "iat": 1718000000,
  "exp": 1718000120,                  // iat + 120s
  "jti": "<random-uuid>"              // unique per token (future replay defense; not enforced phase 0)
}
```

**`wid` is the load-bearing authorization claim.** orbit-www already knows, from the
betterAuth session + Payload membership, which workspace the user is acting in. It puts
that *verified* workspace id into `wid`. The Go side then enforces:

> For any RPC whose request body carries a `workspace_id` (or
> `requesting_workspace_id`), the body value **must equal** the `wid` claim. Mismatch →
> `PermissionDenied`. This closes GO-H2: a caller can no longer pass an arbitrary
> `workspace_id` in the body to reach another tenant's data.

`sub` (betterAuthId) is the verified user identity. It replaces every
`extractUserID(ctx)` metadata read (GO-H1) and populates `CreatedBy`/`ApprovedBy`/
`RequestedBy` (GO-H6).

Phase-0 scope note: `wid` carries a **single** active workspace. RPCs that legitimately
operate across workspaces (cross-workspace topic *discovery*/*share request*, where the
target workspace differs from the caller's) are handled by validating only the
*caller's own* workspace field against `wid` and leaving the *target* workspace to
existing service-layer authorization. The per-RPC field mapping is enumerated in §3.

## 2. Key distribution & fail-fast

Single shared secret, delivered by environment variable to **both** sides:

- **Env var:** `ORBIT_SVC_AUTH_SECRET` (>= 32 bytes of high-entropy random; document
  generating with `openssl rand -base64 48`).
- orbit-www reads the same value as `ORBIT_SVC_AUTH_SECRET` (server-only env, never
  `NEXT_PUBLIC_`).

**Fail-fast, no fail-open defaults (this is an explicit audit theme):**

- **Go services:** read the secret in `loadConfig()` / at server construction. If empty
  or shorter than 32 bytes → `log.Fatalf` before `Serve`. There is **no** development
  default value. (Contrast with the current `DATABASE_URL` fallback in kafka
  `loadConfig()` — the auth secret must *not* follow that pattern.)
- **orbit-www:** the token-minting helper throws if `ORBIT_SVC_AUTH_SECRET` is unset.
  Because the helper runs on the request path of every gRPC call, a missing secret
  fails the call loudly rather than silently sending unauthenticated traffic.
- A single canonical secret is shared by kafka and repository in phase 0 (both verify
  with the same key). Splitting per-service secrets is a trivial later change (two env
  vars, www picks per target) and is noted but not required now.

## 3. Go implementation shape

### Shared verification package: `proto/pkg/svcauth`

Lives in the proto module so both service modules consume it with zero new
cross-module wiring (they already `replace` the proto module). Contents:

```
proto/pkg/svcauth/
  claims.go        // Claims struct, typed context key, Identity accessor
  verify.go        // ParseAndVerify(tokenString, secret) (*Claims, error)
  grpc.go          // UnaryServerInterceptor / StreamServerInterceptor (google.golang.org/grpc)
  connect.go       // NewConnectInterceptor() connect.UnaryInterceptorFunc
  exempt.go        // method allowlist (health checks, reflection)
```

New Go dependency: `github.com/golang-jwt/jwt/v5` (added to `proto/go.mod`; standard,
no infra). `connect-go` is already a transitive dep of the repository module; the proto
module gains a direct dep on `connectrpc.com/connect` for `connect.go`.

**Typed context key + accessor** (`claims.go`) — never a bare string key:

```go
type Identity struct {
    UserID      string // betterAuthId (sub)
    WorkspaceID string // wid
}
type ctxKey struct{}

func WithIdentity(ctx context.Context, id Identity) context.Context { ... }
func IdentityFromContext(ctx context.Context) (Identity, bool) { ... }

// EnforceWorkspace returns codes.PermissionDenied if bodyWorkspaceID != id.WorkspaceID.
// Empty bodyWorkspaceID is allowed (RPC has no workspace scope); empty wid is rejected.
func EnforceWorkspace(ctx context.Context, bodyWorkspaceID string) error { ... }
```

**Token extraction:** read the `authorization` metadata/header, expect
`Bearer <jwt>`. (Not the legacy `user-id` header.)

**gRPC interceptor** (`grpc.go`, for kafka):

```go
func UnaryServerInterceptor(secret []byte) grpc.UnaryServerInterceptor {
    return func(ctx, req, info, handler) (any, error) {
        if isExempt(info.FullMethod) { return handler(ctx, req) }
        md, _ := metadata.FromIncomingContext(ctx)
        tok := bearerFrom(md.Get("authorization"))
        claims, err := ParseAndVerify(tok, secret)   // checks sig, exp, iss, aud
        if err != nil { return nil, status.Error(codes.Unauthenticated, "invalid or missing token") }
        ctx = WithIdentity(ctx, Identity{UserID: claims.Sub, WorkspaceID: claims.Wid})
        return handler(ctx, req)
    }
}
// StreamServerInterceptor mirrors this, wrapping ServerStream.Context().
```

Wire in kafka `main.go`, replacing the logging-only chain:

```go
secret := mustLoadAuthSecret() // fatal if missing/short
grpcServer := grpc.NewServer(
    grpc.ChainUnaryInterceptor(loggingInterceptor, svcauth.UnaryServerInterceptor(secret)),
    grpc.ChainStreamInterceptor(svcauth.StreamServerInterceptor(secret)),
)
```

**Connect interceptor** (`connect.go`, for repository) — applied to every handler:

```go
func NewConnectInterceptor(secret []byte) connect.UnaryInterceptorFunc {
    return func(next connect.UnaryFunc) connect.UnaryFunc {
        return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
            if isExempt(req.Spec().Procedure) { return next(ctx, req) }
            tok := bearerFrom(req.Header().Values("Authorization"))
            claims, err := ParseAndVerify(tok, secret)
            if err != nil { return nil, connect.NewError(connect.CodeUnauthenticated, err) }
            ctx = WithIdentity(ctx, Identity{UserID: claims.Sub, WorkspaceID: claims.Wid})
            return next(ctx, req)
        }
    }
}
```

Wire in repository `cmd/server/main.go` by passing `connect.WithInterceptors(authInt)`
to **every** `New*ServiceHandler(...)` call (Template, Deployment, Health, Build,
Launch, Agent). Server-streaming RPCs (AgentService chat) are covered because the
interceptor runs at stream open. Note connect-go's `UnaryInterceptorFunc` also applies
to streaming handlers via the `WrapStreamingHandler` path of the same interceptor type;
if a separate streaming guard is needed, implement the full `connect.Interceptor`
interface in the same file.

**Handler consumption (the actual GO-H1/H2/H6 fixes):**

- `services/kafka/internal/grpc/share_handler.go:182` — replace
  `CreatedBy: uuid.Nil` with the verified id:
  ```go
  id, _ := svcauth.IdentityFromContext(ctx)
  createdBy, _ := uuid.Parse(id.UserID)
  // ... CreatedBy: createdBy
  ```
  Apply the same to `ApproveTopicAccess` (`approverID` should come from the verified
  identity, not `req.ApprovedBy` — that body field becomes ignored/removed) and
  `RequestTopicAccess` (`RequestedBy`).
- All kafka workspace-scoped RPCs (`CreateServiceAccount`, `ListServiceAccounts`,
  `ListTopicShares`, `DiscoverTopics`, topic create/list/etc.) call
  `svcauth.EnforceWorkspace(ctx, req.GetWorkspaceId())` (or
  `req.GetRequestingWorkspaceId()` for discovery/request) right after parsing.
- `services/repository`: delete the **four** forgeable `extractUserID` methods and the
  two `extractWorkspaceID` methods; replace each
  `userID, err := s.extractUserID(ctx)` call site (repository_server.go lines
  170, 256, 290, 344, 393, 430; the api_catalog/temporal equivalents) with
  `id, ok := svcauth.IdentityFromContext(ctx)` and `EnforceWorkspace` on the body
  `WorkspaceID`. Removing the methods makes the forgeable path uncompilable, which is
  stronger than leaving it dormant.

  The four handlers in the `internal/grpc` package with a forgeable/placeholder
  identity source are `RepositoryServer`, `APICatalogServer`, `TemporalServer`
  (these read `user-id`/`workspace-id` from `metadata.FromIncomingContext`), and
  **`KnowledgeServer`** (`knowledge_server.go:529-540`), whose `extractUserID` /
  `extractWorkspaceID` are *worse* — they `return uuid.New()` unconditionally, a
  hardcoded fake identity. All four are in the same package and compile into the
  repository module; none is currently registered in `cmd/server/main.go`. All four
  get the same treatment so the entire forgeable surface in the package becomes
  uncompilable.

  Out of scope for this interceptor work (flag, do not implement here): the
  `KnowledgeServer` permission stubs `canCreateKnowledgeSpace` / `canViewKnowledgeSpace`
  (`knowledge_server.go:543+`) that `return true`. Those are an *authorization* gap
  (missing RBAC), distinct from the *identity-trust-boundary* gap this design closes;
  they need a separate follow-up task.

**Exempt RPCs** (`exempt.go`): gRPC/Connect health checks
(`grpc.health.v1.Health/Check`, `grpc.health.v1.Health/Watch`, and the Connect
HealthService probe procedure) and gRPC server reflection
(`grpc.reflection.v1alpha.ServerReflection/*`, dev-only). Everything else requires a
valid token. The exempt list is a small explicit allowlist — default is *deny*.

## 4. orbit-www client changes

**Mint + attach in one shared Connect-ES interceptor.** Add:

- `orbit-www/src/lib/grpc/svc-auth-token.ts` — `mintServiceToken(workspaceId: string)`:
  uses `jose` `SignJWT` with HS256 and `ORBIT_SVC_AUTH_SECRET`
  (`throw` if unset), sets `iss/aud/sub/wid/iat/exp/jti`, 120s expiry. `sub` comes from
  `getCurrentUser()` (`session.user.id`) in `src/lib/auth/session.ts`.
- `orbit-www/src/lib/grpc/auth-interceptor.ts` — a Connect-ES `Interceptor` that, per
  call, resolves the current user + active workspace, mints a token, and sets
  `req.header.set('Authorization', 'Bearer ' + token)`.

The active workspace for `wid` is the workspace the request targets. The cleanest
phase-0 approach: the interceptor reads the workspace id from the request message field
(`req.message.workspaceId` / `requestingWorkspaceId`) when present, validates that the
session user is a member of it (Payload membership check, already available
server-side), and signs that into `wid`. If the message has no workspace field, `wid`
is the user's current/default workspace. This guarantees the token's `wid` always
reflects a workspace the user is *authorized* for, so the Go-side body-vs-`wid` check is
a genuine tenant boundary rather than a tautology.

**Attach the interceptor to every client transport:**

- `createGrpcTransport({ ..., interceptors: [authInterceptor] })` in
  `src/lib/grpc/kafka-client.ts`.
- `createConnectTransport({ ..., interceptors: [authInterceptor] })` in
  `src/lib/grpc/agent-client.ts`, `src/lib/grpc/health-client.ts`,
  `src/lib/clients/build-client.ts`, `src/lib/clients/launch-client.ts`,
  `src/lib/clients/deployment-client.ts`.

These six are all server-side modules (connect-node invoked from server actions and
route handlers), so the secret never reaches the browser.

**CORRECTION (found during implementation):** `src/lib/grpc/repository-client.ts` is
NOT server-side — it uses `@connectrpc/connect-web` with `NEXT_PUBLIC_REPOSITORY_URL`
and is imported and called directly from a `'use client'` component
(`src/components/features/repository/RepositoryWizard.tsx` calls
`repositoryClient.createRepository` from the browser, passing a client-supplied
`workspaceId`). The auth interceptor CANNOT be attached there: minting a token in the
browser would require shipping `ORBIT_SVC_AUTH_SECRET` to the client (secret leak), and
the token-mint helper imports `server-only` + Payload + the session helper, which cannot
bundle into a client component.

Resolution (decided in review, matches the existing builds/launches/deployments
pattern): move `RepositoryWizard`'s `createRepository` to a server action in
`src/app/actions/`. The server action runs `getPayloadUserFromSession` →
`requireWorkspaceMembership` (the helper in `src/lib/auth/workspace-membership.ts`) on
the request `workspaceId` BEFORE minting the token, then calls a new server-side
repository client built on `@connectrpc/connect-node` (server-only
`REPOSITORY_SERVICE_URL`, interceptor attached). The membership check is mandatory —
without it the action would sign a `wid` for any workspace the client names,
re-creating GO-H2. After repointing, delete the browser `repository-client.ts` and drop
`NEXT_PUBLIC_REPOSITORY_URL` so the Go repository service is no longer reachable from the
browser network / gRPC-Web CORS surface. This also closes a pre-existing forgeable-write
hole, since the browser call previously sent an unverified `workspaceId`.

## 5. Migration / compatibility

**Single coordinated deploy.** orbit-www and both Go services share the secret and ship
together (same `docker-compose` / k8s release). There is no period where an
authenticated client talks to an unauthenticated server or vice-versa.

To de-risk the cutover, gate the **server-side enforcement** behind one env flag:

- `ORBIT_SVC_AUTH_ENFORCE` (default **`true`**). When `false`, the interceptor still
  parses and injects identity if a token is present, but does **not** reject
  missing/invalid tokens — useful only to bisect a deploy issue. **It must default to
  enforcing and must be removed after rollout.** The client always mints/sends tokens
  regardless of the flag, so flipping enforcement on requires no client change.

This is the only rollout knob; keep it simple and delete it once verified in
production. (Schedule note: this flag is a temporary rollout gate — remove after the
phase-0 deploy is confirmed healthy.)

## 6. Test strategy

**Go unit tests** for `proto/pkg/svcauth` (table-driven, `testify`):

- `ParseAndVerify`: valid token → claims; **expired** (`exp` in past) → error;
  **forged** (wrong secret) → error; **wrong alg** (`alg: none` / RS256) → error
  (explicitly pin allowed algs to HS256 to block alg-confusion); wrong `iss`/`aud` →
  error; **missing/empty** token → error.
- `EnforceWorkspace`: body == `wid` → ok; body != `wid` → `PermissionDenied`; empty
  body → ok; empty `wid` → error.
- gRPC interceptor: a fake `UnaryHandler` asserts identity is in context for a valid
  token; missing token → `codes.Unauthenticated`, handler **never invoked**; exempt
  method passes through without a token.
- Connect interceptor: analogous, asserting `connect.CodeUnauthenticated`.

**Regression tests proving the old forgeable path is closed:**

- kafka: a test calling `CreateServiceAccount` through the interceptor with a forged
  `user-id` metadata header **and no Bearer token** must fail `Unauthenticated`; with a
  valid token, `CreatedBy` in the persisted record must equal the token `sub` (proves
  GO-H6 fixed and GO-H1 closed).
- kafka: `RequestTopicAccess`/`DiscoverTopics` with a body `requestingWorkspaceId`
  different from the token `wid` → `PermissionDenied` (proves GO-H2).
- repository: a test confirming `extractUserID` no longer exists (compile-time) and that
  a handler reads identity only from `svcauth.IdentityFromContext`. A body
  `WorkspaceID` mismatching `wid` → `PermissionDenied`.
- Negative infra test: starting either Go server with `ORBIT_SVC_AUTH_SECRET` unset
  exits non-zero (fail-fast).

**orbit-www tests** (Vitest): `mintServiceToken` throws when secret unset; produced
token round-trips through the Go verifier in a small contract test (or a JS-side
verify) with correct `sub`/`wid`/`exp`.

## 7. Explicit non-goals (phase 0)

- **temporal-worker → orbit-www internal HTTP API auth.** The Temporal workers call
  orbit-www's internal HTTP API (e.g. Payload data). That is a separate
  **internal-API-key** track, not this gRPC interceptor. Out of scope here.
- **mTLS / asymmetric signing.** HS256 + shared env secret is deliberate for phase 0.
  Upgrade path (documented, not built now): move to RS256/ES256 with orbit-www holding
  the private key and services holding the public key (a JWKS endpoint or mounted
  public key), then to mTLS for transport-level service identity. The `Claims`/verify
  abstraction is designed so only `verify.go` changes for the alg upgrade.
- **Token replay defense / `jti` tracking.** `jti` is minted but not checked in phase 0;
  the 120s TTL is the replay bound. A `jti` blocklist (Redis) is a later hardening.
- **Per-service distinct secrets and key rotation tooling.** One shared secret in phase
  0; rotation is a manual coordinated env change.

## Effort estimate

Implementable by one strong engineer in ~1 day:

- `proto/pkg/svcauth` (claims, verify, two interceptors, exempt) + unit tests: ~3–4h.
- kafka wiring + handler `CreatedBy`/`EnforceWorkspace` edits + tests: ~2h.
- repository wiring (6 handler registrations) + delete `extractUserID` + call-site
  edits: ~2h.
- orbit-www mint helper + interceptor + attach to 7 transports + tests: ~2h.
