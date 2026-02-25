# Kubernetes Deployment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deploy all Orbit IDP services to a self-hosted Talos Kubernetes cluster with CI/CD image pipeline.

**Architecture:** Flat Kustomize manifests under `infrastructure/k8s/`, one directory per service. GitHub Actions builds images to ghcr.io. ArgoCD syncs manifests to cluster. Doppler provides secrets via ExternalSecrets operator.

**Tech Stack:** Kubernetes, Kustomize, GitHub Actions, ghcr.io, ArgoCD, Gateway API (envoy-gateway), NFS (csi-driver-nfs), ExternalSecrets (Doppler), BuildKit

**Design Doc:** `docs/plans/2026-02-25-kubernetes-deployment-design.md`

---

## Task 1: Scaffold base K8s manifests

**Files:**
- Create: `infrastructure/k8s/kustomization.yaml`
- Create: `infrastructure/k8s/namespace.yaml`
- Create: `infrastructure/k8s/storageclass.yaml`
- Create: `infrastructure/k8s/serviceaccount.yaml`
- Create: `infrastructure/k8s/externalsecret.yaml`
- Create: `infrastructure/k8s/README.md`

**Step 1: Create namespace**

```yaml
# infrastructure/k8s/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: orbit
```

**Step 2: Create NFS StorageClass**

```yaml
# infrastructure/k8s/storageclass.yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: orbit-nfs
provisioner: nfs.csi.k8s.io
parameters:
  server: 192.168.86.44
  share: /mnt/tank/appdata/orbit
  mountOptions: "nolock"
reclaimPolicy: Retain
volumeBindingMode: Immediate
```

**Step 3: Create ServiceAccount**

```yaml
# infrastructure/k8s/serviceaccount.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: orbit
  namespace: orbit
```

**Step 4: Create ExternalSecret**

```yaml
# infrastructure/k8s/externalsecret.yaml
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
    # MongoDB
    - secretKey: MONGO_ROOT_USERNAME
      remoteRef: { key: ORBIT_MONGO_ROOT_USERNAME }
    - secretKey: MONGO_ROOT_PASSWORD
      remoteRef: { key: ORBIT_MONGO_ROOT_PASSWORD }
    # PostgreSQL
    - secretKey: POSTGRES_USER
      remoteRef: { key: ORBIT_POSTGRES_USER }
    - secretKey: POSTGRES_PASSWORD
      remoteRef: { key: ORBIT_POSTGRES_PASSWORD }
    # MinIO
    - secretKey: MINIO_ROOT_USER
      remoteRef: { key: ORBIT_MINIO_ROOT_USER }
    - secretKey: MINIO_ROOT_PASSWORD
      remoteRef: { key: ORBIT_MINIO_ROOT_PASSWORD }
    # orbit-www application secrets
    - secretKey: PAYLOAD_SECRET
      remoteRef: { key: ORBIT_PAYLOAD_SECRET }
    - secretKey: ENCRYPTION_KEY
      remoteRef: { key: ORBIT_ENCRYPTION_KEY }
    - secretKey: BETTER_AUTH_SECRET
      remoteRef: { key: ORBIT_BETTER_AUTH_SECRET }
    - secretKey: RESEND_API_KEY
      remoteRef: { key: ORBIT_RESEND_API_KEY }
    - secretKey: RESEND_FROM_EMAIL
      remoteRef: { key: ORBIT_RESEND_FROM_EMAIL }
    # GitHub App
    - secretKey: GITHUB_APP_ID
      remoteRef: { key: ORBIT_GITHUB_APP_ID }
    - secretKey: GITHUB_CLIENT_ID
      remoteRef: { key: ORBIT_GITHUB_CLIENT_ID }
    - secretKey: GITHUB_CLIENT_SECRET
      remoteRef: { key: ORBIT_GITHUB_CLIENT_SECRET }
    - secretKey: GITHUB_WEBHOOK_SECRET
      remoteRef: { key: ORBIT_GITHUB_WEBHOOK_SECRET }
    # Inter-service auth
    - secretKey: ORBIT_INTERNAL_API_KEY
      remoteRef: { key: ORBIT_INTERNAL_API_KEY }
    - secretKey: JWT_SECRET
      remoteRef: { key: ORBIT_JWT_SECRET }
    # Registry
    - secretKey: ORBIT_REGISTRY_PASSWORD
      remoteRef: { key: ORBIT_REGISTRY_PASSWORD }
    - secretKey: ORBIT_REGISTRY_JWT_SECRET
      remoteRef: { key: ORBIT_REGISTRY_JWT_SECRET }
```

**Step 5: Create README with Doppler setup instructions**

```markdown
# Orbit Kubernetes Deployment

## Pre-Deployment Setup

### 1. Doppler Secrets

Create a Doppler project (e.g., `orbit`) and populate the following secrets.
These are pulled into the cluster by the `orbit-secrets` ExternalSecret via
the `doppler-cluster-secret-store` ClusterSecretStore.

| Doppler Key | Description |
|---|---|
| `ORBIT_MONGO_ROOT_USERNAME` | MongoDB root username |
| `ORBIT_MONGO_ROOT_PASSWORD` | MongoDB root password |
| `ORBIT_POSTGRES_USER` | PostgreSQL superuser username |
| `ORBIT_POSTGRES_PASSWORD` | PostgreSQL superuser password |
| `ORBIT_MINIO_ROOT_USER` | MinIO root username |
| `ORBIT_MINIO_ROOT_PASSWORD` | MinIO root password |
| `ORBIT_PAYLOAD_SECRET` | Payload CMS secret (random 32+ chars) |
| `ORBIT_ENCRYPTION_KEY` | Encryption key (32 bytes, base64-encoded) |
| `ORBIT_BETTER_AUTH_SECRET` | Better Auth secret (random 32+ chars) |
| `ORBIT_RESEND_API_KEY` | Resend email API key |
| `ORBIT_RESEND_FROM_EMAIL` | Resend sender email address |
| `ORBIT_GITHUB_APP_ID` | GitHub App ID |
| `ORBIT_GITHUB_CLIENT_ID` | GitHub App OAuth client ID |
| `ORBIT_GITHUB_CLIENT_SECRET` | GitHub App OAuth client secret |
| `ORBIT_GITHUB_WEBHOOK_SECRET` | GitHub App webhook secret |
| `ORBIT_INTERNAL_API_KEY` | Shared key for inter-service auth |
| `ORBIT_JWT_SECRET` | JWT signing secret |
| `ORBIT_REGISTRY_PASSWORD` | Container registry password |
| `ORBIT_REGISTRY_JWT_SECRET` | Container registry JWT secret |

### 2. NFS Directories

Create on your NFS server (192.168.86.44):

    mkdir -p /mnt/tank/appdata/orbit/{mongodb,postgresql,redis,redpanda,minio,buildkit}

### 3. ArgoCD Application

Add to your gitops repo (`drewpayment-hoytlabs-talos`):

    apps/orbit/kustomization.yaml
    apps/orbit/application.yaml

See the design doc for the Application manifest content.

### 4. Image Pull Secret (if repo is private)

    kubectl create secret docker-registry ghcr-pull-secret \
      --namespace orbit \
      --docker-server=ghcr.io \
      --docker-username=drewpayment \
      --docker-password=<GITHUB_PAT>

### 5. DNS

Ensure these resolve via Cloudflare tunnel or external-dns:
- `orbit.hoytlabs.app` → gateway-external
- `temporal.orbit.hoytlabs.app` → gateway-external

### 6. First Image Build

Push to `main` to trigger the initial GitHub Actions build before deploying manifests.
```

