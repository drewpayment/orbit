# GitOps Manifest Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable bidirectional sync between Orbit's app database and a `.orbit.yaml` manifest file in the app's linked GitHub repository.

**Architecture:** Payload CMS collection fields + afterChange hook for outbound sync, GitHub webhook route for inbound sync, YAML parser/serializer library, and React UI components for export, status, and conflict resolution.

**Tech Stack:** Payload 3.0, Next.js 15, TypeScript, `yaml` package (already installed), Octokit (already installed), Vitest

**Design Doc:** `docs/plans/2026-02-14-gitops-manifest-sync-design.md`

---

## Task 1: App Manifest Parser & Serializer

**Files:**
- Create: `orbit-www/src/lib/app-manifest.ts`
- Create: `orbit-www/src/lib/app-manifest.test.ts`
- Reference: `orbit-www/src/lib/template-manifest.ts` (parseManifest pattern, lines 55–156)
- Reference: `orbit-www/src/collections/Apps.ts` (healthConfig lines 266–313, buildConfig lines 316–368)

This is the foundation — every other task depends on it. Build the YAML ↔ DB field mapping layer.

**Step 1: Write the failing tests**

Create `orbit-www/src/lib/app-manifest.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  parseAppManifest,
  serializeAppManifest,
  mapManifestToAppFields,
  mapAppFieldsToManifest,
  type AppManifest,
} from './app-manifest'

describe('parseAppManifest', () => {
  it('parses valid manifest YAML', () => {
    const yaml = `
apiVersion: orbit.dev/v1
kind: Application
metadata:
  name: my-service
  description: A test service
health:
  endpoint: /health
  interval: 60
  timeout: 5
  method: GET
  expectedStatus: 200
build:
  language: typescript
  languageVersion: "20"
  framework: nextjs
  buildCommand: npm run build
  startCommand: npm start
  dockerfilePath: Dockerfile
`
    const { manifest, errors } = parseAppManifest(yaml)
    expect(errors).toHaveLength(0)
    expect(manifest).not.toBeNull()
    expect(manifest!.metadata.name).toBe('my-service')
    expect(manifest!.health?.endpoint).toBe('/health')
    expect(manifest!.build?.language).toBe('typescript')
  })

  it('returns errors for invalid YAML syntax', () => {
    const { manifest, errors } = parseAppManifest('{{invalid yaml')
    expect(manifest).toBeNull()
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0].message).toContain('Invalid YAML')
  })

  it('returns errors for wrong apiVersion', () => {
    const yaml = `
apiVersion: wrong/v1
kind: Application
metadata:
  name: test
`
    const { errors } = parseAppManifest(yaml)
    expect(errors.some(e => e.message.includes('apiVersion'))).toBe(true)
  })

  it('returns errors for wrong kind', () => {
    const yaml = `
apiVersion: orbit.dev/v1
kind: Template
metadata:
  name: test
`
    const { errors } = parseAppManifest(yaml)
    expect(errors.some(e => e.message.includes('kind'))).toBe(true)
  })

  it('returns errors for missing metadata.name', () => {
    const yaml = `
apiVersion: orbit.dev/v1
kind: Application
metadata:
  description: no name
`
    const { errors } = parseAppManifest(yaml)
    expect(errors.some(e => e.path === 'metadata.name')).toBe(true)
  })

  it('parses manifest with only required fields', () => {
    const yaml = `
apiVersion: orbit.dev/v1
kind: Application
metadata:
  name: minimal
`
    const { manifest, errors } = parseAppManifest(yaml)
    expect(errors).toHaveLength(0)
    expect(manifest).not.toBeNull()
    expect(manifest!.metadata.name).toBe('minimal')
    expect(manifest!.health).toBeUndefined()
    expect(manifest!.build).toBeUndefined()
  })
})

describe('serializeAppManifest', () => {
  it('serializes app fields to valid YAML', () => {
    const fields = {
      name: 'my-service',
      description: 'A test service',
      healthConfig: {
        url: '/health',
        interval: 60,
        timeout: 5,
        method: 'GET',
        expectedStatus: 200,
      },
      buildConfig: {
        language: 'typescript',
        languageVersion: '20',
        framework: 'nextjs',
        buildCommand: 'npm run build',
        startCommand: 'npm start',
        dockerfilePath: 'Dockerfile',
      },
    }
    const yaml = serializeAppManifest(fields)
    expect(yaml).toContain('apiVersion: orbit.dev/v1')
    expect(yaml).toContain('kind: Application')
    expect(yaml).toContain('name: my-service')
    // Round-trip: parse what we serialized
    const { manifest, errors } = parseAppManifest(yaml)
    expect(errors).toHaveLength(0)
    expect(manifest!.metadata.name).toBe('my-service')
  })

  it('omits empty optional sections', () => {
    const fields = { name: 'minimal' }
    const yaml = serializeAppManifest(fields)
    expect(yaml).toContain('name: minimal')
    expect(yaml).not.toContain('health:')
    expect(yaml).not.toContain('build:')
  })
})

describe('mapManifestToAppFields', () => {
  it('maps manifest to Payload update data', () => {
    const manifest: AppManifest = {
      apiVersion: 'orbit.dev/v1',
      kind: 'Application',
      metadata: { name: 'test', description: 'desc' },
      health: { endpoint: '/health', interval: 30, timeout: 10, method: 'POST', expectedStatus: 201 },
      build: { language: 'go', languageVersion: '1.21', framework: 'fiber', buildCommand: 'go build', startCommand: './app', dockerfilePath: 'Dockerfile.prod' },
    }
    const fields = mapManifestToAppFields(manifest)
    expect(fields.name).toBe('test')
    expect(fields.description).toBe('desc')
    expect(fields.healthConfig?.url).toBe('/health')
    expect(fields.healthConfig?.interval).toBe(30)
    expect(fields.buildConfig?.language).toBe('go')
    expect(fields.buildConfig?.buildCommand).toBe('go build')
  })
})

describe('mapAppFieldsToManifest', () => {
  it('maps Payload app fields to manifest structure', () => {
    const fields = {
      name: 'test',
      description: 'desc',
      healthConfig: { url: '/health', interval: 30, timeout: 10, method: 'POST', expectedStatus: 201 },
      buildConfig: { language: 'go', languageVersion: '1.21', framework: 'fiber', buildCommand: 'go build', startCommand: './app', dockerfilePath: 'Dockerfile.prod' },
    }
    const manifest = mapAppFieldsToManifest(fields)
    expect(manifest.apiVersion).toBe('orbit.dev/v1')
    expect(manifest.kind).toBe('Application')
    expect(manifest.metadata.name).toBe('test')
    expect(manifest.health?.endpoint).toBe('/health')
    expect(manifest.build?.language).toBe('go')
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `cd orbit-www && npx vitest run src/lib/app-manifest.test.ts`
Expected: FAIL — module `./app-manifest` not found

**Step 3: Implement the manifest library**

Create `orbit-www/src/lib/app-manifest.ts`:

```typescript
import * as yaml from 'yaml'

