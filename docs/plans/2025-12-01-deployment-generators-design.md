# Deployment Generators Design

**Date**: 2025-12-01
**Status**: Design Complete
**Author**: Claude + Drew

## Overview

This document describes the architecture for Orbit's pluggable deployment system, enabling users to generate deployment artifacts and execute deployments across different targets (local Docker Compose, Kubernetes, cloud providers).

## Problem Statement

After a user creates an application from a template, they need to deploy it somewhere. Different teams have different deployment targets:
- Local development with Docker Compose
- Kubernetes clusters (self-managed or cloud)
- Cloud provider services (AWS ECS, Lambda, GCP Cloud Run)
- Custom infrastructure

A one-size-fits-all approach won't work. We need a pluggable system.

## Solution: Two-Layer Architecture

### Layer 1: Built-in Executors (Go Code)

Executors are Go implementations that know how to work with specific deployment technologies:

| Executor | What it does | Output |
|----------|--------------|--------|
| `DockerComposeExecutor` | Generates docker-compose.yml | Files committed to repo |
| `TerraformExecutor` | Runs terraform init/plan/apply | Deployed infrastructure |
| `HelmExecutor` | Runs helm upgrade --install | Deployed workloads |
| `KubernetesExecutor` | Applies manifests via kubectl | Deployed workloads |

Executors implement a common interface but handle execution differently (generate-only vs remote execution).

### Layer 2: Deployment Generators (Database Records)

Generators are configuration-driven "plugins" stored in the database:
- Reference an executor type
- Provide template files and config schema
- Can be built-in (global) or workspace-specific

**Example generators using the same executor:**
- "Terraform AWS ECS" → TerraformExecutor + ECS module templates
- "Terraform AWS Lambda" → TerraformExecutor + Lambda module templates
- "Terraform GCP Cloud Run" → TerraformExecutor + GCR module templates

Users select a generator, fill in configuration, and Orbit handles the rest.

## Executor Interface

```go
// pkg/deployment/executor.go
type Executor interface {
    // Type returns the executor identifier
    Type() string

    // ValidateConfig validates generator-specific configuration
    ValidateConfig(ctx context.Context, config json.RawMessage) error

    // Prepare sets up the working directory (clone repo, etc.)
    Prepare(ctx context.Context, req PrepareRequest) error

    // Generate creates deployment artifacts (files to commit)
    // Returns nil if this executor doesn't generate files
    Generate(ctx context.Context, req GenerateRequest) (*GenerateResult, error)

    // Execute performs the actual deployment
    // Returns nil if this executor is generate-only
    Execute(ctx context.Context, req ExecuteRequest) (*ExecuteResult, error)

    // Destroy tears down the deployment
    Destroy(ctx context.Context, req DestroyRequest) error
}

type GenerateResult struct {
    Files        []GeneratedFile
    CommitToRepo bool  // Should Orbit commit these to the app's repo?
}

type ExecuteResult struct {
    Status    DeploymentStatus
    Endpoints []string          // Where the app is accessible
    Outputs   map[string]any    // Executor-specific outputs
}

type GeneratedFile struct {
    Path    string
    Content string
}
```

### Executor Types

| Executor | Generate | Execute | Use Case |
|----------|----------|---------|----------|
| DockerComposeExecutor | ✅ | ❌ | Local dev - generates files for user |
| TerraformExecutor | ✅ (optional) | ✅ | Cloud infra - runs terraform apply |
| HelmExecutor | ✅ (optional) | ✅ | Kubernetes - runs helm install |
| KubernetesExecutor | ✅ (optional) | ✅ | Kubernetes - runs kubectl apply |

## Data Model

### DeploymentGenerator Collection

