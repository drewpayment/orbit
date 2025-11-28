# Application Lifecycle Catalog - Design Document

**Date**: 2025-11-28
**Status**: Design Complete
**Author**: Claude + Drew

## Overview

The Application Lifecycle Catalog provides end-to-end tracking from template instantiation through deployment to production, with live health monitoring. It solves the "code-to-production genesis" problem where the origin and context of deployed applications gets lost over time.

## Problem Statement

Three interconnected pain points:

1. **Lost Lineage**: Deployed applications lose connection to their origin template, making it hard to understand what they do or update them consistently
2. **Manual CI/CD Setup**: Every new repository requires manual deployment scaffolding
3. **No Unified View**: Applications deployed everywhere with no single catalog showing what's running, its health, and its context

## Solution

An integrated system that:
- Tracks application lineage from template to deployment
- Provides pluggable deployment generators (Terraform, Helm, Docker Compose)
- Monitors health via Temporal workflows
- Presents a unified catalog with card grid and visual graph views

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Orbit Platform                           │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐ │
│  │  Templates  │───▶│    Apps     │───▶│    Deployments      │ │
│  │  (existing) │    │  (Catalog)  │    │  (Generators)       │ │
│  └─────────────┘    └─────────────┘    └─────────────────────┘ │
│         │                  │                     │              │
│         │           ┌──────▼──────┐              │              │
│         │           │ .orbit.yaml │              │              │
│         │           │  (manifest) │              │              │
│         │           └─────────────┘              │              │
│         │                                        │              │
│         └────────────────────┬───────────────────┘              │
│                              ▼                                  │
│                    ┌─────────────────┐                         │
│                    │    Temporal     │                         │
│                    │   Workflows     │                         │
│                    │  - Deploy       │                         │
│                    │  - HealthCheck  │                         │
│                    └─────────────────┘                         │
└─────────────────────────────────────────────────────────────────┘
```

### Key Components

1. **App Catalog** - Registry of applications with lineage, context, and status
2. **Deployment Generators** - Pluggable modules (Terraform, Helm, Docker Compose)
3. **Health Workflows** - Temporal-based HTTP polling per deployment
4. **Manifest System** - `.orbit.yaml` for portable identity and config

## Data Model

### App Collection

```typescript
{
  id: string
  name: string
  description: string
  workspace: Workspace // relation
  repository: {
    owner: string
    name: string
    url: string
    installationId: string
  }
  origin: {
    type: 'template' | 'imported'
    templateId?: string // relation to Template
    instantiatedAt?: Date
  }
  syncMode: 'orbit-primary' | 'manifest-primary'
  manifestSha?: string // for sync tracking
  healthConfig: {
    endpoint: string
    interval: number // seconds
    timeout: number // seconds
  }
  status: 'healthy' | 'degraded' | 'down' | 'unknown'
  createdAt: Date
  updatedAt: Date
}
```

### Deployment Collection

```typescript
{
  id: string
  app: App // relation
  name: string // e.g., 'production', 'staging'
  generator: 'terraform' | 'helm' | 'docker-compose' | string
  config: JSON // generator-specific params
  target: {
    type: string
    region?: string
    cluster?: string
    url?: string
  }
  status: 'pending' | 'deploying' | 'deployed' | 'failed'
  lastDeployedAt?: Date
  lastDeployedBy?: User // relation
  healthStatus: 'healthy' | 'degraded' | 'down' | 'unknown'
  healthLastChecked?: Date
  workflowId?: string // active Temporal workflow
}
```

### DeploymentGenerator Collection

```typescript
{
  id: string
  name: string // e.g., 'Terraform AWS ECS'
  slug: string // e.g., 'terraform-aws-ecs'
  description: string
  type: 'terraform' | 'helm' | 'docker-compose' | 'custom'
  configSchema: JSON // JSON Schema for config validation
  templateFiles: Array<{ path: string, content: string }> // IaC templates
  isBuiltIn: boolean
  workspace?: Workspace // null = global/built-in
}
```

### Relationships

- App → Workspace (many-to-one)
- App → Template (optional, many-to-one for origin tracking)
- Deployment → App (many-to-one, an app can have multiple deployments)
- DeploymentGenerator → Workspace (optional, for custom generators)

## Temporal Workflows

### DeploymentWorkflow

```
Input: { deploymentId, appId, generator, config, target }

Steps:
1. ValidateDeploymentConfig    - Check config against schema
2. PrepareGeneratorContext     - Clone repo, gather context
3. ExecuteGenerator            - Run Terraform/Helm/etc
4. CaptureDeploymentOutput     - Store URLs, IPs, metadata
5. StartHealthWorkflow         - Kick off monitoring
6. UpdateDeploymentStatus      - Mark complete in DB

Query: "progress" → { step, message, percentComplete }
Signal: "cancel" → Graceful teardown
```

### HealthCheckWorkflow

```
Input: { deploymentId, endpoint, interval, timeout }

Behavior:
- Long-running workflow (runs indefinitely until stopped)
- Sleeps for interval, then checks endpoint
- Updates deployment healthStatus in DB
- Tracks consecutive failures for degraded/down transitions