// --- Types ---

export interface AppManifest {
  apiVersion: 'orbit.dev/v1'
  kind: 'Application'
  metadata: {
    name: string
    description?: string
  }
  health?: {
    endpoint?: string
    interval?: number
    timeout?: number
    method?: string
    expectedStatus?: number
  }
  build?: {
    language?: string
    languageVersion?: string
    framework?: string
    buildCommand?: string
    startCommand?: string
    dockerfilePath?: string
  }
}

export interface ManifestValidationError {
  path: string
  message: string
}

/** Payload App DB fields relevant to manifest sync */
export interface AppSyncFields {
  name: string
  description?: string | null
  healthConfig?: {
    url?: string | null
    interval?: number | null
    timeout?: number | null
    method?: string | null
    expectedStatus?: number | null
  } | null
  buildConfig?: {
    language?: string | null
    languageVersion?: string | null
    framework?: string | null
    buildCommand?: string | null
    startCommand?: string | null
    dockerfilePath?: string | null
  } | null
}

// --- Parsing ---

export function parseAppManifest(content: string): {
  manifest: AppManifest | null
  errors: ManifestValidationError[]
} {
  const errors: ManifestValidationError[] = []

  let parsed: unknown
  try {
    parsed = yaml.parse(content)
  } catch (e) {
    return {
      manifest: null,
      errors: [{ path: '', message: `Invalid YAML: ${(e as Error).message}` }],
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return { manifest: null, errors: [{ path: '', message: 'Manifest must be a YAML object' }] }
  }

  const doc = parsed as Record<string, unknown>

  if (doc.apiVersion !== 'orbit.dev/v1') {
    errors.push({ path: 'apiVersion', message: "apiVersion must be 'orbit.dev/v1'" })
  }

  if (doc.kind !== 'Application') {
    errors.push({ path: 'kind', message: "kind must be 'Application'" })
  }

  const metadata = doc.metadata as Record<string, unknown> | undefined
  if (!metadata || typeof metadata !== 'object') {
    errors.push({ path: 'metadata', message: 'metadata is required and must be an object' })
  } else if (!metadata.name || typeof metadata.name !== 'string') {
    errors.push({ path: 'metadata.name', message: 'metadata.name is required and must be a string' })
  }

  if (errors.length > 0) {
    return { manifest: null, errors }
  }

  const manifest: AppManifest = {
    apiVersion: 'orbit.dev/v1',
    kind: 'Application',
    metadata: {
      name: (metadata as Record<string, unknown>).name as string,
      description: (metadata as Record<string, unknown>).description as string | undefined,
    },
  }

  if (doc.health && typeof doc.health === 'object') {
    const h = doc.health as Record<string, unknown>
    manifest.health = {
      endpoint: h.endpoint as string | undefined,
      interval: h.interval as number | undefined,
      timeout: h.timeout as number | undefined,
      method: h.method as string | undefined,
      expectedStatus: h.expectedStatus as number | undefined,
    }
  }

  if (doc.build && typeof doc.build === 'object') {
    const b = doc.build as Record<string, unknown>
    manifest.build = {
      language: b.language as string | undefined,
      languageVersion: b.languageVersion as string | undefined,
      framework: b.framework as string | undefined,
      buildCommand: b.buildCommand as string | undefined,
      startCommand: b.startCommand as string | undefined,
      dockerfilePath: b.dockerfilePath as string | undefined,
    }
  }

  return { manifest, errors: [] }
}

// --- Serialization ---

export function serializeAppManifest(fields: Partial<AppSyncFields>): string {
  const manifest = mapAppFieldsToManifest(fields)
  return yaml.stringify(manifest, { lineWidth: 0 })
}

// --- Mappers ---

export function mapManifestToAppFields(manifest: AppManifest): Partial<AppSyncFields> {
  const fields: Partial<AppSyncFields> = {
    name: manifest.metadata.name,
  }

  if (manifest.metadata.description) {
    fields.description = manifest.metadata.description
  }

  if (manifest.health) {
    fields.healthConfig = {
      url: manifest.health.endpoint,
      interval: manifest.health.interval,
      timeout: manifest.health.timeout,
      method: manifest.health.method,
      expectedStatus: manifest.health.expectedStatus,
    }
  }

  if (manifest.build) {
    fields.buildConfig = {
      language: manifest.build.language,
      languageVersion: manifest.build.languageVersion,
      framework: manifest.build.framework,
      buildCommand: manifest.build.buildCommand,
      startCommand: manifest.build.startCommand,
      dockerfilePath: manifest.build.dockerfilePath,
    }
  }

  return fields
}

export function mapAppFieldsToManifest(fields: Partial<AppSyncFields>): AppManifest {
  const manifest: AppManifest = {
    apiVersion: 'orbit.dev/v1',
    kind: 'Application',
    metadata: {
      name: fields.name || '',
    },
  }

  if (fields.description) {
    manifest.metadata.description = fields.description
  }

  if (fields.healthConfig?.url) {
    manifest.health = {
      endpoint: fields.healthConfig.url ?? undefined,
      interval: fields.healthConfig.interval ?? undefined,
      timeout: fields.healthConfig.timeout ?? undefined,
      method: fields.healthConfig.method ?? undefined,
      expectedStatus: fields.healthConfig.expectedStatus ?? undefined,
    }
  }

  if (fields.buildConfig?.language) {
    manifest.build = {
      language: fields.buildConfig.language ?? undefined,
      languageVersion: fields.buildConfig.languageVersion ?? undefined,
      framework: fields.buildConfig.framework ?? undefined,
      buildCommand: fields.buildConfig.buildCommand ?? undefined,
      startCommand: fields.buildConfig.startCommand ?? undefined,
      dockerfilePath: fields.buildConfig.dockerfilePath ?? undefined,
    }
  }

  return manifest
}
```

**Step 4: Run tests to verify they pass**

Run: `cd orbit-www && npx vitest run src/lib/app-manifest.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add orbit-www/src/lib/app-manifest.ts orbit-www/src/lib/app-manifest.test.ts
git commit -m "feat(gitops): add .orbit.yaml manifest parser and serializer"
```

---

## Task 2: Update Apps Collection Schema

**Files:**
- Modify: `orbit-www/src/collections/Apps.ts` (lines 249–264, sync fields)
- Reference: Design doc Section 1 (field table)

Replace `syncMode` with the new sync control fields. No hooks yet — just the field definitions.

**Step 1: Write the failing test**

Add to `orbit-www/src/app/actions/__tests__/apps.test.ts` (or create inline verification):

This task is schema-only — verify by checking TypeScript compilation after field changes. No unit test needed for collection field definitions.

**Step 2: Modify Apps.ts — replace syncMode and add new fields**

In `orbit-www/src/collections/Apps.ts`, replace the `syncMode` field (lines 249–256) and keep `manifestSha` (lines 258–264). Add new fields after `manifestSha`:

```typescript
// Replace syncMode select with syncEnabled checkbox
{
  name: 'syncEnabled',
  type: 'checkbox',
  defaultValue: false,
  admin: {
    description: 'When enabled, app config syncs bidirectionally with .orbit.yaml in the linked repository',
  },
},
// manifestSha already exists — keep it as-is (lines 258-264)
{
  name: 'manifestPath',
  type: 'text',
  defaultValue: '.orbit.yaml',
  admin: {
    description: 'Path to the manifest file within the repository',
  },
},
{
  name: 'lastSyncAt',
  type: 'date',
  admin: {
    readOnly: true,
    description: 'Timestamp of last successful sync',
  },
},
{
  name: 'lastSyncDirection',
  type: 'select',
  options: [
    { label: 'Inbound (repo → Orbit)', value: 'inbound' },
    { label: 'Outbound (Orbit → repo)', value: 'outbound' },
  ],
  admin: {
    readOnly: true,
  },
},
{
  name: 'conflictDetected',
  type: 'checkbox',
  defaultValue: false,
  admin: {
    readOnly: true,
    description: 'Set when both sides changed since last sync',
  },
},
{
  name: 'conflictManifestContent',
  type: 'textarea',
  admin: {
    hidden: true,
    description: 'Stores incoming manifest YAML during a conflict',
  },
},
{
  name: 'webhookId',
  type: 'text',
  admin: {
    readOnly: true,
    hidden: true,
    description: 'GitHub webhook ID for cleanup',
  },
},
{
  name: 'webhookSecret',
  type: 'text',
  admin: {
    hidden: true,
    description: 'Per-app webhook secret (encrypted)',
  },
},
```

**Step 3: Verify TypeScript compiles**

Run: `cd orbit-www && npx tsc --noEmit 2>&1 | head -30`
Expected: No new errors (existing errors OK). If there are errors referencing `syncMode`, fix them in the next step.

**Step 4: Update creation paths in apps.ts**

In `orbit-www/src/app/actions/apps.ts`, replace `syncMode: 'orbit-primary'` with `syncEnabled: false` at:
- Line 68 (createAppFromTemplate)
- Line 141 (importRepository)
- Line 265 (createManualApp)

**Step 5: Verify TypeScript compiles again**

Run: `cd orbit-www && npx tsc --noEmit 2>&1 | head -30`
Expected: No new errors from our changes

**Step 6: Commit**

```bash
git add orbit-www/src/collections/Apps.ts orbit-www/src/app/actions/apps.ts
git commit -m "feat(gitops): replace syncMode with bidirectional sync fields on Apps collection"
```

---

## Task 3: Export Manifest Server Action

**Files:**
- Modify: `orbit-www/src/app/actions/apps.ts`
- Reference: `orbit-www/src/app/actions/templates.ts:982-1024` (webhook registration pattern)
- Reference: `orbit-www/src/lib/github-manifest.ts` (generateWebhookSecret, parseGitHubUrl)
- Reference: `orbit-www/src/lib/github/octokit.ts` (getInstallationOctokit)
- Reference: `orbit-www/src/lib/app-manifest.ts` (serializeAppManifest — from Task 1)

Implements the "Export to Repository" action: serialize DB → YAML, commit to repo, register webhook, enable sync.

**Step 1: Write the failing test**

Add to `orbit-www/src/app/actions/__tests__/apps.test.ts`:

```typescript
describe('exportAppManifest', () => {
  it('throws if user is not authenticated', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(null)
    const { exportAppManifest } = await import('../apps')
    await expect(exportAppManifest('app-id')).rejects.toThrow('Not authenticated')
  })

  it('throws if app has no repository', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({ session: mockSession, user: mockUser })
    vi.mocked(payload.findByID).mockResolvedValueOnce({
      id: 'app-id',
      name: 'test-app',
      repository: {},
    } as any)
    const { exportAppManifest } = await import('../apps')
    await expect(exportAppManifest('app-id')).rejects.toThrow('repository')
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `cd orbit-www && npx vitest run src/app/actions/__tests__/apps.test.ts`
Expected: FAIL — `exportAppManifest` not exported

**Step 3: Implement exportAppManifest**

Add to `orbit-www/src/app/actions/apps.ts`:

```typescript
import { serializeAppManifest } from '@/lib/app-manifest'
import { generateWebhookSecret, parseGitHubUrl } from '@/lib/github-manifest'
import { getInstallationOctokit } from '@/lib/github/octokit'

export async function exportAppManifest(appId: string): Promise<void> {
  'use server'

  const reqHeaders = await headers()
  const session = await auth.api.getSession({ headers: reqHeaders })
  if (!session) throw new Error('Not authenticated')

  const payload = await getPayload({ config })
  const app = await payload.findByID({ collection: 'apps', id: appId, depth: 0 })

  const repoUrl = app.repository?.url
  const installationId = app.repository?.installationId
  if (!repoUrl || !installationId) {
    throw new Error('App must have a linked repository with a GitHub installation to export a manifest')
  }

  const parsed = parseGitHubUrl(repoUrl)
  if (!parsed) throw new Error('Invalid repository URL')

  // Serialize current app state to YAML
  const yamlContent = serializeAppManifest({
    name: app.name,
    description: app.description,
    healthConfig: app.healthConfig,
    buildConfig: app.buildConfig,
  })

  // Get authenticated Octokit
  const octokit = await getInstallationOctokit(Number(installationId))

  const manifestPath = app.manifestPath || '.orbit.yaml'
  const branch = app.repository?.branch || 'main'

  // Check if file already exists (need SHA for update)
  let existingSha: string | undefined
  try {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner: parsed.owner,
      repo: parsed.repo,
      path: manifestPath,
      ref: branch,
    })
    if ('sha' in data) {
      existingSha = data.sha
    }
  } catch {
    // File doesn't exist yet — that's fine
  }

  // Commit the manifest
  const { data: commitData } = await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
    owner: parsed.owner,
    repo: parsed.repo,
    path: manifestPath,
    message: `chore: export .orbit.yaml from Orbit`,
    content: Buffer.from(yamlContent).toString('base64'),
    branch,
    ...(existingSha && { sha: existingSha }),
  })

  const commitSha = commitData.commit.sha

  // Register webhook
  const webhookSecret = generateWebhookSecret()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const webhookUrl = `${appUrl}/api/webhooks/github/app-sync`

  const { data: hook } = await octokit.request('POST /repos/{owner}/{repo}/hooks', {
    owner: parsed.owner,
    repo: parsed.repo,
    name: 'web',
    active: true,
    events: ['push'],
    config: {
      url: webhookUrl,
      content_type: 'json',
      secret: webhookSecret,
      insecure_ssl: '0',
    },
  })

  // Update app with sync state
  await payload.update({
    collection: 'apps',
    id: appId,
    data: {
      syncEnabled: true,
      manifestSha: commitSha,
      manifestPath,
      lastSyncAt: new Date().toISOString(),
      lastSyncDirection: 'outbound',
      webhookId: String(hook.id),
      webhookSecret,
    },
  })

  revalidatePath(`/apps/${appId}`)
}
```

**Step 4: Run tests to verify they pass**

Run: `cd orbit-www && npx vitest run src/app/actions/__tests__/apps.test.ts`
Expected: New tests PASS

**Step 5: Commit**

```bash
git add orbit-www/src/app/actions/apps.ts orbit-www/src/app/actions/__tests__/apps.test.ts
git commit -m "feat(gitops): add exportAppManifest server action"
```

---

## Task 4: Conflict Resolution & Disable Sync Server Actions

**Files:**
- Modify: `orbit-www/src/app/actions/apps.ts`
- Modify: `orbit-www/src/app/actions/__tests__/apps.test.ts`
- Reference: `orbit-www/src/lib/app-manifest.ts` (parseAppManifest, serializeAppManifest, mapManifestToAppFields)

**Step 1: Write the failing tests**

Add to `orbit-www/src/app/actions/__tests__/apps.test.ts`:

```typescript
describe('resolveManifestConflict', () => {
  it('throws if user is not authenticated', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(null)
    const { resolveManifestConflict } = await import('../apps')
    await expect(resolveManifestConflict('app-id', 'keep-orbit')).rejects.toThrow('Not authenticated')
  })
})

describe('disableManifestSync', () => {
  it('throws if user is not authenticated', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(null)
    const { disableManifestSync } = await import('../apps')
    await expect(disableManifestSync('app-id')).rejects.toThrow('Not authenticated')
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `cd orbit-www && npx vitest run src/app/actions/__tests__/apps.test.ts`
Expected: FAIL — functions not exported

**Step 3: Implement resolveManifestConflict**

Add to `orbit-www/src/app/actions/apps.ts`:

```typescript
export async function resolveManifestConflict(
  appId: string,
  resolution: 'keep-orbit' | 'keep-repo',
): Promise<void> {
  'use server'

  const reqHeaders = await headers()
  const session = await auth.api.getSession({ headers: reqHeaders })
  if (!session) throw new Error('Not authenticated')

  const payload = await getPayload({ config })
  const app = await payload.findByID({ collection: 'apps', id: appId, depth: 0 })

  if (!app.conflictDetected) {
    throw new Error('No conflict to resolve')
  }

  if (resolution === 'keep-orbit') {
    // Commit current Orbit state to repo, overwriting repo version
    const repoUrl = app.repository?.url
    const installationId = app.repository?.installationId
    if (!repoUrl || !installationId) throw new Error('Missing repository config')

    const parsed = parseGitHubUrl(repoUrl)
    if (!parsed) throw new Error('Invalid repository URL')

    const yamlContent = serializeAppManifest({
      name: app.name,
      description: app.description,
      healthConfig: app.healthConfig,
      buildConfig: app.buildConfig,
    })

    const octokit = await getInstallationOctokit(Number(installationId))
    const manifestPath = app.manifestPath || '.orbit.yaml'
    const branch = app.repository?.branch || 'main'

    // Get current file SHA for update
    let existingSha: string | undefined
    try {
      const { data } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
        owner: parsed.owner, repo: parsed.repo, path: manifestPath, ref: branch,
      })
      if ('sha' in data) existingSha = data.sha
    } catch { /* file might not exist */ }

    const { data: commitData } = await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
      owner: parsed.owner, repo: parsed.repo, path: manifestPath,
      message: 'chore: resolve manifest conflict — keep Orbit version',
      content: Buffer.from(yamlContent).toString('base64'),
      branch,
      ...(existingSha && { sha: existingSha }),
    })

    await payload.update({
      collection: 'apps',
      id: appId,
      data: {
        manifestSha: commitData.commit.sha,
        lastSyncAt: new Date().toISOString(),
        lastSyncDirection: 'outbound',
        conflictDetected: false,
        conflictManifestContent: null,
      },
    })
  } else {
    // Apply repo version to Orbit DB
    const { parseAppManifest, mapManifestToAppFields } = await import('@/lib/app-manifest')
    const { manifest, errors } = parseAppManifest(app.conflictManifestContent || '')
    if (!manifest || errors.length > 0) {
      throw new Error('Failed to parse conflict manifest content')
    }

    const fields = mapManifestToAppFields(manifest)
    await payload.update({
      collection: 'apps',
      id: appId,
      data: {
        ...fields,
        lastSyncAt: new Date().toISOString(),
        lastSyncDirection: 'inbound',
        conflictDetected: false,
        conflictManifestContent: null,
      },
      context: { _syncSource: 'conflict-resolution' },
    })
  }

  revalidatePath(`/apps/${appId}`)
}
```

**Step 4: Implement disableManifestSync**

Add to `orbit-www/src/app/actions/apps.ts`:

```typescript
export async function disableManifestSync(appId: string): Promise<void> {
  'use server'

  const reqHeaders = await headers()
  const session = await auth.api.getSession({ headers: reqHeaders })
  if (!session) throw new Error('Not authenticated')

  const payload = await getPayload({ config })
  const app = await payload.findByID({ collection: 'apps', id: appId, depth: 0 })

  // Delete webhook from GitHub if we have one
  if (app.webhookId && app.repository?.url && app.repository?.installationId) {
    try {
      const parsed = parseGitHubUrl(app.repository.url)
      if (parsed) {
        const octokit = await getInstallationOctokit(Number(app.repository.installationId))
        await octokit.request('DELETE /repos/{owner}/{repo}/hooks/{hook_id}', {
          owner: parsed.owner,
          repo: parsed.repo,
          hook_id: Number(app.webhookId),
        })
      }
    } catch (error) {
      console.error('Failed to delete webhook:', error)
      // Continue anyway — webhook might already be deleted
    }
  }

  await payload.update({
    collection: 'apps',
    id: appId,
    data: {
      syncEnabled: false,
      manifestSha: null,
      lastSyncAt: null,
      lastSyncDirection: null,
      conflictDetected: false,
      conflictManifestContent: null,
      webhookId: null,
      webhookSecret: null,
    },
  })

  revalidatePath(`/apps/${appId}`)
}
```

**Step 5: Run tests to verify they pass**

Run: `cd orbit-www && npx vitest run src/app/actions/__tests__/apps.test.ts`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add orbit-www/src/app/actions/apps.ts orbit-www/src/app/actions/__tests__/apps.test.ts
git commit -m "feat(gitops): add conflict resolution and disable sync server actions"
```

