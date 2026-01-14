# Environment Variables Design

**Date:** 2025-12-17
**Status:** Draft
**Author:** Claude + Drew

## Problem Statement

Build-time environment variables (like `TURSO_DATABASE_URL`) are required for many applications during the container build process (e.g., Next.js static generation). Currently, there's no way for users to configure these variables in Orbit, causing builds to fail.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | Unified system for build + runtime | Avoids duplication, provides foundation for deployments |
| Security | Encrypted at rest, basic access control | Self-contained, adequate for most teams, can enhance later |
| Organization | Workspace-level with app overrides | Reduces duplication while keeping simple mental model |
| Usage flags | Explicit checkboxes per variable | Security principle: explicit > implicit |
| UI location | Workspace settings + app detail page | Follows existing patterns |
| Value display | Always masked, reveal on click | Industry standard (GitHub, Vercel, etc.) |

## Data Model

### New Collection: `EnvironmentVariables`

```typescript
{
  name: string           // Variable name, e.g., "TURSO_DATABASE_URL"
  value: string          // Encrypted using existing lib/encryption
  workspace: Workspace   // Required - which workspace owns this
  app?: App              // Optional - if set, this is an app-level override
  useInBuilds: boolean   // Default: true - include in Railpack builds
  useInDeployments: boolean  // Default: true - include in K8s deployments
  description?: string   // Optional help text for team members
  createdBy: User        // Who created this variable
  updatedAt: timestamp   // Last modification time
}
```

**Key behaviors:**
- Workspace-level variable: `app` field is null
- App-level override: `app` field is set, `name` matches a workspace variable
- App-specific variable: `app` field is set, `name` doesn't exist at workspace level
- Unique constraint: `(workspace, app, name)` - can't have duplicate names at same scope

## Variable Resolution & Inheritance

When a build or deployment runs, variables are resolved for an app:

```
1. Start with workspace-level variables (where app = null)
2. Apply app-level overrides (where app = targetApp)
3. Filter by usage flag (useInBuilds OR useInDeployments)
4. Return final key-value map
```

**Example:**

```
Workspace variables:
  TURSO_DATABASE_URL = "libsql://prod.turso.io" (builds: ✓, deployments: ✓)
  NODE_ENV = "production" (builds: ✗, deployments: ✓)

App "cfb-stats" overrides:
  TURSO_DATABASE_URL = "libsql://cfb.turso.io" (builds: ✓, deployments: ✓)

Resolved for cfb-stats build:
  TURSO_DATABASE_URL = "libsql://cfb.turso.io"  ← app override wins

Resolved for cfb-stats deployment:
  TURSO_DATABASE_URL = "libsql://cfb.turso.io"  ← app override wins
  NODE_ENV = "production"                        ← inherited from workspace
```

**Access control:**
- Any active workspace member can view variable names and metadata
- Only workspace owners/admins can view, create, edit, or delete values
- Values are masked in API responses unless explicitly requested with proper permissions

## UI Design

### Workspace Settings → Environment Variables Tab

```
┌─────────────────────────────────────────────────────────────────┐
│ Environment Variables                          [+ Add Variable] │
├─────────────────────────────────────────────────────────────────┤
│ NAME                    VALUE          BUILDS  DEPLOY  ACTIONS  │
│ ─────────────────────────────────────────────────────────────── │
│ TURSO_DATABASE_URL      ••••••••••     ✓       ✓       ✎ 🗑     │
│ NEXT_PUBLIC_API_URL     ••••••••••     ✓       ✓       ✎ 🗑     │
│ ANALYTICS_KEY           ••••••••••     ✓       ✓       ✎ 🗑     │
└─────────────────────────────────────────────────────────────────┘
```

### App Detail Page → Environment Variables Section

```
┌─────────────────────────────────────────────────────────────────┐
│ Environment Variables                          [+ Add Override] │
├─────────────────────────────────────────────────────────────────┤
│ NAME                    VALUE          SOURCE      ACTIONS      │
│ ─────────────────────────────────────────────────────────────── │
│ TURSO_DATABASE_URL      ••••••••••     App         ✎ 🗑         │
│ NEXT_PUBLIC_API_URL     ••••••••••     Workspace   [Override]   │
│ ANALYTICS_KEY           ••••••••••     Workspace   [Override]   │
└─────────────────────────────────────────────────────────────────┘

  ℹ Workspace variables are inherited. Click [Override] to set an
    app-specific value.
```

### Add/Edit Variable Modal (Single)

```
┌─────────────────────────────────────────────────┐
│ Add Environment Variable                    ✕   │
├─────────────────────────────────────────────────┤
│ Name                                            │
│ ┌─────────────────────────────────────────────┐ │
│ │ TURSO_DATABASE_URL                          │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ Value                                      👁   │
│ ┌─────────────────────────────────────────────┐ │
│ │ ••••••••••••••••••••••                      │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ Description (optional)                          │
│ ┌─────────────────────────────────────────────┐ │
│ │ Turso database connection string            │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ Use in:                                         │
│ ☑ Builds    ☑ Deployments                       │
│                                                 │
│                        [Cancel]  [Save Variable]│
└─────────────────────────────────────────────────┘
```

### Bulk Import Modal