**Step 6: Create top-level kustomization**

```yaml
# infrastructure/k8s/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: orbit

resources:
  - namespace.yaml
  - storageclass.yaml
  - serviceaccount.yaml
  - externalsecret.yaml

  # Stateful services
  - mongodb
  - postgresql
  - redis
  - redpanda
  - minio

  # Infrastructure
  - temporal
  - registry
  - buildkit

  # Custom services
  - orbit-www
  - repository-service
  - kafka-service
  - plugins-service
  - bifrost
  - build-service
  - temporal-worker
```

**Step 7: Commit**

```bash
git add infrastructure/k8s/
git commit -m "feat(k8s): scaffold base manifests — namespace, storageclass, externalsecret, README"
```

---

## Task 2: MongoDB StatefulSet

**Files:**
- Create: `infrastructure/k8s/mongodb/kustomization.yaml`
- Create: `infrastructure/k8s/mongodb/statefulset.yaml`
- Create: `infrastructure/k8s/mongodb/service.yaml`
- Create: `infrastructure/k8s/mongodb/pvc.yaml`

**Step 1: Create kustomization**

```yaml
# infrastructure/k8s/mongodb/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - pvc.yaml
  - service.yaml
  - statefulset.yaml
```

**Step 2: Create PV and PVC**

```yaml
# infrastructure/k8s/mongodb/pvc.yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: orbit-mongodb-pv
spec:
  capacity:
    storage: 20Gi
  accessModes: [ReadWriteOnce]
  persistentVolumeReclaimPolicy: Retain
  storageClassName: orbit-nfs
  nfs:
    server: 192.168.86.44
    path: /mnt/tank/appdata/orbit/mongodb
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: mongodb-data
  namespace: orbit
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: orbit-nfs
  resources:
    requests:
      storage: 20Gi
  volumeName: orbit-mongodb-pv
```

**Step 3: Create headless Service**

```yaml
# infrastructure/k8s/mongodb/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: mongodb
  namespace: orbit
spec:
  clusterIP: None
  selector:
    app: mongodb
  ports:
    - port: 27017
      targetPort: 27017
```

**Step 4: Create StatefulSet**

```yaml
# infrastructure/k8s/mongodb/statefulset.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: mongodb
  namespace: orbit
spec:
  serviceName: mongodb
  replicas: 1
  selector:
    matchLabels:
      app: mongodb
  template:
    metadata:
      labels:
        app: mongodb
    spec:
      serviceAccountName: orbit
      containers:
        - name: mongodb
          image: mongo:7
          ports:
            - containerPort: 27017
          env:
            - name: MONGO_INITDB_ROOT_USERNAME
              valueFrom:
                secretKeyRef:
                  name: orbit-secrets
                  key: MONGO_ROOT_USERNAME
            - name: MONGO_INITDB_ROOT_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: orbit-secrets
                  key: MONGO_ROOT_PASSWORD
          volumeMounts:
            - name: data
              mountPath: /data/db
          resources:
            requests:
              memory: 256Mi
              cpu: 100m
            limits:
              memory: 1Gi
              cpu: 500m
          livenessProbe:
            exec:
              command: ["mongosh", "--eval", "db.adminCommand('ping')"]
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            exec:
              command: ["mongosh", "--eval", "db.adminCommand('ping')"]
            initialDelaySeconds: 5
            periodSeconds: 10
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: mongodb-data
```

**Step 5: Verify with kustomize build**

Run: `kustomize build infrastructure/k8s/mongodb`
Expected: Valid YAML output with PV, PVC, Service, StatefulSet

**Step 6: Commit**

```bash
git add infrastructure/k8s/mongodb/
git commit -m "feat(k8s): add MongoDB StatefulSet with NFS PVC"
```

---

## Task 3: PostgreSQL StatefulSet

**Files:**
- Create: `infrastructure/k8s/postgresql/kustomization.yaml`
- Create: `infrastructure/k8s/postgresql/statefulset.yaml`
- Create: `infrastructure/k8s/postgresql/service.yaml`
- Create: `infrastructure/k8s/postgresql/pvc.yaml`
- Create: `infrastructure/k8s/postgresql/init-configmap.yaml`

**Step 1: Create kustomization**

```yaml
# infrastructure/k8s/postgresql/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - pvc.yaml
  - init-configmap.yaml
  - service.yaml
  - statefulset.yaml
```

**Step 2: Create PV and PVC**

```yaml
# infrastructure/k8s/postgresql/pvc.yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: orbit-postgresql-pv
spec:
  capacity:
    storage: 10Gi
  accessModes: [ReadWriteOnce]
  persistentVolumeReclaimPolicy: Retain
  storageClassName: orbit-nfs
  nfs:
    server: 192.168.86.44
    path: /mnt/tank/appdata/orbit/postgresql
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgresql-data
  namespace: orbit
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: orbit-nfs
  resources:
    requests:
      storage: 10Gi
  volumeName: orbit-postgresql-pv
```

**Step 3: Create init ConfigMap (creates both databases)**

```yaml
# infrastructure/k8s/postgresql/init-configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: postgresql-init
  namespace: orbit
data:
  init-databases.sh: |
    #!/bin/bash
    set -e
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
      CREATE DATABASE temporal;
      CREATE DATABASE orbit;
    EOSQL
```

**Step 4: Create headless Service**

```yaml
# infrastructure/k8s/postgresql/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: postgresql
  namespace: orbit
spec:
  clusterIP: None
  selector:
    app: postgresql
  ports:
    - port: 5432
      targetPort: 5432
```

**Step 5: Create StatefulSet**

```yaml
# infrastructure/k8s/postgresql/statefulset.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgresql
  namespace: orbit
spec:
  serviceName: postgresql
  replicas: 1
  selector:
    matchLabels:
      app: postgresql
  template:
    metadata:
      labels:
        app: postgresql
    spec:
      serviceAccountName: orbit
      containers:
        - name: postgresql
          image: postgres:15-alpine
          ports:
            - containerPort: 5432
          env:
            - name: POSTGRES_USER
              valueFrom:
                secretKeyRef:
                  name: orbit-secrets
                  key: POSTGRES_USER
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: orbit-secrets
                  key: POSTGRES_PASSWORD
            - name: PGDATA
              value: /var/lib/postgresql/data/pgdata
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
            - name: init-scripts
              mountPath: /docker-entrypoint-initdb.d
          resources:
            requests:
              memory: 128Mi
              cpu: 100m
            limits:
              memory: 512Mi
              cpu: 500m
          livenessProbe:
            exec:
              command: ["pg_isready", "-U", "$(POSTGRES_USER)"]
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            exec:
              command: ["pg_isready", "-U", "$(POSTGRES_USER)"]
            initialDelaySeconds: 5
            periodSeconds: 10
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: postgresql-data
        - name: init-scripts
          configMap:
            name: postgresql-init
```