---

## Task 5: Inbound Webhook Handler (Repo → Orbit)

**Files:**
- Create: `orbit-www/src/app/api/webhooks/github/app-sync/route.ts`
- Reference: `orbit-www/src/app/api/webhooks/github/template-sync/route.ts` (full pattern, lines 148–273)
- Reference: `orbit-www/src/lib/github-manifest.ts` (fetchManifestContent)
- Reference: `orbit-www/src/lib/app-manifest.ts` (parseAppManifest, mapManifestToAppFields)

**Step 1: Implement the webhook handler**

Create `orbit-www/src/app/api/webhooks/github/app-sync/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { getPayload } from 'payload'
import config from '@payload-config'
import { parseAppManifest, mapManifestToAppFields } from '@/lib/app-manifest'
import { fetchManifestContent } from '@/lib/github-manifest'
import { createInstallationToken } from '@/lib/github/octokit'

export async function POST(request: NextRequest) {
  const signature = request.headers.get('X-Hub-Signature-256')
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
  }

  const event = request.headers.get('X-GitHub-Event')
  if (event !== 'push') {
    return NextResponse.json({ message: 'Event ignored' }, { status: 200 })
  }

  const body = await request.text()
  let payload_data: {
    ref: string
    after: string
    before: string
    repository: { full_name: string; default_branch: string }
    commits?: Array<{ added?: string[]; modified?: string[]; removed?: string[] }>
  }

  try {
    payload_data = JSON.parse(body)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Only process pushes to the default branch
  const defaultBranch = payload_data.repository.default_branch
  const pushBranch = payload_data.ref.replace('refs/heads/', '')
  if (pushBranch !== defaultBranch) {
    return NextResponse.json({ message: 'Not default branch' }, { status: 200 })
  }

  const repoFullName = payload_data.repository.full_name
  const [owner, repo] = repoFullName.split('/')

  const payload = await getPayload({ config })

  // Find apps linked to this repo
  const apps = await payload.find({
    collection: 'apps',
    where: {
      'repository.url': { contains: repoFullName },
    },
    overrideAccess: true,
    limit: 100,
  })

  if (apps.docs.length === 0) {
    return NextResponse.json({ message: 'No matching apps' }, { status: 200 })
  }

  for (const app of apps.docs) {
    // Verify webhook signature for this app
    if (!app.webhookSecret) continue

    const expectedSignature =
      'sha256=' +
      crypto.createHmac('sha256', app.webhookSecret).update(body).digest('hex')

    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature),
    )

    if (!isValid) continue

    const manifestPath = app.manifestPath || '.orbit.yaml'

    // Check if manifest was removed in this push
    const manifestRemoved = payload_data.commits?.some(
      (c) => c.removed?.includes(manifestPath),
    )

    if (manifestRemoved) {
      await payload.update({
        collection: 'apps',
        id: app.id,
        data: {
          syncEnabled: false,
          manifestSha: null,
          lastSyncAt: new Date().toISOString(),
        },
        overrideAccess: true,
        context: { _syncSource: 'webhook' },
      })
      continue
    }

    // Check if manifest was touched in this push
    const manifestTouched = payload_data.commits?.some(
      (c) =>
        c.added?.includes(manifestPath) || c.modified?.includes(manifestPath),
    )

    if (!manifestTouched && !app.syncEnabled) continue
    if (!manifestTouched && app.syncEnabled) continue // No manifest change in this push

    // Fetch manifest content from repo
    const installationId = app.repository?.installationId
    if (!installationId) continue

    let accessToken: string
    try {
      const tokenResult = await createInstallationToken(Number(installationId))
      accessToken = tokenResult.token
    } catch (error) {
      console.error(`Failed to get installation token for app ${app.id}:`, error)
      continue
    }

    const content = await fetchManifestContent(
      owner,
      repo,
      defaultBranch,
      manifestPath,
      accessToken,
    )

    if (!content) continue

    // Parse and validate
    const { manifest, errors } = parseAppManifest(content)
    if (!manifest || errors.length > 0) {
      console.error(`Invalid manifest in ${repoFullName}/${manifestPath}:`, errors)
      continue
    }

    // Auto-activate sync if manifest was just added
    if (!app.syncEnabled) {
      const fields = mapManifestToAppFields(manifest)
      await payload.update({
        collection: 'apps',
        id: app.id,
        data: {
          ...fields,
          syncEnabled: true,
          manifestSha: payload_data.after,
          lastSyncAt: new Date().toISOString(),
          lastSyncDirection: 'inbound',
        },
        overrideAccess: true,
        context: { _syncSource: 'webhook' },
      })
      continue
    }

    // Conflict detection: compare before-SHA with stored manifestSha
    if (app.manifestSha && payload_data.before !== app.manifestSha) {
      // Both sides changed — conflict
      await payload.update({
        collection: 'apps',
        id: app.id,
        data: {
          conflictDetected: true,
          conflictManifestContent: content,
        },
        overrideAccess: true,
        context: { _syncSource: 'webhook' },
      })
      continue
    }

    // Clean sync — update DB
    const fields = mapManifestToAppFields(manifest)
    await payload.update({
      collection: 'apps',
      id: app.id,
      data: {
        ...fields,
        manifestSha: payload_data.after,
        lastSyncAt: new Date().toISOString(),
        lastSyncDirection: 'inbound',
        conflictDetected: false,
        conflictManifestContent: null,
      },
      overrideAccess: true,
      context: { _syncSource: 'webhook' },
    })
  }

  return NextResponse.json({ message: 'Processed' }, { status: 200 })
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd orbit-www && npx tsc --noEmit 2>&1 | head -30`
Expected: No new errors from this file

