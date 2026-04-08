# PostHog Self-Hosted — Operations Guide

Orbit deploys a full self-hosted PostHog analytics stack on Kubernetes. This was reverse-engineered from PostHog's Docker Compose hobby deployment since PostHog deprecated their official Helm chart in 2024. There is **no upstream k8s compatibility matrix** — treat this deployment as a hand-maintained appliance.

## Architecture

```
Browser → ingest-posthog.hoytlabs.app (PUBLIC, via Cloudflare)
           ├── /e, /capture, /batch → posthog-capture (Rust, port 3000)
           ├── /s                   → posthog-replay-capture (Rust, port 3000)
           └── /*                   → posthog-web (Django, port 8000)

         posthog.hoytlabs.app (INTERNAL ONLY, LAN gateway)
           └── /*                   → posthog-web (Django, port 8000)

posthog-capture → Redpanda (Kafka) → posthog-ingestion (Node.js) → ClickHouse
posthog-web ←→ Postgres (metadata) + ClickHouse (analytics queries)
posthog-worker (Celery) → background jobs, exports, async migrations
posthog-plugins (Node.js) → CDP pipelines, destinations
```

### Services

| Service | Image | Purpose |
|---------|-------|---------|
| posthog-web | `posthog/posthog` | Django web server (UI + API) |
| posthog-worker | `posthog/posthog` | Celery worker + scheduler |
| posthog-plugins | `posthog/posthog-node` | Node.js plugin server (CDP/pipelines) |
| posthog-capture | `ghcr.io/posthog/posthog/capture` | Rust event capture service |
| posthog-replay-capture | `ghcr.io/posthog/posthog/capture` | Rust session replay capture |
| posthog-ingestion | `posthog/posthog-node` | Node.js ingestion bridge (Kafka → ClickHouse) |
| posthog-property-defs | `ghcr.io/posthog/posthog/property-defs-rs` | Rust property definitions |
| posthog-db | `postgres:15.12-alpine` | PostHog-dedicated Postgres |
| posthog-redis | `valkey/valkey:8.0-alpine` | PostHog-dedicated Redis |
| posthog-kafka | `redpandadata/redpanda` | Kafka-compatible message broker |
| posthog-clickhouse | `clickhouse/clickhouse-server` | Analytics database |

### Disabled Services

These are defined but set to `replicas: 0`:
- **posthog-livestream** — requires GeoIP MMDB file
- Feature flags are handled by the Python web server for the hobby deployment

## Image Version Pinning (CRITICAL)

**All PostHog images are pinned to exact `sha256` digests.** Do NOT update image tags independently.

PostHog services are tightly coupled — the web server, worker, plugin server, ingestion service, and capture service must all be compatible versions. There is no official compatibility matrix for self-hosted k8s. The current digest set was validated as a working combination.

**To upgrade PostHog:**
1. Check PostHog's Docker Compose hobby repo for their latest version set
2. Update ALL image digests together in a single commit
3. Test in a non-production environment first
4. Watch for ClickHouse migration failures — these are the most common breakage

**What breaks if you update one image independently:**
- ClickHouse schema drift (migrations expect specific table shapes)
- Kafka topic format incompatibilities
- Plugin server crashes (Node.js version expects different Postgres schema)
- Capture service rejecting events the ingestion service expects

## ArgoCD Sync Order (CRITICAL)

PostHog has a strict startup dependency chain. If services start out of order, migrations fail, data is lost, or services crash-loop. The sync wave annotations enforce the correct order.

### Sync Wave Map

```
Wave -1: ConfigMap (posthog-env)
         └── Must exist before any pod references it via envFrom

Wave  0: Data Layer (all deploy in parallel, must all be healthy before wave 1)
         ├── posthog-db         (Postgres)
         ├── posthog-redis      (Valkey)
         ├── posthog-kafka      (Redpanda)
         └── posthog-clickhouse (ClickHouse + embedded Keeper)

Wave  1: Init Jobs (ArgoCD Sync hooks, run after data layer is healthy)
         ├── posthog-clickhouse-init  → creates migration tracking tables in ClickHouse
         └── posthog-kafka-init       → creates all required Kafka topics via rpk

Wave  2: Migration Job (ArgoCD Sync hook, runs after init jobs complete)
         └── posthog-migrate          → Django migrations + ClickHouse migrations + async migrations
             Waits for both Postgres AND ClickHouse to be reachable before starting

Wave  3: Application Services (all deploy in parallel, after migrations complete)
         ├── posthog-web              (Django web server)
         ├── posthog-worker           (Celery worker + scheduler)
         ├── posthog-plugins          (Node.js plugin server / CDP)
         ├── posthog-capture          (Rust event capture)
         ├── posthog-replay-capture   (Rust session replay capture)
         ├── posthog-ingestion        (Node.js ingestion bridge)
         ├── posthog-property-defs    (Rust property definitions)
         └── HTTPRoutes               (posthog-ui, posthog-ingest)
```