**Step 6: Commit**

```bash
git add infrastructure/k8s/postgresql/
git commit -m "feat(k8s): add PostgreSQL StatefulSet with init script for temporal + orbit DBs"
```

---

## Task 4: Redis StatefulSet

**Files:**
- Create: `infrastructure/k8s/redis/kustomization.yaml`
- Create: `infrastructure/k8s/redis/statefulset.yaml`
- Create: `infrastructure/k8s/redis/service.yaml`
- Create: `infrastructure/k8s/redis/pvc.yaml`

**Step 1: Create kustomization**

```yaml
# infrastructure/k8s/redis/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - pvc.yaml
  - service.yaml
  - statefulset.yaml
```

**Step 2: Create PV and PVC**

```yaml
# infrastructure/k8s/redis/pvc.yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: orbit-redis-pv
spec:
  capacity:
    storage: 5Gi
  accessModes: [ReadWriteOnce]
  persistentVolumeReclaimPolicy: Retain
  storageClassName: orbit-nfs
  nfs:
    server: 192.168.86.44
    path: /mnt/tank/appdata/orbit/redis
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: redis-data
  namespace: orbit
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: orbit-nfs
  resources:
    requests:
      storage: 5Gi
  volumeName: orbit-redis-pv
```

**Step 3: Create Service**

```yaml
# infrastructure/k8s/redis/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: redis
  namespace: orbit
spec:
  selector:
    app: redis
  ports:
    - port: 6379
      targetPort: 6379
```

**Step 4: Create StatefulSet**

```yaml
# infrastructure/k8s/redis/statefulset.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: redis
  namespace: orbit
spec:
  serviceName: redis
  replicas: 1
  selector:
    matchLabels:
      app: redis
  template:
    metadata:
      labels:
        app: redis
    spec:
      serviceAccountName: orbit
      containers:
        - name: redis
          image: redis:7-alpine
          ports:
            - containerPort: 6379
          command: ["redis-server", "--appendonly", "yes"]
          volumeMounts:
            - name: data
              mountPath: /data
          resources:
            requests:
              memory: 64Mi
              cpu: 50m
            limits:
              memory: 256Mi
              cpu: 200m
          livenessProbe:
            exec:
              command: ["redis-cli", "ping"]
            initialDelaySeconds: 10
            periodSeconds: 10
          readinessProbe:
            exec:
              command: ["redis-cli", "ping"]
            initialDelaySeconds: 5
            periodSeconds: 10
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: redis-data
```

**Step 5: Commit**

```bash
git add infrastructure/k8s/redis/
git commit -m "feat(k8s): add Redis StatefulSet with NFS PVC"
```

---

## Task 5: Redpanda StatefulSet

**Files:**
- Create: `infrastructure/k8s/redpanda/kustomization.yaml`
- Create: `infrastructure/k8s/redpanda/statefulset.yaml`
- Create: `infrastructure/k8s/redpanda/service.yaml`
- Create: `infrastructure/k8s/redpanda/pvc.yaml`

**Step 1: Create kustomization**

```yaml
# infrastructure/k8s/redpanda/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - pvc.yaml
  - service.yaml
  - statefulset.yaml
```

**Step 2: Create PV and PVC**

```yaml
# infrastructure/k8s/redpanda/pvc.yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: orbit-redpanda-pv
spec:
  capacity:
    storage: 10Gi
  accessModes: [ReadWriteOnce]
  persistentVolumeReclaimPolicy: Retain
  storageClassName: orbit-nfs
  nfs:
    server: 192.168.86.44
    path: /mnt/tank/appdata/orbit/redpanda
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: redpanda-data
  namespace: orbit
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: orbit-nfs
  resources:
    requests:
      storage: 10Gi
  volumeName: orbit-redpanda-pv
```

**Step 3: Create Service**

```yaml
# infrastructure/k8s/redpanda/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: redpanda
  namespace: orbit
spec:
  selector:
    app: redpanda
  ports:
    - name: kafka
      port: 9092
      targetPort: 9092
    - name: admin
      port: 9644
      targetPort: 9644
```

**Step 4: Create StatefulSet**

```yaml
# infrastructure/k8s/redpanda/statefulset.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: redpanda
  namespace: orbit
spec:
  serviceName: redpanda
  replicas: 1
  selector:
    matchLabels:
      app: redpanda
  template:
    metadata:
      labels:
        app: redpanda
    spec:
      serviceAccountName: orbit
      containers:
        - name: redpanda
          image: docker.redpanda.com/redpandadata/redpanda:v24.2.10
          args:
            - redpanda
            - start
            - --kafka-addr
            - internal://0.0.0.0:9092
            - --advertise-kafka-addr
            - internal://redpanda:9092
            - --rpc-addr
            - redpanda:33145
            - --advertise-rpc-addr
            - redpanda:33145
            - --mode
            - dev-container
            - --smp
            - "1"
            - --default-log-level=warn
          ports:
            - name: kafka
              containerPort: 9092
            - name: admin
              containerPort: 9644
          volumeMounts:
            - name: data
              mountPath: /var/lib/redpanda/data
          resources:
            requests:
              memory: 256Mi
              cpu: 100m
            limits:
              memory: 1Gi
              cpu: 500m
          readinessProbe:
            exec:
              command: ["rpk", "cluster", "health", "--exit-when-healthy"]
            initialDelaySeconds: 15
            periodSeconds: 10
            timeoutSeconds: 5
          livenessProbe:
            exec:
              command: ["rpk", "cluster", "health", "--exit-when-healthy"]
            initialDelaySeconds: 30
            periodSeconds: 15
            timeoutSeconds: 5
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: redpanda-data
```

**Step 5: Commit**

```bash
git add infrastructure/k8s/redpanda/
git commit -m "feat(k8s): add Redpanda StatefulSet for Kafka-compatible messaging"
```

---

## Task 6: MinIO StatefulSet + init Job

**Files:**
- Create: `infrastructure/k8s/minio/kustomization.yaml`
- Create: `infrastructure/k8s/minio/statefulset.yaml`
- Create: `infrastructure/k8s/minio/service.yaml`
- Create: `infrastructure/k8s/minio/pvc.yaml`
- Create: `infrastructure/k8s/minio/init-job.yaml`

**Step 1: Create kustomization**

```yaml
# infrastructure/k8s/minio/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - pvc.yaml
  - service.yaml
  - statefulset.yaml
  - init-job.yaml
```