**Step 3: Commit**

```bash
git add orbit-www/src/app/api/webhooks/github/app-sync/route.ts
git commit -m "feat(gitops): add inbound webhook handler for repo → Orbit sync"
```

---

## Task 6: Outbound afterChange Hook (Orbit → Repo)

**Files:**
- Modify: `orbit-www/src/collections/Apps.ts` (existing afterChange hook, lines 12–57)
- Reference: `orbit-www/src/lib/app-manifest.ts` (serializeAppManifest)
- Reference: `orbit-www/src/lib/github-manifest.ts` (parseGitHubUrl)
- Reference: `orbit-www/src/lib/github/octokit.ts` (getInstallationOctokit)

Add outbound sync logic to the existing `afterChange` hook. Must include loop prevention via `_syncSource` context flag.

**Step 1: Read the current afterChange hook**

The current hook (lines 12–57) handles health check schedule management. We'll add manifest sync logic after it.

**Step 2: Add outbound sync to the afterChange hook**

Add after the existing health check logic in the `afterChange` hook (after line 55, before the closing brace):

```typescript
// --- Manifest sync: outbound (Orbit → repo) ---
// Skip if this change came from a webhook or conflict resolution
if (args.context?._syncSource) return doc

const syncEnabled = doc.syncEnabled
if (!syncEnabled) return doc

// Check if synced fields changed
const prev = args.previousDoc
const syncedFieldsChanged =
  prev.name !== doc.name ||
  prev.description !== doc.description ||
  JSON.stringify(prev.healthConfig) !== JSON.stringify(doc.healthConfig) ||
  JSON.stringify(prev.buildConfig) !== JSON.stringify(doc.buildConfig)

if (!syncedFieldsChanged) return doc

// Outbound sync: commit updated manifest to repo
try {
  const { serializeAppManifest } = await import('../lib/app-manifest')
  const { parseGitHubUrl } = await import('../lib/github-manifest')
  const { getInstallationOctokit } = await import('../lib/github/octokit')

  const repoUrl = doc.repository?.url
  const installationId = doc.repository?.installationId
  if (!repoUrl || !installationId) return doc

  const parsed = parseGitHubUrl(repoUrl)
  if (!parsed) return doc

  const yamlContent = serializeAppManifest({
    name: doc.name,
    description: doc.description,
    healthConfig: doc.healthConfig,
    buildConfig: doc.buildConfig,
  })

  const octokit = await getInstallationOctokit(Number(installationId))
  const manifestPath = doc.manifestPath || '.orbit.yaml'
  const branch = doc.repository?.branch || 'main'

  // Get current file SHA
  let existingSha: string | undefined
  try {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner: parsed.owner, repo: parsed.repo, path: manifestPath, ref: branch,
    })
    if ('sha' in data) existingSha = data.sha
  } catch { /* file might not exist */ }

  const { data: commitData } = await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
    owner: parsed.owner, repo: parsed.repo, path: manifestPath,
    message: 'chore: sync .orbit.yaml from Orbit',
    content: Buffer.from(yamlContent).toString('base64'),
    branch,
    ...(existingSha && { sha: existingSha }),
  })

  // Update manifestSha — use payload.update with _syncSource to prevent loop
  const { getPayload } = await import('payload')
  const payloadConfig = (await import('@payload-config')).default
  const payloadInstance = await getPayload({ config: payloadConfig })
  await payloadInstance.update({
    collection: 'apps',
    id: doc.id,
    data: {
      manifestSha: commitData.commit.sha,
      lastSyncAt: new Date().toISOString(),
      lastSyncDirection: 'outbound',
    },
    context: { _syncSource: 'outbound-hook' },
  })
} catch (error) {
  console.error('Outbound manifest sync failed:', error)
  // Don't throw — sync failure shouldn't block the save
}

return doc
```

