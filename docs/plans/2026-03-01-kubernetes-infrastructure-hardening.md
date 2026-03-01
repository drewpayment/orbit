# Kubernetes Infrastructure Hardening Plan for Orbit

**Author:** Mitch Ross
**Date:** 2026-03-01
**Status:** Proposal
**Based on:** Battle-tested patterns from [k3s-argocd-proxmox](https://github.com/mitchross/k3s-argocd-proxmox) production cluster

---

## Executive Summary

This document is a comprehensive roadmap for hardening Orbit's Kubernetes infrastructure. It identifies **90+ specific gaps** across security, reliability, observability, disaster recovery, and operational maturity, and provides concrete recommendations with implementation guidance.

The recommendations are organized into **7 phases** from quick wins to long-term strategic improvements, each with estimated effort, impact, and priority. Additionally, this document includes **Claude/LLM-friendly K8s patterns** to ensure AI assistants can work effectively with the infrastructure codebase.

---

## Table of Contents

1. [Current State Assessment](#1-current-state-assessment)
2. [Phase 1: Critical Security Hardening (P0)](#2-phase-1-critical-security-hardening-p0)
3. [Phase 2: Reliability & Resilience (P0)](#3-phase-2-reliability--resilience-p0)
4. [Phase 3: GitOps & Deployment Architecture (P1)](#4-phase-3-gitops--deployment-architecture-p1)
5. [Phase 4: Observability Stack (P1)](#5-phase-4-observability-stack-p1)
6. [Phase 5: Disaster Recovery & Backup (P1)](#6-phase-5-disaster-recovery--backup-p1)
7. [Phase 6: Performance & Cost Optimization (P2)](#7-phase-6-performance--cost-optimization-p2)
8. [Phase 7: Advanced Patterns (P3)](#8-phase-7-advanced-patterns-p3)
9. [Claude/LLM K8s Manifest Rules & Patterns](#9-claudellm-k8s-manifest-rules--patterns)
10. [Full Gap Inventory](#10-full-gap-inventory)
11. [Migration Checklist](#11-migration-checklist)

---

## 1. Current State Assessment

### What Orbit Has Today

| Area | Status | Notes |
|------|--------|-------|
| **K8s Manifests** | Kustomize-based | Single flat `kustomization.yaml` listing all resources |
| **ArgoCD** | External deployment | Application defined in separate `drewpayment-hoytlabs-talos` repo |
| **Secrets** | Doppler via ExternalSecret | Single monolithic `orbit-secrets` for all services |
| **Storage** | NFS via CSI driver | Single NFS server, no backup strategy |
| **Networking** | Gateway API (HTTPRoute) | No network policies, no service mesh |
| **Monitoring** | Prometheus (docker-compose only) | Not deployed to K8s, no Grafana, no alerting |
| **CI/CD** | GitHub Actions | Build + push only, no security scanning of images |
| **Replicas** | All services at 1 | No HA, no PDBs, no priority classes |
| **Health Checks** | Mixed | Some gRPC, some HTTP, one uses `ls /tmp` |
| **Container Security** | Mixed | Frontend runs as non-root, Go services run as root |
| **Backup/DR** | None | No database backups, no PVC snapshots, no runbooks |

### What k3s-argocd-proxmox Does That Orbit Doesn't

| Capability | k3s-argocd-proxmox | Orbit |
|-----------|-------------------|-------|
| App-of-Apps with ApplicationSets | Yes (3 tiers) | No (flat kustomization) |
| Sync Waves (ordered deployment) | Yes (Waves 0-6) | No |
| Server-Side Apply + Server-Side Diff | Yes (everywhere) | No |
| Network Policies (Cilium) | Yes (default deny LAN) | None |
| Per-service secrets | Yes (ExternalSecret per app) | Single monolithic secret |
| PVC Backups (VolSync + Kopia) | Yes (automated via labels) | None |
| Database Backups (CNPG + Barman) | Yes (hourly + WAL) | None |
| Fail-closed backup gates (Kyverno) | Yes | None |
| VPA auto-generation | Yes (Kyverno policy) | None |
| Monitoring stack | Yes (Prometheus + Grafana + Loki + Tempo) | Prometheus in compose only |
| Alert rules | Yes (GPU, backup, storage) | None |
| Pod Disruption Budgets | Yes | None |
| Gateway API with named ports | Yes | Partial (orbit-www only) |
| NFS performance tuning | Yes (nconnect, rsize, BBR) | None |
| Container image policy (Kyverno) | Yes | None |
| Reloader for config changes | Yes | None |
| revisionHistoryLimit | Yes (2, via component) | No (default 10) |

---

## 2. Phase 1: Critical Security Hardening (P0)

**Estimated Effort:** 2-3 days
**Impact:** Eliminates the most dangerous attack surface gaps

### 2.1 Split Monolithic Secret into Per-Service Secrets

**Problem:** Every pod mounts `orbit-secrets` containing ALL 21 secrets. A compromised `plugins-service` pod can read MongoDB root credentials, GitHub App private keys, and registry tokens.

**Solution:** Create per-service ExternalSecrets that pull only what each service needs.

```yaml
# infrastructure/k8s/externalsecrets/orbit-www-secrets.yaml
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: orbit-www-secrets
  namespace: orbit
spec:
  refreshInterval: "1h"
  secretStoreRef:
    kind: ClusterSecretStore
    name: doppler-cluster-secret-store
  target:
    name: orbit-www-secrets
    creationPolicy: Owner
  data:
    - secretKey: PAYLOAD_SECRET
      remoteRef:
        key: ORBIT_PAYLOAD_SECRET
    - secretKey: BETTER_AUTH_SECRET
      remoteRef:
        key: ORBIT_BETTER_AUTH_SECRET
    - secretKey: RESEND_API_KEY
      remoteRef:
        key: ORBIT_RESEND_API_KEY
    # ... only secrets orbit-www actually needs
```

**Secret mapping per service:**

| Service | Secrets Needed |
|---------|---------------|
| orbit-www | PAYLOAD_SECRET, BETTER_AUTH_SECRET, RESEND_API_KEY, RESEND_FROM_EMAIL, GITHUB_APP_ID, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_WEBHOOK_SECRET, ENCRYPTION_KEY, INTERNAL_API_KEY, JWT_SECRET |
| mongodb | MONGO_ROOT_USERNAME, MONGO_ROOT_PASSWORD |
| postgresql | POSTGRES_USER, POSTGRES_PASSWORD |
| minio | MINIO_ROOT_USER, MINIO_ROOT_PASSWORD |
| registry | REGISTRY_PASSWORD, REGISTRY_JWT_SECRET |
| oauth2-proxy | OAUTH2_PROXY_CLIENT_ID, OAUTH2_PROXY_CLIENT_SECRET, OAUTH2_PROXY_COOKIE_SECRET |
| Go services | INTERNAL_API_KEY (shared auth token) |

### 2.2 Add SecurityContext to All Containers

**Problem:** All Go service containers run as root. Container escape = host-level access.

**Solution:** Add non-root user in Dockerfiles and SecurityContext in manifests.

**Dockerfile change (all Go services):**
```dockerfile
# Add before COPY --from=builder
RUN addgroup -S orbit && adduser -S -G orbit orbit
USER orbit
```

**Manifest change (all deployments):**
```yaml
spec:
  template:
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 65534    # nobody
        runAsGroup: 65534
        fsGroup: 65534
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: service-name
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          volumeMounts:
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: tmp
          emptyDir: {}
```

**Exception:** `buildkit` DaemonSet legitimately needs `privileged: true`.

### 2.3 Add Network Policies

**Problem:** Zero network isolation. Any pod can talk to any other pod and reach the entire LAN.

**Solution:** Default-deny with explicit allow rules.

```yaml
# infrastructure/k8s/network-policies/default-deny.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: orbit
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
  egress:
    # Allow DNS
    - to: []
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
```

```yaml
# infrastructure/k8s/network-policies/allow-orbit-www.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-orbit-www
  namespace: orbit
spec:
  podSelector:
    matchLabels:
      app: orbit-www
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: gateway
      ports:
        - port: 3000
  egress:
    - to:
        - podSelector:
            matchLabels:
              app: mongodb
      ports:
        - port: 27017
    - to:
        - podSelector:
            matchLabels:
              app: repository-service
      ports:
        - port: 50051
    - to:
        - podSelector:
            matchLabels:
              app: kafka-service
      ports:
        - port: 50055
    - to:
        - podSelector:
            matchLabels:
              app: bifrost
      ports:
        - port: 50060
    - to:
        - podSelector:
            matchLabels:
              app: temporal
      ports:
        - port: 7233
    - to:  # Internet access for GitHub API, Resend, etc.
        - ipBlock:
            cidr: 0.0.0.0/0
            except:
              - 10.0.0.0/8
              - 172.16.0.0/12
              - 192.168.0.0/16
```

Create similar policies for each service. The pattern: **default deny everything, then whitelist only the connections each service actually needs.**

### 2.4 Add Named Ports to ALL Services

**Problem:** HTTPRoute and NetworkPolicy both work better with named ports. Unnamed ports can cause silent routing failures.

**Solution:**
```yaml
# EVERY service.yaml should use named ports
spec:
  ports:
    - name: grpc          # NOT just "port: 50051"
      port: 50051
      targetPort: 50051
      protocol: TCP
    - name: http-metrics  # NOT just "port: 8081"
      port: 8081
      targetPort: 8081
      protocol: TCP
```

### 2.5 Add Image Pull Secrets for GHCR

**Problem:** GHCR images may require authentication for private repos. No imagePullSecrets defined.

**Solution:**
```yaml
# Add to externalsecret.yaml
- secretKey: GHCR_TOKEN
  remoteRef:
    key: ORBIT_GHCR_TOKEN

# Add to every deployment
spec:
  template:
    spec:
      imagePullSecrets:
        - name: ghcr-credentials
```

### 2.6 CI/CD Security Improvements

**Problem:** No container image scanning, no SBOM generation, no image signing.

**Add to build-and-push.yml:**
```yaml
- name: Scan image with Trivy
  uses: aquasecurity/trivy-action@master
  with:
    image-ref: ghcr.io/${{ github.repository_owner }}/orbit/${{ matrix.service }}:sha-${{ steps.sha.outputs.short_sha }}
    format: 'sarif'
    output: 'trivy-results.sarif'
    severity: 'CRITICAL,HIGH'

- name: Upload Trivy scan results
  uses: github/codeql-action/upload-sarif@v2
  with:
    sarif_file: 'trivy-results.sarif'
```

**Add Dependabot or Renovate:**
```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "gomod"
    directories:
      - "/services/repository"
      - "/services/bifrost"
      - "/services/build-service"
      - "/services/kafka"
      - "/services/plugins"
      - "/temporal-workflows"
    schedule:
      interval: "weekly"
  - package-ecosystem: "npm"
    directory: "/orbit-www"
    schedule:
      interval: "weekly"
  - package-ecosystem: "docker"
    directory: "/"
    schedule:
      interval: "weekly"
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```

---

## 3. Phase 2: Reliability & Resilience (P0)

**Estimated Effort:** 2-3 days
**Impact:** Eliminates single points of failure

### 3.1 Fix Health Checks

**Problem:** Inconsistent and unreliable health checks. Temporal worker uses `ls /tmp`.

| Service | Current Probe | Recommended |
|---------|--------------|-------------|
| orbit-www | HTTP `/api/health` | Keep (good) |
| repository-service | gRPC probe | Keep (good) |
| kafka-service | gRPC probe | Keep (good) |
| plugins-service | HTTP `/health` | Keep (good) |
| bifrost | HTTP `/health` | Keep (good) |
| build-service | gRPC probe | Keep (good) |
| temporal-worker | `exec: ls /tmp` | **Fix:** Check Temporal connection |
| temporal-server | TCP 7233 | **Upgrade:** gRPC health check |
| orbit-docs | HTTP `/docs` | Keep (good) |

**Fix temporal-worker health check:**
```yaml
livenessProbe:
  exec:
    command:
      - /bin/sh
      - -c
      - "wget -q --spider http://temporal:7233/health || exit 1"
  initialDelaySeconds: 30
  periodSeconds: 30
  timeoutSeconds: 5
  failureThreshold: 3
readinessProbe:
  exec:
    command:
      - /bin/sh
      - -c
      - "wget -q --spider http://temporal:7233/health || exit 1"
  initialDelaySeconds: 15
  periodSeconds: 10
```

**Add startup probes for slow-starting services:**
```yaml
# For services that may take time to initialize (temporal, mongodb, etc.)
startupProbe:
  httpGet:
    path: /health
    port: http
  failureThreshold: 30
  periodSeconds: 10
  # Gives up to 5 minutes for startup before liveness kicks in
```

### 3.2 Add Pod Disruption Budgets

**Problem:** Node drain or upgrade kills all pods simultaneously. No protection.

```yaml
# infrastructure/k8s/orbit-www/pdb.yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: orbit-www-pdb
  namespace: orbit
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: orbit-www
```

Create PDBs for all services when running 2+ replicas. For single-replica services, PDBs still help by signaling to cluster operators that disruption should be avoided.

### 3.3 Add Graceful Shutdown

**Problem:** No `terminationGracePeriodSeconds`, no `preStop` hooks. Temporal workflows and in-flight gRPC calls are killed abruptly.

```yaml
spec:
  template:
    spec:
      terminationGracePeriodSeconds: 60  # Default 30 is too short for Temporal
      containers:
        - name: temporal-worker
          lifecycle:
            preStop:
              exec:
                command: ["/bin/sh", "-c", "sleep 15"]
                # Allow in-flight workflows to complete
```

**Service-specific grace periods:**

| Service | Recommended Grace Period | Reason |
|---------|------------------------|--------|
| temporal-worker | 120s | Must finish in-flight activities |
| temporal-server | 60s | Must drain connections |
| build-service | 300s | Active builds may be running |
| orbit-www | 30s | Fast HTTP connections |
| Go gRPC services | 30s | Fast gRPC calls |
| Databases | 60s | Must flush to disk |

### 3.4 Add Rolling Update Strategy

**Problem:** No update strategy defined. Defaults may cause downtime.

```yaml
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0     # Never kill old pod before new is ready
      maxSurge: 1           # Create 1 new pod, then kill old
  minReadySeconds: 10       # Wait 10s after ready before proceeding
```

### 3.5 Set revisionHistoryLimit

**Problem:** Default keeps 10 old ReplicaSets per Deployment, cluttering etcd.

```yaml
# Add to every Deployment
spec:
  revisionHistoryLimit: 3
```

Or use a Kustomize component like k3s-argocd-proxmox does:
```yaml
# infrastructure/k8s/common/deployment-defaults/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1alpha1
kind: Component
patches:
  - target:
      kind: Deployment
    patch: |
      - op: add
        path: /spec/revisionHistoryLimit
        value: 3
  - target:
      kind: StatefulSet
    patch: |
      - op: add
        path: /spec/revisionHistoryLimit
        value: 3
```

### 3.6 Add Priority Classes

**Problem:** All pods are equal priority. Under resource pressure, Kubernetes kills randomly.

```yaml
# infrastructure/k8s/priority-classes.yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: orbit-critical
value: 1000000
globalDefault: false
description: "Critical infrastructure (databases, temporal)"
---
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: orbit-standard
value: 100000
globalDefault: true
description: "Standard application services"
---
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: orbit-batch
value: 10000
globalDefault: false
description: "Batch/build workloads (can be preempted)"
```

**Assignment:**
- `orbit-critical`: mongodb, postgresql, redis, redpanda, temporal-server, minio
- `orbit-standard`: orbit-www, Go microservices, temporal-worker, temporal-ui
- `orbit-batch`: buildkit, build-service, minio-init

---

## 4. Phase 3: GitOps & Deployment Architecture (P1)

**Estimated Effort:** 3-5 days
**Impact:** Transforms deployment from fragile flat structure to resilient, self-healing GitOps

### 4.1 Restructure to App-of-Apps with ApplicationSets

**Current structure (flat, fragile):**
```
infrastructure/k8s/
  kustomization.yaml    # Lists ALL resources in one file
  namespace.yaml
  mongodb/
  postgresql/
  ...everything mixed together...
```

**Proposed structure (layered, discoverable):**
```
infrastructure/k8s/
  argocd/
    root.yaml                          # App-of-Apps entry point
    apps/
      orbit-project.yaml              # ArgoCD AppProject for RBAC
      databases-appset.yaml           # Wave 1: Databases
      infrastructure-appset.yaml      # Wave 2: Core infra
      services-appset.yaml            # Wave 3: Go microservices
      frontend-appset.yaml            # Wave 4: orbit-www, orbit-docs

  base/                               # Shared resources
    namespace.yaml
    storageclass.yaml
    serviceaccount.yaml
    priority-classes.yaml
    network-policies/
    common/
      deployment-defaults/            # Kustomize component

  databases/                          # Wave 1
    mongodb/
      kustomization.yaml
      statefulset.yaml
      service.yaml
      pvc.yaml
      pdb.yaml
    postgresql/
    redis/
    redpanda/
    minio/

  infrastructure/                     # Wave 2
    temporal/
    temporal-ui/
    registry/
    buildkit/
    oauth2-proxy/

  services/                           # Wave 3
    repository-service/
    kafka-service/
    bifrost/
    build-service/
    plugins-service/
    temporal-worker/

  frontend/                           # Wave 4
    orbit-www/
    orbit-docs/

  externalsecrets/                    # Per-service secrets
    mongodb-secrets.yaml
    orbit-www-secrets.yaml
    registry-secrets.yaml
    ...
```

### 4.2 Add Sync Waves

```yaml
# databases-appset.yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: orbit-databases
  namespace: argocd
spec:
  generators:
    - git:
        repoURL: https://github.com/drewpayment/orbit.git
        revision: HEAD
        directories:
          - path: infrastructure/k8s/databases/*
  template:
    metadata:
      name: 'orbit-db-{{path.basename}}'
      annotations:
        argocd.argoproj.io/sync-wave: "1"
    spec:
      project: orbit
      source:
        repoURL: https://github.com/drewpayment/orbit.git
        targetRevision: HEAD
        path: '{{path}}'
      destination:
        server: https://kubernetes.default.svc
        namespace: orbit
      syncPolicy:
        automated:
          prune: true
          selfHeal: true
        syncOptions:
          - CreateNamespace=true
          - ServerSideApply=true
          - RespectIgnoreDifferences=true
```

**Wave ordering:**

| Wave | Category | Services | Reason |
|------|----------|----------|--------|
| 0 | Base | namespace, storageclass, secrets, priority classes, network policies | Foundation |
| 1 | Databases | mongodb, postgresql, redis, redpanda, minio | Data layer must be ready first |
| 2 | Infrastructure | temporal, temporal-ui, registry, buildkit, oauth2-proxy | Depends on databases |
| 3 | Services | repository, kafka, bifrost, build, plugins, temporal-worker | Depends on temporal + databases |
| 4 | Frontend | orbit-www, orbit-docs | Depends on all backend services |

### 4.3 Enable Server-Side Apply + Server-Side Diff

Add to ArgoCD configmap:
```yaml
# argocd-cm ConfigMap
data:
  resource.server-side-diff: "true"
```

Add to every Application/ApplicationSet:
```yaml
syncOptions:
  - ServerSideApply=true
  - RespectIgnoreDifferences=true
```

**CRITICAL:** Never use `ApplyOutOfSyncOnly=true` — it causes silent sync failures with Server-Side Apply (learned from k3s-argocd-proxmox the hard way).

### 4.4 Add ignoreDifferences

Prevent ArgoCD from showing perpetual drift on fields managed by controllers:

```yaml
ignoreDifferences:
  - group: ""
    kind: PersistentVolumeClaim
    jsonPointers:
      - /spec/volumeName
      - /spec/resources/requests/storage
  - group: external-secrets.io
    kind: ExternalSecret
    jsonPointers:
      - /status
  - group: gateway.networking.k8s.io
    kind: HTTPRoute
    jsonPointers:
      - /status
  - group: apps
    kind: Deployment
    jsonPointers:
      - /spec/template/metadata/annotations/kubectl.kubernetes.io~1restartedAt
```

### 4.5 Add ArgoCD Health Check for Child Applications

Standard ArgoCD marks parent "Healthy" when child Application **resource** is created (not when the child is actually healthy). This breaks sync waves — Wave 2 starts before Wave 1 databases are actually running.

**Solution:** Custom Lua health check in ArgoCD values:
```lua
resource.customizations.health.argoproj.io_Application: |
  hs = {}
  hs.status = "Progressing"
  hs.message = ""
  if obj.status ~= nil then
    if obj.status.health ~= nil then
      hs.status = obj.status.health.status
      if obj.status.health.message ~= nil then
        hs.message = obj.status.health.message
      end
    end
  end
  return hs
```

---

## 5. Phase 4: Observability Stack (P1)

**Estimated Effort:** 2-3 days
**Impact:** Visibility into cluster health, performance, and failures

### 5.1 Deploy kube-prometheus-stack

```yaml
# infrastructure/k8s/monitoring/kube-prometheus-stack/kustomization.yaml
helmCharts:
  - name: kube-prometheus-stack
    repo: https://prometheus-community.github.io/helm-charts
    version: "65.1.0"
    releaseName: kube-prometheus-stack
    valuesFile: values.yaml
    includeCRDs: true
```

Key values:
```yaml
# values.yaml
prometheus:
  prometheusSpec:
    retention: 15d
    storageSpec:
      volumeClaimTemplate:
        spec:
          storageClassName: nfs-csi
          resources:
            requests:
              storage: 20Gi
    serviceMonitorSelector: {}  # Discover all ServiceMonitors

grafana:
  enabled: true
  persistence:
    enabled: true
    storageClassName: nfs-csi
    size: 5Gi

alertmanager:
  enabled: true
```

### 5.2 Add ServiceMonitors for All Services

```yaml
# Add to each service directory
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: bifrost
  namespace: orbit
  labels:
    app: bifrost
spec:
  selector:
    matchLabels:
      app: bifrost
  endpoints:
    - port: http-metrics
      interval: 30s
      path: /metrics
```

**Services with metrics endpoints:**
- bifrost: port 8080 `/metrics` (confirmed in docker-compose)
- repository-service: port 8081 (HTTP/metrics)
- plugins-service: port 8080
- build-service: port 50054 (needs metrics endpoint added)
- temporal-server: port 8233 (built-in metrics)

### 5.3 Add Alert Rules

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: orbit-alerts
  namespace: orbit
spec:
  groups:
    - name: orbit.rules
      rules:
        - alert: PodCrashLooping
          expr: rate(kube_pod_container_status_restarts_total{namespace="orbit"}[15m]) > 0
          for: 5m
          labels:
            severity: critical
          annotations:
            summary: "Pod {{ $labels.pod }} is crash looping"

        - alert: PodNotReady
          expr: kube_pod_status_ready{namespace="orbit", condition="true"} == 0
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "Pod {{ $labels.pod }} has been not ready for 5 minutes"

        - alert: PVCAlmostFull
          expr: kubelet_volume_stats_used_bytes{namespace="orbit"} / kubelet_volume_stats_capacity_bytes{namespace="orbit"} > 0.85
          for: 10m
          labels:
            severity: warning
          annotations:
            summary: "PVC {{ $labels.persistentvolumeclaim }} is >85% full"

        - alert: HighMemoryUsage
          expr: container_memory_working_set_bytes{namespace="orbit"} / container_spec_memory_limit_bytes{namespace="orbit"} > 0.9
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "Container {{ $labels.container }} memory >90% of limit"

        - alert: TemporalWorkflowFailures
          expr: rate(temporal_workflow_failed_total[5m]) > 0.1
          for: 5m
          labels:
            severity: critical
          annotations:
            summary: "Temporal workflows failing at elevated rate"
```

### 5.4 Add Log Aggregation (Loki)

```yaml
# infrastructure/k8s/monitoring/loki/kustomization.yaml
helmCharts:
  - name: loki
    repo: https://grafana.github.io/helm-charts
    version: "6.24.0"
    releaseName: loki
    valuesFile: values.yaml
```

### 5.5 Pre-built Grafana Dashboards

Create dashboards for:
- **Orbit Overview:** All service health, request rates, error rates
- **Temporal:** Workflow executions, latencies, failures, queue depth
- **Bifrost/Kafka:** Message throughput, consumer lag, tenant metrics
- **Database:** Connection pools, query latency, replication lag
- **Infrastructure:** Node resources, PVC usage, network I/O

---

## 6. Phase 5: Disaster Recovery & Backup (P1)

**Estimated Effort:** 3-5 days
**Impact:** Prevents unrecoverable data loss

### 6.1 Database Backup Strategy

**Option A: CronJob-based backups (simple)**

```yaml
# infrastructure/k8s/backup/mongodb-backup.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: mongodb-backup
  namespace: orbit
spec:
  schedule: "0 */6 * * *"  # Every 6 hours
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: mongodump
              image: mongo:7
              command:
                - /bin/sh
                - -c
                - |
                  mongodump \
                    --uri="mongodb://$MONGO_USER:$MONGO_PASS@mongodb:27017" \
                    --archive=/backup/mongodb-$(date +%Y%m%d-%H%M%S).gz \
                    --gzip
              envFrom:
                - secretRef:
                    name: mongodb-secrets
              volumeMounts:
                - name: backup
                  mountPath: /backup
          volumes:
            - name: backup
              persistentVolumeClaim:
                claimName: backup-storage
          restartPolicy: OnFailure
```

**Option B: CloudNativePG (production-grade, matches k3s-argocd-proxmox)**

Migrate from standalone PostgreSQL StatefulSet to CNPG for:
- Automated backups to S3 (MinIO) via Barman
- Point-in-time recovery
- WAL archiving
- Automatic failover with 2+ replicas

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: orbit-postgres
  namespace: orbit
spec:
  instances: 2
  storage:
    size: 10Gi
    storageClass: nfs-csi
  backup:
    barmanObjectStore:
      destinationPath: s3://orbit-backups/cnpg/
      endpointURL: http://minio:9000
      s3Credentials:
        accessKeyId:
          name: minio-secrets
          key: MINIO_ROOT_USER
        secretAccessKey:
          name: minio-secrets
          key: MINIO_ROOT_PASSWORD
    retentionPolicy: "30d"
```

### 6.2 PVC Backup with VolSync

For application data that lives in PVCs (MongoDB data, Redis data, MinIO data):

```yaml
# Install VolSync
# infrastructure/k8s/backup/volsync/kustomization.yaml
helmCharts:
  - name: volsync
    repo: https://backube.github.io/helm-charts
    version: "0.10.0"
    releaseName: volsync
```

```yaml
# Per-PVC backup schedule
apiVersion: volsync.backube/v1alpha1
kind: ReplicationSource
metadata:
  name: mongodb-backup
  namespace: orbit
spec:
  sourcePVC: mongodb-data
  trigger:
    schedule: "0 */4 * * *"
  restic:
    repository: mongodb-backup-secret
    retain:
      hourly: 6
      daily: 7
      weekly: 4
      monthly: 2
    copyMethod: Snapshot
```

### 6.3 Backup Verification

Add a CronJob that periodically restores to a test database and validates:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: backup-verification
  namespace: orbit
spec:
  schedule: "0 3 * * 0"  # Weekly Sunday 3am
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: verify
              image: mongo:7
              command:
                - /bin/sh
                - -c
                - |
                  # Restore latest backup to temp database
                  mongorestore --uri="mongodb://..." --drop --nsInclude="orbit-verify.*"
                  # Run validation queries
                  mongosh --eval 'db.getSiblingDB("orbit-verify").getCollectionNames().length > 0 || quit(1)'
          restartPolicy: OnFailure
```

### 6.4 Disaster Recovery Runbook

Create `docs/runbooks/disaster-recovery.md` covering:
- **RTO target:** 1 hour for full cluster recovery
- **RPO target:** 6 hours (backup interval)
- Step-by-step for each failure mode:
  - Single pod crash (auto-recovery)
  - Single node failure (PDB + reschedule)
  - Database corruption (restore from backup)
  - Full cluster loss (NFS backup + ArgoCD bootstrap)
  - Namespace accidental deletion

---

## 7. Phase 6: Performance & Cost Optimization (P2)

**Estimated Effort:** 2-3 days
**Impact:** Right-sized resources, better NFS performance

### 7.1 NFS Mount Tuning

**Current:** No mount options. Default Linux NFS readahead caps at ~140 MB/s.

```yaml
# infrastructure/k8s/storageclass.yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: nfs-csi
provisioner: nfs.csi.k8s.io
parameters:
  server: 192.168.86.44
  share: /mnt/tank/appdata/orbit
mountOptions:
  - nfsvers=4.1
  - noatime          # Skip access time updates (big perf win)
  - nconnect=8       # Multiple TCP connections
  - rsize=1048576    # 1MB read buffer
  - wsize=1048576    # 1MB write buffer
reclaimPolicy: Retain
volumeBindingMode: Immediate
```

### 7.2 Install VPA (Vertical Pod Autoscaler)

```yaml
# Start with recommendation-only mode
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: orbit-www-vpa
  namespace: orbit
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: orbit-www
  updatePolicy:
    updateMode: "Off"  # Recommend only, don't auto-resize
```

Run VPA in "Off" mode for 2 weeks, then review recommendations and adjust resource requests/limits accordingly.

### 7.3 Add HPA for Frontend

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: orbit-www-hpa
  namespace: orbit
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: orbit-www
  minReplicas: 2
  maxReplicas: 5
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
```

### 7.4 Resource Quota for Namespace

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: orbit-quota
  namespace: orbit
spec:
  hard:
    requests.cpu: "8"
    requests.memory: 16Gi
    limits.cpu: "16"
    limits.memory: 32Gi
    persistentvolumeclaims: "20"
    pods: "50"
```

### 7.5 LimitRange for Defaults

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: orbit-defaults
  namespace: orbit
spec:
  limits:
    - default:
        cpu: 500m
        memory: 512Mi
      defaultRequest:
        cpu: 100m
        memory: 128Mi
      type: Container
```

---

## 8. Phase 7: Advanced Patterns (P3)

**Estimated Effort:** 5-10 days
**Impact:** Production-grade operational maturity

### 8.1 Kyverno Policy Engine

Deploy Kyverno for automated policy enforcement (matches k3s-argocd-proxmox):

**Policies to implement:**
1. **Require labels:** All resources must have `app`, `version`, `team` labels
2. **Image pull policy:** Force `IfNotPresent` to avoid Docker Hub rate limits
3. **Disallow privileged:** Block privileged containers (except buildkit)
4. **Require resource limits:** Deny pods without requests/limits
5. **Auto-generate VPA:** Create VPA for every Deployment/StatefulSet
6. **Require probes:** Deny deployments without readiness/liveness probes
7. **Auto-inject Reloader:** Add stakater/Reloader annotations for ConfigMap/Secret change restarts

### 8.2 Stakater Reloader

Auto-restart pods when ConfigMaps or Secrets change:

```yaml
# Install Reloader
helmCharts:
  - name: reloader
    repo: https://stakater.github.io/stakater-charts
    version: "1.0.72"
    releaseName: reloader
```

Then annotate deployments:
```yaml
metadata:
  annotations:
    reloader.stakater.com/auto: "true"
```

### 8.3 Multi-Environment Overlays

```
infrastructure/k8s/
  base/           # Shared manifests
  overlays/
    dev/          # Local development
      kustomization.yaml
      patches/
    staging/      # Staging environment
      kustomization.yaml
      patches/
    production/   # Production
      kustomization.yaml
      patches/
```

### 8.4 Sealed Secrets for Local Development

For developers who don't have Doppler access:
```yaml
# infrastructure/k8s/overlays/dev/kustomization.yaml
resources:
  - ../../base
patchesStrategicMerge:
  - remove-external-secrets.yaml
  - local-secrets.yaml  # SealedSecret or plain Secret
```

### 8.5 Topology Spread Constraints

When running 2+ replicas, spread across nodes:

```yaml
spec:
  template:
    spec:
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app: orbit-www
```

---

## 9. Claude/LLM K8s Manifest Rules & Patterns

This section defines **rules and conventions for AI assistants** (Claude Code, GitHub Copilot, etc.) to follow when working with Orbit's Kubernetes manifests. Add this to `CLAUDE.md` or as a dedicated `.github/instructions/kubernetes.instructions.md`.

### 9.1 File Naming Conventions

```
# STRICT naming rules - LLMs must follow these exactly

infrastructure/k8s/<category>/<service-name>/
  kustomization.yaml          # REQUIRED - Kustomize entry point
  deployment.yaml             # Stateless workloads
  statefulset.yaml            # Stateful workloads (databases, queues)
  service.yaml                # Kubernetes Service
  pvc.yaml                    # PersistentVolumeClaim
  configmap.yaml              # Non-secret configuration
  pdb.yaml                    # Pod Disruption Budget
  hpa.yaml                    # Horizontal Pod Autoscaler
  vpa.yaml                    # Vertical Pod Autoscaler
  servicemonitor.yaml         # Prometheus ServiceMonitor
  networkpolicy.yaml          # Network isolation rules
  httproute.yaml              # Gateway API route
  cronjob.yaml                # Scheduled jobs
  job.yaml                    # One-time jobs

# NEVER create files named:
#   deploy.yaml, svc.yaml, cm.yaml, ns.yaml (use full names)
#   my-service.yaml (use resource-type.yaml, one resource per file)
```

### 9.2 Manifest Template (Required Fields)

Every manifest MUST include these fields. LLMs should use this as a starting template:

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: <service-name>                    # REQUIRED: matches directory name
  namespace: orbit                        # REQUIRED: always explicit, never rely on context
  labels:                                 # REQUIRED: standard labels
    app: <service-name>
    app.kubernetes.io/name: <service-name>
    app.kubernetes.io/part-of: orbit
    app.kubernetes.io/component: <backend|frontend|database|infrastructure>
  annotations:
    argocd.argoproj.io/sync-wave: "<wave-number>"   # REQUIRED: see wave table
spec:
  replicas: 1                             # REQUIRED: explicit, never omit
  revisionHistoryLimit: 3                 # REQUIRED: prevent etcd bloat
  strategy:                               # REQUIRED: explicit strategy
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  selector:
    matchLabels:
      app: <service-name>                 # MUST match template labels
  template:
    metadata:
      labels:
        app: <service-name>               # MUST match selector
        app.kubernetes.io/name: <service-name>
    spec:
      serviceAccountName: orbit           # REQUIRED: never use default
      terminationGracePeriodSeconds: 30   # REQUIRED: explicit value
      priorityClassName: orbit-standard   # REQUIRED: see priority table
      securityContext:                     # REQUIRED: pod-level security
        runAsNonRoot: true
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: <service-name>            # MUST match metadata.name
          image: ghcr.io/drewpayment/orbit/<service-name>:latest
          imagePullPolicy: IfNotPresent   # REQUIRED: never "Always" in prod
          ports:
            - name: grpc                  # REQUIRED: named ports always
              containerPort: 50051
              protocol: TCP
          env: []                         # Use envFrom for secrets
          envFrom:
            - configMapRef:
                name: <service-name>-config
            - secretRef:
                name: <service-name>-secrets
          securityContext:                 # REQUIRED: container-level security
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          resources:                      # REQUIRED: always set both
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi
          startupProbe:                   # RECOMMENDED for slow-starting services
            httpGet:
              path: /health
              port: http
            failureThreshold: 30
            periodSeconds: 10
          readinessProbe:                 # REQUIRED
            httpGet:
              path: /health
              port: http
            initialDelaySeconds: 5
            periodSeconds: 10
            timeoutSeconds: 3
            failureThreshold: 3
          livenessProbe:                  # REQUIRED
            httpGet:
              path: /health
              port: http
            initialDelaySeconds: 15
            periodSeconds: 20
            timeoutSeconds: 5
            failureThreshold: 3
          volumeMounts:
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: tmp
          emptyDir: {}                    # For readOnlyRootFilesystem
```

### 9.3 Service Template

```yaml
# service.yaml
apiVersion: v1
kind: Service
metadata:
  name: <service-name>
  namespace: orbit
  labels:
    app: <service-name>
    app.kubernetes.io/name: <service-name>
    app.kubernetes.io/part-of: orbit
spec:
  selector:
    app: <service-name>
  ports:
    - name: grpc                          # REQUIRED: always named
      port: 50051
      targetPort: 50051
      protocol: TCP
    - name: http-metrics                  # REQUIRED: always named
      port: 8081
      targetPort: 8081
      protocol: TCP
  # NOTE: Use ClusterIP (default) for internal services
  # NOTE: Use headless (clusterIP: None) for StatefulSets
  # NEVER: Use NodePort or LoadBalancer in manifests
```

### 9.4 Critical Rules for LLMs

```markdown
## K8s Manifest Rules (MUST follow)

### Naming
- Directory name = service name = metadata.name = container name = label `app: <name>`
- One resource per file (deployment.yaml, service.yaml, not combined)
- Files named by resource type, not service name

### Labels (REQUIRED on every resource)
- `app: <service-name>` — Primary selector
- `app.kubernetes.io/name: <service-name>` — Standard K8s label
- `app.kubernetes.io/part-of: orbit` — App grouping
- `app.kubernetes.io/component: <type>` — One of: backend, frontend, database, infrastructure, monitoring

### Ports (MUST be named)
- gRPC: `name: grpc`
- HTTP API: `name: http`
- HTTP metrics: `name: http-metrics`
- Custom: `name: <protocol>-<purpose>` (e.g., `kafka-proxy`, `admin-grpc`)

### Security (REQUIRED on every container)
- `runAsNonRoot: true` at pod level
- `allowPrivilegeEscalation: false` at container level
- `readOnlyRootFilesystem: true` with emptyDir for /tmp
- `capabilities.drop: ["ALL"]`
- Exception: buildkit (privileged required for container builds)

### Resources (REQUIRED, never omit)
- Always set both requests AND limits
- CPU: requests ≤ limits (burstable OK)
- Memory: requests = limits (prevents OOM kills from overcommit)
- See resource table below for per-service guidelines

### Health Checks (REQUIRED on every container)
- readinessProbe: REQUIRED (takes pod out of Service)
- livenessProbe: REQUIRED (restarts unhealthy pod)
- startupProbe: RECOMMENDED for services needing >30s to start
- NEVER use `exec: ls /tmp` or similar fake checks
- gRPC services: use native gRPC health protocol
- HTTP services: use dedicated /health endpoint

### Secrets (NEVER hardcode)
- All secrets via ExternalSecret from Doppler
- Per-service secrets (not monolithic)
- Reference via envFrom.secretRef, not env.valueFrom
- NEVER put secret values in ConfigMaps
- NEVER commit .env files

### Sync Waves (REQUIRED annotation)
- Wave 0: namespace, secrets, network policies, priority classes
- Wave 1: databases (mongodb, postgresql, redis, redpanda, minio)
- Wave 2: core infrastructure (temporal, registry, buildkit)
- Wave 3: application services (Go microservices)
- Wave 4: frontend (orbit-www, orbit-docs)

### What NOT to do
- NEVER use `kubectl edit` for persistent changes (GitOps only)
- NEVER use `latest` tag without imagePullPolicy: IfNotPresent
- NEVER create Services without named ports
- NEVER skip namespace field (even if Kustomize sets it)
- NEVER use `hostNetwork: true` or `hostPort`
- NEVER use `ApplyOutOfSyncOnly=true` in ArgoCD sync options
- NEVER put multiple resources in one YAML file (use kustomization.yaml to compose)
- NEVER reference secrets by name without verifying the ExternalSecret exists
- NEVER set replicas > 1 without also adding a PDB
- NEVER use `replace: true` in ArgoCD (use server-side apply patch instead)
```

### 9.5 Resource Guidelines Table

```markdown
## Resource Sizing Guidelines

| Service | CPU Request | CPU Limit | Mem Request | Mem Limit | Priority | Wave |
|---------|------------|-----------|-------------|-----------|----------|------|
| mongodb | 200m | 1000m | 512Mi | 2Gi | critical | 1 |
| postgresql | 200m | 500m | 256Mi | 1Gi | critical | 1 |
| redis | 100m | 300m | 128Mi | 512Mi | critical | 1 |
| redpanda | 200m | 1000m | 512Mi | 2Gi | critical | 1 |
| minio | 100m | 500m | 256Mi | 1Gi | critical | 1 |
| temporal | 200m | 500m | 256Mi | 1Gi | critical | 2 |
| temporal-ui | 50m | 200m | 64Mi | 256Mi | standard | 2 |
| temporal-worker | 100m | 500m | 128Mi | 512Mi | standard | 3 |
| registry | 50m | 200m | 64Mi | 256Mi | standard | 2 |
| buildkit | 500m | 4000m | 512Mi | 4Gi | batch | 2 |
| orbit-www | 200m | 1000m | 256Mi | 1Gi | standard | 4 |
| orbit-docs | 50m | 200m | 64Mi | 256Mi | standard | 4 |
| repository-svc | 100m | 300m | 64Mi | 256Mi | standard | 3 |
| kafka-svc | 100m | 300m | 64Mi | 256Mi | standard | 3 |
| bifrost | 100m | 300m | 128Mi | 512Mi | standard | 3 |
| build-svc | 200m | 1000m | 256Mi | 1Gi | batch | 3 |
| plugins-svc | 100m | 300m | 64Mi | 256Mi | standard | 3 |
| oauth2-proxy | 50m | 200m | 64Mi | 128Mi | standard | 2 |
```

### 9.6 Kustomization Template

```yaml
# Every service directory MUST have this file
# infrastructure/k8s/<category>/<service-name>/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: orbit

# List ALL resources in this directory
resources:
  - deployment.yaml       # or statefulset.yaml
  - service.yaml
  - pdb.yaml
  - servicemonitor.yaml

# Reference shared components
components:
  - ../../common/deployment-defaults

# Common labels applied to all resources
commonLabels:
  app.kubernetes.io/part-of: orbit
```

### 9.7 Commenting Conventions for LLM Readability

```yaml
# === DEPLOYMENT: repository-service ===
# Purpose: Manages Git repository operations (clone, sync, template generation)
# Depends on: temporal (workflow orchestration), mongodb (metadata storage)
# Exposes: gRPC on 50051, HTTP metrics on 8081
# Wave: 3 (application services)
# Owner: platform-team
apiVersion: apps/v1
kind: Deployment
metadata:
  name: repository-service
  # ...

# NOTE: This service needs /tmp for git clone operations
# NOTE: Memory limit increased from 256Mi after OOM during large repo clones
# TODO: Add HPA when traffic patterns are established
```

**Comment rules for LLMs:**
- Every file starts with a header block explaining purpose, dependencies, and ownership
- Use `NOTE:` for non-obvious design decisions
- Use `TODO:` for known improvements
- Use `CRITICAL:` for configuration that must not be changed without understanding implications
- Use `DEPENDS-ON:` to document service dependencies
- Never add comments that repeat what YAML already says (e.g., `# port 80` next to `port: 80`)

### 9.8 Directory Discovery Conventions

```markdown
## How to find things (for LLMs)

### "Where is the deployment for service X?"
infrastructure/k8s/<category>/<service-name>/deployment.yaml

### "Where are the secrets for service X?"
infrastructure/k8s/externalsecrets/<service-name>-secrets.yaml

### "Where is the network policy for service X?"
infrastructure/k8s/base/network-policies/<service-name>.yaml

### "Where is the monitoring config for service X?"
infrastructure/k8s/<category>/<service-name>/servicemonitor.yaml

### "Where is the ArgoCD config?"
infrastructure/k8s/argocd/

### "Where are shared components?"
infrastructure/k8s/base/common/

### "What wave is service X in?"
Check the sync-wave annotation in its deployment.yaml metadata
Or check the ApplicationSet that manages its category

### "What connects to what?"
Read the network policies in infrastructure/k8s/base/network-policies/
Each policy explicitly lists allowed ingress/egress connections
```

---

## 10. Full Gap Inventory

### Critical (P0) — Must fix before production confidence

| # | Gap | Category | Current | Target |
|---|-----|----------|---------|--------|
| 1 | Monolithic secret shared by all pods | Security | Single `orbit-secrets` | Per-service ExternalSecrets |
| 2 | Go containers run as root | Security | No USER in Dockerfile | Non-root user, SecurityContext |
| 3 | Zero network policies | Security | All pods talk freely | Default deny + explicit allow |
| 4 | No container image scanning | Security | Push without scan | Trivy in CI pipeline |
| 5 | No dependency updates | Security | Manual only | Dependabot/Renovate |
| 6 | Unnamed service ports | Reliability | Raw port numbers | Named ports on all services |
| 7 | Fake health check (temporal-worker) | Reliability | `ls /tmp` | Real Temporal connectivity check |
| 8 | No graceful shutdown | Reliability | Instant kill | preStop hooks, grace periods |
| 9 | No rolling update strategy | Reliability | K8s defaults | Explicit maxUnavailable: 0 |
| 10 | All replicas = 1 | Availability | Single point of failure | 2+ for critical services |

### High (P1) — Should implement within 1-2 months

| # | Gap | Category | Current | Target |
|---|-----|----------|---------|--------|
| 11 | Flat kustomization | Architecture | Single file lists all | App-of-Apps with ApplicationSets |
| 12 | No sync waves | Architecture | Race conditions | Wave 0-4 ordered deployment |
| 13 | No Server-Side Apply | Architecture | Client-side (conflicts) | SSA + Server-Side Diff |
| 14 | No ignoreDifferences | Architecture | Perpetual drift | Configured for known-drifting fields |
| 15 | No database backups | Data Safety | None | CronJob or CNPG Barman |
| 16 | No PVC backups | Data Safety | None | VolSync + Kopia/Restic |
| 17 | No disaster recovery runbook | Operations | None | Documented procedures |
| 18 | No Prometheus in K8s | Observability | Docker-compose only | kube-prometheus-stack |
| 19 | No Grafana dashboards | Observability | None | Pre-built dashboards |
| 20 | No alerting | Observability | None | PrometheusRule + Alertmanager |
| 21 | No log aggregation | Observability | None | Loki + Promtail |
| 22 | No Pod Disruption Budgets | Reliability | None | PDB for all 2+ replica services |
| 23 | No priority classes | Reliability | All equal | 3-tier priority (critical/standard/batch) |
| 24 | No startup probes | Reliability | None | For slow-starting services |

### Medium (P2) — Implement within 3-6 months

| # | Gap | Category | Current | Target |
|---|-----|----------|---------|--------|
| 25 | No NFS mount tuning | Performance | Default options | nconnect, rsize, noatime |
| 26 | No VPA | Cost | Static guesses | VPA recommendations |
| 27 | No HPA | Scalability | Manual scaling | Auto-scale frontend |
| 28 | No ResourceQuota | Cost | Unbounded | Namespace limits |
| 29 | No LimitRange | Safety | No defaults | Default request/limit for orphan pods |
| 30 | No multi-environment overlays | Architecture | Single environment | dev/staging/prod overlays |
| 31 | revisionHistoryLimit not set | Efficiency | 10 (default) | 3 |
| 32 | No topology spread | Availability | All pods same node | Spread across nodes |
| 33 | Hardcoded NFS IP | Portability | 192.168.86.44 | ConfigMap or StorageClass parameter |
| 34 | Hardcoded domain names | Portability | orbit.hoytlabs.app everywhere | Kustomize variable substitution |
| 35 | No .dockerignore (most services) | Build Speed | Sends full context | Minimal build context |

### Low (P3) — Long-term improvements

| # | Gap | Category | Current | Target |
|---|-----|----------|---------|--------|
| 36 | No Kyverno policies | Governance | None | Automated policy enforcement |
| 37 | No Reloader | Operations | Manual restart on config change | Auto-restart |
| 38 | No service mesh | Security | No mTLS | Consider Cilium service mesh |
| 39 | No cost monitoring | Cost | None | Kubecost or OpenCost |
| 40 | No SBOM generation | Compliance | None | CycloneDX in CI |
| 41 | No image signing | Supply Chain | None | Cosign |
| 42 | No etcd encryption at rest | Security | Plain secrets in etcd | EncryptionConfiguration |
| 43 | MongoDB not a replica set | Data Safety | Standalone | ReplicaSet with 2+ members |
| 44 | Redis not clustered | Availability | Standalone | Redis Sentinel or Cluster |
| 45 | Redpanda single broker | Availability | 1 broker | 3 brokers for production |
| 46 | MinIO single server | Availability | Standalone | Distributed mode (4+ nodes) |

---

## 11. Migration Checklist

### Phase 1 Checklist (Security, 2-3 days)

- [ ] Create per-service ExternalSecret manifests
- [ ] Update all deployments to reference service-specific secrets
- [ ] Delete monolithic `orbit-secrets` ExternalSecret
- [ ] Add non-root USER to all Go Dockerfiles
- [ ] Add SecurityContext to all deployment manifests
- [ ] Create default-deny NetworkPolicy
- [ ] Create per-service allow NetworkPolicies
- [ ] Name all service ports
- [ ] Add Trivy scanning to build-and-push.yml
- [ ] Create `.github/dependabot.yml`
- [ ] Verify all changes in staging before applying to production

### Phase 2 Checklist (Reliability, 2-3 days)

- [ ] Fix temporal-worker health check
- [ ] Add startup probes to slow-starting services
- [ ] Add terminationGracePeriodSeconds to all deployments
- [ ] Add preStop hooks to temporal-worker and temporal-server
- [ ] Add explicit rolling update strategy to all deployments
- [ ] Set revisionHistoryLimit: 3 on all deployments
- [ ] Create PriorityClass resources (critical, standard, batch)
- [ ] Assign priority classes to all deployments
- [ ] Create PDB for orbit-www (when scaled to 2+)
- [ ] Test node drain with PDBs

### Phase 3 Checklist (GitOps, 3-5 days)

- [ ] Restructure `infrastructure/k8s/` into category directories
- [ ] Create `base/` directory with shared resources
- [ ] Create Kustomize component for deployment defaults
- [ ] Add sync wave annotations to all manifests
- [ ] Create ApplicationSets (databases, infrastructure, services, frontend)
- [ ] Create root Application (app-of-apps)
- [ ] Enable Server-Side Apply in all ApplicationSets
- [ ] Enable Server-Side Diff in ArgoCD configmap
- [ ] Add ignoreDifferences for PVCs, ExternalSecrets, HTTPRoutes
- [ ] Add custom Lua health check for Application CRD
- [ ] Test wave ordering by deploying to fresh namespace

### Phase 4 Checklist (Observability, 2-3 days)

- [ ] Deploy kube-prometheus-stack via Helm
- [ ] Create ServiceMonitors for all services with metrics endpoints
- [ ] Create PrometheusRule for critical alerts
- [ ] Deploy Loki for log aggregation
- [ ] Create Grafana dashboards (overview, Temporal, Kafka, databases)
- [ ] Configure AlertManager routing (email/Slack/Discord)
- [ ] Verify all metrics scraped via Prometheus targets page

### Phase 5 Checklist (DR & Backup, 3-5 days)

- [ ] Create MongoDB backup CronJob
- [ ] Create PostgreSQL backup CronJob
- [ ] Test backup restoration to verify integrity
- [ ] Evaluate CNPG migration for PostgreSQL
- [ ] Deploy VolSync for PVC backups (if applicable)
- [ ] Create disaster recovery runbook
- [ ] Create backup verification CronJob
- [ ] Document RTO/RPO targets
- [ ] Run full DR drill (simulate namespace deletion and recovery)

### Phase 6 Checklist (Performance & Cost, 2-3 days)

- [ ] Add NFS mount options to StorageClass
- [ ] Deploy VPA in recommendation mode
- [ ] Wait 2 weeks, review VPA recommendations
- [ ] Adjust resource requests/limits based on VPA data
- [ ] Add HPA for orbit-www
- [ ] Create ResourceQuota for orbit namespace
- [ ] Create LimitRange for orbit namespace
- [ ] Add `.dockerignore` to all service directories

### Phase 7 Checklist (Advanced, 5-10 days)

- [ ] Deploy Kyverno
- [ ] Create core policies (labels, probes, resources, security)
- [ ] Deploy Reloader for config-change restarts
- [ ] Create multi-environment overlays (dev/staging/prod)
- [ ] Add topology spread constraints
- [ ] Parameterize domain names via Kustomize
- [ ] Evaluate service mesh (Cilium or Linkerd)

---

## Appendix A: ArgoCD Application Example

```yaml
# For the external drewpayment-hoytlabs-talos repo
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: orbit
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: orbit
  source:
    repoURL: https://github.com/drewpayment/orbit.git
    targetRevision: HEAD
    path: infrastructure/k8s/argocd
  destination:
    server: https://kubernetes.default.svc
    namespace: argocd
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
      - ServerSideApply=true
      - RespectIgnoreDifferences=true
  ignoreDifferences:
    - group: argoproj.io
      kind: Application
      jsonPointers:
        - /status
```

## Appendix B: Quick Reference Card

```
ORBIT K8S QUICK REFERENCE

Waves:  0=base → 1=databases → 2=infra → 3=services → 4=frontend
Labels: app, app.kubernetes.io/name, part-of, component
Ports:  ALWAYS named (grpc, http, http-metrics, kafka-proxy)
Security: runAsNonRoot, no-escalation, readOnlyRootFS, drop ALL caps
Probes: readiness + liveness REQUIRED, startup RECOMMENDED
Resources: ALWAYS set requests AND limits
Secrets: Per-service ExternalSecret, NEVER monolithic
Strategy: maxUnavailable=0, maxSurge=1
History: revisionHistoryLimit=3
Network: Default deny + explicit allow per service
Shutdown: terminationGracePeriodSeconds + preStop hooks

PRIORITY CLASSES:
  orbit-critical (1M):  databases, temporal
  orbit-standard (100K): app services, frontend (default)
  orbit-batch (10K):    buildkit, build jobs

SYNC OPTIONS (ArgoCD):
  ServerSideApply=true
  RespectIgnoreDifferences=true
  CreateNamespace=true
  NEVER: ApplyOutOfSyncOnly=true
```

## Appendix C: Comparison Summary

```
k3s-argocd-proxmox          →  What Orbit Should Adopt
─────────────────────────────────────────────────────────
App-of-Apps + AppSets       →  Replace flat kustomization
Sync Waves (0-6)            →  Add wave annotations (0-4)
Server-Side Apply/Diff      →  Enable on all Applications
1Password + ExternalSecrets →  Keep Doppler, split per-service
Cilium Network Policies     →  Add K8s NetworkPolicies
VolSync + Kopia backups     →  Add VolSync or CronJob backups
CNPG for PostgreSQL         →  Evaluate CNPG migration
Kyverno policies            →  Add Kyverno for governance
VPA auto-generation         →  Deploy VPA
kube-prometheus-stack       →  Deploy full monitoring
Loki + Tempo                →  Add log/trace aggregation
Named Service ports         →  Fix all services
Deployment defaults component →  Create shared component
NFS mount tuning            →  Add mount options
Reloader                    →  Deploy Reloader
```

---

*This document was generated by analyzing the battle-tested patterns in [k3s-argocd-proxmox](https://github.com/mitchross/k3s-argocd-proxmox) and comparing them against the current state of Orbit's infrastructure. All recommendations are prioritized by security impact, operational risk, and implementation effort.*