**Step 2: Create PV and PVC**

```yaml
# infrastructure/k8s/minio/pvc.yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: orbit-minio-pv
spec:
  capacity:
    storage: 20Gi
  accessModes: [ReadWriteOnce]
  persistentVolumeReclaimPolicy: Retain
  storageClassName: orbit-nfs
  nfs:
    server: 192.168.86.44
    path: /mnt/tank/appdata/orbit/minio
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: minio-data
  namespace: orbit
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: orbit-nfs
  resources:
    requests:
      storage: 20Gi
  volumeName: orbit-minio-pv
```

**Step 3: Create Service**

```yaml
# infrastructure/k8s/minio/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: minio
  namespace: orbit
spec:
  selector:
    app: minio
  ports:
    - name: api
      port: 9000
      targetPort: 9000
    - name: console
      port: 9001
      targetPort: 9001
```

**Step 4: Create StatefulSet**

```yaml
# infrastructure/k8s/minio/statefulset.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: minio
  namespace: orbit
spec:
  serviceName: minio
  replicas: 1
  selector:
    matchLabels:
      app: minio
  template:
    metadata:
      labels:
        app: minio
    spec:
      serviceAccountName: orbit
      containers:
        - name: minio
          image: minio/minio:latest
          args: ["server", "/data", "--console-address", ":9001"]
          ports:
            - name: api
              containerPort: 9000
            - name: console
              containerPort: 9001
          env:
            - name: MINIO_ROOT_USER
              valueFrom:
                secretKeyRef:
                  name: orbit-secrets
                  key: MINIO_ROOT_USER
            - name: MINIO_ROOT_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: orbit-secrets
                  key: MINIO_ROOT_PASSWORD
          volumeMounts:
            - name: data
              mountPath: /data
          resources:
            requests:
              memory: 128Mi
              cpu: 100m
            limits:
              memory: 512Mi
              cpu: 500m
          livenessProbe:
            httpGet:
              path: /minio/health/live
              port: 9000
            initialDelaySeconds: 15
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /minio/health/ready
              port: 9000
            initialDelaySeconds: 5
            periodSeconds: 10
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: minio-data
```

**Step 5: Create init Job to create orbit-registry bucket**

```yaml
# infrastructure/k8s/minio/init-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: minio-init-buckets
  namespace: orbit
  annotations:
    argocd.argoproj.io/hook: PostSync
    argocd.argoproj.io/hook-delete-policy: HookSucceeded
spec:
  template:
    spec:
      restartPolicy: OnFailure
      containers:
        - name: mc
          image: minio/mc:latest
          env:
            - name: MINIO_ROOT_USER
              valueFrom:
                secretKeyRef:
                  name: orbit-secrets
                  key: MINIO_ROOT_USER
            - name: MINIO_ROOT_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: orbit-secrets
                  key: MINIO_ROOT_PASSWORD
          command:
            - /bin/sh
            - -c
            - |
              until mc alias set orbit http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"; do
                echo "Waiting for MinIO..."
                sleep 5
              done
              mc mb orbit/orbit-registry --ignore-existing
              echo "Bucket created successfully"
```

**Step 6: Commit**

```bash
git add infrastructure/k8s/minio/
git commit -m "feat(k8s): add MinIO StatefulSet with bucket init Job"
```

---

## Task 7: Temporal server + UI

**Files:**
- Create: `infrastructure/k8s/temporal/kustomization.yaml`
- Create: `infrastructure/k8s/temporal/deployment.yaml`
- Create: `infrastructure/k8s/temporal/service.yaml`
- Create: `infrastructure/k8s/temporal/dynamicconfig-configmap.yaml`
- Create: `infrastructure/k8s/temporal/ui-deployment.yaml`
- Create: `infrastructure/k8s/temporal/ui-service.yaml`
- Create: `infrastructure/k8s/temporal/ui-http-route.yaml`

**Step 1: Create kustomization**

```yaml
# infrastructure/k8s/temporal/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - dynamicconfig-configmap.yaml
  - service.yaml
  - deployment.yaml
  - ui-service.yaml
  - ui-deployment.yaml
  - ui-http-route.yaml
```

**Step 2: Create dynamic config ConfigMap**

```yaml
# infrastructure/k8s/temporal/dynamicconfig-configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: temporal-dynamicconfig
  namespace: orbit
data:
  development-sql.yaml: |
    history.maxAutoResetPoints:
      - value: 20
        constraints: {}
    matching.numTaskqueueWritePartitions:
      - value: 1
        constraints: {}
    matching.numTaskqueueReadPartitions:
      - value: 1
        constraints: {}
    frontend.keepAliveMinTime:
      - value: "10s"
        constraints: {}
    worker.taskProcessorCount:
      - value: 10
        constraints: {}
    system.enableActivityLocalDispatch:
      - value: true
        constraints: {}
    system.enableArchival:
      - value: false
        constraints: {}
```

**Step 3: Create Temporal server Deployment**

```yaml
# infrastructure/k8s/temporal/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: temporal
  namespace: orbit
spec:
  replicas: 1
  selector:
    matchLabels:
      app: temporal
  template:
    metadata:
      labels:
        app: temporal
    spec:
      serviceAccountName: orbit
      containers:
        - name: temporal
          image: temporalio/auto-setup:1.25.1
          ports:
            - name: grpc
              containerPort: 7233
            - name: http
              containerPort: 8233
          env:
            - name: DB
              value: postgres12
            - name: DB_PORT
              value: "5432"
            - name: POSTGRES_USER
              valueFrom:
                secretKeyRef:
                  name: orbit-secrets
                  key: POSTGRES_USER
            - name: POSTGRES_PWD
              valueFrom:
                secretKeyRef:
                  name: orbit-secrets
                  key: POSTGRES_PASSWORD
            - name: POSTGRES_SEEDS
              value: postgresql
            - name: DYNAMIC_CONFIG_FILE_PATH
              value: /etc/temporal/config/dynamicconfig/development-sql.yaml
            - name: ENABLE_ES
              value: "false"
          volumeMounts:
            - name: dynamicconfig
              mountPath: /etc/temporal/config/dynamicconfig
          resources:
            requests:
              memory: 256Mi
              cpu: 100m
            limits:
              memory: 512Mi
              cpu: 500m
          livenessProbe:
            tcpSocket:
              port: 7233
            initialDelaySeconds: 60
            periodSeconds: 15
          readinessProbe:
            tcpSocket:
              port: 7233
            initialDelaySeconds: 30
            periodSeconds: 10
      volumes:
        - name: dynamicconfig
          configMap:
            name: temporal-dynamicconfig
```

**Step 4: Create Temporal Service**

```yaml
# infrastructure/k8s/temporal/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: temporal
  namespace: orbit
spec:
  selector:
    app: temporal
  ports:
    - name: grpc
      port: 7233
      targetPort: 7233
    - name: http
      port: 8233
      targetPort: 8233
```

