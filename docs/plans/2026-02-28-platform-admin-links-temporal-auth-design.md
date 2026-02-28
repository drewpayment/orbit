# Platform Admin External Links & Temporal Auth Design

**Date**: 2026-02-28
**Status**: Approved

## Overview

Two related features that improve platform admin access to underlying infrastructure UIs:

1. **Kafka Cluster Console Links** - Add external links from the Kafka cluster management UI to the physical cluster's management console (e.g., Redpanda Console)
2. **Temporal UI Access with Auth** - Add a platform admin nav link to the Temporal UI and protect it with authentication via oauth2-proxy backed by Better Auth as an OIDC provider

## Feature 1: Kafka Cluster Console Links

### Changes

**Collection** (`src/collections/kafka/KafkaClusters.ts`):
- Add optional `consoleUrl` text field for the cluster's management console URL

**Type** (`src/app/actions/kafka-admin.ts`):
- Add `consoleUrl?: string` to `KafkaClusterConfig` interface

**ClustersTab** (`src/app/(frontend)/platform/kafka/components/ClustersTab.tsx`):
- Add "Open Console" external link button on each cluster card
- Only shown when `consoleUrl` is populated
- Uses `ExternalLink` icon from lucide-react
- `e.stopPropagation()` to prevent triggering `onSelectCluster`

**ClusterDetail** (`src/app/(frontend)/platform/kafka/components/ClusterDetail.tsx`):
- Add `consoleUrl` input field for admins to enter/edit the URL

**Server actions**:
- Update cluster read/write actions to include `consoleUrl` in the mapping

## Feature 2: Temporal UI Link in Platform Admin

### Changes

**Sidebar** (`src/components/app-sidebar.tsx`):
- Add "Workflows" entry to `navPlatformData` with appropriate icon
- Links to `/platform/workflows`

**Page** (`src/app/(frontend)/platform/workflows/page.tsx`):
- Simple platform admin page with description and "Open Temporal UI" button
- URL configurable via `NEXT_PUBLIC_TEMPORAL_UI_URL` env var (default: `http://localhost:8080`)

**K8s config** (`infrastructure/k8s/orbit-www/configmap.yaml`):
- Add `NEXT_PUBLIC_TEMPORAL_UI_URL=https://temporal.orbit.hoytlabs.app`

## Feature 3: Better Auth OIDC Provider

### Goal

Make Orbit act as an OIDC identity provider so oauth2-proxy and future internal tools can authenticate users against it.

### Changes

**Dependencies**:
- Install Better Auth OIDC provider plugin (if separate package needed)

**Auth config** (`src/lib/auth.ts`):
- Add `oidcProvider` plugin to Better Auth configuration
- Configure allowed OIDC clients (oauth2-proxy client ID/secret)
- Include `role` claim in ID tokens for role-based access enforcement
- Scope allowed redirect URIs to oauth2-proxy callback

**Endpoints exposed**:
- `/.well-known/openid-configuration` (discovery)
- `/api/auth/authorize` (authorization)
- `/api/auth/token` (token)
- `/api/auth/userinfo` (userinfo)
- `/api/auth/jwks` (JWKS)

**Secrets**:
- OIDC client ID and secret for oauth2-proxy stored in Doppler
- Pulled via External Secrets Operator in K8s

## Feature 4: oauth2-proxy for Temporal UI (Production Only)

### Goal

Protect the Temporal UI in production so only platform admins (`super_admin`, `admin` roles) can access it.

### Changes

**New K8s manifests** (`infrastructure/k8s/oauth2-proxy/`):
- `deployment.yaml`: oauth2-proxy configured with:
  - `--provider=oidc`
  - `--oidc-issuer-url=https://orbit.hoytlabs.app`
  - `--upstream=http://temporal-ui:8080`
  - `--allowed-roles=super_admin,admin`
  - Client credentials from Doppler secrets
  - Cookie secret for session encryption
- `service.yaml`: ClusterIP on port 4180
- `kustomization.yaml`

**Updated Temporal UI HTTPRoute** (`infrastructure/k8s/temporal/ui-http-route.yaml`):
- Change backend from `temporal-ui:8080` to `oauth2-proxy:4180`

**ExternalSecret** (`infrastructure/k8s/externalsecret.yaml`):
- Add `OAUTH2_PROXY_CLIENT_ID`, `OAUTH2_PROXY_CLIENT_SECRET`, `OAUTH2_PROXY_COOKIE_SECRET`

**No docker-compose changes** - local dev accesses Temporal UI directly without auth.

### Auth Flow

```
User clicks "Open Temporal UI" in Orbit
  → temporal.orbit.hoytlabs.app
  → oauth2-proxy checks for valid session cookie
  → No cookie? Redirect to orbit.hoytlabs.app/api/auth/authorize
  → User logs in via Orbit's Better Auth
  → Better Auth issues ID token with role claim
  → oauth2-proxy validates token, checks role ∈ {super_admin, admin}
  → Sets session cookie, proxies request to temporal-ui:8080
  → User sees Temporal UI
```

## Out of Scope

- Workflow summary stats on the `/platform/workflows` page (future enhancement)
- Embedding Temporal UI via iframe
- Protecting Redpanda Console with oauth2-proxy (future - same pattern applies)
- Docker Compose oauth2-proxy setup for local development
