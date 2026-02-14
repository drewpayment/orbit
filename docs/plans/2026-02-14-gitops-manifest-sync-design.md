# GitOps Manifest Sync (`.orbit.yaml`) — Design Document

> **Roadmap:** Phase 2.1
> **Date:** 2026-02-14
> **Status:** Design Complete — Ready for Implementation Planning

---

## Goal

Allow apps in Orbit to optionally sync their configuration with a `.orbit.yaml` manifest file in their linked GitHub repository. When sync is active, changes flow bidirectionally: UI edits commit back to the repo, and repo pushes update the Orbit database. Conflicts are detected and resolved by the user choosing a side.

## Key Design Decisions

1. **Sync is OFF by default.** All existing apps stay DB-only. No manifests are generated unless the user explicitly exports or manually creates one.
2. **Bidirectional when ON.** There are no rigid "orbit-primary" vs "manifest-primary" modes. Once sync is active, changes flow both ways.
3. **Conflict = detect and block.** When both sides change since last sync, Orbit flags the conflict and the user chooses "Keep Orbit" or "Keep Repository" (all-or-nothing).
4. **1:1 repo mapping, designed for monorepo.** Each app maps to one repo. A `manifestPath` field (default `.orbit.yaml`) allows future monorepo support where multiple apps live in one repo at different paths.

---

## 1. Schema & Data Model

### `.orbit.yaml` Manifest Format

```yaml
apiVersion: orbit.dev/v1
kind: Application
metadata:
  name: user-auth-service
  description: User authentication and authorization API
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
```

The manifest maps 1:1 to the app's DB fields. Orbit serializes DB → YAML when exporting/committing, and parses YAML → DB fields when ingesting from a webhook push.

### Apps Collection Field Changes

**File:** `orbit-www/src/collections/Apps.ts`

**Replace** the existing `syncMode` select field (lines 249–256) with:

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `syncEnabled` | checkbox | `false` | Replaces `syncMode` select. Simple on/off. |
| `manifestSha` | text (read-only) | — | Already exists (lines 258–264). Stores git commit SHA of last synced manifest. |
| `manifestPath` | text | `.orbit.yaml` | Path within the repo. Enables future monorepo support. |
| `lastSyncAt` | date | — | Timestamp of last successful sync. |
| `lastSyncDirection` | select | — | `'inbound'` or `'outbound'` — which direction the last sync was. |
| `conflictDetected` | checkbox | `false` | Flag set when both sides changed since last sync. |
| `conflictManifestContent` | textarea (hidden) | — | Stores the incoming manifest YAML during a conflict for user comparison. |
| `webhookId` | text (read-only, hidden) | — | GitHub webhook ID for cleanup on app deletion. |
| `webhookSecret` | text (encrypted, hidden) | — | Per-app webhook secret for signature verification. |

**Migration:** The existing `syncMode` field (always set to `'orbit-primary'` on creation) is replaced by `syncEnabled: false`. No apps are actually syncing today, so this is a clean swap. Update the three creation paths in `orbit-www/src/app/actions/apps.ts` (lines 68, 141, 265) to use `syncEnabled: false` instead of `syncMode: 'orbit-primary'`.

---

## 2. Sync Lifecycle

Three states an app can be in:

### State 1: Sync Off (default)

No manifest exists in the repo. App lives entirely in Orbit DB. User manages everything through the UI. This is the state all existing apps are in today.

### State 2: Sync Active

A `.orbit.yaml` exists in the linked repo and is tracked. Changes flow bidirectionally:

- **UI edit → repo:** An `afterChange` hook on the Apps collection detects field changes, serializes to YAML, and commits the updated manifest via the GitHub API (using the installation token from `GitHubInstallations`).
- **Repo push → Orbit:** A GitHub webhook (`push` event) hits a new route. The handler reads the manifest from the payload, parses it, compares `manifestSha` to detect conflicts, and updates the DB if clean.

### State 3: Conflict

Both sides changed since the last sync. The webhook handler detects this when the incoming commit's parent SHA doesn't match `manifestSha`. It sets `conflictDetected: true`, stores `conflictManifestContent`, and does NOT update the DB. The user sees a banner and resolves by choosing "Keep Orbit" or "Keep Manifest" (all-or-nothing).

### How Sync Gets Activated

- **Export action:** User clicks "Export to Repository" in the UI. Orbit serializes current DB state to YAML, commits it to the repo via GitHub API, registers a webhook, stores the commit SHA in `manifestSha`, sets `syncEnabled: true`.
- **Manual creation:** User pushes a `.orbit.yaml` to their repo. Next webhook fires (if webhook was registered during export, or user can manually trigger a "Connect Manifest" action), Orbit detects the new manifest, ingests it, sets `syncEnabled: true`.

