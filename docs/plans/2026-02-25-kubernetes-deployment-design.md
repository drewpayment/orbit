# Kubernetes Deployment Design

**Date:** 2026-02-25
**Status:** Approved
**Scope:** Full-stack Kubernetes deployment of Orbit IDP to self-hosted Talos cluster

## Overview

Deploy all Orbit services and dependencies to a self-hosted Talos Kubernetes cluster. Manifests live in this repo under `infrastructure/k8s/`, use Kustomize (matching the existing gitops repo patterns), and are synced via ArgoCD.

## Decisions

| Decision | Choice |
|---|---|
| Target environment | Self-hosted Talos cluster (homelab) |
| Stateful services | All in-cluster (StatefulSets with NFS PVCs) |
| Manifest location | `infrastructure/k8s/` in this repo |
| Manifest format | Flat Kustomize per-service (no Helm, no overlays) |
| Image registry | ghcr.io/drewpayment/orbit/* |
| Secrets | Doppler via ExternalSecrets (`doppler-cluster-secret-store`) |
| Ingress | Gateway API (envoy-gateway, `gateway-external`) |
| Storage | NFS via csi-driver-nfs, paths under `/mnt/tank/appdata/orbit/` |
| GitOps | ArgoCD Application pointing to this repo |
| CI/CD | GitHub Actions matrix build with path filters |
| Build-service strategy | BuildKit DaemonSet, build-service connects via TCP |

## Directory Structure

```
infrastructure/k8s/
  kustomization.yaml           # Top-level, references all subdirs
  namespace.yaml               # orbit namespace
  storageclass.yaml            # NFS storage class for orbit
  externalsecret.yaml          # Single ExternalSecret pulling all secrets from Doppler
  serviceaccount.yaml          # Shared SA for orbit workloads
  README.md                    # Doppler setup instructions and pre-deployment checklist

  # Custom services (Deployments)
  orbit-www/
    kustomization.yaml
    deployment.yaml
    service.yaml
    http-route.yaml
    configmap.yaml
  repository-service/
    kustomization.yaml
    deployment.yaml
    service.yaml
  kafka-service/
    kustomization.yaml
    deployment.yaml
    service.yaml
  plugins-service/
    kustomization.yaml
    deployment.yaml
    service.yaml
  bifrost/
    kustomization.yaml
    deployment.yaml
    service.yaml
  build-service/
    kustomization.yaml
    deployment.yaml
    service.yaml
  temporal-worker/
    kustomization.yaml
    deployment.yaml

  # Stateful services (StatefulSets)
  mongodb/
    kustomization.yaml
    statefulset.yaml
    service.yaml
    pvc.yaml
  postgresql/
    kustomization.yaml
    statefulset.yaml
    service.yaml
    pvc.yaml
    init-configmap.yaml        # Creates temporal + orbit databases
  redis/
    kustomization.yaml
    statefulset.yaml
    service.yaml
    pvc.yaml
  redpanda/
    kustomization.yaml
    statefulset.yaml
    service.yaml
    pvc.yaml
  minio/
    kustomization.yaml
    statefulset.yaml
    service.yaml
    pvc.yaml

  # Infrastructure services
  temporal/
    kustomization.yaml
    deployment.yaml            # Temporal server (stateless, uses PostgreSQL)
    service.yaml
    ui-deployment.yaml         # Temporal UI
    ui-service.yaml
    ui-http-route.yaml         # temporal.orbit.hoytlabs.app
    dynamicconfig-configmap.yaml
  registry/
    kustomization.yaml
    deployment.yaml            # registry:2 backed by MinIO
    service.yaml
  buildkit/
    kustomization.yaml
    daemonset.yaml
    service.yaml
    pvc.yaml
```

## Custom Services

All 7 custom services pull images from `ghcr.io/drewpayment/orbit/<service>:<tag>`.

### orbit-www (external)

The only service with external HTTP access.

- **Deployment:** 1 replica, port 3000, non-root user (`nextjs:nodejs`)
- **Service:** ClusterIP on port 3000
- **HTTPRoute:** `orbit.hoytlabs.app` via `gateway-external`, path prefix `/`
- **ConfigMap:** NEXT_PUBLIC_APP_URL, service URLs for gRPC backends
- **Secrets:** DATABASE_URI, PAYLOAD_SECRET, ENCRYPTION_KEY, BETTER_AUTH_SECRET, RESEND_API_KEY, GitHub app credentials
- **Health:** HTTP liveness/readiness on `/api/health`
- **Resources:** 256Mi request / 512Mi limit, 100m / 500m CPU

### Go gRPC services (internal)

repository-service, kafka-service, plugins-service, bifrost, build-service.

- **Deployment:** 1 replica each, gRPC port + optional HTTP metrics port
- **Service:** ClusterIP, named ports (`grpc`, `http-metrics`)
- **No HTTPRoute** — cluster-internal only
- **Env vars:** Service URLs via K8s DNS, secrets from ExternalSecret
- **Health:** gRPC health check protocol
- **Resources:** 64Mi request / 256Mi limit, 50m / 200m CPU
- **build-service additionally:** `BUILDKIT_HOST=tcp://buildkit:1234`

### temporal-worker (internal, no service)

Outbound-only worker that connects to Temporal server.

- **Deployment:** 1 replica, no ports exposed
- **No Service or HTTPRoute** — initiates connections only
- **Env vars:** TEMPORAL_ADDRESS, ORBIT_INTERNAL_API_KEY, backend service URLs
- **Health:** Process liveness only
- **Resources:** 128Mi request / 256Mi limit, 50m / 200m CPU

## Stateful Services

All use StatefulSets with NFS-backed PVCs. Single replica each.

### MongoDB

- **Image:** `mongo:7`, port 27017
- **PVC:** NFS `/mnt/tank/appdata/orbit/mongodb`, 20Gi
- **Service:** Headless ClusterIP (`clusterIP: None`)
- **Auth:** MONGO_INITDB_ROOT_USERNAME/PASSWORD from ExternalSecret
- **Consumers:** orbit-www (`mongodb://$(user):$(pass)@mongodb:27017/orbit-www?authSource=admin`)

### PostgreSQL

Single instance serving both Temporal and application databases.

- **Image:** `postgres:15-alpine`, port 5432
- **PVC:** NFS `/mnt/tank/appdata/orbit/postgresql`, 10Gi
- **Service:** Headless ClusterIP
- **Init:** ConfigMap with init script creating `temporal` and `orbit` databases
- **Auth:** POSTGRES_USER/PASSWORD from ExternalSecret
- **Consumers:** Temporal server

### Redis

- **Image:** `redis:7-alpine`, port 6379
- **PVC:** NFS `/mnt/tank/appdata/orbit/redis`, 5Gi
- **Service:** ClusterIP
- **Consumers:** orbit-www (caching), bifrost (state)

### Redpanda

- **Image:** `redpandadata/redpanda:v24.2.10`, ports 9092 (Kafka), 9644 (admin)
- **PVC:** NFS `/mnt/tank/appdata/orbit/redpanda`, 10Gi
- **Service:** ClusterIP
- **Config:** ConfigMap with single-node `redpanda.yaml`
- **Consumers:** bifrost, kafka-service

### MinIO

- **Image:** `minio/minio:latest`, ports 9000 (API), 9001 (console)
- **PVC:** NFS `/mnt/tank/appdata/orbit/minio`, 20Gi
- **Service:** ClusterIP
- **Auth:** MINIO_ROOT_USER/PASSWORD from ExternalSecret
- **Consumers:** build-service (artifacts), container registry (image layers)

## Infrastructure Services

### Temporal Server

- **Deployment** (stateless): 1 replica, `temporalio/auto-setup:1.25.1`, ports 7233 (gRPC), 8233 (HTTP)
- **Service:** ClusterIP on both ports
- **Config:** Dynamic config via ConfigMap (from existing `infrastructure/temporal/dynamicconfig/`)
- **Env vars:** PostgreSQL connection details

### Temporal UI

- **Deployment:** 1 replica, `temporalio/ui:2.30.0`, port 8080
- **Service:** ClusterIP
- **HTTPRoute:** `temporal.orbit.hoytlabs.app` via `gateway-external`

### Container Registry

- **Deployment:** 1 replica, `registry:2`, port 5050
- **Service:** ClusterIP
- **Config:** MinIO as storage backend
- **Purpose:** Stores user-built application images (Orbit's IDP functionality), separate from ghcr.io which hosts Orbit's own service images

### BuildKit

- **DaemonSet:** `moby/buildkit:latest`, rootless mode (`--oci-worker-no-process-sandbox`)
- **Service:** ClusterIP on port 1234
- **PVC:** NFS `/mnt/tank/appdata/orbit/buildkit`, 10Gi (build cache)
- **Consumer:** build-service connects via `BUILDKIT_HOST=tcp://buildkit:1234`

## Secrets Management

Single ExternalSecret (`orbit-secrets`) pulls all secrets from Doppler via `doppler-cluster-secret-store`.

### Secret Keys Required in Doppler

All prefixed with `ORBIT_` in Doppler, mapped to shorter names in the K8s Secret:

**Database credentials:**
- `ORBIT_MONGO_ROOT_USERNAME` / `ORBIT_MONGO_ROOT_PASSWORD`
- `ORBIT_POSTGRES_USER` / `ORBIT_POSTGRES_PASSWORD`
- `ORBIT_MINIO_ROOT_USER` / `ORBIT_MINIO_ROOT_PASSWORD`

**Application secrets:**
- `ORBIT_PAYLOAD_SECRET`
- `ORBIT_ENCRYPTION_KEY`
- `ORBIT_BETTER_AUTH_SECRET`
- `ORBIT_RESEND_API_KEY`

**GitHub App:**
- `ORBIT_GITHUB_APP_ID`
- `ORBIT_GITHUB_CLIENT_ID`
- `ORBIT_GITHUB_CLIENT_SECRET`
- `ORBIT_GITHUB_WEBHOOK_SECRET`

**Inter-service auth:**
- `ORBIT_INTERNAL_API_KEY`
- `ORBIT_JWT_SECRET`

**Registry:**
- `ORBIT_REGISTRY_PASSWORD`
- `ORBIT_REGISTRY_JWT_SECRET`

Services consume secrets via `env[].valueFrom.secretKeyRef` referencing the `orbit-secrets` Secret. Non-secret config (service URLs, ports) goes in per-service ConfigMaps.

## Networking

### External Access

| Hostname | Service | Port | Gateway |
|---|---|---|---|
| `orbit.hoytlabs.app` | orbit-www | 3000 | gateway-external |
| `temporal.orbit.hoytlabs.app` | temporal-ui | 8080 | gateway-external |

TLS handled by wildcard cert `cert-hoytlabs` (`*.hoytlabs.app`) on the gateway.

### Internal Service Discovery

All services communicate via K8s DNS within the `orbit` namespace:

| DNS Name | Port | Used By |
|---|---|---|
| `mongodb:27017` | 27017 | orbit-www |
| `postgresql:5432` | 5432 | temporal |
| `redis:6379` | 6379 | orbit-www, bifrost |
| `redpanda:9092` | 9092 | bifrost, kafka-service |
| `minio:9000` | 9000 | build-service, registry |
| `temporal:7233` | 7233 | temporal-worker, orbit-www |
| `repository-service:50051` | 50051 | orbit-www |
| `plugins-service:50053` | 50053 | orbit-www |
| `build-service:50054` | 50054 | orbit-www |
| `kafka-service:50055` | 50055 | orbit-www |
| `bifrost:50060` | 50060 | orbit-www |
| `bifrost:9092` | 9092 | kafka clients |
| `buildkit:1234` | 1234 | build-service |
| `registry:5050` | 5050 | build-service |

## CI/CD Pipeline

### GitHub Actions Workflow (`.github/workflows/build-and-push.yml`)

Matrix build of all 7 custom service images on push to `main`.

| Service | Dockerfile | Image | Path Filter |
|---|---|---|---|
| orbit-www | `orbit-www/Dockerfile` | `ghcr.io/drewpayment/orbit/orbit-www` | `orbit-www/**` |
| repository-service | `services/repository/Dockerfile` | `ghcr.io/drewpayment/orbit/repository-service` | `services/repository/**`, `proto/**` |
| build-service | `services/build-service/Dockerfile` | `ghcr.io/drewpayment/orbit/build-service` | `services/build-service/**`, `proto/**` |
| bifrost | `services/bifrost/Dockerfile` | `ghcr.io/drewpayment/orbit/bifrost` | `services/bifrost/**`, `proto/**` |
| kafka-service | `services/kafka/Dockerfile` | `ghcr.io/drewpayment/orbit/kafka-service` | `services/kafka/**`, `proto/**` |
| plugins-service | `services/plugins/Dockerfile` | `ghcr.io/drewpayment/orbit/plugins-service` | `services/plugins/**`, `proto/**` |
| temporal-worker | `temporal-workflows/Dockerfile` | `ghcr.io/drewpayment/orbit/temporal-worker` | `temporal-workflows/**`, `proto/**` |

**Tagging:** `latest` + `sha-<short-hash>` per commit.

**Build tooling:** `docker/build-push-action` with BuildKit layer caching via GitHub Actions cache. Auth via automatic `GITHUB_TOKEN`.

**Build context:** All services use repo root (`.`) as build context since Go services need `proto/` directory.

## ArgoCD Integration

ArgoCD Application in your gitops repo (`apps/orbit/`) points to this repo:

```
# gitops repo: apps/orbit/
application.yaml       # ArgoCD Application pointing to drewpayment/orbit infrastructure/k8s/
kustomization.yaml     # Lists application.yaml as resource
```

**Sync policy:** Automated with prune + selfHeal, matching existing app patterns.

**Deployment flow:**
1. Push code to `main`
2. GitHub Actions builds changed images → pushes to ghcr.io
3. Update image tag in Deployment manifest → push
4. ArgoCD detects manifest change → syncs to cluster

## Pre-Deployment Checklist

1. **Doppler:** Create project, populate all `ORBIT_*` secrets listed above
2. **NFS:** Create directories under `/mnt/tank/appdata/orbit/` for each stateful service (mongodb, postgresql, redis, redpanda, minio, buildkit)
3. **GitOps repo:** Add `apps/orbit/` with ArgoCD Application manifest
4. **GHCR access:** If the orbit repo is private, create an image pull secret for the cluster
5. **DNS:** Ensure `orbit.hoytlabs.app` and `temporal.orbit.hoytlabs.app` resolve (Cloudflare tunnel or external-dns)
6. **First image build:** Push to main to trigger initial image builds before deploying manifests

## Out of Scope

- ArgoCD Image Updater (automatic image tag bumping)
- Horizontal Pod Autoscaling (start with 1 replica, tune later)
- Network policies (Cilium can enforce later)
- Monitoring/alerting beyond existing Prometheus
- Backup/restore for stateful services
- Staging/production environment separation