**Step 5: Create Temporal UI Deployment**

```yaml
# infrastructure/k8s/temporal/ui-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: temporal-ui
  namespace: orbit
spec:
  replicas: 1
  selector:
    matchLabels:
      app: temporal-ui
  template:
    metadata:
      labels:
        app: temporal-ui
    spec:
      serviceAccountName: orbit
      containers:
        - name: temporal-ui
          image: temporalio/ui:2.30.0
          ports:
            - containerPort: 8080
          env:
            - name: TEMPORAL_ADDRESS
              value: temporal:7233
            - name: TEMPORAL_CORS_ORIGINS
              value: https://orbit.hoytlabs.app
          resources:
            requests:
              memory: 64Mi
              cpu: 50m
            limits:
              memory: 256Mi
              cpu: 200m
          livenessProbe:
            httpGet:
              path: /
              port: 8080
            initialDelaySeconds: 15
            periodSeconds: 10
```

**Step 6: Create Temporal UI Service**

```yaml
# infrastructure/k8s/temporal/ui-service.yaml
apiVersion: v1
kind: Service
metadata:
  name: temporal-ui
  namespace: orbit
spec:
  selector:
    app: temporal-ui
  ports:
    - port: 8080
      targetPort: 8080
```

**Step 7: Create Temporal UI HTTPRoute**

```yaml
# infrastructure/k8s/temporal/ui-http-route.yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: temporal-ui
  namespace: orbit
  annotations:
    external-dns.alpha.kubernetes.io/hostname: temporal.orbit.hoytlabs.app
spec:
  parentRefs:
    - name: gateway-external
      namespace: gateway
  hostnames:
    - temporal.orbit.hoytlabs.app
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /
      backendRefs:
        - name: temporal-ui
          port: 8080
```

**Step 8: Commit**

```bash
git add infrastructure/k8s/temporal/
git commit -m "feat(k8s): add Temporal server + UI with Gateway API HTTPRoute"
```

---

## Task 8: Container registry + BuildKit

**Files:**
- Create: `infrastructure/k8s/registry/kustomization.yaml`
- Create: `infrastructure/k8s/registry/deployment.yaml`
- Create: `infrastructure/k8s/registry/service.yaml`
- Create: `infrastructure/k8s/buildkit/kustomization.yaml`
- Create: `infrastructure/k8s/buildkit/daemonset.yaml`
- Create: `infrastructure/k8s/buildkit/service.yaml`
- Create: `infrastructure/k8s/buildkit/pvc.yaml`

**Step 1: Create registry kustomization**

```yaml
# infrastructure/k8s/registry/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - service.yaml
  - deployment.yaml
```

**Step 2: Create registry Deployment (env-var driven config, no hardcoded secrets)**

```yaml
# infrastructure/k8s/registry/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: registry
  namespace: orbit
spec:
  replicas: 1
  selector:
    matchLabels:
      app: registry
  template:
    metadata:
      labels:
        app: registry
    spec:
      serviceAccountName: orbit
      containers:
        - name: registry
          image: registry:2
          ports:
            - containerPort: 5000
          env:
            - name: REGISTRY_STORAGE
              value: s3
            - name: REGISTRY_STORAGE_S3_ACCESSKEY
              valueFrom:
                secretKeyRef:
                  name: orbit-secrets
                  key: MINIO_ROOT_USER
            - name: REGISTRY_STORAGE_S3_SECRETKEY
              valueFrom:
                secretKeyRef:
                  name: orbit-secrets
                  key: MINIO_ROOT_PASSWORD
            - name: REGISTRY_STORAGE_S3_REGION
              value: us-east-1
            - name: REGISTRY_STORAGE_S3_REGIONENDPOINT
              value: http://minio:9000
            - name: REGISTRY_STORAGE_S3_BUCKET
              value: orbit-registry
            - name: REGISTRY_STORAGE_S3_SECURE
              value: "false"
            - name: REGISTRY_HTTP_ADDR
              value: 0.0.0.0:5000
            - name: REGISTRY_HEALTH_STORAGEDRIVER_ENABLED
              value: "true"
          resources:
            requests:
              memory: 64Mi
              cpu: 50m
            limits:
              memory: 256Mi
              cpu: 200m
          livenessProbe:
            httpGet:
              path: /
              port: 5000
            initialDelaySeconds: 10
            periodSeconds: 10
```

**Step 3: Create registry Service (expose as port 5050 externally for compatibility)**

```yaml
# infrastructure/k8s/registry/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: registry
  namespace: orbit
spec:
  selector:
    app: registry
  ports:
    - port: 5050
      targetPort: 5000
```

**Step 4: Create BuildKit kustomization**

```yaml
# infrastructure/k8s/buildkit/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - pvc.yaml
  - service.yaml
  - daemonset.yaml
```

**Step 5: Create BuildKit PV and PVC**

```yaml
# infrastructure/k8s/buildkit/pvc.yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: orbit-buildkit-pv
spec:
  capacity:
    storage: 10Gi
  accessModes: [ReadWriteMany]
  persistentVolumeReclaimPolicy: Retain
  storageClassName: orbit-nfs
  nfs:
    server: 192.168.86.44
    path: /mnt/tank/appdata/orbit/buildkit
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: buildkit-cache
  namespace: orbit
spec:
  accessModes: [ReadWriteMany]
  storageClassName: orbit-nfs
  resources:
    requests:
      storage: 10Gi
  volumeName: orbit-buildkit-pv
```

**Step 6: Create BuildKit DaemonSet**

```yaml
# infrastructure/k8s/buildkit/daemonset.yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: buildkit
  namespace: orbit
spec:
  selector:
    matchLabels:
      app: buildkit
  template:
    metadata:
      labels:
        app: buildkit
    spec:
      serviceAccountName: orbit
      containers:
        - name: buildkit
          image: moby/buildkit:latest
          args:
            - --addr
            - tcp://0.0.0.0:1234
            - --oci-worker-no-process-sandbox
          ports:
            - containerPort: 1234
          securityContext:
            privileged: true
          volumeMounts:
            - name: cache
              mountPath: /var/lib/buildkit
          resources:
            requests:
              memory: 256Mi
              cpu: 100m
            limits:
              memory: 2Gi
              cpu: "2"
      volumes:
        - name: cache
          persistentVolumeClaim:
            claimName: buildkit-cache
```

**Step 7: Create BuildKit Service**

```yaml
# infrastructure/k8s/buildkit/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: buildkit
  namespace: orbit
spec:
  selector:
    app: buildkit
  ports:
    - port: 1234
      targetPort: 1234
```

**Step 8: Commit**

```bash
git add infrastructure/k8s/registry/ infrastructure/k8s/buildkit/
git commit -m "feat(k8s): add container registry + BuildKit DaemonSet"
```

---

## Task 9: orbit-www Deployment

