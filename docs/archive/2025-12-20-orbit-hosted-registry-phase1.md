# Orbit-Hosted Registry - Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deploy an Orbit-hosted container registry as the zero-config default for all builds.

**Architecture:** Docker Distribution (registry:2) with MinIO S3 backend, integrated as automatic fallback when no user registry is configured. Images tracked in Payload for quota management.

**Tech Stack:** Docker Registry, MinIO, Payload CMS, Go (build-service), TypeScript (actions), Protocol Buffers

---

## Task 1: Add MinIO Service to Docker Compose

**Files:**
- Modify: `docker-compose.yml`

**Step 1: Add MinIO service definition**

Add after the `redis` service block (around line 162):

```yaml
  minio:
    container_name: orbit-minio
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      - MINIO_ROOT_USER=orbit-admin
      - MINIO_ROOT_PASSWORD=orbit-secret-key
    volumes:
      - minio-data:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 5s
      retries: 5
```

**Step 2: Add volume definition**

Add to the `volumes:` section at the bottom of the file:

```yaml
  minio-data:
```

**Step 3: Verify syntax**

Run: `docker compose config --quiet && echo "Valid"`
Expected: `Valid`

**Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "infra: add MinIO service for object storage"
```

---

## Task 2: Add Docker Registry Service

**Files:**
- Modify: `docker-compose.yml`
- Create: `infrastructure/registry/config.yml`

**Step 1: Create registry config directory**

```bash
mkdir -p infrastructure/registry
```

**Step 2: Create registry configuration file**

Create `infrastructure/registry/config.yml`:

```yaml
version: 0.1
log:
  level: info
  formatter: json
storage:
  s3:
    accesskey: orbit-admin
    secretkey: orbit-secret-key
    region: us-east-1
    regionendpoint: http://minio:9000
    bucket: orbit-registry
    encrypt: false
    secure: false
    v4auth: true
    rootdirectory: /
  delete:
    enabled: true
  cache:
    blobdescriptor: inmemory
http:
  addr: :5000
  headers:
    X-Content-Type-Options: [nosniff]
health:
  storagedriver:
    enabled: true
    interval: 10s
    threshold: 3
```

**Step 3: Add registry service to docker-compose.yml**

Add after the `minio` service:

```yaml
  orbit-registry:
    container_name: orbit-registry
    image: registry:2
    ports:
      - "5050:5000"
    volumes:
      - ./infrastructure/registry/config.yml:/etc/docker/registry/config.yml:ro
    depends_on:
      minio:
        condition: service_healthy
    restart: unless-stopped
```

**Step 4: Verify syntax**

Run: `docker compose config --quiet && echo "Valid"`
Expected: `Valid`

**Step 5: Commit**

```bash
git add docker-compose.yml infrastructure/registry/
git commit -m "infra: add Docker Registry with MinIO S3 backend"
```

---

## Task 3: Create MinIO Bucket Initialization

**Files:**
- Create: `infrastructure/registry/init-bucket.sh`
- Modify: `docker-compose.yml`

**Step 1: Create bucket initialization script**

Create `infrastructure/registry/init-bucket.sh`:

```bash
#!/bin/sh
set -e

# Wait for MinIO to be ready
until mc alias set myminio http://minio:9000 orbit-admin orbit-secret-key; do
  echo "Waiting for MinIO..."
  sleep 2
done

# Create bucket if it doesn't exist
mc mb --ignore-existing myminio/orbit-registry

echo "MinIO bucket 'orbit-registry' ready"
```

**Step 2: Make script executable**

```bash
chmod +x infrastructure/registry/init-bucket.sh
```

**Step 3: Add init container to docker-compose.yml**

Add after the `minio` service, before `orbit-registry`:

```yaml
  minio-init:
    container_name: orbit-minio-init
    image: minio/mc:latest
    entrypoint: /init-bucket.sh
    volumes:
      - ./infrastructure/registry/init-bucket.sh:/init-bucket.sh:ro
    depends_on:
      minio:
        condition: service_healthy
    restart: "no"
```

**Step 4: Update orbit-registry to depend on minio-init**

Change orbit-registry depends_on to:

```yaml
    depends_on:
      minio-init:
        condition: service_completed_successfully
