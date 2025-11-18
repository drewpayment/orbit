# GitHub App Installation & Token Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Created**: 2025-11-13
**Last Updated**: 2025-11-16
**Status**: 🟢 Complete (Tasks 2-8, 10-12) | ⏳ Pending (Task 9) | 📝 User Action (Task 1)
**Priority**: CRITICAL (Blocks backend activities Task 4+)

---

## Executive Summary

**Goal**: Implement enterprise GitHub App installation pattern for org-level repository operations, replacing user OAuth approach.

**Why This Matters**:
- Orbit admins install GitHub App into their GitHub organization(s)
- All users in Orbit workspace share the same installation
- Operations execute as "Orbit IDP Bot" with admin-controlled permissions
- Multi-tenant SaaS ready (tenant-scoped installations)
- Token refresh managed via long-running Temporal workflow

**Architecture Pattern**: Enterprise app installation (like Slack, Atlassian)
**Not**: User OAuth (that's for future personal integrations like Notion)

**Dependencies**:
- Payload CMS with MongoDB (✅ Already in use)
- Temporal workflows (✅ Already in use)
- GitHub App registration (⚠️ Must create)
- Token encryption (⚠️ Must implement)

**Blocks**:
- Backend Activities Implementation Plan (Task 4: PushToRemoteActivity)
- Any Git operations requiring authentication

---

## Design Decisions (From Brainstorming)

### **GitHub App vs User OAuth**
- ✅ **GitHub App** (chosen): Org-level installation, bot tokens, admin-controlled permissions
- ❌ User OAuth: Individual user tokens, per-user GitHub permissions

### **Multi-Tenancy Strategy**
- Design for multi-tenant SaaS from day one
- Add optional `tenant` field to all collections
- Self-hosted: Single default tenant (tenant field = null)
- SaaS: Multiple tenants with full isolation

### **Installation Scope**
- One Orbit instance can connect to **multiple GitHub organizations**
- Admin maps: "Which workspaces can use which GitHub org?"
- Example: "Engineering" workspace → `mycompany-backend` + `mycompany-frontend` orgs

### **Commit Attribution**
- All commits: "Orbit IDP <bot@orbit.dev>"
- Commit message includes: "Requested by: @username"
- No individual user GitHub permission checks

### **Token Lifecycle**
- GitHub App installation tokens expire after 1 hour
- Temporal scheduled workflow refreshes every 50 minutes
- Workflow runs continuously until app uninstalled

### **Permission Boundaries**
- GitHub org admin controls which repos Orbit can access
- Orbit admin controls which workspaces can use each GitHub org
- No individual user permission checks within Orbit

---

## Prerequisites

**Before Starting:**
- ✅ Payload CMS configured with MongoDB
- ✅ Temporal server running
- ✅ User authentication working
- ⚠️ GitHub App not yet registered (Task 1)
- ⚠️ Encryption strategy not yet implemented (Task 2)

**External Dependencies:**
- GitHub account with organization admin access (for testing)
- GitHub App creation permissions
- MongoDB encryption key or KMS setup

**Reference Documentation:**
- GitHub Apps: https://docs.github.com/en/apps/creating-github-apps
- Installation Tokens: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token
- Webhooks: https://docs.github.com/en/webhooks

---

## Phase 1: Foundation & GitHub App Setup

### Task 1: Register GitHub App ⚠️ USER ACTION REQUIRED

**Status**: External configuration - User must complete this on GitHub
**Goal**: Create "Orbit IDP" GitHub App on GitHub.

**Files**: N/A (external to codebase)

#### Step 1.1: Create GitHub App

Navigate to: https://github.com/settings/apps/new

**App Configuration:**
- **Name**: `Orbit IDP` (or `Orbit IDP Dev` for testing)
- **Homepage URL**: `https://orbit.dev` (or your staging URL)
- **Callback URL**: `https://orbit.dev/api/github/installation/callback`
- **Setup URL**: `https://orbit.dev/admin/settings/github/setup`
- **Webhook URL**: `https://orbit.dev/api/github/webhooks`
- **Webhook Secret**: Generate strong secret (save in environment variables)

**Permissions Required:**
- **Repository permissions**:
  - Contents: Read & Write (clone, push, create repos)
  - Metadata: Read (repo info)
  - Administration: Read & Write (create repos)
- **Organization permissions**:
  - Members: Read (optional, for future user validation)

**Events to Subscribe**:
- `installation` (created, deleted, suspend, unsuspend)
- `installation_repositories` (added, removed)

**Where can this GitHub App be installed?**
- "Any account" (allows users to install in their orgs)

#### Step 1.2: Download Private Key

After creating the app:
1. Click "Generate a private key"
2. Download `orbit-idp.YYYY-MM-DD.private-key.pem`
3. Store securely (see Task 2 for storage strategy)

#### Step 1.3: Save App Credentials

Record these values (store in `.env`):
```env
GITHUB_APP_ID=123456
GITHUB_APP_CLIENT_ID=Iv1.abc123...
GITHUB_APP_CLIENT_SECRET=abc123...
GITHUB_APP_WEBHOOK_SECRET=webhook_secret_here
GITHUB_APP_PRIVATE_KEY_PATH=/path/to/private-key.pem
# Or store private key directly (base64 encoded):
GITHUB_APP_PRIVATE_KEY_BASE64=LS0tLS1CRUd...
```

#### Step 1.4: Verification

```bash
# Test that app is accessible
curl -H "Authorization: Bearer <JWT_TOKEN>" \
  https://api.github.com/app

# Should return app details
```

**Commit**: N/A (external configuration, document in README)

---

### Task 2: Implement Token Encryption ✅ COMPLETE

**Status**: ✅ Complete (2025-11-14)
**Files**: `orbit-www/src/lib/encryption/index.ts`, `encryption.test.ts`
**Goal**: Securely encrypt GitHub installation tokens before storing in MongoDB.

**Files**:
- Create: `orbit-www/src/lib/encryption/index.ts`
- Create: `orbit-www/src/lib/encryption/encryption.test.ts`

#### Step 2.1: Choose Encryption Strategy

**Option A: AES-256-GCM with App-Level Key (Recommended for MVP)**
```typescript
// orbit-www/src/lib/encryption/index.ts
import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY! // 32-byte base64 key

if (!ENCRYPTION_KEY) {
  throw new Error('ENCRYPTION_KEY environment variable required')
}

const key = Buffer.from(ENCRYPTION_KEY, 'base64')

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  const authTag = cipher.getAuthTag()

  // Format: iv:authTag:encryptedData
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
}

export function decrypt(encryptedText: string): string {
  const parts = encryptedText.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format')
  }

  const [ivHex, authTagHex, encrypted] = parts
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}
```

**Generate Encryption Key:**
```bash
# Generate 32-byte key
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# Save output to .env as ENCRYPTION_KEY
```

**Option B: AWS KMS or HashiCorp Vault** (for production with compliance requirements)
- Defer to future task if needed
- Use Option A for MVP

#### Step 2.2: Write Tests

```typescript
// orbit-www/src/lib/encryption/encryption.test.ts
import { describe, it, expect } from 'vitest'
import { encrypt, decrypt } from './index'

describe('Encryption', () => {
  it('encrypts and decrypts text correctly', () => {
    const plaintext = 'ghp_test_token_abc123'
    const encrypted = encrypt(plaintext)
    const decrypted = decrypt(encrypted)

    expect(decrypted).toBe(plaintext)
    expect(encrypted).not.toBe(plaintext)
    expect(encrypted).toContain(':') // Contains IV and auth tag
  })

  it('produces different ciphertext for same plaintext (random IV)', () => {
    const plaintext = 'test_token'
    const encrypted1 = encrypt(plaintext)
    const encrypted2 = encrypt(plaintext)

    expect(encrypted1).not.toBe(encrypted2)
    expect(decrypt(encrypted1)).toBe(plaintext)
    expect(decrypt(encrypted2)).toBe(plaintext)
  })

  it('throws error for invalid encrypted text', () => {
    expect(() => decrypt('invalid')).toThrow('Invalid encrypted text format')
  })

  it('throws error for tampered ciphertext', () => {
    const encrypted = encrypt('test')
    const tampered = encrypted.replace(/.$/, 'X') // Change last char

    expect(() => decrypt(tampered)).toThrow()
  })
})
```

#### Step 2.3: Run Tests

```bash
cd orbit-www
pnpm exec vitest run src/lib/encryption/encryption.test.ts
```

**Expected**: All tests pass

#### Step 2.4: Update Environment Variables

```bash
# .env.local
ENCRYPTION_KEY=<base64_key_from_step_2.1>
```

#### Step 2.5: Commit

```bash
git add orbit-www/src/lib/encryption/
git commit -m "feat: implement AES-256-GCM encryption for secrets

- Add encrypt/decrypt functions using crypto module
- Use random IV for each encryption (non-deterministic)
- Include authentication tag for tamper detection
- Comprehensive tests for encryption/decryption
- Env var: ENCRYPTION_KEY (32-byte base64)

Refs: GitHub App installation token storage

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Create Payload Collection for GitHub Installations ✅ COMPLETE

**Status**: ✅ Complete (2025-11-14)
**Files**: `orbit-www/src/collections/GitHubInstallations.ts`
**Goal**: Define `github-installations` Payload collection schema.

**Files**:
- Create: `orbit-www/src/collections/GitHubInstallations.ts`
- Modify: `orbit-www/src/payload.config.ts` (import and register collection)

#### Step 3.1: Create Collection Schema

```typescript
// orbit-www/src/collections/GitHubInstallations.ts
import { CollectionConfig } from 'payload/types'
import { isAdmin } from '../access/isAdmin'

export const GitHubInstallations: CollectionConfig = {
  slug: 'github-installations',

  admin: {
    useAsTitle: 'accountLogin',
    defaultColumns: ['accountLogin', 'installationId', 'status', 'installedAt'],
    group: 'Integrations',
    description: 'GitHub App installations for repository operations',
  },

  access: {
    // Only admins can view/manage GitHub installations
    read: isAdmin,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },

  fields: [
    // ===== GitHub App Installation Details =====
    {
      name: 'installationId',
      type: 'number',
      required: true,
      unique: true,
      admin: {
        description: 'GitHub App installation ID from GitHub API',
        readOnly: true,
      },
    },
    {
      name: 'accountLogin',
      type: 'text',
      required: true,
      admin: {
        description: 'GitHub organization name (e.g., "mycompany")',
      },
    },
    {
      name: 'accountId',
      type: 'number',
      required: true,
      admin: {
        description: 'GitHub account ID',
        readOnly: true,
      },
    },
    {
      name: 'accountType',
      type: 'select',
      required: true,
      defaultValue: 'Organization',
      options: [
        { label: 'Organization', value: 'Organization' },
        { label: 'User', value: 'User' },
      ],
      admin: {
        description: 'Type of GitHub account (usually Organization)',
      },
    },
    {
      name: 'accountAvatarUrl',
      type: 'text',
      admin: {
        description: 'GitHub organization avatar URL',
      },
    },

    // ===== Installation Token (Encrypted) =====
    {
      name: 'installationToken',
      type: 'text',
      required: true,
      admin: {
        description: 'Encrypted GitHub App installation access token',
        hidden: true, // Never show in admin UI
        readOnly: true,
      },
    },
    {
      name: 'tokenExpiresAt',
      type: 'date',
      required: true,
      admin: {
        description: 'When the current token expires (auto-refreshed every 50 min)',
        readOnly: true,
      },
    },
    {
      name: 'tokenLastRefreshedAt',
      type: 'date',
      admin: {
        description: 'Last successful token refresh timestamp',
        readOnly: true,
      },
    },

    // ===== Repository Access Configuration =====
    {
      name: 'repositorySelection',
      type: 'select',
      required: true,
      defaultValue: 'all',
      options: [
        { label: 'All Repositories', value: 'all' },
        { label: 'Selected Repositories', value: 'selected' },
      ],
      admin: {
        description: 'Repository access scope configured during installation',
      },
    },
    {
      name: 'selectedRepositories',
      type: 'array',
      admin: {
        description: 'Specific repositories if repositorySelection is "selected"',
        condition: (data) => data.repositorySelection === 'selected',
      },
      fields: [
        {
          name: 'fullName',
          type: 'text',
          required: true,
          admin: {
            description: 'Full repo name (e.g., "mycompany/backend")',
          },
        },
        {
          name: 'id',
          type: 'number',
          required: true,
        },
        {
          name: 'private',
          type: 'checkbox',
          defaultValue: false,
        },
      ],
    },

    // ===== Workspace Access Mapping =====
    {
      name: 'allowedWorkspaces',
      type: 'relationship',
      relationTo: 'workspaces',
      hasMany: true,
      admin: {
        description: 'Which Orbit workspaces can use this GitHub installation',
        position: 'sidebar',
      },
    },

    // ===== Lifecycle Status =====
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Suspended', value: 'suspended' },
        { label: 'Token Refresh Failed', value: 'refresh_failed' },
      ],
      admin: {
        description: 'Installation health status',
        position: 'sidebar',
      },
    },
    {
      name: 'suspendedAt',
      type: 'date',
      admin: {
        description: 'When the installation was suspended',
        condition: (data) => data.status === 'suspended',
      },
    },
    {
      name: 'suspensionReason',
      type: 'textarea',
      admin: {
        description: 'Why the installation was suspended',
        condition: (data) => data.status === 'suspended',
      },
    },

    // ===== Temporal Workflow Integration =====
    {
      name: 'temporalWorkflowId',
      type: 'text',
      admin: {
        description: 'ID of the token refresh Temporal workflow',
        readOnly: true,
        position: 'sidebar',
      },
    },
    {
      name: 'temporalWorkflowStatus',
      type: 'select',
      options: [
        { label: 'Running', value: 'running' },
        { label: 'Stopped', value: 'stopped' },
        { label: 'Failed', value: 'failed' },
      ],
      admin: {
        description: 'Token refresh workflow status',
        position: 'sidebar',
      },
    },

    // ===== Installation Metadata =====
    {
      name: 'installedBy',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      admin: {
        description: 'Orbit admin who installed the GitHub App',
        position: 'sidebar',
      },
    },
    {
      name: 'installedAt',
      type: 'date',
      required: true,
      defaultValue: () => new Date(),
      admin: {
        description: 'When the GitHub App was installed',
        readOnly: true,
        position: 'sidebar',
      },
    },

    // ===== Multi-Tenancy (Future) =====
    {
      name: 'tenant',
      type: 'relationship',
      relationTo: 'tenants',
      admin: {
        description: 'For multi-tenant SaaS (null = default tenant for self-hosted)',
        position: 'sidebar',
      },
    },
  ],

  hooks: {
    afterChange: [
      async ({ doc, operation, req }) => {
        // Future: Start Temporal workflow on create
        if (operation === 'create') {
          // TODO: Start GitHubTokenRefreshWorkflow
          console.log('[GitHub Installation] Created:', doc.id)
        }
      },
    ],
  },
}
```

#### Step 3.2: Register Collection in Payload Config

```typescript
// orbit-www/src/payload.config.ts
import { GitHubInstallations } from './collections/GitHubInstallations'