```
┌─────────────────────────────────────────────────────────────────┐
│ Add Environment Variables                                    ✕  │
├─────────────────────────────────────────────────────────────────┤
│  [Single Variable]    [Bulk Import]                             │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  Paste your .env file contents:                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ TURSO_DATABASE_URL=libsql://cfb.turso.io                    ││
│  │ NEXT_PUBLIC_API_URL=https://api.example.com                 ││
│  │ ANALYTICS_KEY=UA-12345678                                   ││
│  │ # Comments are ignored                                      ││
│  │ NODE_ENV=production                                         ││
│  │                                                             ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  Preview (4 variables detected):                                │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ ✓ TURSO_DATABASE_URL      libsql://cfb...   Builds Deploy  ││
│  │ ✓ NEXT_PUBLIC_API_URL     https://api...    Builds Deploy  ││
│  │ ✓ ANALYTICS_KEY           UA-1234...        Builds Deploy  ││
│  │ ✓ NODE_ENV                production        Builds Deploy  ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  Default settings for imported variables:                       │
│  ☑ Use in Builds    ☑ Use in Deployments                        │
│                                                                 │
│                              [Cancel]  [Import 4 Variables]     │
└─────────────────────────────────────────────────────────────────┘
```

**Parser supports:**
- Standard `.env` format: `KEY=value`
- Quoted values: `KEY="value with spaces"` or `KEY='value'`
- Comments: `# ignored`
- Empty lines: ignored
- Export prefix: `export KEY=value` (strips `export`)

## Encryption

Reuses existing encryption infrastructure at `lib/encryption/index.ts`:

- Algorithm: AES-256-GCM
- Key: `ENCRYPTION_KEY` environment variable (already configured)
- Format: `iv:authTag:encryptedData` (hex encoded)

**Collection hook for auto-encryption:**
```typescript
hooks: {
  beforeChange: [
    ({ data }) => {
      // Encrypt value if not already encrypted
      if (data.value && !data.value.includes(':')) {
        data.value = encrypt(data.value)
      }
      return data
    }
  ]
}
```

## Backend Integration

### Resolution Function

```typescript
async function resolveEnvironmentVariables(
  appId: string,
  usage: 'build' | 'deployment'
): Promise<Record<string, string>> {
  const app = await getApp(appId)

  // 1. Get workspace-level vars
  const workspaceVars = await payload.find({
    collection: 'environment-variables',
    where: {
      workspace: { equals: app.workspace },
      app: { exists: false },
      [usage === 'build' ? 'useInBuilds' : 'useInDeployments']: { equals: true }
    }
  })

  // 2. Get app-level overrides
  const appVars = await payload.find({
    collection: 'environment-variables',
    where: {
      app: { equals: appId },
      [usage === 'build' ? 'useInBuilds' : 'useInDeployments']: { equals: true }
    }
  })

  // 3. Merge (app overrides workspace)
  const result: Record<string, string> = {}
  for (const v of workspaceVars.docs) {
    result[v.name] = decrypt(v.value)
  }
  for (const v of appVars.docs) {
    result[v.name] = decrypt(v.value)
  }

  return result
}
```

### Build Flow Integration

```typescript
export async function startBuild({ appId }: StartBuildInput) {
  // ... existing validation ...

  // NEW: Resolve build environment variables
  const buildEnv = await resolveEnvironmentVariables(appId, 'build')

  // Start workflow with buildEnv included
  await buildClient.startBuildWorkflow({
    appId,
    // ... other params ...
    buildEnv,  // ← Now populated!
  })
}
```

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `orbit-www/src/collections/EnvironmentVariables.ts` | Payload collection definition |
| `orbit-www/src/components/features/env-vars/EnvironmentVariablesTable.tsx` | List/table component |
| `orbit-www/src/components/features/env-vars/EnvironmentVariableModal.tsx` | Add/edit single variable |
| `orbit-www/src/components/features/env-vars/BulkImportModal.tsx` | Paste .env import |
| `orbit-www/src/lib/env-parser.ts` | Parse .env format |
| `orbit-www/src/app/actions/environment-variables.ts` | Server actions (CRUD + resolve) |

### Modified Files

| File | Change |
|------|--------|
| `orbit-www/src/payload.config.ts` | Register EnvironmentVariables collection |
| `orbit-www/src/app/(dashboard)/settings/page.tsx` | Add Environment Variables tab |
| `orbit-www/src/app/actions/builds.ts` | Call `resolveEnvironmentVariables` before build |
| `orbit-www/src/components/features/apps/AppDetailPage.tsx` | Add env vars section |

## Implementation Phases

1. **Phase 1: Core collection & encryption** - Create collection with hooks, verify encryption works
2. **Phase 2: Workspace settings UI** - Table, add/edit modal, bulk import
3. **Phase 3: App-level overrides UI** - Inherited vars display, override functionality
4. **Phase 4: Build integration** - Wire up `resolveEnvironmentVariables` to build flow
5. **Phase 5: Testing** - E2E test with cfb-stats app (verify TURSO_DATABASE_URL works)

## Security Considerations

- Values encrypted at rest using AES-256-GCM
- Values never returned in standard API responses (access control on field)
- Only workspace owners/admins can manage variables
- Decryption only happens at build/deployment time
- Audit trail via `createdBy` and `updatedAt` fields

## Future Enhancements (Out of Scope)

- External secrets manager integration (Vault, AWS Secrets Manager)
- Key rotation support
- Environment groupings (dev/staging/prod)
- Variable references (`${OTHER_VAR}` expansion)
- Secret scanning/validation
