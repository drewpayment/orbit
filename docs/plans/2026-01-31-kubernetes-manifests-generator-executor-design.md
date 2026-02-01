# Kubernetes Manifests Generator & Executor Design

**Date**: 2026-01-31  
**Status**: Design Complete  
**Authors**: Drew + Claude

---

## Overview

A Kubernetes manifest generator that creates deployment artifacts (Deployment, Service, Ingress, etc.) from an Orbit application's configuration. Supports two execution paths: direct cluster apply or GitOps commit.

This replaces the need for Helm in most cases — users get K8s manifests directly without the chart abstraction layer.

## Key Concepts

| Path | Generator | Executor |
|------|-----------|----------|
| **Direct Apply** | Render YAML manifests | `kubectl apply` + wait for rollout |
| **GitOps** | Render YAML manifests | `git commit` + push (or open PR) |

### Orbit's Responsibilities
- Generate K8s manifests from app config
- Connect to clusters (SA token or cloud provider integration)
- Apply manifests or commit to repo
- Monitor rollout status (direct apply path)

### User's Responsibilities
- Configure which resources to generate
- Provide cluster access (or choose GitOps path)
- Review and approve before execution

## Generated Resources

### Resource Tiers

| Tier | Resources | Notes |
|------|-----------|-------|
| **Core** (always) | Deployment, Service | Minimum viable deploy |
| **Optional** | Ingress, ConfigMap, Secret, HPA, PVC | User toggles on/off |

### Resource Configuration UI

```
┌─────────────────────────────────────────────────────────┐
│ Kubernetes Resources                                    │
│                                                         │
│ Core:                                                   │
│ ☑ Deployment    [▾ replicas: 2, image, resources...]   │
│ ☑ Service       [▾ port: 80 → 3000, type: ClusterIP]   │
│                                                         │
│ Optional:                                               │
│ ☐ Ingress       → host, path, TLS, ingress class       │
│ ☐ ConfigMap     → pulls non-secret env vars            │
│ ☐ Secret        → pulls secrets (method varies)        │
│ ☐ HPA           → min/max replicas, CPU threshold      │
│ ☐ PVC           → size, storage class                  │
└─────────────────────────────────────────────────────────┘
```

When user checks an optional resource, a config section expands with relevant fields.

### Ingress Example

```
☑ Ingress
  ┌───────────────────────────────────────────────────┐
  │ Host:          [my-app.example.com            ]   │
  │ Path:          [/                             ]   │
  │ Ingress Class: [nginx                        ▾]   │
  │ ☐ Enable TLS (uses cert-manager)                 │
  └───────────────────────────────────────────────────┘
```

## Secret Handling

Secrets require different strategies based on executor path:

| Executor | Secret Strategy |
|----------|-----------------|
| Direct Apply | Generate `Secret` resource, apply directly (never committed to git) |
| GitOps | Generate `ExternalSecret` or `SealedSecret` CRD (actual values never in git) |

### GitOps Secret Options

User selects their secret management approach:

```
Secret Management (GitOps):
○ ExternalSecret (AWS Secrets Manager, Vault, etc.)
○ SealedSecret (Bitnami Sealed Secrets)
```

Orbit generates the appropriate CRD referencing the external secret store.

## Cluster Connectivity

### New Collection: `KubernetesClusters`

```typescript
// orbit-www/src/collections/KubernetesClusters.ts
{
  slug: 'kubernetes-clusters',
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'workspace', type: 'relationship', relationTo: 'workspaces' },
    { name: 'defaultNamespace', type: 'text', defaultValue: 'default' },
    
    // Connection method
    { 
      name: 'connectionMethod', 
      type: 'select',
      options: [
        { label: 'Service Account Token', value: 'service-account' },
        { label: 'AWS EKS', value: 'aws-eks' },
        { label: 'GCP GKE', value: 'gcp-gke' },
        { label: 'Azure AKS', value: 'azure-aks' },
      ]
    },
    
    // Service Account method (all encrypted)
    { name: 'apiServer', type: 'text' },
    { name: 'caCertificate', type: 'textarea' },
    { name: 'serviceAccountToken', type: 'text' },
    
    // Cloud provider method
    { name: 'cloudCredential', type: 'relationship', relationTo: 'cloud-credentials' },
    { name: 'clusterName', type: 'text' },
    { name: 'region', type: 'text' },
  ]
}
```