export default buildConfig({
  // ... existing config ...
  collections: [
    Users,
    Workspaces,
    Media,
    GitHubInstallations, // NEW
    // ... other collections ...
  ],
})
```

#### Step 3.3: Create Access Control Helper (if not exists)

```typescript
// orbit-www/src/access/isAdmin.ts
import { Access } from 'payload/types'

export const isAdmin: Access = ({ req: { user } }) => {
  return Boolean(user?.role === 'admin')
}
```

#### Step 3.4: Start Development Server and Verify

```bash
cd orbit-www
pnpm dev
```

Navigate to: `http://localhost:3000/admin/collections/github-installations`

**Expected**: Empty collection with admin UI visible

#### Step 3.5: Commit

```bash
git add orbit-www/src/collections/GitHubInstallations.ts
git add orbit-www/src/payload.config.ts
git add orbit-www/src/access/isAdmin.ts # if new
git commit -m "feat: add GitHub installations Payload collection

- Create github-installations collection schema
- Include all installation metadata fields
- Encrypted token storage (installationToken field)
- Workspace access mapping relationship
- Status tracking (active, suspended, refresh_failed)
- Temporal workflow ID tracking
- Admin-only access control

Collection provides admin UI for managing GitHub App installations.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Phase 2: GitHub App Installation Flow (Frontend)

### Task 4: Implement Installation Callback Handler ✅ COMPLETE

**Status**: ✅ Complete (2025-11-16)
**Files**: `orbit-www/src/app/api/github/installation/callback/route.ts`, `lib/github/octokit.ts`
**Goal**: Handle GitHub App installation callback and store encrypted token.

**Files**:
- Create: `orbit-www/src/app/api/github/installation/callback/route.ts`
- Create: `orbit-www/src/lib/github/octokit.ts` (GitHub API client)
- Create: `orbit-www/src/lib/github/types.ts` (TypeScript types)

#### Step 4.1: Create GitHub API Client

```typescript
// orbit-www/src/lib/github/octokit.ts
import { App } from '@octokit/app'
import { Octokit } from '@octokit/rest'
import fs from 'fs'

const GITHUB_APP_ID = process.env.GITHUB_APP_ID!
const GITHUB_APP_PRIVATE_KEY_PATH = process.env.GITHUB_APP_PRIVATE_KEY_PATH
const GITHUB_APP_PRIVATE_KEY_BASE64 = process.env.GITHUB_APP_PRIVATE_KEY_BASE64