```

**Step 5: Verify syntax**

Run: `docker compose config --quiet && echo "Valid"`
Expected: `Valid`

**Step 6: Commit**

```bash
git add docker-compose.yml infrastructure/registry/
git commit -m "infra: add MinIO bucket initialization for registry"
```

---

## Task 4: Add REGISTRY_TYPE_ORBIT to Protobuf

**Files:**
- Modify: `proto/idp/build/v1/build.proto`

**Step 1: Update RegistryType enum**

In `proto/idp/build/v1/build.proto`, find the RegistryType enum (lines 91-96) and add ORBIT:

```protobuf
enum RegistryType {
  REGISTRY_TYPE_UNSPECIFIED = 0;
  REGISTRY_TYPE_GHCR = 1;
  REGISTRY_TYPE_ACR = 2;
  REGISTRY_TYPE_ORBIT = 3;
}
```

**Step 2: Regenerate proto code**

Run: `make proto-gen`
Expected: Successful generation to `proto/gen/go/` and `orbit-www/src/lib/proto/`

**Step 3: Verify generated TypeScript**

Run: `grep -A5 "export enum RegistryType" orbit-www/src/lib/proto/idp/build/v1/build_pb.ts`
Expected: Should show `ORBIT = 3`

**Step 4: Verify generated Go**

Run: `grep -A5 "RegistryType_REGISTRY_TYPE_ORBIT" proto/gen/go/idp/build/v1/build.pb.go`
Expected: Should show the ORBIT constant

**Step 5: Commit**

```bash
git add proto/ orbit-www/src/lib/proto/
git commit -m "feat: add REGISTRY_TYPE_ORBIT to protobuf"
```

---

## Task 5: Add Orbit Registry Type Constant to Builder

**Files:**
- Modify: `services/build-service/internal/builder/builder.go`

**Step 1: Add RegistryTypeOrbit constant**

Find the registry type constants (lines 14-19) and add:

```go
const (
    RegistryTypeGHCR  RegistryType = "ghcr"
    RegistryTypeACR   RegistryType = "acr"
    RegistryTypeOrbit RegistryType = "orbit"
)
```

**Step 2: Add Orbit case to loginToRegistry**

Find the `loginToRegistry` function switch statement (around line 279) and add before `default`:

```go
    case RegistryTypeOrbit:
        // For Orbit registry, use service account credentials
        // Registry runs on internal network, auth via environment
        orbitUser := os.Getenv("ORBIT_REGISTRY_USER")
        orbitPass := os.Getenv("ORBIT_REGISTRY_PASS")
        if orbitUser == "" {
            orbitUser = "orbit-service"
        }
        if orbitPass == "" {
            orbitPass = "orbit-registry-token"
        }
        cmd = exec.CommandContext(ctx, "docker", "login", req.Registry.URL,
            "-u", orbitUser,
            "--password-stdin")
        cmd.Stdin = strings.NewReader(orbitPass)
```

**Step 3: Verify build**

Run: `cd services/build-service && go build ./...`
Expected: No errors

**Step 4: Commit**

```bash
git add services/build-service/
git commit -m "feat: add Orbit registry type support to builder"
```

---

## Task 6: Update Build Service gRPC Server

**Files:**
- Modify: `services/build-service/internal/grpc/build/server.go`

**Step 1: Add Orbit registry type conversion**

Find the registry type switch in `BuildImage` function (around line 179-192) and add:

```go
        case buildv1.RegistryType_REGISTRY_TYPE_ORBIT:
            buildReq.Registry.Type = builder.RegistryTypeOrbit
```

**Step 2: Verify build**

Run: `cd services/build-service && go build ./...`
Expected: No errors

**Step 3: Commit**

```bash
git add services/build-service/
git commit -m "feat: handle Orbit registry type in build service gRPC"
```

---

## Task 7: Update Temporal Build Activities

**Files:**
- Modify: `temporal-workflows/internal/activities/build_activities.go`

**Step 1: Add Orbit case to registry type conversion**

Find the registry type switch in `BuildAndPushImage` (around line 233-241) and add:

```go
    case "orbit":
        registryType = buildv1.RegistryType_REGISTRY_TYPE_ORBIT
```

**Step 2: Verify build**

Run: `cd temporal-workflows && go build ./...`
Expected: No errors

**Step 3: Commit**

```bash
git add temporal-workflows/
git commit -m "feat: add Orbit registry type to temporal activities"
```

---

## Task 8: Add Orbit Type to RegistryConfigs Collection

**Files:**
- Modify: `orbit-www/src/collections/RegistryConfigs.ts`

**Step 1: Add 'orbit' to type options**

Find the `type` field (around line 131-138) and update options:

```typescript
    {
      name: 'type',
      type: 'select',
      required: true,
      options: [
        { label: 'Orbit Registry', value: 'orbit' },
        { label: 'GitHub Container Registry', value: 'ghcr' },
        { label: 'Azure Container Registry', value: 'acr' },
      ],
      defaultValue: 'orbit',
      admin: {
        description: 'Container registry type. Orbit Registry requires no configuration.',
      },
    },