**Files:**
- Create: `infrastructure/k8s/orbit-www/kustomization.yaml`
- Create: `infrastructure/k8s/orbit-www/deployment.yaml`
- Create: `infrastructure/k8s/orbit-www/service.yaml`
- Create: `infrastructure/k8s/orbit-www/configmap.yaml`
- Create: `infrastructure/k8s/orbit-www/http-route.yaml`

**Step 1: Create kustomization**

```yaml
# infrastructure/k8s/orbit-www/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - configmap.yaml
  - service.yaml
  - deployment.yaml
  - http-route.yaml
```

**Step 2: Create ConfigMap**

```yaml
# infrastructure/k8s/orbit-www/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: orbit-www-config
  namespace: orbit
data:
  NEXT_PUBLIC_APP_URL: "https://orbit.hoytlabs.app"
  TEMPORAL_ADDRESS: "temporal:7233"
  TEMPORAL_NAMESPACE: "default"
  REPOSITORY_SERVICE_URL: "repository-service:50051"
  NEXT_PUBLIC_REPOSITORY_URL: "http://repository-service:50051"
  NEXT_PUBLIC_KAFKA_SERVICE_URL: "http://kafka-service:50055"
  BIFROST_ADMIN_URL: "http://bifrost:50060"
  ORBIT_REGISTRY_URL: "registry:5050"
```

**Step 3: Create Deployment**

```yaml
# infrastructure/k8s/orbit-www/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orbit-www
  namespace: orbit
spec:
  replicas: 1
  selector:
    matchLabels:
      app: orbit-www
  template:
    metadata:
      labels:
        app: orbit-www
    spec:
      serviceAccountName: orbit
      containers:
        - name: orbit-www
          image: ghcr.io/drewpayment/orbit/orbit-www:latest
          ports:
            - containerPort: 3000
          envFrom:
            - configMapRef:
                name: orbit-www-config
          env:
            - name: MONGO_USER
              valueFrom:
                secretKeyRef:
                  name: orbit-secrets
                  key: MONGO_ROOT_USERNAME
            - name: MONGO_PASS
              valueFrom:
                secretKeyRef:
                  name: orbit-secrets
                  key: MONGO_ROOT_PASSWORD
            - name: DATABASE_URI
              value: "mongodb://$(MONGO_USER):$(MONGO_PASS)@mongodb:27017/orbit-www?authSource=admin"
            - name: PAYLOAD_SECRET
              valueFrom:
                secretKeyRef:
                  name: orbit-secrets
                  key: PAYLOAD_SECRET
            - name: ENCRYPTION_KEY
              valueFrom:
                secretKeyRef:
                  name: orbit-secrets
                  key: ENCRYPTION_KEY
            - name: BETTER_AUTH_SECRET
              valueFrom:
                secretKeyRef:
                  name: orbit-secrets
                  key: BETTER_AUTH_SECRET
            - name: RESEND_API_KEY
              valueFrom:
                secretKeyRef:
                  name: orbit-secrets
                  key: RESEND_API_KEY
            - name: RESEND_FROM_EMAIL
              valueFrom:
                secretKeyRef:
                  name: orbit-secrets
                  key: RESEND_FROM_EMAIL
            - name: GITHUB_APP_ID
              valueFrom:
                secretKeyRef:
                  name: orbit-secrets
                  key: GITHUB_APP_ID
            - name: GITHUB_CLIENT_ID
              valueFrom:
                secretKeyRef:
                  name: orbit-secrets
                  key: GITHUB_CLIENT_ID
            - name: GITHUB_CLIENT_SECRET
              valueFrom:
                secretKeyRef:
                  name: orbit-secrets
                  key: GITHUB_CLIENT_SECRET
            - name: GITHUB_WEBHOOK_SECRET
              valueFrom:
                secretKeyRef:
                  name: orbit-secrets
                  key: GITHUB_WEBHOOK_SECRET
            - name: ORBIT_INTERNAL_API_KEY
              valueFrom:
                secretKeyRef:
                  name: orbit-secrets
                  key: ORBIT_INTERNAL_API_KEY
            - name: ORBIT_REGISTRY_JWT_SECRET
              valueFrom:
                secretKeyRef:
                  name: orbit-secrets
                  key: ORBIT_REGISTRY_JWT_SECRET
          resources:
            requests:
              memory: 256Mi
              cpu: 100m
            limits:
              memory: 512Mi
              cpu: 500m
          livenessProbe:
            httpGet:
              path: /api/health
              port: 3000
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /api/health
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 10
```

**Step 4: Create Service**

```yaml
# infrastructure/k8s/orbit-www/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: orbit-www
  namespace: orbit
spec:
  selector:
    app: orbit-www
  ports:
    - port: 3000
      targetPort: 3000
```

**Step 5: Create HTTPRoute**

```yaml
# infrastructure/k8s/orbit-www/http-route.yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: orbit-www
  namespace: orbit
  annotations:
    external-dns.alpha.kubernetes.io/hostname: orbit.hoytlabs.app
spec:
  parentRefs:
    - name: gateway-external
      namespace: gateway
  hostnames:
    - orbit.hoytlabs.app
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /
      backendRefs:
        - name: orbit-www
          port: 3000
```

**Step 6: Add /api/health endpoint**

Check if `orbit-www/src/app/api/health/route.ts` exists. If not, create it:

```typescript
// orbit-www/src/app/api/health/route.ts
import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({ status: 'ok' })
}
```

**Step 7: Commit**

```bash
git add infrastructure/k8s/orbit-www/ orbit-www/src/app/api/health/
git commit -m "feat(k8s): add orbit-www Deployment with HTTPRoute and health endpoint"
```

---

## Task 10: Go gRPC service Deployments (repository, kafka, plugins, bifrost, build-service)

**Files:**
- Create: `infrastructure/k8s/repository-service/{kustomization,deployment,service}.yaml`
- Create: `infrastructure/k8s/kafka-service/{kustomization,deployment,service}.yaml`
- Create: `infrastructure/k8s/plugins-service/{kustomization,deployment,service}.yaml`
- Create: `infrastructure/k8s/bifrost/{kustomization,deployment,service}.yaml`
- Create: `infrastructure/k8s/build-service/{kustomization,deployment,service}.yaml`

All follow the same pattern. Each gets a kustomization + deployment + service.

**Step 1: repository-service**

```yaml
# infrastructure/k8s/repository-service/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - service.yaml
  - deployment.yaml
```

```yaml
# infrastructure/k8s/repository-service/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: repository-service
  namespace: orbit
spec:
  replicas: 1
  selector:
    matchLabels:
      app: repository-service
  template:
    metadata:
      labels:
        app: repository-service
    spec:
      serviceAccountName: orbit
      containers:
        - name: repository-service
          image: ghcr.io/drewpayment/orbit/repository-service:latest
          ports:
            - name: grpc
              containerPort: 50051
            - name: http
              containerPort: 8081
          env:
            - name: GRPC_PORT
              value: "50051"
            - name: HTTP_PORT
              value: "8081"
            - name: TEMPORAL_HOST
              value: temporal:7233
            - name: TEMPLATE_WORK_DIR
              value: /tmp/orbit-templates
          resources:
            requests:
              memory: 64Mi
              cpu: 50m
            limits:
              memory: 256Mi
              cpu: 200m
          livenessProbe:
            grpc:
              port: 50051
            initialDelaySeconds: 10
            periodSeconds: 10
          readinessProbe:
            grpc:
              port: 50051
            initialDelaySeconds: 5
            periodSeconds: 10
```