if (!GITHUB_APP_ID) {
  throw new Error('GITHUB_APP_ID environment variable required')
}

// Load private key from file or base64 env var
let privateKey: string
if (GITHUB_APP_PRIVATE_KEY_BASE64) {
  privateKey = Buffer.from(GITHUB_APP_PRIVATE_KEY_BASE64, 'base64').toString('utf-8')
} else if (GITHUB_APP_PRIVATE_KEY_PATH) {
  privateKey = fs.readFileSync(GITHUB_APP_PRIVATE_KEY_PATH, 'utf-8')
} else {
  throw new Error('Either GITHUB_APP_PRIVATE_KEY_PATH or GITHUB_APP_PRIVATE_KEY_BASE64 required')
}

// Create GitHub App instance
export const githubApp = new App({
  appId: GITHUB_APP_ID,
  privateKey: privateKey,
})

/**
 * Get Octokit instance for a specific installation
 */
export async function getInstallationOctokit(installationId: number): Promise<Octokit> {
  return await githubApp.getInstallationOctokit(installationId)
}

/**
 * Create installation access token
 */
export async function createInstallationToken(installationId: number) {
  const octokit = await getInstallationOctokit(installationId)
  const { data } = await octokit.apps.createInstallationAccessToken({
    installation_id: installationId,
  })

  return {
    token: data.token,
    expiresAt: new Date(data.expires_at),
  }
}

/**
 * Get installation details from GitHub
 */
export async function getInstallation(installationId: number) {
  const octokit = await githubApp.getInstallationOctokit(installationId)
  const { data } = await octokit.apps.getInstallation({
    installation_id: installationId,
  })

  return data
}
```

#### Step 4.2: Add Dependencies

```bash
cd orbit-www
pnpm add @octokit/app @octokit/rest
```

#### Step 4.3: Create Installation Callback Route

```typescript
// orbit-www/src/app/api/github/installation/callback/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { encrypt } from '@/lib/encryption'
import { getInstallation, createInstallationToken } from '@/lib/github/octokit'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const installationId = searchParams.get('installation_id')
  const setupAction = searchParams.get('setup_action')
  const state = searchParams.get('state')

  // Verify state (CSRF protection)
  // TODO: Implement state verification with session storage

  if (!installationId) {
    return NextResponse.json(
      { error: 'Missing installation_id parameter' },
      { status: 400 }
    )
  }

  if (setupAction !== 'install' && setupAction !== 'update') {
    return NextResponse.json(
      { error: 'Invalid setup_action' },
      { status: 400 }
    )
  }

  try {
    const payload = await getPayload({ config: configPromise })

    // Get installation details from GitHub
    const installation = await getInstallation(Number(installationId))

    // Generate installation access token
    const { token, expiresAt } = await createInstallationToken(Number(installationId))

    // Encrypt token before storing
    const encryptedToken = encrypt(token)

    // Check if installation already exists (for updates)
    const existing = await payload.find({
      collection: 'github-installations',
      where: {
        installationId: {
          equals: Number(installationId),
        },
      },
      limit: 1,
    })

    if (existing.docs.length > 0 && setupAction === 'update') {
      // Update existing installation
      await payload.update({
        collection: 'github-installations',
        id: existing.docs[0].id,
        data: {
          installationToken: encryptedToken,
          tokenExpiresAt: expiresAt,
          tokenLastRefreshedAt: new Date(),
          repositorySelection: installation.repository_selection,
          selectedRepositories: installation.repositories?.map(repo => ({
            fullName: repo.full_name,
            id: repo.id,
            private: repo.private,
          })),
          status: 'active',
        },
      })

      // Redirect to configuration page
      return NextResponse.redirect(
        new URL(`/admin/collections/github-installations/${existing.docs[0].id}`, request.url)
      )
    }

    // Get current user from session
    // TODO: Implement proper session management
    // For now, assume admin user ID is available
    const adminUserId = 'admin-user-id' // Replace with actual user ID from session

    // Create new installation record
    const githubInstallation = await payload.create({
      collection: 'github-installations',
      data: {
        installationId: Number(installationId),
        accountLogin: installation.account.login,
        accountId: installation.account.id,
        accountType: installation.account.type as 'Organization' | 'User',
        accountAvatarUrl: installation.account.avatar_url,
        installationToken: encryptedToken,
        tokenExpiresAt: expiresAt,
        tokenLastRefreshedAt: new Date(),
        repositorySelection: installation.repository_selection,
        selectedRepositories: installation.repositories?.map(repo => ({
          fullName: repo.full_name,
          id: repo.id,
          private: repo.private,
        })),
        allowedWorkspaces: [], // Admin will configure
        status: 'active',
        installedBy: adminUserId,
        installedAt: new Date(),
        temporalWorkflowStatus: 'stopped', // Will be 'running' after workflow starts
      },
    })

    // TODO: Start Temporal token refresh workflow (Task 8)

    // Redirect to workspace configuration page
    return NextResponse.redirect(
      new URL(`/admin/settings/github/${githubInstallation.id}/configure`, request.url)
    )

  } catch (error) {
    console.error('[GitHub Installation Callback] Error:', error)
    return NextResponse.json(
      { error: 'Failed to process GitHub App installation' },
      { status: 500 }
    )
  }
}
```

#### Step 4.4: Test Installation Flow (Manual)

1. Start dev server: `pnpm dev`
2. Navigate to GitHub App installation URL (from Task 1)
3. Select repositories and install
4. Verify callback creates record in `github-installations` collection
5. Verify token is encrypted (check MongoDB directly)

**Expected**: Installation record created with encrypted token

#### Step 4.5: Commit

```bash
git add orbit-www/src/lib/github/
git add orbit-www/src/app/api/github/installation/callback/
git commit -m "feat: implement GitHub App installation callback handler

- Create GitHub API client with Octokit
- Handle installation callback from GitHub
- Fetch installation details from GitHub API
- Generate and encrypt installation access token
- Store installation in github-installations collection
- Support both new installations and updates

Next: Implement workspace configuration UI

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Build Installation Initiation UI ✅ COMPLETE

**Status**: ✅ Complete (2025-11-16)
**Files**: `orbit-www/src/app/(frontend)/settings/github/page.tsx`, `[id]/configure/page.tsx`
**Goal**: Create admin UI to initiate GitHub App installation.

**Files**:
- Create: `orbit-www/src/app/(app)/admin/settings/github/page.tsx`
- Create: `orbit-www/src/app/(app)/admin/settings/github/[id]/configure/page.tsx`

#### Step 5.1: Create GitHub Settings Admin Page

```typescript
// orbit-www/src/app/(app)/admin/settings/github/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'

const GITHUB_APP_NAME = process.env.NEXT_PUBLIC_GITHUB_APP_NAME || 'orbit-idp'

export default function GitHubSettingsPage() {
  const [installations, setInstallations] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchInstallations()
  }, [])

  async function fetchInstallations() {
    try {
      const res = await fetch('/api/github/installations')
      const data = await res.json()
      setInstallations(data.docs || [])
    } catch (error) {
      console.error('Failed to fetch installations:', error)
    } finally {
      setLoading(false)
    }
  }

  function handleInstallGitHubApp() {
    // Generate CSRF state token
    const state = crypto.randomUUID()
    sessionStorage.setItem('github_install_state', state)

    // Redirect to GitHub App installation page
    const installUrl = `https://github.com/apps/${GITHUB_APP_NAME}/installations/new?state=${state}`
    window.location.href = installUrl
  }

  if (loading) {
    return <div>Loading...</div>
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">GitHub App Installations</h1>
        <Button onClick={handleInstallGitHubApp}>
          + Install GitHub App
        </Button>
      </div>

      {installations.length === 0 ? (
        <Alert variant="info">
          <p className="font-semibold">No GitHub installations configured</p>
          <p className="text-sm mt-1">
            Install the Orbit IDP GitHub App into your GitHub organization to enable repository operations.
          </p>
          <Button className="mt-4" onClick={handleInstallGitHubApp}>
            Install GitHub App
          </Button>
        </Alert>
      ) : (
        <div className="space-y-4">
          {installations.map((install) => (
            <InstallationCard key={install.id} installation={install} />
          ))}
        </div>
      )}
    </div>
  )
}

