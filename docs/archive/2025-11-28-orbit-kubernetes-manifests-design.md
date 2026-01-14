# Orbit Kubernetes Manifests Design

**Date:** 2025-11-28
**Status:** Approved
**Author:** Claude (with Drew)

## Overview

This document describes the design for deploying Orbit to Kubernetes using ArgoCD. The manifests will be committed to the existing `hoytlabs-talos` ArgoCD repository and follow established patterns from existing applications (affine, hoarder, headlamp).

## Goals

1. Deploy core Orbit services to Kubernetes with ArgoCD
2. Match the development docker-compose setup for parity
3. Use existing infrastructure patterns (Kustomize, ExternalSecrets, NFS storage)
4. Enable access via `orbit.hoytlabs.app`

## Non-Goals (Phase 2)

- Backstage integration (`backstage-backend`, `plugins-service`)
- Application PostgreSQL (only used by Backstage)
- High availability / multi-replica deployments
- Horizontal Pod Autoscaling

## Architecture

### Services In Scope

| Service | Type | Image | Port |
|---------|------|-------|------|
| orbit-www | Deployment | `ghcr.io/drewpayment/orbit-www` | 3000 |
| temporal-worker | Deployment | `ghcr.io/drewpayment/orbit-temporal-worker` | - |
| repository-service | Deployment | `ghcr.io/drewpayment/orbit-repository-service` | 50051 |
| temporal-server | StatefulSet | `temporalio/auto-setup:1.25.1` | 7233 |
| temporal-ui | Deployment | `temporalio/ui:2.30.0` | 8080 |
| mongo | StatefulSet | `mongo:latest` | 27017 |
| temporal-postgresql | StatefulSet | `postgres:15-alpine` | 5432 |
| elasticsearch | StatefulSet | `elasticsearch:7.16.2` | 9200 |
| redis | Deployment | `redis:7-alpine` | 6379 |

### Services Excluded (Phase 2)

| Service | Reason |
|---------|--------|
| backstage-backend | Integrations feature - not core functionality |
| plugins-service | Depends on backstage-backend |
| postgres (application) | Only used by backstage-backend |

## Directory Structure

Located in the `hoytlabs-talos` ArgoCD repository:

```
apps/orbit/
├── kustomization.yaml           # Main kustomization with image tags
├── namespace.yaml               # orbit namespace
├── externalsecret.yaml          # Doppler → orbit-secrets
├── storageclass.yaml            # orbit-storage (NFS)
│
├── orbit-www/
│   ├── kustomization.yaml
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── configmap.yaml
│   └── http-route.yaml          # orbit.hoytlabs.app
│
├── temporal/
│   ├── kustomization.yaml
│   ├── server-statefulset.yaml  # temporal-server
│   ├── server-service.yaml
│   ├── ui-deployment.yaml
│   ├── ui-service.yaml
│   ├── worker-deployment.yaml   # orbit temporal-worker
│   └── worker-service.yaml
│
├── databases/
│   ├── kustomization.yaml
│   ├── mongo-statefulset.yaml
│   ├── mongo-service.yaml
│   ├── temporal-postgres-statefulset.yaml
│   ├── temporal-postgres-service.yaml
│   ├── redis-deployment.yaml
│   ├── redis-service.yaml
│   └── pvcs.yaml
│
├── elasticsearch/
│   ├── kustomization.yaml
│   ├── statefulset.yaml
│   ├── service.yaml
│   └── pvc.yaml
│
└── repository-service/
    ├── kustomization.yaml
    ├── deployment.yaml
    └── service.yaml
```

## ArgoCD Integration

The existing `apps/appset.yaml` includes `path: apps/*/*` which will automatically discover nested subfolders. Each subfolder becomes an independent ArgoCD Application, allowing:

- Independent sync per component
- Granular rollback capabilities
- Clear ownership boundaries

## Secrets Management

### Doppler Configuration

All secrets managed via Doppler using ExternalSecrets Operator (matching existing apps):