```

**Step 2: Update conditional fields**

Update ghcrOwner condition (around line 148-156):

```typescript
    {
      name: 'ghcrOwner',
      type: 'text',
      admin: {
        condition: (data) => data?.type === 'ghcr',
        description: 'GitHub username or organization name',
      },
    },
```

**Step 3: Verify TypeScript compiles**

Run: `cd orbit-www && bunx tsc --noEmit`
Expected: No errors (or only pre-existing errors)

**Step 4: Commit**

```bash
git add orbit-www/src/collections/
git commit -m "feat: add Orbit registry type to RegistryConfigs collection"
```

---

## Task 9: Add Workspace Registry Settings

**Files:**
- Modify: `orbit-www/src/collections/Workspaces.ts`

**Step 1: Add registry settings to workspace settings group**

Find the `settings` group (around line 99-113) and add fields:

```typescript
    {
      name: 'settings',
      type: 'group',
      fields: [
        { name: 'customization', type: 'json' },
        {
          name: 'allowOrbitRegistry',
          type: 'checkbox',
          defaultValue: true,
          admin: {
            description: 'Allow Orbit-hosted registry as fallback when no registry is configured',
          },
        },
        {
          name: 'registryQuotaBytes',
          type: 'number',
          defaultValue: 10737418240, // 10GB
          admin: {
            description: 'Maximum storage quota for Orbit-hosted registry (bytes)',
            hidden: true, // Admin-only, managed by system
          },
        },
      ],
    },
```

**Step 2: Verify TypeScript compiles**

Run: `cd orbit-www && bunx tsc --noEmit`
Expected: No errors (or only pre-existing errors)

**Step 3: Commit**

```bash
git add orbit-www/src/collections/
git commit -m "feat: add workspace registry settings (allowOrbitRegistry, quota)"
```

---

## Task 10: Create RegistryImages Collection

**Files:**
- Create: `orbit-www/src/collections/RegistryImages.ts`
- Modify: `orbit-www/src/payload.config.ts`

**Step 1: Create RegistryImages collection**

Create `orbit-www/src/collections/RegistryImages.ts`:

```typescript
import type { CollectionConfig } from 'payload'

export const RegistryImages: CollectionConfig = {
  slug: 'registry-images',
  admin: {
    useAsTitle: 'tag',
    group: 'System',
    defaultColumns: ['app', 'tag', 'sizeBytes', 'pushedAt'],
    hidden: true, // Internal collection, not shown in admin
  },
  access: {
    // Only system/admin can manage registry images
    read: ({ req: { user } }) => {
      if (!user) return false
      return { workspace: { in: user.workspaces?.map((w: { workspace: string | { id: string } }) =>
        typeof w.workspace === 'string' ? w.workspace : w.workspace.id
      ) || [] } }
    },
    create: () => false, // Only created by system
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
    },
    {
      name: 'app',
      type: 'relationship',
      relationTo: 'apps',
      required: true,
      index: true,
    },
    {
      name: 'tag',
      type: 'text',
      required: true,
      index: true,
    },
    {
      name: 'digest',
      type: 'text',
      required: true,
      admin: {
        description: 'SHA256 digest of the image manifest',
      },
    },
    {
      name: 'sizeBytes',
      type: 'number',
      required: true,
      admin: {
        description: 'Image size in bytes',
      },
    },
    {
      name: 'pushedAt',
      type: 'date',
      required: true,
      index: true,
      admin: {
        description: 'When the image was pushed to registry',
      },
    },
  ],
  indexes: [
    {
      name: 'workspace_pushedAt',
      fields: ['workspace', 'pushedAt'],
    },
    {
      name: 'workspace_app_tag',
      fields: ['workspace', 'app', 'tag'],
      unique: true,
    },
  ],
}
```

**Step 2: Register collection in payload.config.ts**

Add import at top of `orbit-www/src/payload.config.ts`:

```typescript
import { RegistryImages } from './collections/RegistryImages'
```

Add to collections array (find the collections array and add):

```typescript
    RegistryImages,