function InstallationCard({ installation }) {
  const statusColors = {
    active: 'bg-green-100 text-green-800',
    suspended: 'bg-red-100 text-red-800',
    refresh_failed: 'bg-yellow-100 text-yellow-800',
  }

  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {installation.accountAvatarUrl && (
            <img
              src={installation.accountAvatarUrl}
              alt={installation.accountLogin}
              className="w-12 h-12 rounded"
            />
          )}
          <div>
            <h3 className="font-semibold">{installation.accountLogin}</h3>
            <p className="text-sm text-gray-600">
              {installation.repositorySelection === 'all'
                ? 'All repositories'
                : `${installation.selectedRepositories?.length || 0} selected repositories`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusColors[installation.status]}`}>
            {installation.status}
          </span>
          <Button
            variant="secondary"
            onClick={() => window.location.href = `/admin/settings/github/${installation.id}/configure`}
          >
            Configure
          </Button>
        </div>
      </div>

      {installation.status === 'suspended' && (
        <Alert variant="error" className="mt-4">
          <p className="font-semibold">GitHub App Uninstalled</p>
          <p className="text-sm">
            This GitHub App has been uninstalled. Repository operations will fail until reinstalled.
          </p>
        </Alert>
      )}

      <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
        <div>
          <p className="text-gray-600">Allowed Workspaces</p>
          <p className="font-medium">{installation.allowedWorkspaces?.length || 0}</p>
        </div>
        <div>
          <p className="text-gray-600">Installed By</p>
          <p className="font-medium">{installation.installedBy?.email || 'Unknown'}</p>
        </div>
        <div>
          <p className="text-gray-600">Token Status</p>
          <p className="font-medium">
            {installation.temporalWorkflowStatus === 'running' ? '✓ Auto-refreshing' : '⚠ Not refreshing'}
          </p>
        </div>
      </div>
    </div>
  )
}
```

#### Step 5.2: Create Workspace Configuration Page

```typescript
// orbit-www/src/app/(app)/admin/settings/github/[id]/configure/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'

export default function ConfigureInstallationPage() {
  const params = useParams()
  const router = useRouter()
  const [installation, setInstallation] = useState(null)
  const [workspaces, setWorkspaces] = useState([])
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    // Fetch installation details
    const installRes = await fetch(`/api/github/installations/${params.id}`)
    const installData = await installRes.json()
    setInstallation(installData)
    setSelectedWorkspaces(installData.allowedWorkspaces?.map(w => w.id) || [])

    // Fetch all workspaces
    const workspacesRes = await fetch('/api/workspaces')
    const workspacesData = await workspacesRes.json()
    setWorkspaces(workspacesData.docs || [])
  }

  async function handleSave() {
    setSaving(true)
    try {
      await fetch(`/api/github/installations/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allowedWorkspaces: selectedWorkspaces,
        }),
      })

      router.push('/admin/settings/github')
    } catch (error) {
      console.error('Failed to save configuration:', error)
    } finally {
      setSaving(false)
    }
  }

  if (!installation) {
    return <div>Loading...</div>
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-2">Configure GitHub Installation</h1>
      <p className="text-gray-600 mb-6">
        GitHub Organization: <strong>{installation.accountLogin}</strong>
      </p>

      <div className="bg-white border rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">Workspace Access</h2>
        <p className="text-sm text-gray-600 mb-4">
          Select which Orbit workspaces can use this GitHub installation for repository operations.
        </p>

        <div className="space-y-3">
          {workspaces.map((workspace) => (
            <label key={workspace.id} className="flex items-center gap-3 p-3 border rounded hover:bg-gray-50 cursor-pointer">
              <Checkbox
                checked={selectedWorkspaces.includes(workspace.id)}
                onChange={(checked) => {
                  if (checked) {
                    setSelectedWorkspaces([...selectedWorkspaces, workspace.id])
                  } else {
                    setSelectedWorkspaces(selectedWorkspaces.filter(id => id !== workspace.id))
                  }
                }}
              />
              <div>
                <p className="font-medium">{workspace.name}</p>
                <p className="text-sm text-gray-600">{workspace.slug}</p>
              </div>
            </label>
          ))}
        </div>

        {workspaces.length === 0 && (
          <p className="text-sm text-gray-500 italic">No workspaces available</p>
        )}
      </div>

      <div className="flex gap-3 mt-6">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Configuration'}
        </Button>
        <Button variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
```

#### Step 5.3: Add API Routes for Installation Management

```typescript
// orbit-www/src/app/api/github/installations/route.ts
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

export async function GET() {
  const payload = await getPayload({ config: configPromise })

  const installations = await payload.find({
    collection: 'github-installations',
    sort: '-installedAt',
  })

  return NextResponse.json(installations)
}
```

```typescript
// orbit-www/src/app/api/github/installations/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const payload = await getPayload({ config: configPromise })

  const installation = await payload.findByID({
    collection: 'github-installations',
    id: params.id,
  })

  return NextResponse.json(installation)
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await request.json()
  const payload = await getPayload({ config: configPromise })

  const updated = await payload.update({
    collection: 'github-installations',
    id: params.id,
    data: body,
  })

  return NextResponse.json(updated)
}
```

#### Step 5.4: Test Installation Flow End-to-End

1. Navigate to `/admin/settings/github`
2. Click "Install GitHub App"
3. Authorize on GitHub and select repos
4. Verify redirect to configuration page
5. Select workspaces and save
6. Verify installation appears in list

#### Step 5.5: Commit

```bash
git add orbit-www/src/app/(app)/admin/settings/github/
git add orbit-www/src/app/api/github/installations/
git commit -m "feat: add GitHub App installation admin UI

- Create GitHub settings page with installation list
- Add installation card component with status badges
- Build workspace configuration page
- Allow admins to select which workspaces can use each GitHub org
- Add API routes for installation management
- Complete installation flow: GitHub → Callback → Configure → Done

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Phase 3: Temporal Token Refresh Workflow

### Task 6: Implement Token Refresh Workflow (Go) ✅ COMPLETE

**Status**: ✅ Complete (2025-11-14)
**Files**: `temporal-workflows/internal/workflows/github_token_refresh_workflow.go`, `activities/github_token_activities.go`
**Goal**: Create long-running Temporal workflow that refreshes GitHub installation tokens every 50 minutes.

**Files**:
- Create: `temporal-workflows/internal/workflows/github_token_refresh_workflow.go`
- Create: `temporal-workflows/internal/workflows/github_token_refresh_workflow_test.go`
- Create: `temporal-workflows/internal/activities/github_token_activities.go`
- Create: `temporal-workflows/internal/activities/github_token_activities_test.go`

#### Step 6.1: Define Workflow Input/Output Types

```go
// temporal-workflows/internal/workflows/github_token_refresh_workflow.go
package workflows

import (
	"time"

	"go.temporal.io/sdk/workflow"
)

type GitHubTokenRefreshWorkflowInput struct {
	InstallationID string // Payload document ID (not GitHub installation ID)
}

type RefreshTokenResult struct {
	Success      bool
	ExpiresAt    time.Time
	ErrorMessage string
}

// GitHubTokenRefreshWorkflow continuously refreshes a GitHub App installation token
// This workflow runs indefinitely until cancelled (when app is uninstalled)
func GitHubTokenRefreshWorkflow(ctx workflow.Context, input GitHubTokenRefreshWorkflowInput) error {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting GitHub token refresh workflow", "installationId", input.InstallationID)

	// Activity options
	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    time.Minute,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	// Refresh token immediately on workflow start
	var result RefreshTokenResult
	err := workflow.ExecuteActivity(ctx, "RefreshGitHubInstallationTokenActivity", input.InstallationID).Get(ctx, &result)
	if err != nil {
		logger.Error("Initial token refresh failed", "error", err)
		// Mark as refresh_failed but continue trying
		workflow.ExecuteActivity(ctx, "UpdateInstallationStatusActivity", input.InstallationID, "refresh_failed", err.Error())
	} else {
		logger.Info("Initial token refresh succeeded", "expiresAt", result.ExpiresAt)
	}

	// Run indefinitely until workflow is cancelled
	for {
		// Sleep for 50 minutes (10 min before token expires)
		err := workflow.Sleep(ctx, 50*time.Minute)
		if err != nil {
			// Workflow cancelled (app uninstalled)
			logger.Info("Workflow cancelled, stopping token refresh", "error", err)
			return err
		}

		// Refresh token
		var result RefreshTokenResult
		err = workflow.ExecuteActivity(ctx, "RefreshGitHubInstallationTokenActivity", input.InstallationID).Get(ctx, &result)

		if err != nil {
			logger.Error("Token refresh failed", "error", err)
			// Update status but continue trying
			workflow.ExecuteActivity(ctx, "UpdateInstallationStatusActivity", input.InstallationID, "refresh_failed", err.Error())
		} else {
			logger.Info("Token refresh succeeded", "expiresAt", result.ExpiresAt)
			// Update status to active
			workflow.ExecuteActivity(ctx, "UpdateInstallationStatusActivity", input.InstallationID, "active", "")
		}
	}
}
```

#### Step 6.2: Implement Token Refresh Activity