```typescript
// orbit-www/src/collections/DeploymentGenerators.ts
{
  slug: 'deployment-generators',
  fields: [
    // Identity
    { name: 'name', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true },
    { name: 'description', type: 'textarea' },

    // Executor binding
    {
      name: 'executorType',
      type: 'select',
      required: true,
      options: [
        { label: 'Docker Compose', value: 'docker-compose' },
        { label: 'Terraform', value: 'terraform' },
        { label: 'Helm', value: 'helm' },
        { label: 'Kubernetes', value: 'kubernetes' },
      ]
    },

    // Configuration schema (JSON Schema)
    {
      name: 'configSchema',
      type: 'json',
      admin: { description: 'JSON Schema defining required user inputs' }
    },

    // Template files
    {
      name: 'templateFiles',
      type: 'array',
      fields: [
        { name: 'path', type: 'text', required: true },
        { name: 'content', type: 'code', required: true },
      ]
    },

    // Ownership
    { name: 'isBuiltIn', type: 'checkbox', defaultValue: false },
    { name: 'workspace', type: 'relationship', relationTo: 'workspaces' },

    // Metadata
    { name: 'icon', type: 'text' },
    { name: 'category', type: 'select', options: ['local-dev', 'cloud', 'kubernetes', 'custom'] },
  ]
}
```

### Deployment Collection

```typescript
// orbit-www/src/collections/Deployments.ts
{
  slug: 'deployments',
  fields: [
    // Relations
    { name: 'app', type: 'relationship', relationTo: 'apps', required: true },
    { name: 'generator', type: 'relationship', relationTo: 'deployment-generators', required: true },

    // Identity
    { name: 'name', type: 'text', required: true },

    // User-provided config
    { name: 'config', type: 'json' },

    // Target info (for remote deployments)
    {
      name: 'target',
      type: 'group',
      fields: [
        { name: 'type', type: 'text' },
        { name: 'region', type: 'text' },
        { name: 'cluster', type: 'text' },
        { name: 'namespace', type: 'text' },
      ]
    },

    // Status tracking
    {
      name: 'status',
      type: 'select',
      defaultValue: 'pending',
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Generating', value: 'generating' },
        { label: 'Generated', value: 'generated' },
        { label: 'Deploying', value: 'deploying' },
        { label: 'Deployed', value: 'deployed' },
        { label: 'Failed', value: 'failed' },
        { label: 'Destroyed', value: 'destroyed' },
      ]
    },

    // Workflow tracking
    { name: 'workflowId', type: 'text' },
    { name: 'lastDeployedAt', type: 'date' },
    { name: 'lastDeployedBy', type: 'relationship', relationTo: 'users' },

    // Output
    { name: 'endpoints', type: 'json' },
    { name: 'outputs', type: 'json' },

    // Health
    { name: 'healthStatus', type: 'select', options: ['healthy', 'degraded', 'down', 'unknown'] },
    { name: 'healthLastChecked', type: 'date' },

    // Errors
    { name: 'lastError', type: 'textarea' },
  ]
}
```

## Temporal Workflow

### DeploymentWorkflow