**Step 3: Verify TypeScript compiles**

Run: `cd orbit-www && npx tsc --noEmit 2>&1 | head -30`
Expected: No new errors

**Step 4: Commit**

```bash
git add orbit-www/src/collections/Apps.ts
git commit -m "feat(gitops): add outbound afterChange hook for Orbit → repo sync"
```

---

## Task 7: Webhook Cleanup on App Deletion

**Files:**
- Modify: `orbit-www/src/collections/Apps.ts` (existing afterDelete hook, lines 58–64)

Add webhook cleanup to the existing `afterDelete` hook.

**Step 1: Add cleanup logic to afterDelete**

The current hook (lines 58–64) only handles health schedule deletion. Add webhook cleanup:

```typescript
// --- Clean up GitHub webhook ---
if (doc.webhookId && doc.repository?.url && doc.repository?.installationId) {
  try {
    const { parseGitHubUrl } = await import('../lib/github-manifest')
    const { getInstallationOctokit } = await import('../lib/github/octokit')

    const parsed = parseGitHubUrl(doc.repository.url)
    if (parsed) {
      const octokit = await getInstallationOctokit(Number(doc.repository.installationId))
      await octokit.request('DELETE /repos/{owner}/{repo}/hooks/{hook_id}', {
        owner: parsed.owner,
        repo: parsed.repo,
        hook_id: Number(doc.webhookId),
      })
    }
  } catch (error) {
    console.error('Failed to delete webhook on app deletion:', error)
  }
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd orbit-www && npx tsc --noEmit 2>&1 | head -30`
Expected: No new errors