```go
// temporal-workflows/internal/activities/github_token_activities.go
package activities

import (
	"context"
	"fmt"
	"time"
)

type GitHubTokenActivities struct {
	payloadClient PayloadClient
	githubClient  GitHubClient
	encryption    EncryptionService
}

func NewGitHubTokenActivities(
	payloadClient PayloadClient,
	githubClient GitHubClient,
	encryption EncryptionService,
) *GitHubTokenActivities {
	return &GitHubTokenActivities{
		payloadClient: payloadClient,
		githubClient:  githubClient,
		encryption:    encryption,
	}
}

type RefreshTokenResult struct {
	Success      bool
	ExpiresAt    time.Time
	ErrorMessage string
}

// RefreshGitHubInstallationTokenActivity refreshes a GitHub App installation token
func (a *GitHubTokenActivities) RefreshGitHubInstallationTokenActivity(
	ctx context.Context,
	installationID string,
) (RefreshTokenResult, error) {
	// Fetch installation from Payload
	installation, err := a.payloadClient.GetDocument(ctx, "github-installations", installationID)
	if err != nil {
		return RefreshTokenResult{
			Success:      false,
			ErrorMessage: fmt.Sprintf("failed to fetch installation: %v", err),
		}, err
	}

	// Get GitHub installation ID
	githubInstallationID := installation["installationId"].(int64)

	// Generate new installation access token from GitHub
	token, expiresAt, err := a.githubClient.CreateInstallationAccessToken(ctx, githubInstallationID)
	if err != nil {
		return RefreshTokenResult{
			Success:      false,
			ErrorMessage: fmt.Sprintf("failed to create token: %v", err),
		}, err
	}

	// Encrypt token
	encryptedToken, err := a.encryption.Encrypt(token)
	if err != nil {
		return RefreshTokenResult{
			Success:      false,
			ErrorMessage: fmt.Sprintf("failed to encrypt token: %v", err),
		}, err
	}

	// Update Payload document
	err = a.payloadClient.UpdateDocument(ctx, "github-installations", installationID, map[string]interface{}{
		"installationToken":      encryptedToken,
		"tokenExpiresAt":         expiresAt,
		"tokenLastRefreshedAt":   time.Now(),
		"status":                 "active",
		"temporalWorkflowStatus": "running",
	})
	if err != nil {
		return RefreshTokenResult{
			Success:      false,
			ErrorMessage: fmt.Sprintf("failed to update installation: %v", err),
		}, err
	}

	return RefreshTokenResult{
		Success:   true,
		ExpiresAt: expiresAt,
	}, nil
}

// UpdateInstallationStatusActivity updates the status of a GitHub installation
func (a *GitHubTokenActivities) UpdateInstallationStatusActivity(
	ctx context.Context,
	installationID string,
	status string,
	reason string,
) error {
	updates := map[string]interface{}{
		"status": status,
	}

	if reason != "" {
		updates["suspensionReason"] = reason
		if status == "suspended" {
			updates["suspendedAt"] = time.Now()
		}
	}

	return a.payloadClient.UpdateDocument(ctx, "github-installations", installationID, updates)
}
```

#### Step 6.3: Define Service Interfaces (Mock for Now)

```go
// temporal-workflows/internal/activities/interfaces.go
package activities

import (
	"context"
	"time"
)

// PayloadClient interface for interacting with Payload CMS
type PayloadClient interface {
	GetDocument(ctx context.Context, collection string, id string) (map[string]interface{}, error)
	UpdateDocument(ctx context.Context, collection string, id string, data map[string]interface{}) error
}

// GitHubClient interface for GitHub API operations
type GitHubClient interface {
	CreateInstallationAccessToken(ctx context.Context, installationID int64) (token string, expiresAt time.Time, err error)
}

// EncryptionService interface for encrypting/decrypting sensitive data
type EncryptionService interface {
	Encrypt(plaintext string) (string, error)
	Decrypt(ciphertext string) (string, error)
}
```

#### Step 6.4: Write Tests

```go
// temporal-workflows/internal/activities/github_token_activities_test.go
package activities_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
)

// Mock implementations
type MockPayloadClient struct {
	Documents map[string]map[string]interface{}
	Updates   []map[string]interface{}
}

func (m *MockPayloadClient) GetDocument(ctx context.Context, collection string, id string) (map[string]interface{}, error) {
	return m.Documents[id], nil
}

func (m *MockPayloadClient) UpdateDocument(ctx context.Context, collection string, id string, data map[string]interface{}) error {
	m.Updates = append(m.Updates, data)
	return nil
}

type MockGitHubClient struct {
	Token     string
	ExpiresAt time.Time
}

func (m *MockGitHubClient) CreateInstallationAccessToken(ctx context.Context, installationID int64) (string, time.Time, error) {
	return m.Token, m.ExpiresAt, nil
}

type MockEncryptionService struct{}

func (m *MockEncryptionService) Encrypt(plaintext string) (string, error) {
	return "encrypted:" + plaintext, nil
}

func (m *MockEncryptionService) Decrypt(ciphertext string) (string, error) {
	return ciphertext[10:], nil // Remove "encrypted:" prefix
}

func TestRefreshGitHubInstallationTokenActivity(t *testing.T) {
	mockPayload := &MockPayloadClient{
		Documents: map[string]map[string]interface{}{
			"install-123": {
				"installationId": int64(456),
				"accountLogin":   "mycompany",
			},
		},
		Updates: []map[string]interface{}{},
	}

	mockGitHub := &MockGitHubClient{
		Token:     "ghs_new_token_abc123",
		ExpiresAt: time.Now().Add(1 * time.Hour),
	}

	mockEncryption := &MockEncryptionService{}

	activities := activities.NewGitHubTokenActivities(mockPayload, mockGitHub, mockEncryption)

	result, err := activities.RefreshGitHubInstallationTokenActivity(context.Background(), "install-123")

	require.NoError(t, err)
	assert.True(t, result.Success)
	assert.Equal(t, mockGitHub.ExpiresAt, result.ExpiresAt)

	// Verify Payload was updated
	require.Len(t, mockPayload.Updates, 1)
	update := mockPayload.Updates[0]
	assert.Equal(t, "encrypted:ghs_new_token_abc123", update["installationToken"])
	assert.Equal(t, "active", update["status"])
	assert.Equal(t, "running", update["temporalWorkflowStatus"])
}

func TestUpdateInstallationStatusActivity(t *testing.T) {
	mockPayload := &MockPayloadClient{
		Updates: []map[string]interface{}{},
	}

	activities := activities.NewGitHubTokenActivities(mockPayload, nil, nil)

	err := activities.UpdateInstallationStatusActivity(context.Background(), "install-123", "suspended", "App uninstalled")

	require.NoError(t, err)
	require.Len(t, mockPayload.Updates, 1)

	update := mockPayload.Updates[0]
	assert.Equal(t, "suspended", update["status"])
	assert.Equal(t, "App uninstalled", update["suspensionReason"])
	assert.NotNil(t, update["suspendedAt"])
}
```

#### Step 6.5: Run Tests

```bash
cd temporal-workflows
go test -v ./internal/activities/github_token_activities_test.go
```

**Expected**: All tests pass

#### Step 6.6: Commit

```bash
git add temporal-workflows/internal/workflows/github_token_refresh_workflow.go
git add temporal-workflows/internal/activities/github_token_activities.go
git add temporal-workflows/internal/activities/github_token_activities_test.go
git add temporal-workflows/internal/activities/interfaces.go
git commit -m "feat: implement GitHub token refresh Temporal workflow

- Create long-running workflow that refreshes tokens every 50 min
- Implement RefreshGitHubInstallationTokenActivity
- Implement UpdateInstallationStatusActivity
- Define service interfaces (PayloadClient, GitHubClient, EncryptionService)
- Comprehensive tests with mocks
- Workflow runs indefinitely until cancelled (app uninstalled)

Tokens expire after 1 hour, refresh 10 min before expiry.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: Integrate Workflow Startup with Installation Callback ✅ COMPLETE

**Status**: ✅ Complete (2025-11-14)
**Files**: `orbit-www/src/lib/temporal/client.ts`, modified callback route
**Goal**: Start Temporal workflow when GitHub App is installed.

**Files**:
- Modify: `orbit-www/src/app/api/github/installation/callback/route.ts`
- Create: `orbit-www/src/lib/temporal/client.ts` (Temporal client for Node.js)

#### Step 7.1: Create Temporal Client

```typescript
// orbit-www/src/lib/temporal/client.ts
import { Connection, Client } from '@temporalio/client'

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS || 'localhost:7233'

let temporalClient: Client | null = null

export async function getTemporalClient(): Promise<Client> {
  if (!temporalClient) {
    const connection = await Connection.connect({ address: TEMPORAL_ADDRESS })
    temporalClient = new Client({ connection })
  }
  return temporalClient
}

/**
 * Start GitHub token refresh workflow
 */
export async function startGitHubTokenRefreshWorkflow(installationId: string): Promise<string> {
  const client = await getTemporalClient()

  const workflowId = `github-token-refresh:${installationId}`

  const handle = await client.workflow.start('GitHubTokenRefreshWorkflow', {
    taskQueue: 'orbit-workflows',
    args: [{
      InstallationID: installationId,
    }],
    workflowId,
    // Run indefinitely until cancelled
  })

  return handle.workflowId
}