```go
func DeploymentWorkflow(ctx workflow.Context, input DeploymentWorkflowInput) (*DeploymentWorkflowResult, error) {
    // Step 1: Load generator and executor
    var generator GeneratorInfo
    workflow.ExecuteActivity(ctx, "LoadGenerator", input.GeneratorSlug).Get(ctx, &generator)

    // Step 2: Validate configuration
    workflow.ExecuteActivity(ctx, "ValidateConfig", ValidateConfigInput{
        ExecutorType: generator.ExecutorType,
        Config:       input.AppConfig,
        Schema:       generator.ConfigSchema,
    }).Get(ctx, nil)

    // Step 3: Prepare working directory (clone app repo)
    var workDir string
    workflow.ExecuteActivity(ctx, "PrepareWorkDir", PrepareWorkDirInput{
        AppID: input.AppID,
    }).Get(ctx, &workDir)
    defer workflow.ExecuteActivity(ctx, "CleanupWorkDir", workDir)

    // Step 4: Generate artifacts (if executor supports it)
    var generateResult *GenerateResult
    workflow.ExecuteActivity(ctx, "GenerateArtifacts", GenerateArtifactsInput{
        ExecutorType:    generator.ExecutorType,
        WorkDir:         workDir,
        GeneratorConfig: generator.Config,
        AppConfig:       input.AppConfig,
    }).Get(ctx, &generateResult)

    // Step 5: Commit files to repo (if generated)
    if generateResult != nil && generateResult.CommitToRepo && len(generateResult.Files) > 0 {
        workflow.ExecuteActivity(ctx, "CommitToRepo", CommitToRepoInput{
            AppID:   input.AppID,
            Files:   generateResult.Files,
            Message: fmt.Sprintf("chore(orbit): deployment config via %s", generator.Name),
        }).Get(ctx, nil)
    }

    // Step 6: Execute deployment (if executor supports it)
    var executeResult *ExecuteResult
    workflow.ExecuteActivity(ctx, "ExecuteDeployment", ExecuteDeploymentInput{
        ExecutorType:    generator.ExecutorType,
        WorkDir:         workDir,
        GeneratorConfig: generator.Config,
        AppConfig:       input.AppConfig,
    }).Get(ctx, &executeResult)

    // Step 7: Update deployment status
    status := "generated"
    if executeResult != nil {
        status = string(executeResult.Status)
    }
    workflow.ExecuteActivity(ctx, "UpdateDeploymentStatus", UpdateStatusInput{
        DeploymentID: input.DeploymentID,
        Status:       status,
        Endpoints:    executeResult.Endpoints,
    }).Get(ctx, nil)

    // Step 8: Start health check workflow (if endpoints exist)
    if executeResult != nil && len(executeResult.Endpoints) > 0 {
        workflow.ExecuteChildWorkflow(ctx, "HealthCheckWorkflow", HealthCheckWorkflowInput{
            DeploymentID: input.DeploymentID,
            Endpoints:    executeResult.Endpoints,
        })
    }

    return &DeploymentWorkflowResult{Status: status}, nil
}
```

## Docker Compose Executor (First Implementation)

### Executor Implementation

```go
// internal/executors/dockercompose/executor.go
type DockerComposeExecutor struct{}

func (e *DockerComposeExecutor) Type() string {
    return "docker-compose"
}

func (e *DockerComposeExecutor) Generate(ctx context.Context, req GenerateRequest) (*GenerateResult, error) {
    // Load template from generator config
    template := req.GeneratorConfig.TemplateFiles["docker-compose.yml"]

    // Render with user's config
    rendered, err := renderTemplate(template, req.AppConfig)
    if err != nil {
        return nil, err
    }

    return &GenerateResult{
        Files: []GeneratedFile{
            {Path: "docker-compose.yml", Content: rendered},
        },
        CommitToRepo: true,
    }, nil
}

func (e *DockerComposeExecutor) Execute(ctx context.Context, req ExecuteRequest) (*ExecuteResult, error) {
    // Docker Compose executor is generate-only
    // User runs docker-compose up locally
    return nil, nil
}
```

### Built-in Generator (Seed Data)

```yaml
name: "Docker Compose (Local Dev)"
slug: "docker-compose-local"
description: "Generate docker-compose.yml for local development"
executorType: "docker-compose"
isBuiltIn: true
category: "local-dev"
icon: "🐳"

configSchema:
  type: object
  required: [serviceName, port]
  properties:
    serviceName:
      type: string
      description: "Service name in docker-compose"
    port:
      type: number
      description: "Port to expose"
    environment:
      type: array
      items:
        type: object
        properties:
          key: { type: string }
          value: { type: string }
    volumes:
      type: array
      items: { type: string }

templateFiles:
  - path: "docker-compose.yml"
    content: |
      version: '3.8'
      services:
        {{serviceName}}:
          build: .
          ports:
            - "{{port}}:{{port}}"
          {{#if environment}}
          environment:
            {{#each environment}}
            - {{key}}={{value}}
            {{/each}}
          {{/if}}
          {{#if volumes}}
          volumes:
            {{#each volumes}}
            - {{this}}
            {{/each}}
          {{/if}}
```

## End-to-End Flow Example

### User creates deployment for their app

1. **User has an App**: `my-auth-api` (from template instantiation)

2. **User clicks "Add Deployment"**: Selects "Docker Compose (Local Dev)"