**Step 3: Commit**

```bash
git add orbit-www/src/collections/Apps.ts
git commit -m "feat(gitops): clean up GitHub webhook on app deletion"
```

---

## Task 8: SyncStatusBadge Component

**Files:**
- Create: `orbit-www/src/components/features/apps/SyncStatusBadge.tsx`
- Create: `orbit-www/src/components/features/apps/SyncStatusBadge.test.tsx`
- Reference: `orbit-www/src/components/features/kafka/RequestStatusBadge.tsx` (badge pattern)
- Reference: `orbit-www/src/components/features/templates/TemplateSyncStatus.tsx` (sync status pattern)

**Step 1: Write the failing test**

Create `orbit-www/src/components/features/apps/SyncStatusBadge.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SyncStatusBadge } from './SyncStatusBadge'

describe('SyncStatusBadge', () => {
  it('renders "Not synced" when syncEnabled is false', () => {
    render(<SyncStatusBadge syncEnabled={false} conflictDetected={false} />)
    expect(screen.getByText('Not synced')).toBeInTheDocument()
  })

  it('renders "Synced" when syncEnabled is true and no conflict', () => {
    render(<SyncStatusBadge syncEnabled={true} conflictDetected={false} />)
    expect(screen.getByText('Synced')).toBeInTheDocument()
  })

  it('renders "Conflict" when conflictDetected is true', () => {
    render(<SyncStatusBadge syncEnabled={true} conflictDetected={true} />)
    expect(screen.getByText('Conflict')).toBeInTheDocument()
  })

  it('shows lastSyncAt when provided and synced', () => {
    render(
      <SyncStatusBadge
        syncEnabled={true}
        conflictDetected={false}
        lastSyncAt="2026-02-14T12:00:00Z"
      />,
    )
    expect(screen.getByText('Synced')).toBeInTheDocument()
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `cd orbit-www && npx vitest run src/components/features/apps/SyncStatusBadge.test.tsx`
Expected: FAIL — module not found

**Step 3: Implement the component**

Create `orbit-www/src/components/features/apps/SyncStatusBadge.tsx`:

```typescript
'use client'