/**
 * Cancel GitHub token refresh workflow
 */
export async function cancelGitHubTokenRefreshWorkflow(workflowId: string): Promise<void> {
  const client = await getTemporalClient()
  const handle = client.workflow.getHandle(workflowId)
  await handle.cancel()
}
```

#### Step 7.2: Add Temporal Client Dependency

```bash
cd orbit-www
pnpm add @temporalio/client
```

#### Step 7.3: Update Installation Callback to Start Workflow

```typescript
// orbit-www/src/app/api/github/installation/callback/route.ts
import { startGitHubTokenRefreshWorkflow } from '@/lib/temporal/client'

// ... existing imports and code ...

export async function GET(request: NextRequest) {
  // ... existing installation creation code ...

  try {
    // ... create installation record ...

    const githubInstallation = await payload.create({
      collection: 'github-installations',
      data: {
        // ... existing fields ...
        temporalWorkflowStatus: 'starting',
      },
    })

    // Start Temporal token refresh workflow
    let workflowId: string
    try {
      workflowId = await startGitHubTokenRefreshWorkflow(githubInstallation.id)

      // Update installation with workflow ID
      await payload.update({
        collection: 'github-installations',
        id: githubInstallation.id,
        data: {
          temporalWorkflowId: workflowId,
          temporalWorkflowStatus: 'running',
        },
      })
    } catch (workflowError) {
      console.error('[GitHub Installation] Failed to start workflow:', workflowError)

      // Mark workflow as failed but don't fail installation
      await payload.update({
        collection: 'github-installations',
        id: githubInstallation.id,
        data: {
          temporalWorkflowStatus: 'failed',
        },
      })
    }

    // ... existing redirect code ...
  } catch (error) {
    // ... existing error handling ...
  }
}
```

#### Step 7.4: Test End-to-End Flow

1. Install GitHub App (triggers callback)
2. Verify installation record created
3. Check Temporal UI: http://localhost:8080
4. Verify workflow started: `github-token-refresh:install-<id>`
5. Wait 50+ minutes and verify token refreshed (or manually trigger activity)

#### Step 7.5: Commit

```bash
git add orbit-www/src/lib/temporal/
git add orbit-www/src/app/api/github/installation/callback/route.ts
git commit -m "feat: integrate Temporal workflow startup with installation

- Create Temporal client for Node.js
- Implement startGitHubTokenRefreshWorkflow helper
- Start workflow immediately after installation
- Store workflow ID in installation document
- Track workflow status (starting, running, failed)

Token refresh now fully automated on installation.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Phase 4: Webhook Handling & Lifecycle Management

### Task 8: Implement GitHub App Webhooks ✅ COMPLETE

**Status**: ✅ Complete (2025-11-14)
**Files**: `orbit-www/src/app/api/github/webhooks/route.ts`, `lib/github/webhooks.ts`
**Goal**: Handle GitHub App uninstall/suspend events to stop workflows and update status.

**Files**:
- Create: `orbit-www/src/app/api/github/webhooks/route.ts`
- Create: `orbit-www/src/lib/github/webhooks.ts` (signature verification)

#### Step 8.1: Implement Webhook Signature Verification

```typescript
// orbit-www/src/lib/github/webhooks.ts
import crypto from 'crypto'

const WEBHOOK_SECRET = process.env.GITHUB_APP_WEBHOOK_SECRET!

if (!WEBHOOK_SECRET) {
  throw new Error('GITHUB_APP_WEBHOOK_SECRET environment variable required')
}

/**
 * Verify GitHub webhook signature
 */
export function verifyWebhookSignature(payload: string, signature: string): boolean {
  if (!signature) {
    return false
  }

  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET)
  const digest = 'sha256=' + hmac.update(payload).digest('hex')

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(digest)
  )
}
```

#### Step 8.2: Create Webhook Handler

```typescript
// orbit-www/src/app/api/github/webhooks/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { verifyWebhookSignature } from '@/lib/github/webhooks'
import { cancelGitHubTokenRefreshWorkflow } from '@/lib/temporal/client'

export async function POST(request: NextRequest) {
  const signature = request.headers.get('x-hub-signature-256')
  const payload = await request.text()

  // Verify webhook signature
  if (!signature || !verifyWebhookSignature(payload, signature)) {
    console.error('[GitHub Webhook] Invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const event = JSON.parse(payload)
  const action = event.action

  console.log('[GitHub Webhook] Received event:', action, 'for installation:', event.installation?.id)

  const payloadCMS = await getPayload({ config: configPromise })

  try {
    switch (action) {
      case 'deleted': {
        // GitHub App uninstalled
        await handleAppUninstalled(payloadCMS, event.installation.id)
        break
      }

      case 'suspend': {
        // GitHub App suspended
        await handleAppSuspended(payloadCMS, event.installation.id)
        break
      }

      case 'unsuspend': {
        // GitHub App unsuspended
        await handleAppUnsuspended(payloadCMS, event.installation.id)
        break
      }

      case 'new_permissions_accepted': {
        // Permissions updated
        console.log('[GitHub Webhook] Permissions updated for installation:', event.installation.id)
        break
      }

      default:
        console.log('[GitHub Webhook] Unhandled action:', action)
    }

    return NextResponse.json({ status: 'ok' })

  } catch (error) {
    console.error('[GitHub Webhook] Error handling webhook:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

async function handleAppUninstalled(payload: any, githubInstallationId: number) {
  // Find installation by GitHub installation ID
  const installations = await payload.find({
    collection: 'github-installations',
    where: {
      installationId: {
        equals: githubInstallationId,
      },
    },
    limit: 1,
  })

  if (installations.docs.length === 0) {
    console.warn('[GitHub Webhook] Installation not found:', githubInstallationId)
    return
  }

  const installation = installations.docs[0]

  // Cancel Temporal workflow
  if (installation.temporalWorkflowId) {
    try {
      await cancelGitHubTokenRefreshWorkflow(installation.temporalWorkflowId)
      console.log('[GitHub Webhook] Cancelled workflow:', installation.temporalWorkflowId)
    } catch (error) {
      console.error('[GitHub Webhook] Failed to cancel workflow:', error)
    }
  }

  // Update installation status
  await payload.update({
    collection: 'github-installations',
    id: installation.id,
    data: {
      status: 'suspended',
      suspendedAt: new Date(),
      suspensionReason: 'GitHub App uninstalled by user',
      temporalWorkflowStatus: 'stopped',
    },
  })

  console.log('[GitHub Webhook] Installation marked as suspended:', installation.id)
}

async function handleAppSuspended(payload: any, githubInstallationId: number) {
  // Similar to uninstalled
  await handleAppUninstalled(payload, githubInstallationId)
}

async function handleAppUnsuspended(payload: any, githubInstallationId: number) {
  const installations = await payload.find({
    collection: 'github-installations',
    where: {
      installationId: {
        equals: githubInstallationId,
      },
    },
    limit: 1,
  })

  if (installations.docs.length === 0) {
    return
  }

  const installation = installations.docs[0]

  // Reactivate installation
  await payload.update({
    collection: 'github-installations',
    id: installation.id,
    data: {
      status: 'active',
      suspendedAt: null,
      suspensionReason: null,
    },
  })

  // Restart workflow
  // TODO: Implement workflow restart logic

  console.log('[GitHub Webhook] Installation reactivated:', installation.id)
}
```

#### Step 8.3: Test Webhook Handling

**Manual Testing:**
1. Use GitHub webhook test events (in GitHub App settings)
2. Or use ngrok to expose local dev server
3. Trigger uninstall event
4. Verify installation marked as suspended
5. Verify Temporal workflow cancelled

**Unit Test** (future):
```bash
# Add test for webhook signature verification
cd orbit-www
pnpm exec vitest run src/lib/github/webhooks.test.ts
```

#### Step 8.4: Commit

```bash
git add orbit-www/src/lib/github/webhooks.ts
git add orbit-www/src/app/api/github/webhooks/route.ts
git commit -m "feat: implement GitHub App webhook handling

- Verify webhook signatures with HMAC SHA256
- Handle 'deleted' event (app uninstalled)
- Handle 'suspend' and 'unsuspend' events
- Cancel Temporal workflow on uninstall
- Update installation status in database
- Log all webhook events for debugging

Webhooks keep installation status in sync with GitHub.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Phase 5: Integration with Repository Workflows

### Task 9: Update Git Activities to Use Installation Tokens ⏳ PENDING

**Status**: ⏳ Not Started - Blocked by finalizing Git activities implementation
**Next Steps**:
- Add `WorkspaceID` to activity input structs
- Implement `findGitHubInstallationForWorkspace()` helper
- Update `PushToRemoteActivity` to decrypt and use installation token
- Update `InitializeGitActivity` for commit attribution
**Goal**: Modify `PushToRemoteActivity` and related Git activities to use GitHub installation tokens.

**Files**:
- Modify: `temporal-workflows/internal/activities/git_activities.go`
- Modify: `temporal-workflows/internal/workflows/repository_workflow.go`
- Modify: All activity input structs

#### Step 9.1: Update Activity Input Structs

```go
// temporal-workflows/internal/activities/git_activities.go