```

**Step 3: Verify TypeScript compiles**

Run: `cd orbit-www && bunx tsc --noEmit`
Expected: No errors (or only pre-existing errors)

**Step 4: Commit**

```bash
git add orbit-www/src/collections/RegistryImages.ts orbit-www/src/payload.config.ts
git commit -m "feat: add RegistryImages collection for tracking Orbit registry usage"
```

---

## Task 11: Update builds.ts with Orbit Registry Fallback

**Files:**
- Modify: `orbit-www/src/app/actions/builds.ts`

**Step 1: Add Orbit registry URL constant**

Add near the top of the file (after imports):

```typescript
const ORBIT_REGISTRY_URL = process.env.ORBIT_REGISTRY_URL || 'localhost:5050'
```

**Step 2: Update registry selection logic**

Find the registry selection logic (around lines 66-94) and replace with:

```typescript
  // Get registry config (app-specific or workspace default, or Orbit fallback)
  let registryConfig = null
  let useOrbitRegistry = false

  if (app.registryConfig) {
    // App has specific registry - fetch it
    registryConfig =
      typeof app.registryConfig === 'string'
        ? await payload.findByID({ collection: 'registry-configs', id: app.registryConfig })
        : app.registryConfig
  } else {
    // Find workspace default
    const defaults = await payload.find({
      collection: 'registry-configs',
      where: {
        and: [{ workspace: { equals: workspaceId } }, { isDefault: { equals: true } }],
      },
      limit: 1,
    })
    if (defaults.docs.length > 0) {
      registryConfig = defaults.docs[0]
    }
  }

  // If no registry configured, check if Orbit registry is allowed
  if (!registryConfig) {
    const workspaceData = await payload.findByID({
      collection: 'workspaces',
      id: workspaceId,
    })

    const allowOrbitRegistry = workspaceData?.settings?.allowOrbitRegistry !== false

    if (allowOrbitRegistry) {
      useOrbitRegistry = true
      console.log('[Build] No registry configured, using Orbit-hosted registry')
    } else {
      return {
        success: false,
        error:
          'No container registry configured and Orbit registry is disabled. Please configure a registry in workspace settings.',
      }
    }
  }
```

**Step 3: Update registry URL/path construction**

Find the registry type branching (around lines 162-173) and update:

```typescript
  // Build registry URL and repository path
  let registryUrl: string
  let repositoryPath: string
  let registryUsername: string | undefined
  let registryToken: string

  if (useOrbitRegistry) {
    // Orbit-hosted registry
    registryUrl = ORBIT_REGISTRY_URL
    const workspaceData = await payload.findByID({ collection: 'workspaces', id: workspaceId })
    const workspaceSlug = workspaceData?.slug || workspaceId
    repositoryPath = `${workspaceSlug}/${app.name.toLowerCase().replace(/\s+/g, '-')}`
    registryToken = process.env.ORBIT_REGISTRY_TOKEN || 'orbit-registry-token'
    console.log('[Build] Using Orbit registry:', { registryUrl, repositoryPath })
  } else if (registryConfig.type === 'ghcr') {
    registryUrl = 'ghcr.io'
    repositoryPath = `${registryConfig.ghcrOwner}/${app.name.toLowerCase().replace(/\s+/g, '-')}`
    registryToken = githubToken
  } else if (registryConfig.type === 'acr') {
    registryUrl = registryConfig.acrLoginServer || ''
    repositoryPath = app.name.toLowerCase().replace(/\s+/g, '-')
    registryUsername = registryConfig.acrUsername || undefined
    registryToken = registryConfig.acrToken || ''
  } else if (registryConfig.type === 'orbit') {
    // Explicit Orbit registry config (user selected it)
    registryUrl = ORBIT_REGISTRY_URL
    const workspaceData = await payload.findByID({ collection: 'workspaces', id: workspaceId })
    const workspaceSlug = workspaceData?.slug || workspaceId
    repositoryPath = `${workspaceSlug}/${app.name.toLowerCase().replace(/\s+/g, '-')}`
    registryToken = process.env.ORBIT_REGISTRY_TOKEN || 'orbit-registry-token'
  } else {
    return { success: false, error: `Unsupported registry type: ${registryConfig.type}` }
  }
```

**Step 4: Update startBuildWorkflow call registry type**

Find where the registry type is set for the workflow and update to handle orbit:

```typescript
  const registryType = useOrbitRegistry ? 'orbit' : registryConfig.type