```yaml
# infrastructure/k8s/repository-service/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: repository-service
  namespace: orbit
spec:
  selector:
    app: repository-service
  ports:
    - name: grpc
      port: 50051
      targetPort: 50051
    - name: http
      port: 8081
      targetPort: 8081
```

**Step 2: kafka-service**

```yaml
# infrastructure/k8s/kafka-service/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - service.yaml
  - deployment.yaml
```

```yaml
# infrastructure/k8s/kafka-service/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kafka-service
  namespace: orbit
spec:
  replicas: 1
  selector:
    matchLabels:
      app: kafka-service
  template:
    metadata:
      labels:
        app: kafka-service
    spec:
      serviceAccountName: orbit
      containers:
        - name: kafka-service
          image: ghcr.io/drewpayment/orbit/kafka-service:latest
          ports:
            - name: grpc
              containerPort: 50055
          env:
            - name: GRPC_PORT
              value: "50055"
            - name: ENVIRONMENT
              value: production
          resources:
            requests:
              memory: 64Mi
              cpu: 50m
            limits:
              memory: 256Mi
              cpu: 200m
          livenessProbe:
            grpc:
              port: 50055
            initialDelaySeconds: 10
            periodSeconds: 10
          readinessProbe:
            grpc:
              port: 50055
            initialDelaySeconds: 5
            periodSeconds: 10
```

```yaml
# infrastructure/k8s/kafka-service/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: kafka-service
  namespace: orbit
spec:
  selector:
    app: kafka-service
  ports:
    - name: grpc
      port: 50055
      targetPort: 50055
```

**Step 3: plugins-service**

```yaml
# infrastructure/k8s/plugins-service/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - service.yaml
  - deployment.yaml
```

```yaml
# infrastructure/k8s/plugins-service/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: plugins-service
  namespace: orbit
spec:
  replicas: 1
  selector:
    matchLabels:
      app: plugins-service
  template:
    metadata:
      labels:
        app: plugins-service
    spec:
      serviceAccountName: orbit
      containers:
        - name: plugins-service
          image: ghcr.io/drewpayment/orbit/plugins-service:latest
          ports:
            - name: grpc
              containerPort: 50053
            - name: http
              containerPort: 8080
          env:
            - name: GRPC_PORT
              value: "50053"
            - name: HTTP_PORT
              value: "8080"
            - name: JWT_SECRET
              valueFrom:
                secretKeyRef:
                  name: orbit-secrets
                  key: JWT_SECRET
            - name: REDIS_URL
              value: redis://redis:6379
            - name: BACKSTAGE_TIMEOUT
              value: "10s"
            - name: GRPC_DEADLINE
              value: "15s"
            - name: CIRCUIT_BREAKER_TIMEOUT
              value: "30s"
          resources:
            requests:
              memory: 64Mi
              cpu: 50m
            limits:
              memory: 256Mi
              cpu: 200m
          livenessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 10
```

```yaml
# infrastructure/k8s/plugins-service/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: plugins-service
  namespace: orbit
spec:
  selector:
    app: plugins-service
  ports:
    - name: grpc
      port: 50053
      targetPort: 50053
    - name: http
      port: 8080
      targetPort: 8080
```

**Step 4: bifrost**

```yaml
# infrastructure/k8s/bifrost/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - service.yaml
  - deployment.yaml
```

```yaml
# infrastructure/k8s/bifrost/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: bifrost
  namespace: orbit
spec:
  replicas: 1
  selector:
    matchLabels:
      app: bifrost
  template:
    metadata:
      labels:
        app: bifrost
    spec:
      serviceAccountName: orbit
      containers:
        - name: bifrost
          image: ghcr.io/drewpayment/orbit/bifrost:latest
          ports:
            - name: kafka
              containerPort: 9092
            - name: admin
              containerPort: 50060
            - name: metrics
              containerPort: 8080
          env:
            - name: BIFROST_PROXY_PORT
              value: "9092"
            - name: BIFROST_ADMIN_PORT
              value: "50060"
            - name: BIFROST_METRICS_PORT
              value: "8080"
            - name: KAFKA_BOOTSTRAP_SERVERS
              value: redpanda:9092
            - name: BIFROST_LOG_LEVEL
              value: info
          resources:
            requests:
              memory: 64Mi
              cpu: 50m
            limits:
              memory: 256Mi
              cpu: 200m
          livenessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 10
```

```yaml
# infrastructure/k8s/bifrost/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: bifrost
  namespace: orbit
spec:
  selector:
    app: bifrost
  ports:
    - name: kafka
      port: 9092
      targetPort: 9092
    - name: admin
      port: 50060
      targetPort: 50060
    - name: metrics
      port: 8080
      targetPort: 8080
```

**Step 5: build-service**

```yaml
# infrastructure/k8s/build-service/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - service.yaml
  - deployment.yaml
```

```yaml
# infrastructure/k8s/build-service/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: build-service
  namespace: orbit
spec:
  replicas: 1
  selector:
    matchLabels:
      app: build-service
  template:
    metadata:
      labels:
        app: build-service
    spec:
      serviceAccountName: orbit
      containers:
        - name: build-service
          image: ghcr.io/drewpayment/orbit/build-service:latest
          ports:
            - name: grpc
              containerPort: 50054
          env:
            - name: BUILD_SERVICE_PORT
              value: "50054"
            - name: BUILD_WORK_DIR
              value: /tmp/orbit-builds
            - name: BUILDKIT_HOST
              value: tcp://buildkit:1234
            - name: ORBIT_REGISTRY_URL
              value: http://registry:5050
            - name: ORBIT_REGISTRY_USERNAME
              value: orbit-service
            - name: ORBIT_REGISTRY_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: orbit-secrets
                  key: ORBIT_REGISTRY_PASSWORD
            - name: ORBIT_API_URL
              value: http://orbit-www:3000
            - name: ORBIT_INTERNAL_API_KEY
              valueFrom:
                secretKeyRef:
                  name: orbit-secrets
                  key: ORBIT_INTERNAL_API_KEY
          resources:
            requests:
              memory: 128Mi
              cpu: 100m
            limits:
              memory: 512Mi
              cpu: 500m
          livenessProbe:
            grpc:
              port: 50054
            initialDelaySeconds: 10
            periodSeconds: 10
          readinessProbe:
            grpc:
              port: 50054
            initialDelaySeconds: 5
            periodSeconds: 10
```

