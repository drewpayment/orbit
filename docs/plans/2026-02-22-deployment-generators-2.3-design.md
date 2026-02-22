# Deployment Generators Phase 2.3 — Design Document

**Goal:** Complete the deployment generators feature end-to-end — fix broken template rendering, add Helm chart generator, wire up GitHub commit flow, fix UI gaps, and add secret reference injection.

**Architecture:** The existing scaffolding (collections, Temporal workflow, gRPC service, UI components) is extensive. This phase fills in the real implementations behind the stubs: production-quality templates, actual git commits, and generator-specific UI config.

**Tech Stack:** Go text/template (generation), Temporal (orchestration), GitHub Contents API (commits), Payload CMS (data), Next.js server actions (UI bridge)

---

## Scope

### In scope
1. Fix template syntax mismatch (seed uses Handlebars, Go uses text/template)
2. Docker Compose generator — production-quality template with env var references, health checks, networking
3. Helm chart generator — new seed producing Chart.yaml, values.yaml, deployment.yaml, service.yaml
4. Secret injection — pull env var names from app's EnvironmentVariables, inject as references (not values)
5. CommitToRepo — wire Go activity to commit files to GitHub via installation token
6. commitGeneratedFiles — wire TypeScript server action to trigger real commit
7. getRepoBranches — query GitHub for actual branch names
8. AddDeploymentModal — generator-specific config fields per type

### Out of scope
- Terraform generator (deferred — cloud-provider-specific, unclear generic value)
- Execute mode for any generator (requires real cloud/cluster credentials)
- Custom generator authoring UI
- Usage analytics
- Dynamic JSON Schema form rendering (over-engineering for 2 generator types)

---

## Generator Templates

Both generators are generate-mode only. Users review files, then commit to repo.

### Shared Template Context

```go
type GeneratorContext struct {
    AppName     string
    ServiceName string
    ImageRepo   string              // from app's registry/build config
    ImageTag    string              // default "latest"
    Port        int                 // default 3000
    EnvVars     []EnvVar            // names only, no secret values
    Config      map[string]interface{} // generator-specific user config
}

type EnvVar struct {
    Name string // display name
    Key  string // original key for reference
}
```

Env var names come from the app's linked EnvironmentVariables collection. Values are never included — generated files use reference syntax appropriate to the target format.

### Docker Compose (`docker-compose-basic`)

Generates `docker-compose.yml`:
- Service with image, ports, restart policy
- Health check endpoint if app has healthConfig
- Environment section using `${VAR_NAME}` syntax (docker-compose native `.env` interpolation)
- Optional volumes and network from user config

### Helm Chart (`helm-basic`)

Generates 4 files:
- `Chart.yaml` — name, version, appVersion
- `values.yaml` — image repo/tag, port, replicas, env var names with placeholder values
- `templates/deployment.yaml` — Deployment spec with `secretKeyRef` for each env var pointing to a Kubernetes Secret
- `templates/service.yaml` — ClusterIP Service exposing the configured port

### Template Syntax

All templates use Go `text/template`. The existing seed data uses Handlebars (`{{serviceName}}`) which is incompatible with the Go renderer — this must be fixed.

---

## CommitToRepo and GitHub Integration

### Go Activity (`CommitToRepo`)

Currently returns `placeholder-sha`. Real implementation:

1. Receive deployment ID, app ID, generated files, branch name, commit message
2. Fetch app's `repository.installationId` from Payload
3. Create GitHub installation token via existing `PayloadTokenService`
4. Commit files via GitHub Trees API:
   - Get current commit SHA for target branch
   - Create blobs for each generated file
   - Create a tree with new/updated files
   - Create a commit pointing to that tree
   - Update branch ref
5. Return real commit SHA

### TypeScript Server Action (`commitGeneratedFiles`)

Currently `console.log`s and returns fake SHA. Real implementation:

- Calls gRPC to trigger the CommitToRepo activity through the deployment workflow
- Updates deployment status to `deployed` with real commit SHA

### `getRepoBranches` Server Action

Currently returns hardcoded `['main', 'develop']`. Real implementation:

- Fetch app's installation ID from Payload
- Create installation token
- Call GitHub API `GET /repos/{owner}/{repo}/branches`
- Return actual branch names

---

## Secret Injection (Reference-Only)

Generated files reference environment variables by name, never by value:

- **Docker Compose:** `${DATABASE_URL}` — users create a `.env` file or configure their Docker host
- **Helm:** `secretKeyRef` pointing to a Kubernetes Secret resource — users create the Secret separately

The `PrepareGeneratorContext` activity fetches env var names from the app's EnvironmentVariables collection via Payload API. Only the `key` field is read; encrypted `value` is never touched.

---

## UI Changes

### AddDeploymentModal

Currently shows docker-compose fields regardless of selected generator type.

**Fix:** Switch on generator type to render appropriate fields:
- `docker-compose`: serviceName (required), port (default 3000), volumes (optional)
- `helm`: releaseName (required), namespace (default "default"), replicas (default 1), port (default 3000)

Description text updates dynamically based on selected generator.

### DeploymentProgressPanel

No component changes needed. Fix the data flowing through existing components:
- `CommitToRepoForm.onCommit` calls real `commitGeneratedFiles`
- Branch list from real `getRepoBranches`

### No New Components

The existing set (`DeploymentRow`, `ProgressSteps`, `GeneratedFilesView`, `CommitToRepoForm`) covers the full flow.