```yaml
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: orbit-secrets
  namespace: orbit
spec:
  refreshInterval: "1h"
  secretStoreRef:
    kind: ClusterSecretStore
    name: doppler-cluster-secret-store
  target:
    name: orbit-secrets
  data:
    # GitHub App credentials
    - secretKey: github_app_id
      remoteRef:
        key: ORBIT_GITHUB_APP_ID
    - secretKey: github_app_client_id
      remoteRef:
        key: ORBIT_GITHUB_APP_CLIENT_ID
    - secretKey: github_app_client_secret
      remoteRef:
        key: ORBIT_GITHUB_APP_CLIENT_SECRET
    - secretKey: github_app_private_key_base64
      remoteRef:
        key: ORBIT_GITHUB_APP_PRIVATE_KEY_BASE64
    - secretKey: github_app_webhook_secret
      remoteRef:
        key: ORBIT_GITHUB_APP_WEBHOOK_SECRET
    # Encryption & Auth
    - secretKey: payload_secret
      remoteRef:
        key: ORBIT_PAYLOAD_SECRET
    - secretKey: encryption_key
      remoteRef:
        key: ORBIT_ENCRYPTION_KEY
    - secretKey: internal_api_key
      remoteRef:
        key: ORBIT_INTERNAL_API_KEY
    # Database passwords
    - secretKey: mongo_password
      remoteRef:
        key: ORBIT_MONGO_PASSWORD
    - secretKey: postgres_password
      remoteRef:
        key: ORBIT_POSTGRES_PASSWORD
    - secretKey: temporal_postgres_password
      remoteRef:
        key: ORBIT_TEMPORAL_POSTGRES_PASSWORD
```

### Doppler Keys to Create

| Key | Description |
|-----|-------------|
| `ORBIT_GITHUB_APP_ID` | GitHub App ID |
| `ORBIT_GITHUB_APP_CLIENT_ID` | GitHub App OAuth Client ID |
| `ORBIT_GITHUB_APP_CLIENT_SECRET` | GitHub App OAuth Client Secret |
| `ORBIT_GITHUB_APP_PRIVATE_KEY_BASE64` | Base64-encoded GitHub App private key |
| `ORBIT_GITHUB_APP_WEBHOOK_SECRET` | GitHub webhook secret |
| `ORBIT_PAYLOAD_SECRET` | Payload CMS secret |
| `ORBIT_ENCRYPTION_KEY` | Token encryption key |
| `ORBIT_INTERNAL_API_KEY` | Internal API key for temporal-worker |
| `ORBIT_MONGO_PASSWORD` | MongoDB password (if auth enabled) |
| `ORBIT_POSTGRES_PASSWORD` | (Reserved for future use) |
| `ORBIT_TEMPORAL_POSTGRES_PASSWORD` | Temporal PostgreSQL password |

## Storage Configuration

### NFS StorageClass

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: orbit-storage
provisioner: nfs.csi.k8s.io
parameters:
  server: 192.168.86.44
  share: /mnt/tank/appdata/orbit
  mountOptions: "nolock"
reclaimPolicy: Retain
volumeBindingMode: Immediate
```

### Persistent Volume Claims

| Service | PVC Name | Size | Mount Path |
|---------|----------|------|------------|
| MongoDB | orbit-mongo-pvc | 10Gi | /data/db |
| Temporal PostgreSQL | orbit-temporal-postgres-pvc | 5Gi | /var/lib/postgresql/data |
| Elasticsearch | orbit-elasticsearch-pvc | 10Gi | /usr/share/elasticsearch/data |

### NAS Directory Structure

Create on NAS (192.168.86.44):

```
/mnt/tank/appdata/orbit/
├── mongo/
├── temporal-postgres/
└── elasticsearch/
```

## Networking

### HTTPRoute Configuration

Single HTTPRoute with path-based routing:

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: orbit-route
  namespace: orbit
  annotations:
    external-dns.alpha.kubernetes.io/hostname: orbit.hoytlabs.app
spec:
  parentRefs:
    - name: gateway-external
      namespace: gateway
  hostnames:
    - "orbit.hoytlabs.app"
  rules:
    # Temporal UI at /temporal
    - matches:
        - path:
            type: PathPrefix
            value: /temporal
      backendRefs:
        - name: temporal-ui
          port: 8080
    # Everything else to orbit-www
    - matches:
        - path:
            type: PathPrefix
            value: /
      backendRefs:
        - name: orbit-www
          port: 3000
```

### Endpoints

| URL | Service |
|-----|---------|
| `orbit.hoytlabs.app` | orbit-www (Next.js + Payload) |
| `orbit.hoytlabs.app/temporal` | temporal-ui |

### Internal Services (ClusterIP)

| Service | Port | Consumers |
|---------|------|-----------|
| temporal-server | 7233 | temporal-worker, orbit-www |
| repository-service | 50051 | orbit-www |
| mongo | 27017 | orbit-www |
| temporal-postgresql | 5432 | temporal-server |
| elasticsearch | 9200 | temporal-server |
| redis | 6379 | orbit-www |