---

## 3. Webhook & GitHub Integration

### Inbound: Webhook Handler

**New file:** `orbit-www/src/app/api/webhooks/github/app-sync/route.ts`

Modeled after the existing template-sync webhook at `orbit-www/src/app/api/webhooks/github/template-sync/route.ts`.

Handles `push` events. The flow:

1. Verify webhook signature using timing-safe comparison (reuse pattern from template-sync, lines 148–180)
2. Extract repo info from payload, find matching App record by repository relation
3. Check if `syncEnabled: true` — if not, check if a `.orbit.yaml` was added in the push commits (activates sync automatically)
4. Fetch manifest content from the repo at the commit SHA using `fetchManifestContent()` from `orbit-www/src/lib/github-manifest.ts`
5. Parse YAML using new `parseAppManifest()` function, validate against schema
6. Compare the stored `manifestSha` against the commit's parent SHA:
   - **Match (clean sync):** Update DB fields from manifest, store new commit SHA in `manifestSha`, update `lastSyncAt`, set `lastSyncDirection: 'inbound'`
   - **Mismatch (conflict):** Set `conflictDetected: true`, store `conflictManifestContent` with the parsed YAML, do NOT update DB
7. Return 200

### Outbound: afterChange Hook

**File:** `orbit-www/src/collections/Apps.ts` — new `afterChange` hook

1. Check if `syncEnabled: true` and the change includes synced fields (name, description, health, build config)
2. **Loop prevention:** Skip if the change came FROM a webhook. Use a `_syncSource: 'webhook'` flag in the Payload request context. The webhook handler sets this via `context: { _syncSource: 'webhook' }` when calling `payload.update()`.
3. Get installation token from `GitHubInstallations` using `getInstallationOctokit()` from `orbit-www/src/lib/github/octokit.ts`
4. Serialize DB fields → YAML using new `serializeAppManifest()` function
5. Commit to repo at `manifestPath` using GitHub Contents API (`octokit.repos.createOrUpdateFileContents`)
6. Store new commit SHA in `manifestSha`, update `lastSyncAt`, set `lastSyncDirection: 'outbound'`

### Webhook Registration

When sync is activated (export action), register a GitHub webhook:

```typescript
// Reuse pattern from orbit-www/src/app/actions/templates.ts:982-1024
const webhookSecret = generateWebhookSecret() // from github-manifest.ts
const webhookUrl = `${appUrl}/api/webhooks/github/app-sync`

const { data: hook } = await octokit.repos.createWebhook({
  owner, repo,
  name: 'web',
  active: true,
  events: ['push'],
  config: { url: webhookUrl, content_type: 'json', secret: webhookSecret, insecure_ssl: '0' },
})
```

Store `webhookId` and encrypted `webhookSecret` on the App record. Clean up on app deletion or sync disable.

---

## 4. Conflict Resolution UI & Export Action

### Conflict Banner

**File:** New component `orbit-www/src/components/features/apps/ManifestConflictBanner.tsx`

When `conflictDetected: true`, the app detail page shows a prominent warning banner:

> "Sync conflict detected — the manifest in your repository and Orbit both changed since the last sync."

Two buttons:
- **"Keep Orbit Version"** — Serializes current DB state → commits to repo → updates `manifestSha` → clears `conflictDetected` and `conflictManifestContent`
- **"Keep Repository Version"** — Parses `conflictManifestContent` → updates DB fields → updates `manifestSha` → clears conflict flags

Both paths end with `conflictDetected: false` and `conflictManifestContent: null`.

### Export Action

**File:** New server action in `orbit-www/src/app/actions/apps.ts`

A new "Export to Repository" button on the app detail page. Only shown when `syncEnabled: false` AND the app has a linked GitHub repository with an active installation.

Clicking it:
1. Serializes current DB state to `.orbit.yaml` format
2. Commits to the repo at `manifestPath` via GitHub Contents API
3. Registers a GitHub webhook for `push` events
4. Sets `syncEnabled: true`, stores `manifestSha` and `webhookId`, sets `lastSyncAt`
5. Shows success toast: "Manifest exported — sync is now active"

### Disable Sync Action

A "Disable Sync" option (in settings or dropdown). Clicking it:
1. Deletes the GitHub webhook via API
2. Sets `syncEnabled: false`, clears `manifestSha`, `webhookId`, `webhookSecret`
3. Does NOT delete the `.orbit.yaml` from the repo (user can do that manually)

### Sync Status Indicator

**File:** New component `orbit-www/src/components/features/apps/SyncStatusBadge.tsx`

