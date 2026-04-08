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