// Remove UserID (no longer needed - using installation token)
// Keep WorkspaceID (needed to find installation)

type PushToRemoteInput struct {
	RepositoryID string
	WorkspaceID  string // Used to find GitHub installation
}

type CloneTemplateInput struct {
	TemplateName string
	RepositoryID string
	WorkspaceID  string // NEW: For future private template repos
}

type InitializeGitInput struct {
	RepositoryID         string
	GitURL               string
	WorkspaceID          string
	RequestedByUsername  string // For commit attribution
	TemplateName         string // For commit message
}
```

#### Step 9.2: Add PayloadClient Dependency to GitActivities

```go
// temporal-workflows/internal/activities/git_activities.go

type GitActivities struct {
	workDir       string
	payloadClient PayloadClient    // NEW
	encryption    EncryptionService // NEW
}

func NewGitActivities(
	workDir string,
	payloadClient PayloadClient,
	encryption EncryptionService,
) *GitActivities {
	return &GitActivities{
		workDir:       workDir,
		payloadClient: payloadClient,
		encryption:    encryption,
	}
}
```

#### Step 9.3: Implement Installation Token Lookup

```go
// temporal-workflows/internal/activities/git_activities.go

// findGitHubInstallationForWorkspace finds an active GitHub installation
// that is allowed to be used by the specified workspace
func (a *GitActivities) findGitHubInstallationForWorkspace(
	ctx context.Context,
	workspaceID string,
) (map[string]interface{}, error) {
	// Query Payload for installations where allowedWorkspaces contains this workspace
	installations, err := a.payloadClient.FindDocuments(ctx, "github-installations", map[string]interface{}{
		"allowedWorkspaces": map[string]interface{}{
			"contains": workspaceID,
		},
		"status": "active",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to query installations: %w", err)
	}

	if len(installations) == 0 {
		return nil, fmt.Errorf("no active GitHub installation found for workspace %s", workspaceID)
	}

	// Use first installation (future: allow user to select)
	return installations[0], nil
}
```

#### Step 9.4: Update PushToRemoteActivity Implementation

```go
// temporal-workflows/internal/activities/git_activities.go

func (a *GitActivities) PushToRemoteActivity(ctx context.Context, input PushToRemoteInput) error {
	if input.WorkspaceID == "" {
		return errors.New("workspace_id is required")
	}

	repoPath := filepath.Join(a.workDir, input.RepositoryID)

	// Check if repository exists
	if _, err := os.Stat(repoPath); os.IsNotExist(err) {
		return errors.New("repository directory does not exist")
	}

	// Verify remote exists
	cmd := exec.CommandContext(ctx, "git", "remote", "get-url", "origin")
	cmd.Dir = repoPath
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("no remote configured: %w", err)
	}

	// Find GitHub installation for this workspace
	installation, err := a.findGitHubInstallationForWorkspace(ctx, input.WorkspaceID)
	if err != nil {
		return fmt.Errorf("GitHub installation not available: %w\n\nPlease ask an admin to configure GitHub integration for this workspace.", err)
	}

	// Decrypt installation token
	encryptedToken := installation["installationToken"].(string)
	token, err := a.encryption.Decrypt(encryptedToken)
	if err != nil {
		return fmt.Errorf("failed to decrypt GitHub token: %w", err)
	}

	// Create temporary credential helper script
	credHelper, err := a.createCredentialHelper(token)
	if err != nil {
		return fmt.Errorf("failed to create credential helper: %w", err)
	}
	defer os.Remove(credHelper)

	// Push to remote using installation token
	cmd = exec.CommandContext(ctx, "git", "push", "-u", "origin", "main")
	cmd.Dir = repoPath
	cmd.Env = append(os.Environ(),
		fmt.Sprintf("GIT_ASKPASS=%s", credHelper),
		// Bot identity already set in InitializeGitActivity
	)

	output, err := cmd.CombinedOutput()
	if err != nil {
		// Check if already pushed (idempotency)
		if strings.Contains(string(output), "Everything up-to-date") {
			return nil
		}
		return fmt.Errorf("failed to push to remote: %w (output: %s)", err, string(output))
	}

	return nil
}
```

#### Step 9.5: Update InitializeGitActivity for Commit Attribution

```go
// temporal-workflows/internal/activities/git_activities.go

func (a *GitActivities) InitializeGitActivity(ctx context.Context, input InitializeGitInput) error {
	// ... existing initialization code ...

	// Configure Git user as bot
	configName := exec.CommandContext(ctx, "git", "config", "user.name", "Orbit IDP")
	configName.Dir = repoPath
	if err := configName.Run(); err != nil {
		return fmt.Errorf("failed to configure git user.name: %w", err)
	}

	configEmail := exec.CommandContext(ctx, "git", "config", "user.email", "bot@orbit.dev")
	configEmail.Dir = repoPath
	if err := configEmail.Run(); err != nil {
		return fmt.Errorf("failed to configure git user.email: %w", err)
	}

	// ... add files ...

	// Create initial commit with attribution
	commitMsg := fmt.Sprintf(
		"Initial commit from Orbit IDP\n\nGenerated from template: %s\nRequested by: @%s",
		input.TemplateName,
		input.RequestedByUsername,
	)

	commitCmd := exec.CommandContext(ctx, "git", "commit", "-m", commitMsg)
	commitCmd.Dir = repoPath
	if err := commitCmd.Run(); err != nil {
		// ... error handling ...
	}

	// ... add remote ...

	return nil
}
```

#### Step 9.6: Update Workflow to Pass WorkspaceID

```go
// temporal-workflows/internal/workflows/repository_workflow.go

type RepositoryWorkflowInput struct {
	RepositoryID         string
	WorkspaceID          string // REQUIRED
	RequestedByUsername  string // NEW: For commit attribution
	TemplateName         string
	Variables            map[string]string
	GitURL               string
}

func RepositoryWorkflow(ctx workflow.Context, input RepositoryWorkflowInput) error {
	// ... existing code ...

	// Task 4: Push to remote (now uses installation token)
	err = workflow.ExecuteActivity(ctx, "PushToRemoteActivity", PushToRemoteInput{
		RepositoryID: input.RepositoryID,
		WorkspaceID:  input.WorkspaceID,
	}).Get(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to push to remote: %w", err)
	}

	return nil
}
```

#### Step 9.7: Write Tests with Mock Installation

```go
// temporal-workflows/internal/activities/git_activities_test.go

func TestPushToRemoteActivity_WithInstallation(t *testing.T) {
	tempDir := t.TempDir()

	// Initialize test repo
	exec.Command("git", "init", tempDir).Run()
	exec.Command("git", "-C", tempDir, "remote", "add", "origin", "https://github.com/test/repo.git").Run()

	mockPayload := &MockPayloadClient{
		Documents: map[string][]map[string]interface{}{
			"github-installations": {
				{
					"id":                  "install-123",
					"installationToken":   "encrypted:ghs_test_token",
					"status":              "active",
					"allowedWorkspaces":   []string{"workspace-123"},
				},
			},
		},
	}

	mockEncryption := &MockEncryptionService{}

	activities := NewGitActivities(tempDir, mockPayload, mockEncryption)

	input := PushToRemoteInput{
		RepositoryID: "test-repo",
		WorkspaceID:  "workspace-123",
	}

	// Will fail because no real remote, but verifies installation lookup
	err := activities.PushToRemoteActivity(context.Background(), input)

	// Verify installation was queried
	assert.True(t, mockPayload.FindDocumentsCalled)

	// Error expected (no real remote), but should not be "installation not found"
	if err != nil {
		assert.NotContains(t, err.Error(), "installation not available")
	}
}

func TestPushToRemoteActivity_NoInstallation(t *testing.T) {
	mockPayload := &MockPayloadClient{
		Documents: map[string][]map[string]interface{}{
			"github-installations": {}, // No installations
		},
	}

	activities := NewGitActivities("/tmp", mockPayload, nil)

	input := PushToRemoteInput{
		RepositoryID: "test-repo",
		WorkspaceID:  "workspace-999",
	}

	err := activities.PushToRemoteActivity(context.Background(), input)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "GitHub installation not available")
	assert.Contains(t, err.Error(), "Please ask an admin")
}
```

#### Step 9.8: Run Tests

```bash
cd temporal-workflows
go test -v ./internal/activities/
```

#### Step 9.9: Commit

```bash
git add temporal-workflows/internal/activities/git_activities.go
git add temporal-workflows/internal/activities/git_activities_test.go
git add temporal-workflows/internal/workflows/repository_workflow.go
git commit -m "feat: update Git activities to use GitHub installation tokens