## Container Images

### Custom Images (require GHCR setup)

| Image | Source |
|-------|--------|
| `ghcr.io/drewpayment/orbit-www` | `orbit-www/Dockerfile` |
| `ghcr.io/drewpayment/orbit-temporal-worker` | `temporal-workflows/Dockerfile` |
| `ghcr.io/drewpayment/orbit-repository-service` | `services/repository/Dockerfile` |

### Image Tagging Strategy

Use Kustomize image transformers for tag management:

```yaml
# apps/orbit/kustomization.yaml
images:
  - name: ghcr.io/drewpayment/orbit-www
    newTag: latest  # CI/CD updates to git SHA
  - name: ghcr.io/drewpayment/orbit-temporal-worker
    newTag: latest
  - name: ghcr.io/drewpayment/orbit-repository-service
    newTag: latest
```

### Official Images (pinned versions)

| Image | Version |
|-------|---------|
| `temporalio/auto-setup` | 1.25.1 |
| `temporalio/ui` | 2.30.0 |
| `mongo` | latest |
| `postgres` | 15-alpine |
| `elasticsearch` | 7.16.2 |
| `redis` | 7-alpine |

## Prerequisites

Before deployment:

1. **GHCR Setup**
   - Create GitHub Actions workflow for building/pushing images
   - Enable GitHub Packages for the repository
   - Configure `GITHUB_TOKEN` or PAT with `packages:write`

2. **Doppler Secrets**
   - Create all 12 secret keys listed above
   - Copy values from current `.env` files

3. **NAS Directories**
   - SSH to NAS and create `/mnt/tank/appdata/orbit/{mongo,temporal-postgres,elasticsearch}`
   - Set appropriate permissions

4. **DNS (automatic)**
   - external-dns will create `orbit.hoytlabs.app` CNAME via Cloudflare

## Environment Variables

### orbit-www

```yaml
env:
  - name: DATABASE_URI
    value: "mongodb://mongo:27017/orbit-www"
  - name: TEMPORAL_ADDRESS
    value: "temporal-server:7233"
  - name: TEMPORAL_NAMESPACE
    value: "default"
  - name: REPOSITORY_SERVICE_URL
    value: "http://repository-service:50051"
  - name: NEXT_PUBLIC_APP_URL
    value: "https://orbit.hoytlabs.app"
  - name: NEXT_PUBLIC_GITHUB_APP_NAME
    value: "orbit-idp"
  # Secrets from ExternalSecret
  - name: GITHUB_APP_ID
    valueFrom:
      secretKeyRef:
        name: orbit-secrets
        key: github_app_id
  # ... (all other secrets)
```

### temporal-worker

```yaml
env:
  - name: TEMPORAL_ADDRESS
    value: "temporal-server:7233"
  - name: TEMPORAL_NAMESPACE
    value: "default"
  - name: ORBIT_API_URL
    value: "http://orbit-www:3000"
  - name: ORBIT_INTERNAL_API_KEY
    valueFrom:
      secretKeyRef:
        name: orbit-secrets
        key: internal_api_key
```

### temporal-server

```yaml
env:
  - name: DB
    value: "postgres12"
  - name: DB_PORT
    value: "5432"
  - name: POSTGRES_USER
    value: "temporal"
  - name: POSTGRES_PWD
    valueFrom:
      secretKeyRef:
        name: orbit-secrets
        key: temporal_postgres_password
  - name: POSTGRES_SEEDS
    value: "temporal-postgresql"
  - name: ENABLE_ES
    value: "true"
  - name: ES_SEEDS
    value: "elasticsearch"
  - name: ES_VERSION
    value: "v7"
```

## Testing Plan

1. **Verify ArgoCD sync** - All applications should sync without errors
2. **Check pod status** - All pods Running with no restarts
3. **Test external access** - `orbit.hoytlabs.app` loads login page
4. **Test Temporal UI** - `orbit.hoytlabs.app/temporal` shows Temporal dashboard
5. **Test GitHub integration** - Install GitHub App, verify workflow starts
6. **Test template instantiation** - Create repo from template, verify completion

## Future Enhancements (Phase 2)

- Backstage integration (backstage-backend, plugins-service)
- Resource limits and requests tuning
- Pod disruption budgets
- Network policies
- Horizontal Pod Autoscaling
- Prometheus ServiceMonitors