import { Badge } from '@/components/ui/badge'
import { CloudOff, RefreshCw, AlertTriangle } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface SyncStatusBadgeProps {
  syncEnabled: boolean
  conflictDetected: boolean
  lastSyncAt?: string | null
}

const statusConfig = {
  off: {
    label: 'Not synced',
    icon: CloudOff,
    variant: 'outline' as const,
    className: 'text-muted-foreground',
  },
  synced: {
    label: 'Synced',
    icon: RefreshCw,
    variant: 'outline' as const,
    className: 'border-green-300 text-green-700 bg-green-50',
  },
  conflict: {
    label: 'Conflict',
    icon: AlertTriangle,
    variant: 'destructive' as const,
    className: '',
  },
}

export function SyncStatusBadge({ syncEnabled, conflictDetected, lastSyncAt }: SyncStatusBadgeProps) {
  const status = !syncEnabled ? 'off' : conflictDetected ? 'conflict' : 'synced'
  const config = statusConfig[status]
  const Icon = config.icon

  return (
    <Badge
      variant={config.variant}
      className={`gap-1 font-medium ${config.className}`}
      title={
        lastSyncAt && syncEnabled
          ? `Last synced ${formatDistanceToNow(new Date(lastSyncAt), { addSuffix: true })}`
          : undefined
      }
    >
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  )
}
```

**Step 4: Run tests to verify they pass**

Run: `cd orbit-www && npx vitest run src/components/features/apps/SyncStatusBadge.test.tsx`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add orbit-www/src/components/features/apps/SyncStatusBadge.tsx orbit-www/src/components/features/apps/SyncStatusBadge.test.tsx
git commit -m "feat(gitops): add SyncStatusBadge component"
```

---

## Task 9: ManifestConflictBanner Component

**Files:**
- Create: `orbit-www/src/components/features/apps/ManifestConflictBanner.tsx`
- Create: `orbit-www/src/components/features/apps/ManifestConflictBanner.test.tsx`

**Step 1: Write the failing test**

Create `orbit-www/src/components/features/apps/ManifestConflictBanner.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ManifestConflictBanner } from './ManifestConflictBanner'

describe('ManifestConflictBanner', () => {
  it('renders nothing when no conflict', () => {
    const { container } = render(
      <ManifestConflictBanner conflictDetected={false} appId="123" />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders warning when conflict detected', () => {
    render(<ManifestConflictBanner conflictDetected={true} appId="123" />)
    expect(screen.getByText(/sync conflict detected/i)).toBeInTheDocument()
  })

  it('renders both resolution buttons', () => {
    render(<ManifestConflictBanner conflictDetected={true} appId="123" />)
    expect(screen.getByText(/keep orbit/i)).toBeInTheDocument()
    expect(screen.getByText(/keep repository/i)).toBeInTheDocument()
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `cd orbit-www && npx vitest run src/components/features/apps/ManifestConflictBanner.test.tsx`
Expected: FAIL

**Step 3: Implement the component**

Create `orbit-www/src/components/features/apps/ManifestConflictBanner.tsx`:

```typescript
'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { resolveManifestConflict } from '@/app/actions/apps'
import { toast } from 'sonner'

interface ManifestConflictBannerProps {
  conflictDetected: boolean
  appId: string
}