3. **User fills configuration form**:
   - Service Name: `auth-api`
   - Port: `8080`
   - Environment: `DATABASE_URL=postgres://...`

4. **Orbit creates Deployment record** and starts DeploymentWorkflow

5. **Workflow executes**:
   - Loads Docker Compose generator
   - Validates config against schema
   - Clones app repo
   - Generates docker-compose.yml from template
   - Commits to app's GitHub repo
   - Updates status to "generated"

6. **Developer uses generated file**:
   ```bash
   git pull
   docker-compose up  # App runs on localhost:8080
   ```

7. **UI shows**: Deployment status "Generated ✓"

## Relationship to Other Systems

### How this connects to existing designs

| System | Relationship |
|--------|--------------|
| **Application Lifecycle Catalog** | Apps have Deployments; Deployments use Generators |
| **Template Instantiation** | Creates App → User adds Deployments later |
| **Health Monitoring** | HealthCheckWorkflow monitors Deployed (not Generated) deployments |
| **Orbit K8s Deployment** | Separate - that's how Orbit itself runs, not user apps |

### Diagram

```
Template Catalog
       │
       ▼ (instantiate)
┌─────────────┐
│    Apps     │──────────────────────────────────┐
│  (Catalog)  │                                  │
└─────────────┘                                  │
       │                                         │
       ▼ (add deployment)                        │
┌─────────────────────────────────────────┐     │
│  Deployment Generators                   │     │
│  ┌───────────────────────────────────┐  │     │
│  │ Docker Compose (Local Dev)        │  │     │
│  │ → DockerComposeExecutor           │  │     │
│  └───────────────────────────────────┘  │     │
│  ┌───────────────────────────────────┐  │     │
│  │ Terraform AWS ECS                 │  │     │
│  │ → TerraformExecutor               │  │     │
│  └───────────────────────────────────┘  │     │
│  ┌───────────────────────────────────┐  │     │
│  │ Kubernetes Basic                  │  │     │
│  │ → KubernetesExecutor              │  │     │
│  └───────────────────────────────────┘  │     │
└─────────────────────────────────────────┘     │
       │                                         │
       ▼ (Temporal workflow)                     │
┌─────────────────────────────────────────┐     │
│  Deployments                             │◄────┘
│  ┌─────────────────────────────────┐    │
│  │ my-auth-api / local-dev         │    │
│  │ Status: Generated               │    │
│  │ Generator: docker-compose-local │    │
│  └─────────────────────────────────┘    │
│  ┌─────────────────────────────────┐    │
│  │ my-auth-api / production        │    │
│  │ Status: Deployed                │    │
│  │ Generator: terraform-aws-ecs    │    │
│  │ Endpoints: [https://...]        │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
       │
       ▼ (if endpoints exist)
┌─────────────────────────────────────────┐
│  Health Check Workflow                   │
│  (monitors deployed endpoints)           │
└─────────────────────────────────────────┘
```

## Implementation Phases

### Phase 1: Foundation
- [ ] DeploymentGenerator collection
- [ ] Deployment collection (updated)
- [ ] Executor interface definition
- [ ] DockerComposeExecutor implementation

### Phase 2: Workflow
- [ ] DeploymentWorkflow
- [ ] Activities: LoadGenerator, ValidateConfig, PrepareWorkDir
- [ ] Activities: GenerateArtifacts, CommitToRepo, UpdateStatus

### Phase 3: UI
- [ ] Generator selection UI
- [ ] Dynamic config form (from JSON Schema)
- [ ] Deployment status display
- [ ] "Re-generate" action

### Phase 4: Additional Executors
- [ ] KubernetesExecutor (generate + apply manifests)
- [ ] TerraformExecutor (generate + terraform apply)
- [ ] HelmExecutor (generate + helm install)

## Future Considerations

- **Code-based plugins**: HashiCorp go-plugin for truly custom executors
- **Deployment secrets**: Securely pass credentials to executors
- **Multi-environment**: Promote deployments between environments
- **Rollback support**: Revert to previous deployment
- **Deployment pipelines**: Automated staging → production promotion
