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
- `orbit.hoytlabs.app` -> gateway-external
- `temporal.orbit.hoytlabs.app` -> gateway-external

### 6. First Image Build

Push to `main` to trigger the initial GitHub Actions build before deploying manifests.