A small badge on the app detail page:
- **"Not synced"** (grey) — `syncEnabled: false`
- **"Synced"** (green) — `syncEnabled: true`, no conflict, shows `lastSyncAt` on hover
- **"Conflict"** (red/amber) — `conflictDetected: true`

---

## 5. Manifest Parser & Serializer

**New file:** `orbit-www/src/lib/app-manifest.ts`

Modeled after `orbit-www/src/lib/template-manifest.ts` which uses the `yaml` package (already installed).

### Types

```typescript
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
```

### Functions

- `parseAppManifest(content: string): { manifest: AppManifest | null; errors: ManifestValidationError[] }` — Parse and validate YAML content
- `serializeAppManifest(app: AppFields): string` — Serialize DB fields to YAML string
- `diffManifest(a: AppManifest, b: AppManifest): ManifestDiff[]` — Compare two manifests for display in conflict resolution UI (optional, can be deferred)
- `mapManifestToAppFields(manifest: AppManifest): Partial<AppFields>` — Map parsed manifest to Payload update data
- `mapAppFieldsToManifest(app: AppFields): AppManifest` — Map DB fields to manifest structure

---

## 6. Files Summary

### New Files

| File | Purpose |
|------|---------|
| `orbit-www/src/lib/app-manifest.ts` | Manifest parser, serializer, mapper functions |
| `orbit-www/src/app/api/webhooks/github/app-sync/route.ts` | Inbound webhook handler for repo → Orbit sync |
| `orbit-www/src/components/features/apps/ManifestConflictBanner.tsx` | Conflict resolution UI component |
| `orbit-www/src/components/features/apps/SyncStatusBadge.tsx` | Sync status indicator badge |
| `orbit-www/src/components/features/apps/ExportManifestButton.tsx` | Export action button component |

### Modified Files

| File | Changes |
|------|---------|
| `orbit-www/src/collections/Apps.ts` | Replace `syncMode` with new sync fields, add `afterChange` hook |
| `orbit-www/src/app/actions/apps.ts` | Add export, conflict resolution, disable sync server actions; update creation paths |
| `orbit-www/src/components/features/apps/AppDetail.tsx` | Integrate SyncStatusBadge, ManifestConflictBanner, ExportManifestButton |
| `orbit-www/src/app/(frontend)/apps/[id]/page.tsx` | Pass sync-related props to AppDetail |

### Reused Patterns

| Pattern | Source | Reuse |
|---------|--------|-------|
| Webhook signature verification | `app/api/webhooks/github/template-sync/route.ts` | Copy and adapt for app-sync |
| Manifest YAML parsing | `lib/template-manifest.ts` | Same approach, different schema |
| GitHub file fetch | `lib/github-manifest.ts` (`fetchManifestContent`, `fileExists`) | Direct reuse |
| Installation Octokit | `lib/github/octokit.ts` (`getInstallationOctokit`) | Direct reuse |
| Webhook registration | `app/actions/templates.ts:982-1024` | Copy and adapt for apps |
| Webhook secret generation | `lib/github-manifest.ts` (`generateWebhookSecret`) | Direct reuse |

---

## 7. Edge Cases

| Scenario | Handling |
|----------|----------|
| App has no linked repository | Export button hidden. Sync cannot be enabled. |
| GitHub installation token expired | Refresh via existing `GitHubInstallations` `afterChange` hook / Temporal workflow before sync operations. |
| `.orbit.yaml` deleted from repo | Webhook detects file removal in push. Set `syncEnabled: false`, show toast "Manifest removed from repository — sync disabled." |
| App deleted in Orbit | `beforeDelete` hook cleans up: delete GitHub webhook, no manifest cleanup needed in repo. |
| Webhook delivery fails | GitHub retries automatically. Orbit handles idempotently (SHA comparison prevents duplicate updates). |
| Concurrent UI edits during sync | Payload's `afterChange` fires per-save. Last write wins for outbound commits. Conflict detection handles the inbound side. |
| Invalid YAML pushed to repo | Webhook handler parses and validates. Invalid manifest = log error, return 200 (don't crash), don't update DB. Optionally set a sync error state. |
| Repo renamed or transferred | GitHub webhook URL stays valid. Payload lookup by installation ID + repo still works. |

---

## 8. Out of Scope (Deferred)

- **Diff view in conflict resolution** — Show field-by-field diff instead of all-or-nothing. Can add later.
- **Partial sync** — Sync only specific sections of the manifest. Start with all-or-nothing.
- **Multi-app monorepo** — `manifestPath` field is in place for this. Implementation deferred to when there's a real use case.
- **Temporal workflow for sync** — Start with synchronous webhook + afterChange hook. Move to Temporal if reliability becomes an issue.
- **Sync history/audit log** — Track sync events over time. Add when audit logging (Phase 4.4) is built.