### Connection Methods

| Method | How Orbit Authenticates |
|--------|------------------------|
| Service Account | Direct: API server URL + CA cert + token |
| AWS EKS | `aws eks get-token` using linked CloudCredentials |
| GCP GKE | `gcloud container clusters get-credentials` using linked CloudCredentials |
| Azure AKS | `az aks get-credentials` using linked CloudCredentials |

### Encryption Requirements

All sensitive fields use Orbit's existing AES-256-GCM encryption service. Same pattern as:
- `CloudCredentials` — encrypts access keys and tokens
- `EnvironmentVariables` — encrypts secret values

**Raw values are NEVER:**
- Stored unencrypted in database
- Logged in Temporal history
- Returned to frontend

## Namespace Handling

Cluster has a default namespace, user can override per deployment:

```
Deployment Config:
┌─────────────────────────────────────────────────────────┐
│ Cluster:    [production-cluster               ▾]       │
│ Namespace:  [my-app-prod    ] (default: "default")     │
└─────────────────────────────────────────────────────────┘
```

Generated manifests include explicit `namespace:` in metadata.

## User Flow

### Step 1: Configure

```
┌─────────────────────────────────────────────────────────┐
│ Repository: drewpayment/my-app ✓                        │
│                                                         │
│ Name:       [production                            ]    │
│                                                         │
│ Execution Method:                                       │
│ ○ Deploy directly to cluster                           │
│ ○ Commit to repository (GitOps)                        │
│                                                         │
│ ─── Direct Deploy Settings ───                         │
│ Cluster:    [production-cluster               ▾]       │
│ Namespace:  [my-app                            ]       │
│                                                         │
│ ─── Resources ───                                      │
│ [Resource toggles and config as shown above]           │
│                                                         │
│ [Cancel]                              [Generate]        │
└─────────────────────────────────────────────────────────┘
```

### Step 2: Review

```
┌─────────────────────────────────────────────────────────┐
│ Generated Manifests                                     │
│                                                         │
│ 📄 deployment.yaml                                      │
│ 📄 service.yaml                                         │
│ 📄 configmap.yaml                                       │
│ 📄 secret.yaml                                          │
│                                                         │
│ [▾ Preview YAML]                                       │
│ ┌─────────────────────────────────────────────────────┐│
│ │ apiVersion: apps/v1                                 ││
│ │ kind: Deployment                                    ││
│ │ metadata:                                           ││
│ │   name: my-app                                      ││
│ │   namespace: my-app                                 ││
│ │ ...                                                 ││
│ └─────────────────────────────────────────────────────┘│
│                                                         │
│ [Cancel]                        [Approve & Deploy]      │
└─────────────────────────────────────────────────────────┘
```

### Step 3: Execute & Monitor (Direct Apply)

```
┌─────────────────────────────────────────────────────────┐
│ Deploying to production-cluster...                      │
│                                                         │
│ Applying manifests:                                     │
│   ✓ ConfigMap/my-app-config created                    │
│   ✓ Secret/my-app-secrets created                      │
│   ✓ Deployment/my-app created                          │
│   ✓ Service/my-app created                             │
│                                                         │
│ Waiting for rollout:                                    │
│   ⟳ deployment "my-app" rolling out (1/3 pods ready)   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Step 4: Complete

```
┌─────────────────────────────────────────────────────────┐
│ ✓ Deployment Complete                                   │
│                                                         │
│ Cluster:   production-cluster                          │
│ Namespace: my-app                                       │
│ Pods:      3/3 ready                                   │
│                                                         │
│ Service:   my-app.my-app.svc.cluster.local:80          │
│                                                         │
│ [View Details]                              [Done]      │
└─────────────────────────────────────────────────────────┘
```

## Technical Architecture

### Temporal Workflow

```
KubernetesDeploymentWorkflow
│
├─ 1. ValidatePrerequisites
│     └─ Check: cluster connected (direct) OR repo linked (GitOps)
│
├─ 2. RenderManifests
│     └─ Generate YAML for selected resources
│     └─ Store manifests on deployment record
│     └─ Update status: "awaiting_approval"
│
├─ ⏸️  WAIT FOR SIGNAL (Approve or Cancel)
│
├─ 3. ExecuteDeployment (branches by executor type)
│     │
│     ├─ Direct Apply Path:
│     │   ├─ Activity: GetClusterCredentials
│     │   │     └─ Decrypt SA token OR fetch via cloud CLI
│     │   ├─ Activity: ApplyManifests
│     │   │     └─ kubectl apply -f (each manifest)
│     │   └─ Activity: WaitForRollout
│     │         └─ Poll: kubectl rollout status
│     │         └─ Heartbeat to Temporal
│     │         └─ Timeout after configurable duration
│     │
│     └─ GitOps Path:
│         └─ Activity: CommitOrCreatePR
│               └─ Commit manifests to specified path
│               └─ Or open PR for review
│
└─ 4. UpdateDeploymentRecord
      └─ Store result (endpoints, PR link, error)
      └─ Set final status: deployed / failed / pr_opened