```

**Step 5: Verify TypeScript compiles**

Run: `cd orbit-www && bunx tsc --noEmit`
Expected: No errors (or only pre-existing errors)

**Step 6: Commit**

```bash
git add orbit-www/src/app/actions/
git commit -m "feat: add Orbit registry fallback to build action"
```

---

## Task 12: Add Environment Variables to Build Service

**Files:**
- Modify: `docker-compose.yml`

**Step 1: Add registry environment variables to build-service**

Find the build-service environment section and add:

```yaml
      - ORBIT_REGISTRY_URL=orbit-registry:5000
      - ORBIT_REGISTRY_USER=orbit-service
      - ORBIT_REGISTRY_PASS=orbit-registry-token
```

**Step 2: Add depends_on for orbit-registry**

Update build-service depends_on to include orbit-registry:

```yaml
    depends_on:
      - temporal-server
      - buildkit
      - orbit-registry
```

**Step 3: Verify syntax**

Run: `docker compose config --quiet && echo "Valid"`
Expected: `Valid`

**Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add Orbit registry env vars to build-service"
```

---

## Task 13: Add Environment Variables to Orbit WWW

**Files:**
- Modify: `docker-compose.yml`
- Modify: `orbit-www/.env.example` (if exists)

**Step 1: Add registry URL to orbit-www environment**

Find the orbit-www service environment section and add:

```yaml
      - ORBIT_REGISTRY_URL=orbit-registry:5000
      - ORBIT_REGISTRY_TOKEN=orbit-registry-token
```

**Step 2: Update .env.example if it exists**

Add to orbit-www/.env.example (or create section in existing .env):

```
# Orbit Registry
ORBIT_REGISTRY_URL=localhost:5050
ORBIT_REGISTRY_TOKEN=orbit-registry-token
```

**Step 3: Commit**

```bash
git add docker-compose.yml orbit-www/.env.example 2>/dev/null || git add docker-compose.yml
git commit -m "feat: add Orbit registry env vars to orbit-www"
```

---

## Task 14: Integration Test - Start Services

**Step 1: Start all services**

Run: `docker compose up -d minio minio-init orbit-registry`
Expected: All services start successfully

**Step 2: Verify MinIO is accessible**

Run: `curl -s http://localhost:9000/minio/health/live`
Expected: Returns OK or healthy status

**Step 3: Verify registry is accessible**

Run: `curl -s http://localhost:5050/v2/`
Expected: `{}` (empty JSON, registry is responding)

**Step 4: Verify bucket was created**

Run: `docker compose logs minio-init | grep "ready"`
Expected: Shows "MinIO bucket 'orbit-registry' ready"

---

## Task 15: Integration Test - Build with Orbit Registry

**Step 1: Rebuild services with new code**

Run: `docker compose build build-service temporal-worker`
Expected: Builds complete successfully

**Step 2: Restart services**

Run: `docker compose up -d`
Expected: All services start

**Step 3: Test a build (manual)**

Trigger a build from the UI for an app without a registry configured.
Expected: Build should use Orbit registry and push successfully

**Step 4: Verify image in registry**

Run: `curl -s http://localhost:5050/v2/_catalog`
Expected: Shows the pushed image repository

---

## Task 16: Final Verification and Documentation

**Step 1: Run all Go tests**

Run: `make test-go`
Expected: No new failures (same baseline as before)

**Step 2: Run frontend type check**

Run: `cd orbit-www && bunx tsc --noEmit`
Expected: No new errors

**Step 3: Update CLAUDE.md ports section**

Add to the ports section:

```
  - 5050: Orbit Container Registry
  - 9000: MinIO API
  - 9001: MinIO Console
```

**Step 4: Final commit**

```bash
git add .
git commit -m "docs: update ports documentation for Orbit registry"
```

---

## Summary

After completing all tasks, you will have:

1. ✅ MinIO running with `orbit-registry` bucket
2. ✅ Docker Registry running with S3 backend
3. ✅ `REGISTRY_TYPE_ORBIT` in protobuf and all services
4. ✅ `orbit` type in RegistryConfigs collection
5. ✅ Workspace settings for `allowOrbitRegistry`
6. ✅ `RegistryImages` collection for tracking
7. ✅ Automatic fallback to Orbit registry in builds
8. ✅ Build service can push to Orbit registry

**Next Phase:** Implement quota management and auto-cleanup (Phase 2)