```yaml
# infrastructure/k8s/build-service/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: build-service
  namespace: orbit
spec:
  selector:
    app: build-service
  ports:
    - name: grpc
      port: 50054
      targetPort: 50054
```

**Step 6: Commit**

```bash
git add infrastructure/k8s/repository-service/ infrastructure/k8s/kafka-service/ \
  infrastructure/k8s/plugins-service/ infrastructure/k8s/bifrost/ infrastructure/k8s/build-service/
git commit -m "feat(k8s): add all Go gRPC service Deployments"
```

---

## Task 11: temporal-worker Deployment

**Files:**
- Create: `infrastructure/k8s/temporal-worker/kustomization.yaml`
- Create: `infrastructure/k8s/temporal-worker/deployment.yaml`

**Step 1: Create kustomization**

```yaml
# infrastructure/k8s/temporal-worker/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - deployment.yaml
```

**Step 2: Create Deployment**

```yaml
# infrastructure/k8s/temporal-worker/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: temporal-worker
  namespace: orbit
spec:
  replicas: 1
  selector:
    matchLabels:
      app: temporal-worker
  template:
    metadata:
      labels:
        app: temporal-worker
    spec:
      serviceAccountName: orbit
      containers:
        - name: temporal-worker
          image: ghcr.io/drewpayment/orbit/temporal-worker:latest
          env:
            - name: TEMPORAL_ADDRESS
              value: temporal:7233
            - name: TEMPORAL_NAMESPACE
              value: default
            - name: ORBIT_API_URL
              value: http://orbit-www:3000
            - name: ORBIT_INTERNAL_API_KEY
              valueFrom:
                secretKeyRef:
                  name: orbit-secrets
                  key: ORBIT_INTERNAL_API_KEY
            - name: BIFROST_ADMIN_URL
              value: bifrost:50060
            - name: BUILD_SERVICE_ADDRESS
              value: build-service:50054
            - name: GIT_WORK_DIR
              value: /tmp/orbit-repos
            - name: TEMPLATE_WORK_DIR
              value: /tmp/orbit-templates
            - name: DEPLOYMENT_WORK_DIR
              value: /tmp/orbit-deployments
          resources:
            requests:
              memory: 128Mi
              cpu: 50m
            limits:
              memory: 256Mi
              cpu: 200m
          livenessProbe:
            exec:
              command: ["ls", "/tmp"]
            initialDelaySeconds: 10
            periodSeconds: 30
```

**Step 3: Commit**

```bash
git add infrastructure/k8s/temporal-worker/
git commit -m "feat(k8s): add temporal-worker Deployment"
```

---

## Task 12: Validate full kustomize build

**Step 1: Run kustomize build on the full stack**

Run: `kustomize build infrastructure/k8s/`
Expected: Valid YAML with all resources (namespace, storageclass, externalsecret, all services, all statefulsets, all PVs/PVCs, HTTPRoutes)

**Step 2: Count resources**

Run: `kustomize build infrastructure/k8s/ | grep 'kind:' | sort | uniq -c | sort -rn`
Expected: Deployments (9-10), StatefulSets (5), Services (14+), PVs (6), PVCs (6), ConfigMaps (4+), etc.

**Step 3: Fix any kustomize errors and commit fixes**

---

## Task 13: GitHub Actions build-and-push workflow

**Files:**
- Create: `.github/workflows/build-and-push.yml`

**Step 1: Create the workflow**

```yaml
# .github/workflows/build-and-push.yml
name: Build and Push Images

on:
  push:
    branches: [main]
    paths:
      - 'orbit-www/**'
      - 'services/**'
      - 'temporal-workflows/**'
      - 'proto/**'
      - '.github/workflows/build-and-push.yml'

env:
  REGISTRY: ghcr.io
  IMAGE_PREFIX: ghcr.io/${{ github.repository_owner }}/orbit

jobs:
  changes:
    runs-on: ubuntu-latest
    outputs:
      orbit-www: ${{ steps.filter.outputs.orbit-www }}
      repository-service: ${{ steps.filter.outputs.repository-service }}
      build-service: ${{ steps.filter.outputs.build-service }}
      bifrost: ${{ steps.filter.outputs.bifrost }}
      kafka-service: ${{ steps.filter.outputs.kafka-service }}
      plugins-service: ${{ steps.filter.outputs.plugins-service }}
      temporal-worker: ${{ steps.filter.outputs.temporal-worker }}
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            orbit-www:
              - 'orbit-www/**'
            repository-service:
              - 'services/repository/**'
              - 'proto/**'
            build-service:
              - 'services/build-service/**'
              - 'proto/**'
            bifrost:
              - 'services/bifrost/**'
              - 'proto/**'
            kafka-service:
              - 'services/kafka/**'
              - 'proto/**'
            plugins-service:
              - 'services/plugins/**'
              - 'proto/**'
            temporal-worker:
              - 'temporal-workflows/**'
              - 'proto/**'

  build:
    needs: changes
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    strategy:
      fail-fast: false
      matrix:
        include:
          - service: orbit-www
            dockerfile: orbit-www/Dockerfile
            context: orbit-www
          - service: repository-service
            dockerfile: services/repository/Dockerfile
            context: .
          - service: build-service
            dockerfile: services/build-service/Dockerfile
            context: .
          - service: bifrost
            dockerfile: services/bifrost/Dockerfile
            context: .
          - service: kafka-service
            dockerfile: services/kafka/Dockerfile
            context: .
          - service: plugins-service
            dockerfile: services/plugins/Dockerfile
            context: .
          - service: temporal-worker
            dockerfile: temporal-workflows/Dockerfile
            context: .
    steps:
      - name: Check if service changed
        id: check
        run: |
          echo "changed=${{ needs.changes.outputs[matrix.service] }}" >> "$GITHUB_OUTPUT"

      - uses: actions/checkout@v4
        if: steps.check.outputs.changed == 'true'

      - name: Set up Docker Buildx
        if: steps.check.outputs.changed == 'true'
        uses: docker/setup-buildx-action@v3

      - name: Log in to GHCR
        if: steps.check.outputs.changed == 'true'
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push
        if: steps.check.outputs.changed == 'true'
        uses: docker/build-push-action@v6
        with:
          context: ${{ matrix.context }}
          file: ${{ matrix.dockerfile }}
          push: true
          tags: |
            ${{ env.IMAGE_PREFIX }}/${{ matrix.service }}:latest
            ${{ env.IMAGE_PREFIX }}/${{ matrix.service }}:sha-${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

**Step 2: Commit**

```bash
git add .github/workflows/build-and-push.yml
git commit -m "feat(ci): add GitHub Actions workflow for building and pushing images to ghcr.io"
```

---

## Task 14: Final validation and push

**Step 1: Run full kustomize build**

Run: `kustomize build infrastructure/k8s/`
Expected: Valid YAML, no errors

**Step 2: Verify all files are committed**

Run: `git status`
Expected: Clean working tree

**Step 3: Push to main**

Run: `git push`