```

### Rollout Monitoring

The `WaitForRollout` activity:
- Polls `kubectl rollout status deployment/<name>` with heartbeats
- Surfaces pod errors (CrashLoopBackOff, ImagePullBackOff, etc.)
- Configurable timeout (default: 5 minutes)
- On failure, captures pod logs/events for debugging

### Components

| Layer | Component | Responsibility |
|-------|-----------|----------------|
| UI | `AddDeploymentModal` | Resource selection, config |
| UI | `ManifestPreviewPanel` | Show generated YAML |
| UI | `DeploymentProgressPanel` | Rollout status |
| Collection | `KubernetesClusters` | Store cluster connections |
| Server Action | `deployments.ts` | Trigger workflow |
| Temporal Workflow | `KubernetesDeploymentWorkflow` | Orchestrate |
| Temporal Activities | `KubernetesActivities` | kubectl operations |

### Worker Requirements

- `kubectl` CLI installed
- Cloud provider CLIs (aws, gcloud, az) for EKS/GKE/AKS auth

## Implementation Tasks

### Phase 1: Foundation — 3-4 days

1. **Create `KubernetesClusters` collection**
   - Connection methods (SA token, EKS, GKE, AKS)
   - Encryption hooks for sensitive fields
   - Workspace-scoped access control

2. **Cluster management UI**
   - Workspace Settings → Kubernetes Clusters
   - Add/edit/delete with provider-specific fields
   - Test connection button

3. **Update Temporal worker**
   - Install `kubectl` CLI
   - Ensure cloud CLIs available (for EKS/GKE/AKS auth)

### Phase 2: Generator — 3-4 days

1. **Manifest templates**
   - Deployment, Service (core)
   - Ingress, ConfigMap, Secret, HPA, PVC (optional)
   - ExternalSecret/SealedSecret for GitOps path
   - Go `text/template` with K8s YAML output

2. **Resource config UI**
   - Checkbox toggles for optional resources
   - Expandable config sections per resource
   - Preview rendered YAML

### Phase 3: Executors — 3-4 days

1. **Direct Apply executor**
   - `GetClusterCredentials` activity
   - `ApplyManifests` activity (kubectl apply)
   - `WaitForRollout` activity (poll + heartbeat)

2. **GitOps executor**
   - Reuse git commit/PR logic from Docker Compose generator
   - ExternalSecret/SealedSecret generation for secrets path

### Phase 4: Polish — 2-3 days

1. Error handling — surface kubectl errors, pod failures clearly
2. Namespace validation — ensure namespace exists or create it
3. Tests — unit tests for templates, workflow integration test
4. Docs — user guide for connecting clusters

## Estimated Effort

~2 weeks total

## Future Considerations

- **Helm chart consumption** — ability to deploy existing Helm charts (separate feature)
- **Rollback support** — `kubectl rollout undo` if deployment fails health checks
- **Multi-cluster deployments** — deploy same app to multiple clusters
- **Drift detection** — detect manual changes to deployed resources
- **Resource quotas** — enforce limits on what users can request
