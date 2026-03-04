# GCP Launches — Design

**Status:** Approved
**Date:** 2026-03-03
**Context:** Extend the Launches feature to support Google Cloud Platform, mirroring the existing AWS worker pattern.

## Goal

Add GCP as a second cloud provider for Launches. Developers should be able to provision GCP infrastructure (GCS buckets, Cloud SQL, Cloud Run, VPC networks) through the same wizard and lifecycle used for AWS.

## Approach

**Dedicated GCP Worker** — Create `launches-worker-gcp/` as a standalone TypeScript Temporal worker, mirroring `launches-worker-aws/`. It listens on the `launches_gcp` task queue. The existing Go workflow already routes `provisionInfra`/`destroyInfra` to provider-specific queues via `taskQueueForProvider()`, so no workflow changes are needed.

## Architecture

```
Frontend (wizard selects provider: "gcp")
  → LaunchServer (gRPC) → Temporal LaunchWorkflow (Go, "orbit-workflows" queue)
    → ValidateLaunchInputs, UpdateLaunchStatus (Go, same queue)
    → provisionInfra / destroyInfra (routed to "launches_gcp" queue)
      → launches-worker-gcp (TypeScript)
        → Pulumi Automation API + @pulumi/gcp → GCP
```

No changes to:
- Go workflow (`launch_workflow.go`) — provider routing already built in
- Proto/gRPC layer — provider-agnostic
- Payload collections — `Launches` and `LaunchTemplates` already support `gcp`
- Frontend UI — wizard, ProviderIcon, tables all handle GCP

## GCP Worker Service

```
launches-worker-gcp/
  src/
    worker.ts                          # Temporal worker, task queue "launches_gcp"
    types.ts                           # ProvisionInput/Output, DestroyInput/Output
    activities/
      index.ts
      provision.ts                     # Pulumi stack.up() with @pulumi/gcp
      destroy.ts                       # Pulumi stack.destroy()
      validate-credentials.ts          # google-auth-library credential check
    templates/
      resources/
        gcs-bucket/
        cloud-sql-postgresql/
        cloud-run-service/
        vpc-network/
      bundles/
        web-app-backend/
        static-site/
  Dockerfile
  package.json
  tsconfig.json
```

Key differences from AWS worker:
- `@pulumi/gcp` instead of `@pulumi/aws`
- Pulumi config sets `gcp:project` and `gcp:region` (not `aws:region`)
- Credentials via `GOOGLE_CREDENTIALS` env var (service account JSON)
- `validateCredentials` uses `google-auth-library`

## Template Mapping (AWS → GCP)

| AWS Template | GCP Equivalent | Key Resources |
|---|---|---|
| S3 Bucket | GCS Bucket | `gcp.storage.Bucket`, versioning, lifecycle, IAM |
| RDS PostgreSQL | Cloud SQL PostgreSQL | `gcp.sql.DatabaseInstance`, `Database`, `User` |
| ECS Fargate | Cloud Run Service | `gcp.cloudrunv2.Service`, IAM invoker |
| VPC | VPC Network | `gcp.compute.Network`, `Subnetwork`, `Router`, `Firewall` |
| Web App Backend (bundle) | Web App Backend | VPC + Cloud Run + Cloud SQL + Load Balancing + IAM |
| Static Site (bundle) | Static Site | GCS + Cloud CDN + SSL Certificate + DNS |

## Docker Compose

```yaml
launches-worker-gcp:
  build: ./launches-worker-gcp
  environment:
    TEMPORAL_ADDRESS: temporal:7233
    TASK_QUEUE: launches_gcp
    PULUMI_BACKEND_URL: s3://pulumi-state?endpoint=minio:9000
    AWS_ACCESS_KEY_ID: minioadmin
    AWS_SECRET_ACCESS_KEY: minioadmin
    GOOGLE_CREDENTIALS: ${GOOGLE_CREDENTIALS:-}
  depends_on:
    - temporal
    - minio
```

## Seed Data

Extend `orbit-www/src/seed/launch-templates-seed.ts` with 6 GCP templates matching the AWS set (provider: `gcp`, GCP-specific `pulumiProjectPath` values).

## Testing

- Unit tests for each Pulumi template (mocked GCP provider)
- Activity tests for `provisionInfra`, `destroyInfra`, `validateCredentials`
- No Go-side changes needed
- Manual smoke test: create GCP cloud account → wizard → provision

## Out of Scope

- Azure and DigitalOcean workers (future)
- Cross-provider template linking (`crossProviderSlugs` wiring)
- Changes to Go workflow or gRPC layer
- New frontend UI components