### Why this order matters

1. **ClickHouse init MUST run before migrations** — PostHog's `migrate_clickhouse` command expects `infi_clickhouse_orm_migrations` table to already exist. Without the init job, the migration job will crash.
2. **Kafka topics MUST exist before ingestion/capture start** — the Rust capture service and Node.js ingestion service expect topics to exist. They will crash-loop if topics are missing.
3. **Django migrations MUST complete before web/worker start** — the web server checks migration state on boot and the Celery worker requires async migrations to be run.
4. **Init jobs use ArgoCD Sync hooks** (`argocd.argoproj.io/hook: Sync`) with `BeforeHookCreation` delete policy — this means old job pods are cleaned up before each sync, and the jobs re-run on every sync to ensure idempotency.

### Shared Application Consideration

In Orbit, PostHog is part of the **main ArgoCD Application** (not a separate Application like in the reference setup). This means:
- PostHog's sync waves run alongside all other Orbit resources
- All existing Orbit resources (MongoDB, Temporal, etc.) default to wave 0 and will deploy alongside PostHog's data layer
- This is fine — Orbit's existing services and PostHog's data layer have no interdependencies
- **If you later add sync waves to other Orbit resources**, be aware that PostHog's waves 1-3 will wait for ALL wave 0 resources to be healthy, including non-PostHog ones

If PostHog deployment becomes too slow or complex due to shared sync waves, consider splitting it into its own ArgoCD Application (separate `Application` manifest pointing at `infrastructure/k8s/posthog/`).

## Network Routing

### Dashboard — INTERNAL ONLY

- **Hostname**: `posthog.hoytlabs.app`
- **Gateway**: `gateway-internal` (LAN-only, no Cloudflare, no public DNS)
- **Why internal**: Full admin access to all analytics data, session recordings, user data, and config
- **Access**: VPN, tailnet, or direct LAN only

### Ingest Endpoint — PUBLIC

- **Hostname**: `ingest-posthog.hoytlabs.app`
- **Gateway**: `gateway-external` (public, through Cloudflare Tunnel)
- **Why public**: Browsers must reach this to send events and session recordings
- **Path routing**:
  - `/e`, `/i/v0`, `/capture`, `/batch` → Rust capture service
  - `/s` → Rust replay-capture service
  - `/` fallback → Django web (serves JS SDK assets like `array.full.js`)

## Cloudflare Configuration

If the ingest endpoint goes through Cloudflare (proxy or tunnel), these settings are **required** or PostHog will silently break.

### Disable Brotli Compression

Cloudflare applies Brotli by default. PostHog's Rust capture service and the JS SDK do NOT handle Brotli-compressed request/response bodies correctly when proxied. Symptoms:
- Events silently dropped (capture returns 200 but body is garbled)
- Session recordings failing to upload
- `posthog-js` errors in browser console

**Fix**: Cloudflare Dashboard → Speed → Optimization → Content Optimization → Disable Brotli for `ingest-posthog.hoytlabs.app`. Or create a Configuration Rule scoped to that hostname.

### Disable Auto-Minification

Cloudflare may minify the PostHog JS SDK served from `/static/array.full.js`. This corrupts the SDK.

**Fix**: Disable Auto-Minification (JS) for the ingest hostname.

### Cache Bypass

PostHog ingest endpoints must NOT be cached. Create a Cache Rule to bypass cache for the entire ingest hostname, or at minimum for `/e`, `/capture`, `/batch`, `/s` paths.

### Client-Side Compression

The PostHog JS client in Orbit is configured with `disable_compression: true` in the PostHogProvider. This prevents the client from gzip-compressing request bodies, avoiding double-compression issues through Cloudflare.

### SSL / TLS

- `DISABLE_SECURE_SSL_REDIRECT: "true"` is set in the PostHog ConfigMap (Cloudflare Tunnel terminates TLS)
- `IS_BEHIND_PROXY: "true"` ensures PostHog trusts `X-Forwarded-*` headers
- Update `TRUSTED_PROXIES` in `configmap-env.yaml` with your gateway/proxy IPs