export function ManifestConflictBanner({ conflictDetected, appId }: ManifestConflictBannerProps) {
  const router = useRouter()
  const [isResolving, setIsResolving] = React.useState<'keep-orbit' | 'keep-repo' | null>(null)

  if (!conflictDetected) return null

  const handleResolve = async (resolution: 'keep-orbit' | 'keep-repo') => {
    setIsResolving(resolution)
    try {
      await resolveManifestConflict(appId, resolution)
      toast.success(
        resolution === 'keep-orbit'
          ? 'Conflict resolved — Orbit version pushed to repository'
          : 'Conflict resolved — repository version applied to Orbit',
      )
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to resolve conflict')
    } finally {
      setIsResolving(null)
    }
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
        <div className="flex-1">
          <h4 className="font-medium text-amber-800 dark:text-amber-200">
            Sync conflict detected
          </h4>
          <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
            The manifest in your repository and Orbit both changed since the last sync.
            Choose which version to keep.
          </p>
          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleResolve('keep-orbit')}
              disabled={isResolving !== null}
            >
              {isResolving === 'keep-orbit' && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Keep Orbit Version
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleResolve('keep-repo')}
              disabled={isResolving !== null}
            >
              {isResolving === 'keep-repo' && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Keep Repository Version
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

**Step 4: Run tests to verify they pass**

Run: `cd orbit-www && npx vitest run src/components/features/apps/ManifestConflictBanner.test.tsx`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add orbit-www/src/components/features/apps/ManifestConflictBanner.tsx orbit-www/src/components/features/apps/ManifestConflictBanner.test.tsx
git commit -m "feat(gitops): add ManifestConflictBanner component"
```

---

## Task 10: ExportManifestButton Component

**Files:**
- Create: `orbit-www/src/components/features/apps/ExportManifestButton.tsx`
- Create: `orbit-www/src/components/features/apps/ExportManifestButton.test.tsx`

**Step 1: Write the failing test**

Create `orbit-www/src/components/features/apps/ExportManifestButton.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ExportManifestButton } from './ExportManifestButton'

describe('ExportManifestButton', () => {
  it('renders nothing when syncEnabled is true', () => {
    const { container } = render(
      <ExportManifestButton appId="123" syncEnabled={true} hasRepository={true} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when app has no repository', () => {
    const { container } = render(
      <ExportManifestButton appId="123" syncEnabled={false} hasRepository={false} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders export button when sync is off and has repository', () => {
    render(
      <ExportManifestButton appId="123" syncEnabled={false} hasRepository={true} />,
    )
    expect(screen.getByText(/export to repository/i)).toBeInTheDocument()
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `cd orbit-www && npx vitest run src/components/features/apps/ExportManifestButton.test.tsx`
Expected: FAIL

**Step 3: Implement the component**

Create `orbit-www/src/components/features/apps/ExportManifestButton.tsx`:

```typescript
'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Upload, Loader2 } from 'lucide-react'
import { exportAppManifest } from '@/app/actions/apps'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

interface ExportManifestButtonProps {
  appId: string
  syncEnabled: boolean
  hasRepository: boolean
  manifestPath?: string
}

export function ExportManifestButton({
  appId,
  syncEnabled,
  hasRepository,
  manifestPath = '.orbit.yaml',
}: ExportManifestButtonProps) {
  const router = useRouter()
  const [isExporting, setIsExporting] = React.useState(false)

  if (syncEnabled || !hasRepository) return null

  const handleExport = async () => {
    setIsExporting(true)
    try {
      await exportAppManifest(appId)
      toast.success('Manifest exported — sync is now active')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to export manifest')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={isExporting}>
          <Upload className="h-4 w-4 mr-2" />
          Export to Repository
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Export manifest to repository?</AlertDialogTitle>
          <AlertDialogDescription>
            This will commit a <code>{manifestPath}</code> file to your repository and enable
            bidirectional sync. Future changes in Orbit will be committed to the repo, and
            changes pushed to the repo will update Orbit.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleExport} disabled={isExporting}>
            {isExporting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Exporting...
              </>
            ) : (
              'Export & Enable Sync'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

**Step 4: Run tests to verify they pass**

Run: `cd orbit-www && npx vitest run src/components/features/apps/ExportManifestButton.test.tsx`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add orbit-www/src/components/features/apps/ExportManifestButton.tsx orbit-www/src/components/features/apps/ExportManifestButton.test.tsx
git commit -m "feat(gitops): add ExportManifestButton component"
```

---

## Task 11: Integrate Sync UI into AppDetail

**Files:**
- Modify: `orbit-www/src/components/features/apps/AppDetail.tsx` (lines 110–135 header, lines 137–208 cards)
- Modify: `orbit-www/src/app/(frontend)/apps/[id]/page.tsx` (data passing)

**Step 1: Update AppDetail to include sync components**

Add imports to `AppDetail.tsx`:

```typescript
import { SyncStatusBadge } from './SyncStatusBadge'
import { ManifestConflictBanner } from './ManifestConflictBanner'
import { ExportManifestButton } from './ExportManifestButton'
```

Add to the header section (after the status badge, around line 123):

```tsx
<SyncStatusBadge
  syncEnabled={!!app.syncEnabled}
  conflictDetected={!!app.conflictDetected}
  lastSyncAt={app.lastSyncAt}
/>
```

Add after the settings button (around line 134):

```tsx
<ExportManifestButton
  appId={app.id}
  syncEnabled={!!app.syncEnabled}
  hasRepository={!!app.repository?.url && !!app.repository?.installationId}
  manifestPath={app.manifestPath || '.orbit.yaml'}
/>
```

Add before the summary cards grid (before line 138):

```tsx
<ManifestConflictBanner conflictDetected={!!app.conflictDetected} appId={app.id} />
```

**Step 2: Verify TypeScript compiles**

Run: `cd orbit-www && npx tsc --noEmit 2>&1 | head -30`
Expected: No new errors (Payload's generated types should include the new fields after schema change in Task 2)

**Step 3: Commit**

```bash
git add orbit-www/src/components/features/apps/AppDetail.tsx orbit-www/src/app/(frontend)/apps/[id]/page.tsx
git commit -m "feat(gitops): integrate sync status, conflict banner, and export button into AppDetail"
```

---

## Task 12: Run Full Test Suite & Lint

**Files:** None — verification only.

**Step 1: Run all frontend tests**

Run: `cd orbit-www && npx vitest run`
Expected: All tests pass (including new manifest tests)

**Step 2: Run linter**

Run: `cd orbit-www && npx next lint`
Expected: No new lint errors

**Step 3: Run TypeScript check**

Run: `cd orbit-www && npx tsc --noEmit`
Expected: No new type errors

**Step 4: Fix any failures**

If tests fail, debug and fix. If lint errors, fix. If type errors, fix.

**Step 5: Final commit if fixes were needed**

```bash
git add -A
git commit -m "fix(gitops): address test/lint/type issues"
```

---

## Dependency Graph

```
Task 1 (parser/serializer) ─┬─→ Task 3 (export action) ─┬─→ Task 10 (ExportManifestButton)
                             │                            │
                             ├─→ Task 4 (conflict/disable)┼─→ Task 9 (ConflictBanner)
                             │                            │
                             ├─→ Task 5 (webhook handler) │
                             │                            │
                             └─→ Task 6 (afterChange hook)│
                                                          │
Task 2 (schema fields) ──────┼──────────────────────────→ Task 11 (integrate into AppDetail)
                              │                            ↑
                              └─→ Task 7 (webhook cleanup) │
                                                           │
                              Task 8 (SyncStatusBadge) ────┘
                              Task 9 (ConflictBanner) ─────┘
                              Task 10 (ExportButton) ──────┘
                                                           │
                                                           ↓
                                                    Task 12 (verification)
```

**Parallelizable groups:**
- Tasks 1 & 2 can run in parallel (independent)
- Tasks 3, 4, 5, 6 depend on Task 1 (serial after Task 1)
- Task 7 depends on Task 2
- Tasks 8, 9, 10 (UI components) can run in parallel after their action dependencies
- Task 11 depends on Tasks 2, 8, 9, 10
- Task 12 runs last