- Remove UserID from activity inputs (use installation token)
- Add WorkspaceID to find GitHub installation
- Implement findGitHubInstallationForWorkspace helper
- Update PushToRemoteActivity to use installation token
- Update InitializeGitActivity with commit attribution
- Add RequestedByUsername to workflow input
- Comprehensive tests with mock installations
- User-friendly error when installation not configured

Operations now use org-level GitHub App installation.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Phase 6: Documentation & SOPs

### Task 10: Create GitHub App Installation SOP ✅ COMPLETE

**Status**: ✅ Complete (2025-11-13)
**Files**: `.agent/SOPs/github-app-installation.md`
**Goal**: Document the GitHub App installation pattern for future development.

**Files**:
- Create: `.agent/SOPs/github-app-installation.md`

*(Content provided in separate file - see comprehensive SOP document)*

#### Step 10.1: Write SOP

```bash
# See separate file: github-app-installation-sop.md
# Copy to .agent/SOPs/github-app-installation.md
```

#### Step 10.2: Commit

```bash
git add .agent/SOPs/github-app-installation.md
git commit -m "docs: add GitHub App installation SOP

- Document enterprise app installation pattern
- Include Payload collection schema
- Document token refresh workflow
- Include webhook handling procedures
- Add workspace access mapping guidelines
- Reference from backend activities plan

Constitutional requirement for org-level integrations.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 11: Rename User OAuth SOP ✅ COMPLETE

**Status**: ✅ Complete (2025-11-13)
**Files**: `.agent/SOPs/user-oauth-integrations.md` (renamed from user-driven-authentication.md)
**Goal**: Clarify that existing user OAuth SOP is for personal integrations, not GitHub.

**Files**:
- Rename: `.agent/SOPs/user-driven-authentication.md` → `.agent/SOPs/user-oauth-integrations.md`
- Update: `.agent/SOPs/user-oauth-integrations.md` (add note about GitHub App)

#### Step 11.1: Rename File

```bash
cd .agent/SOPs
git mv user-driven-authentication.md user-oauth-integrations.md
```

#### Step 11.2: Update SOP Header

```markdown
# SOP: User OAuth Integrations (Personal Services)

**Created**: 2025-01-13
**Last Updated**: 2025-11-13
**Trigger**: When implementing user-level OAuth integrations (Notion, personal APIs)

## Scope

This SOP covers **user-level OAuth integrations** for personal services like:
- Notion (personal workspace)
- Google Drive (personal files)
- Slack (personal DMs)

**NOT covered by this SOP:**
- ❌ GitHub integration (use `.agent/SOPs/github-app-installation.md` instead)
- ❌ Other org-level app installations (follow GitHub App pattern)

For **organization-level integrations** (GitHub, Confluence, Jira), see:
- `.agent/SOPs/github-app-installation.md` (enterprise app installation pattern)

---

## Core Principle

**User-Context Authentication**: User-level integrations MUST use the authenticated user's OAuth token...

*(Rest of existing content)*
```

#### Step 11.3: Commit

```bash
git add .agent/SOPs/user-oauth-integrations.md
git commit -m "docs: rename and clarify user OAuth SOP scope

- Rename: user-driven-authentication.md → user-oauth-integrations.md
- Add scope clarification (user-level, not org-level)
- Reference GitHub App SOP for org-level integrations
- Preserve existing content for Notion, personal APIs, etc.

Prevents confusion between user OAuth and GitHub App patterns.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 12: Update Backend Activities Plan ✅ COMPLETE

**Status**: ✅ Complete (2025-11-13)
**Files**: `docs/plans/2025-11-02-backend-activities-implementation.md` (added IMPORTANT DEPENDENCY section)
**Goal**: Add dependency note to backend activities plan pointing to this plan.

**Files**:
- Modify: `docs/plans/2025-11-02-backend-activities-implementation.md`

#### Step 12.1: Add Dependency Section at Top

```markdown
# Backend Activities Implementation Plan (C3)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**IMPORTANT DEPENDENCY**: This plan depends on **GitHub App Installation** being implemented first.

**See**: `docs/plans/2025-11-13-github-app-installation.md`

**Why**: Tasks 4+ require GitHub App installation tokens for authentication. Before continuing with this plan:
1. Complete all tasks in GitHub App installation plan
2. Verify GitHub App installed and token refresh working
3. Verify workspace access mapping configured
4. Then resume this plan at Task 4

---

**Goal:** Replace stubbed Temporal activity implementations with real Git operations...

*(Rest of existing content)*
```

#### Step 12.2: Update Task 4 Authentication Section

```markdown
## Task 4: Implement Push to Remote Activity

**PREREQUISITE**: GitHub App installation must be complete (see `docs/plans/2025-11-13-github-app-installation.md`)

**Goal:** Push repository to remote Git provider using GitHub App installation token.

**🔒 AUTHENTICATION REQUIREMENT:**
- MUST use GitHub App installation token (from `github-installations` collection)
- MUST NOT use user OAuth or service account credentials
- Repository is created in GitHub org where App is installed
- Commits show "Orbit IDP <bot@orbit.dev>" as author
- Commit message includes username attribution
- See: `.agent/SOPs/github-app-installation.md`

*(Rest of Task 4 content - already updated in earlier analysis)*
```

#### Step 12.3: Commit

```bash
git add docs/plans/2025-11-02-backend-activities-implementation.md
git commit -m "docs: add GitHub App dependency to backend activities plan

- Add IMPORTANT DEPENDENCY section at top
- Link to GitHub App installation plan
- Clarify prerequisite for Task 4+
- Update Task 4 authentication requirements
- Reference GitHub App SOP

Makes dependency explicit before implementation.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Summary & Next Steps

**Total Tasks**: 12 (across 6 phases)
**Completed**: 10/12 tasks (83%)
**Status**:
- ✅ Phase 1: Foundation (Tasks 2-3) - **COMPLETE**
- ⚠️ Phase 1: GitHub App Registration (Task 1) - **USER ACTION REQUIRED**
- ✅ Phase 2: Installation Flow (Tasks 4-5) - **COMPLETE**
- ✅ Phase 3: Token Refresh (Tasks 6-7) - **COMPLETE**
- ✅ Phase 4: Webhooks (Task 8) - **COMPLETE**
- ⏳ Phase 5: Integration (Task 9) - **PENDING**
- ✅ Phase 6: Documentation (Tasks 10-12) - **COMPLETE**

**Dependencies**: Payload CMS ✅, Temporal ✅, GitHub App registration ⚠️ (user must register)

### **Implementation Order**

**Phase 1: Foundation** (Tasks 1-3, ~2-3 hours)
- Register GitHub App on GitHub
- Implement encryption
- Create Payload collection

**Phase 2: Installation Flow** (Tasks 4-5, ~3-4 hours)
- Installation callback handler
- Admin UI for installation

**Phase 3: Token Refresh** (Tasks 6-7, ~3-4 hours)
- Temporal workflow
- Workflow startup integration

**Phase 4: Webhooks** (Task 8, ~2 hours)
- Webhook handling
- Lifecycle management

**Phase 5: Integration** (Task 9, ~2-3 hours)
- Update Git activities
- Remove user OAuth approach

**Phase 6: Documentation** (Tasks 10-12, ~1-2 hours)
- SOPs
- Update plans

### **Remaining Work**

**Before Full Completion:**
1. **Task 1 (User Action)**: Register GitHub App on GitHub
   - Navigate to https://github.com/settings/apps/new
   - Follow configuration in Task 1 steps
   - Save credentials to `.env`

2. **Task 9 (Development)**: Update Git activities to use installation tokens
   - Implement in `temporal-workflows/internal/activities/git_activities.go`
   - See detailed implementation steps in Task 9

**After Full Completion:**

This plan will unblock:
- ✅ Backend Activities Plan (Task 4: PushToRemoteActivity)
- ✅ Repository creation workflows
- ✅ Future org-level integrations (Confluence, Jira)

### **Testing Strategy**

- **Unit Tests**: Mock Payload, GitHub, encryption services
- **Integration Tests**: Real GitHub App in test org
- **E2E Tests**: Full installation → token refresh → push flow
- **Manual Tests**: Install/uninstall in development

### **Production Readiness Checklist**

Before deploying to production:
- [ ] GitHub App registered in production GitHub
- [ ] Encryption key rotated and stored securely (KMS/Vault)
- [ ] Webhook endpoint publicly accessible (HTTPS)
- [ ] Temporal workflow monitoring configured
- [ ] Admin documentation for installing GitHub App
- [ ] User documentation for workspace GitHub access
- [ ] Error handling tested (app uninstall, token refresh failure)
- [ ] Multi-tenancy tested (if applicable)

---

**Plan complete. Ready for implementation using `superpowers:executing-plans`.**