Query: "status" → { healthy, lastCheck, consecutiveFailures }
Signal: "stop" → Graceful shutdown
Signal: "updateConfig" → Change interval/endpoint live
```

### Generator Interface

```go
type DeploymentGenerator interface {
    Validate(ctx context.Context, config json.RawMessage) error
    Prepare(ctx context.Context, workDir string, config json.RawMessage) error
    Execute(ctx context.Context, workDir string) (*DeploymentResult, error)
    Destroy(ctx context.Context, workDir string) error
}
```

Built-in generators:
- TerraformGenerator (executes terraform init/plan/apply)
- HelmGenerator (executes helm upgrade --install)
- DockerComposeGenerator (executes docker-compose up -d)

## Manifest System

### .orbit.yaml Format

```yaml
apiVersion: orbit.dev/v1
kind: Application

metadata:
  name: user-auth-service
  description: User authentication and authorization API

origin:
  template: auth-service-template
  templateVersion: "1.2.0"
  instantiatedAt: "2025-01-28T10:00:00Z"
  instantiatedBy: drew@example.com

health:
  endpoint: /health
  interval: 60s
  timeout: 5s
```

### What Lives Where

| In Manifest (`.orbit.yaml`) | In Orbit DB Only |
|-----------------------------|------------------|
| App identity (name, description) | Deployment configurations |
| Origin/lineage info | Generator parameters |
| Health check config | Target credentials/secrets |
| Sync mode preference | Deployment history |
| | Live status & metrics |

### Sync Modes

**Orbit-Primary (default)**:
- User edits in Orbit UI
- Orbit auto-commits .orbit.yaml to repo
- Manifest changes in repo are overwritten on next sync
- Simple, UI-driven experience

**Manifest-Primary (opt-in)**:
- GitHub webhook detects .orbit.yaml changes
- Orbit reads manifest, updates DB
- UI shows "managed by manifest" indicator
- UI edits push commits to repo
- GitOps-native experience for power users

**Conflict Handling** (manifest-primary mode):
- Webhook triggers sync on push
- If Orbit DB was modified since last sync → prompt user to resolve
- Options: "Keep Orbit changes", "Use manifest", "Merge manually"

## User Interface

### Application Catalog

Two views with toggle:
1. **Card Grid View** - Scannable, status-focused cards
2. **Visual Graph View** - Interactive lineage tree showing Template → App → Deployments

### Card Grid View

Each card shows:
- App name with health indicator (🟢🟡🔴)
- Description
- Origin (template name or "Imported")
- Deployment count
- Per-deployment health status
- Quick actions (View, Deploy)

### Visual Graph View

Interactive visualization:
- Templates at top level
- Apps as children of their origin template
- Deployments as children of apps
- Health status on each node
- Click to view details, hover for tooltip
- Filter by template to highlight lineage

### App Detail Page

Sections:
- Header with name, description, edit/sync actions
- Summary cards (Origin, Repository, Health)
- Deployments table with status and actions
- Activity log (deploys, health changes, creation)

## User Flows

### Flow 1: Template → App

1. User instantiates template (existing flow)
2. Repository created successfully
3. Prompt: "Ready to deploy? Add this app to your catalog"
4. If accepted: App auto-created with origin linked, .orbit.yaml committed

### Flow 2: Import Existing Repo

1. Applications → New App → "Import existing repository"
2. Select repository from GitHub installations
3. Enter app name, description
4. App created with origin: "imported", .orbit.yaml committed

### Flow 3: Add Deployment

1. App Detail → Add Deployment
2. Choose generator (Terraform, Helm, Docker Compose)
3. Configure generator-specific parameters
4. Set health check endpoint/interval
5. Create & Deploy → DeploymentWorkflow starts
6. On success → HealthCheckWorkflow starts

## Navigation Structure

```
Orbit
├── Templates (existing)
│   ├── Browse templates
│   └── Create from template → [Add to Catalog prompt]
│
├── Applications (NEW)
│   ├── Catalog (grid/graph views)
│   ├── App detail
│   │   ├── Overview
│   │   ├── Deployments
│   │   ├── Activity log
│   │   └── Settings (sync mode, health config)
│   └── Import existing repo
│
└── Deployment Generators (admin/workspace settings)
    ├── Built-in generators
    └── Custom generators (future)
```

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Architecture | Hybrid (Manifest + Platform) | Flexibility for different user preferences |
| Sync strategy | Orbit-primary default, optional manifest-primary | Simple default, power user option |
| Deployment system | Direct orchestration via Temporal | Durability, visibility, no repo commits needed |
| Health monitoring | Simple HTTP checks | Start simple, can evolve |
| Catalog UX | Card grid + visual graph toggle | Scannable + explorable |

## Future Considerations

- Auto-discovery: Scan GitHub org for repos with .orbit.yaml
- Custom generators: User-defined deployment templates
- Metrics integration: Pull from Datadog, Prometheus, CloudWatch
- Deployment pipelines: Multi-stage promotion (dev → staging → prod)
- Rollback support: One-click revert to previous deployment

## Implementation Phases

This design will be broken into implementation phases in a separate planning document. Key phases anticipated:

1. **Data Model & Collections** - App, Deployment, DeploymentGenerator collections
2. **Manifest System** - .orbit.yaml parsing, sync logic
3. **Catalog UI** - Card grid view, app detail page
4. **Deployment Workflows** - Temporal workflows, first generator (Docker Compose)
5. **Health Monitoring** - HealthCheckWorkflow, status updates
6. **Visual Graph** - D3/React Flow visualization
7. **Additional Generators** - Terraform, Helm
8. **Import Flow** - Adopt existing repos