## Content Security Policy (CSP)

If Orbit ever adds a CSP header (middleware, gateway policy, etc.), whitelist the PostHog ingest host:

```
script-src 'self' 'unsafe-inline' https://ingest-posthog.hoytlabs.app;
connect-src 'self' https://ingest-posthog.hoytlabs.app;
```

- `script-src` — the JS SDK loads from `ingest-posthog.hoytlabs.app/static/array.full.js`
- `'unsafe-inline'` — needed for the `posthog.init()` call in PostHogProvider
- `connect-src` — XHR/fetch calls to send events and recordings

## Frontend Integration

The PostHog JS client is integrated via:
- `orbit-www/src/components/providers/posthog-provider.tsx` — wraps both layouts, handles init + pageview tracking
- `orbit-www/src/components/providers/posthog-identify.tsx` — call with user data to tie sessions to authenticated users
- `orbit-www/src/lib/env.ts` — runtime env vars `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST`

**PostHog gracefully no-ops when env vars are unset** — the frontend works fine without PostHog configured.

### PostHogProvider Settings

```typescript
posthog.init(key, {
  api_host: host,                  // ingest endpoint
  person_profiles: 'always',       // create profiles for all visitors
  capture_pageview: false,         // manual pageview tracking (Next.js router)
  capture_pageleave: true,         // track when users leave
  autocapture: true,               // capture clicks, inputs, etc.
  disable_session_recording: false, // session recording ON
  disable_compression: true,       // avoid Brotli/double-compression via Cloudflare
})
```

## Secrets (Doppler)

Three secrets must exist in Doppler:

| Doppler Key | Purpose | How to Generate |
|-------------|---------|-----------------|
| `ORBIT_POSTHOG_SECRET_KEY` | Django SECRET_KEY | `openssl rand -hex 32` |
| `ORBIT_POSTHOG_ENCRYPTION_SALT_KEYS` | Encryption salt | `openssl rand -hex 32` |
| `ORBIT_POSTHOG_DB_PASSWORD` | Postgres password | `openssl rand -hex 24` |

PostHog also reuses Orbit's existing MinIO credentials (`MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`) for S3-compatible object storage.

## Storage

PostHog uses 4 NFS-backed PVs on the same NFS server as other Orbit services:

| PV | NFS Path | Size |
|----|----------|------|
| `orbit-posthog-postgres-pv` | `/mnt/tank/appdata/orbit/posthog/postgres` | 20Gi |
| `orbit-posthog-redis-pv` | `/mnt/tank/appdata/orbit/posthog/redis` | 5Gi |
| `orbit-posthog-kafka-pv` | `/mnt/tank/appdata/orbit/posthog/kafka` | 20Gi |
| `orbit-posthog-clickhouse-pv` | `/mnt/tank/appdata/orbit/posthog/clickhouse` | 100Gi |

These directories must be created on `192.168.86.44` before deployment.

## Initial Deployment Checklist

1. Create NFS directories (see Storage section above)
2. Add secrets to Doppler (see Secrets section above)
3. Create `posthog` bucket in MinIO
4. Update `configmap-env.yaml` with actual hostnames and trusted proxy IPs
5. Update `http-route.yaml` parentRefs to match your gateway names
6. Configure Cloudflare (see Cloudflare section above)
7. ArgoCD sync — init jobs handle migrations automatically
8. Log into PostHog dashboard (internal URL), create a project, copy the API key
9. Set `NEXT_PUBLIC_POSTHOG_KEY` in `infrastructure/k8s/orbit-www/configmap.yaml`
10. Redeploy orbit-www

## Troubleshooting

**Events not appearing in PostHog**: Check browser Network tab for requests to `ingest-posthog.hoytlabs.app/e`. If they 502/503, the capture service may not be running. If they succeed but PostHog shows nothing, check Kafka topics and the ingestion service logs.

**Session recordings not working**: Verify `/s` path routes to replay-capture. Check that `disable_session_recording: false` is set in the provider. Verify S3/MinIO connectivity from the worker pod.

**PostHog UI login fails**: Check Django migration job completed successfully. Verify Postgres is accessible from the web pod. Check `SECRET_KEY` is set correctly.

**ClickHouse errors on startup**: The clickhouse-init job must complete before the migrate job. Verify ArgoCD sync waves are ordered correctly (wave 0 → data layer, wave 1 → init jobs, wave 2 → migration, wave 3 → app services).
